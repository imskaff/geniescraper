// Maps the extension pages' requests onto the Apple Music client and the paste session.
// Album detection runs one at a time. Track reads run as many at once as the panel asks for, never more than
// MAX_OPEN_TABS, so a long album cannot open a tab per track. Paste changes are serialised by the paste service.
import { isPasteCommand, isWorkerRequest, type AlbumInfo, type Result } from "../shared/messages";
import { detectAlbum, scrapeTrack, type ClientTiming } from "./appleClient";
import type { CoverService } from "./covers";
import { NO_YOUTUBE, type YoutubeService } from "./youtube";
import type { PasteService } from "./paste";
import type { BrowserPorts } from "./ports";
import { Limiter, Serial } from "./serial";

/** Hidden tabs open at once, whatever the panel asks for. */
export const MAX_OPEN_TABS = 24;

const NO_LINK = { url: "", isMusicVideo: false };

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

export function createRouter(
  ports: BrowserPorts,
  timing: ClientTiming,
  paste: PasteService,
  covers: CoverService,
  youtube: YoutubeService = NO_YOUTUBE,
): Router {
  const serial = new Serial();
  const reads = new Limiter(MAX_OPEN_TABS);
  const direct = { run: <T>(job: () => Promise<T>): Promise<T> => job() };

  return (raw) => {
    if (!isWorkerRequest(raw)) {
      return Promise.resolve({ ok: false, error: { code: "bad-request", message: "Unrecognised request." } });
    }
    // Pasting must stay responsive while an album is being read, so it does not wait in the reads' queue.
    if (isPasteCommand(raw)) return paste.command(raw);

    // YouTube look-ups wait in no queue of tabs: the gate inside the service paces them.
    const queue = raw.type === "detect" ? serial : raw.type === "youtube-lookup" ? direct : reads;
    return queue.run(async () => {
      const stopKeepAlive = ports.keepAlive();
      try {
        if (raw.type === "detect") {
          // The lookup runs while the page is read, as in the desktop app, so it adds no waiting.
          const exact = covers.exact(raw.url).catch(() => "");
          const result = await detectAlbum(ports, raw.url, raw.tabId, timing);
          // A failed read must not wait on the lookup: it would hold the queue for as long as iTunes takes.
          if (!result.ok) return result;
          return { ok: true, data: await withCover(result.data, await exact, covers) };
        }
        if (raw.type === "youtube-lookup") {
          const link = await youtube.find(raw.title, raw.artist).catch(() => NO_LINK);
          return { ok: true, data: { ...link, throttled: !link.url && youtube.throttled() } };
        }
        const result = await scrapeTrack(ports, raw.url, raw.trackTitle, timing);
        if (!result.ok || result.data.coverArtUrl) return result;
        // As in the desktop app, a track with no cover of its own is searched by its title, which finds a cover
        // when the album's lookup missed and the song page showed none.
        const title = raw.trackTitle || result.data.title;
        const found = title && result.data.artist ? await covers.search(title, result.data.artist).catch(() => "") : "";
        return { ok: true, data: { ...result.data, coverArtUrl: found } };
      } finally {
        stopKeepAlive();
      }
    });
  };
}
