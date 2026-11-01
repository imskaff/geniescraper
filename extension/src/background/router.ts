// Maps the extension pages' requests onto the Apple Music client and the paste session.
// Album detection runs one at a time. Track reads run as many at once as the panel asks for, never more than
// MAX_OPEN_TABS, so a long album cannot open a tab per track. Paste changes are serialised by the paste service.
import { isPasteCommand, isWorkerRequest, type AlbumInfo, type Result, type WorkerRequest } from "../shared/messages";
import { detectAlbum, scrapeTrack, type ClientTiming } from "./providerClient";
import type { CoverService } from "./covers";
import { NO_YOUTUBE, type YoutubeService } from "./youtube";
import type { KeyCheck } from "../shared/messages";
import type { PasteService } from "./paste";
import type { BrowserPorts } from "./ports";
import type { GeniusNavigator } from "./geniusNav";
import { recogniseUrl } from "../providers/registry";
import type { CreditsProvider } from "../providers/types";
import { Limiter, PoliteQueue, REAL_CLOCK, Serial, type Clock } from "./serial";

/** Hidden tabs open at once, whatever the panel asks for. */
export const MAX_OPEN_TABS = 24;

const NO_GENIUS: GeniusNavigator = { open: () => Promise.resolve({ status: "failed" }) };
/** After a site asks for a captcha, it is not read again for this long, so the user can look at it first. */
export const BLOCKED_PAUSE_MS = 15 * 60_000;

/** Failures that say something about the site or the connection rather than about one track. */
const PUSHBACK_CODES: ReadonlySet<string> = new Set(["blocked", "tab-failed", "timeout", "internal"]);

const NO_LINK = { url: "", isMusicVideo: false, keyProblem: "" } as const;

export const INTERNAL_ERROR: Result<never> = {
  ok: false,
  error: { code: "internal", message: "Something went wrong inside the extension." },
};

export type Router = (raw: unknown) => Promise<Result<unknown>>;

/**
 * Settle the album's cover. Apple's catalog lookup is exact and wins over the page header, which shows only motion
 * artwork for some albums; a title search is the last resort, since it can return another edition.
 */
async function withCover(album: AlbumInfo, exact: string, covers: CoverService): Promise<AlbumInfo> {
  let cover = exact || album.coverArtUrl;
  if (!cover && album.albumTitle && album.artist) cover = await covers.search(album.albumTitle, album.artist);
  return { ...album, coverArtUrl: cover };
}

/** A /song/ page has no footer, so its album's ℗ and © lines come from the iTunes lookup (best effort). */
async function withSongCopyright(album: AlbumInfo, url: string, covers: CoverService): Promise<AlbumInfo> {
  if (
    !url.includes("music.apple.com") ||
    !url.includes("/song/") ||
    album.phonographicCopyright ||
    album.copyrightNotice
  )
    return album;
  const [phonographicCopyright, copyrightNotice] = (await covers.copyright?.(url).catch(() => undefined)) ?? ["", ""];
  return { ...album, phonographicCopyright, copyrightNotice };
}

export function createRouter(
  ports: BrowserPorts,
  timing: ClientTiming,
  paste: PasteService,
  covers: CoverService,
  youtube: YoutubeService = NO_YOUTUBE,
  checkKey: (key: string) => Promise<KeyCheck> = () => Promise.resolve("failed"),
  genius: GeniusNavigator = NO_GENIUS,
  clock: Clock = REAL_CLOCK,
): Router {
  const serial = new Serial();
  const reads = new Limiter(MAX_OPEN_TABS);
  const direct = { run: <T>(job: () => Promise<T>): Promise<T> => job() };
  // Sites read politely get a queue of their own, and are left alone for a while once they ask for a captcha.
  const polite = new Map<string, PoliteQueue>();
  const blockedUntil = new Map<string, number>();
  const politeQueue = (provider: CreditsProvider): PoliteQueue => {
    let queue = polite.get(provider.id);
    if (!queue) {
      queue = new PoliteQueue(provider.readGapMs ?? 0, provider.readConcurrency ?? 1, clock);
      polite.set(provider.id, queue);
    }
    return queue;
  };

  // A job that throws something nobody planned for still has to answer: the panel waits on the reply, and a
  // rejected promise in the worker's listener would leave it with a closed message channel and no explanation.
  return (raw) => handle(raw).catch(() => INTERNAL_ERROR);

  function handle(raw: unknown): Promise<Result<unknown>> {
    if (!isWorkerRequest(raw)) {
      return Promise.resolve({ ok: false, error: { code: "bad-request", message: "Unrecognised request." } });
    }
    // Pasting must stay responsive while an album is being read, so it does not wait in the reads' queue.
    if (isPasteCommand(raw)) return paste.command(raw);

    // Opening a song on Genius waits for a page, not for the reads, and a read never waits for it.
    if (raw.type === "genius-open") {
      const stopKeepAlive = ports.keepAlive();
      return genius
        .open(raw.title, raw.artist)
        .then((data): Result<unknown> => ({ ok: true, data }))
        .finally(stopKeepAlive);
    }

    // A politely read site is never opened in parallel, whatever the panel asks for. Reading the user's own tab opens
    // nothing, so it needs no pause.
    const owner = raw.type === "detect" || raw.type === "scrape-track" ? recogniseUrl(raw.url)?.provider : undefined;
    const provider =
      owner?.readGapMs !== undefined && !(raw.type === "detect" && raw.tabId !== undefined) ? owner : undefined;
    // YouTube look-ups wait in no queue of tabs: the gate inside the service paces them.
    const queue = provider
      ? politeQueue(provider)
      : raw.type === "detect"
        ? serial
        : raw.type === "scrape-track"
          ? reads
          : direct;
    return queue.run(async () => {
      if (provider && clock.now() < (blockedUntil.get(provider.id) ?? 0)) {
        return {
          ok: false,
          error: {
            code: "blocked",
            message: `${provider.label} asked for a captcha a moment ago, so it is not being read for now. Open it in a tab, check it works, and try again in a while.`,
          },
        };
      }
      const stopKeepAlive = ports.keepAlive();
      try {
        const answer = await work(raw);
        if (provider && !answer.ok) {
          if (answer.error.code === "blocked") blockedUntil.set(provider.id, clock.now() + BLOCKED_PAUSE_MS);
          // A read that failed for a reason that is not the track's own (a captcha, a page that would not open or
          // answer) may mean the site is pushing back: from then on it is read one page at a time.
          if (PUSHBACK_CODES.has(answer.error.code)) politeQueue(provider).setLimit(1);
        }
        return answer;
      } finally {
        stopKeepAlive();
      }
    });
  }

  async function work(raw: WorkerRequest): Promise<Result<unknown>> {
    if (raw.type === "detect") {
      // The lookup runs while the page is read, as in the desktop app, so it adds no waiting.
      const exact = covers.exact(raw.url).catch(() => "");
      const result = await detectAlbum(ports, raw.url, raw.tabId, timing);
      // A failed read must not wait on the lookup: it would hold the queue for as long as iTunes takes.
      if (!result.ok) return result;
      const album = await withCover(result.data, await exact, covers);
      return { ok: true, data: await withSongCopyright(album, raw.url, covers) };
    }
    if (raw.type === "youtube-lookup") {
      const link = await youtube.find(raw.title, raw.artist).catch(() => NO_LINK);
      return { ok: true, data: { ...link, throttled: !link.url && youtube.throttled() } };
    }
    if (raw.type === "youtube-key-check") return { ok: true, data: await checkKey(raw.key) };
    if (raw.type !== "scrape-track")
      return { ok: false, error: { code: "bad-request", message: "Unrecognised request." } };
    const result = await scrapeTrack(ports, raw.url, raw.trackTitle, timing);
    if (!result.ok || result.data.coverArtUrl) return result;
    // As in the desktop app, a track with no cover of its own is searched by its title, which finds a cover
    // when the album's lookup missed and the song page showed none.
    const title = raw.trackTitle || result.data.title;
    const found = title && result.data.artist ? await covers.search(title, result.data.artist).catch(() => "") : "";
    return { ok: true, data: { ...result.data, coverArtUrl: found } };
  }
}
