// "This song on Apple Music and Spotify": from the Genius song page in a tab, find the song's pages on both services.
// The page's own ids are the primary source (Apple has one on every song page, Spotify on few); where the id is
// missing or does not hold, a search runs and only an exact match counts (core/searchMatch.ts), otherwise the answer
// is "none" and never a guess. Nothing is read from the pages found: the user presses Get credits for that. Every
// failure is data (`failed`), the two services are resolved in parallel, and one song page is resolved once.
import { normTitle, pickHit, type Hit, type SongRef } from "../core/searchMatch";
import {
  appleHit,
  appleSongUrl,
  lookupAppleSong,
  lookupSpotifyTitle,
  searchAppleSongs,
  type AppleSong,
} from "../lookups/songLinks";
import type { GetJson } from "../lookups/itunes";
import {
  isGeniusSongInfo,
  isResult,
  type GeniusSongInfo,
  type Result,
  type SearchRow,
  type ServiceMatch,
  type SongMatchesAnswer,
} from "../shared/messages";
import type { GeniusNavTiming } from "./geniusNav";
import type { BrowserPorts } from "./ports";

const GENIUS_ORIGIN = "https://genius.com";
const GENIUS_CONTENT_SCRIPT = "genius/content.js";

/** What the router lends the resolver: the Spotify search page, read politely (one tab at a time, captcha pause). */
export interface SongMatchTools {
  spotifySearch(query: string): Promise<Result<SearchRow[]>>;
  /** Apple Music's search page, a last resort after iTunes's search API found nothing. */
  appleSearch(query: string): Promise<Result<SearchRow[]>>;
}

export interface SongMatches {
  resolve(tabId: number, tools: SongMatchTools): Promise<Result<SongMatchesAnswer>>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const songRef = (info: GeniusSongInfo): SongRef => ({
  title: info.title,
  primary: info.primary,
  featured: info.featured,
});

const searchText = (info: GeniusSongInfo): string => `${info.title} ${info.primary.join(" ")}`;

const appleDown: ServiceMatch = { status: "failed", message: "Apple Music could not be asked just now." };
const spotifyDown: ServiceMatch = { status: "failed", message: "Spotify could not be asked just now." };

function appleFound(song: AppleSong, source: "genius" | "search"): ServiceMatch {
  return {
    status: "found",
    url: appleSongUrl(song.id),
    name: `${song.artist} - ${song.title}`,
    release: song.release,
    source,
  };
}

/** The id at the end of the address `appleHit` made for a song ("" for no hit). */
const idOf = (hit: Hit | null): string => /(\d+)$/.exec(hit?.href ?? "")?.[1] ?? "";

/** The track id in the `?i=` of an Apple Music song link. */
const TRACK_PARAM = /[?&]i=(\d{1,12})$/;

/** The page for an exact match on Apple Music's own search page, as a song page built from the id in its link. */
async function resolveAppleBySearchPage(tools: SongMatchTools, info: GeniusSongInfo): Promise<ServiceMatch> {
  const rows = await tools.appleSearch(searchText(info));
  if (!rows.ok) return { status: "failed", message: rows.error.message };
  // The link's album name is the release; the page's own rows have no album text.
  const hits: Hit[] = rows.data.map((row) => ({ title: row.title, artists: row.artists, href: row.href }));
  const hit = pickHit("apple", songRef(info), hits);
  const id = TRACK_PARAM.exec(hit?.href ?? "")?.[1];
  if (!hit || !id) return { status: "none" };
  return {
    status: "found",
    url: appleSongUrl(id),
    name: `${hit.artists.join(", ")} - ${hit.title}`,
    release: "",
    source: "search",
  };
}

/**
 * Apple Music: the id Genius gives; when it does not resolve, an exact match in iTunes's search, and only when that
 * finds nothing either, in Apple Music's own search page (one background tab).
 */
async function resolveApple(getJson: GetJson, tools: SongMatchTools, info: GeniusSongInfo): Promise<ServiceMatch> {
  let unreachable = false;
  if (info.appleId) {
    const song = await lookupAppleSong(getJson, info.appleId);
    if (song !== null && song !== "none") return appleFound(song, "genius");
    // About 4 in 100 ids are retired and answer nothing: that is not a failure, the search below takes over.
    unreachable = song === null;
  }
  const songs = await searchAppleSongs(getJson, searchText(info));
  if (songs === null) return unreachable || !info.appleId ? appleDown : { status: "none" };
  const hit = pickHit("apple", songRef(info), songs.map(appleHit));
  const song = songs.find((candidate) => candidate.id === idOf(hit));
  return song ? appleFound(song, "search") : resolveAppleBySearchPage(tools, info);
}

function spotifyFound(
  id: string,
  artists: string[],
  title: string,
  release: string,
  source: "genius" | "search",
): ServiceMatch {
  return {
    status: "found",
    url: `https://open.spotify.com/track/${id}`,
    name: `${artists.join(", ")} - ${title}`,
    release,
    source,
  };
}

const SPOTIFY_TRACK_ID = /\/track\/([A-Za-z0-9]{22})$/;

/** Spotify: the id Genius gives, if Spotify agrees it is this song; otherwise an exact match in one search page. */
async function resolveSpotify(getJson: GetJson, tools: SongMatchTools, info: GeniusSongInfo): Promise<ServiceMatch> {
  const everyone = [...info.primary, ...info.featured];
  if (info.spotifyId) {
    const title = await lookupSpotifyTitle(getJson, info.spotifyId);
    // Genius's ids are entered by hand: one whose title is another song's is not trusted. When Spotify cannot be asked
    // at all, Genius's word stands.
    if (title === null || (title !== "" && normTitle(title, everyone) === normTitle(info.title, everyone))) {
      return spotifyFound(info.spotifyId, info.primary, title ?? info.title, "", "genius");
    }
  }
  const rows = await tools.spotifySearch(searchText(info));
  if (!rows.ok) return { status: "failed", message: rows.error.message };
  const hits: Hit[] = rows.data.map((row) => ({
    title: row.title,
    artists: row.artists,
    album: row.album,
    href: row.href,
  }));
  const hit = pickHit("spotify", songRef(info), hits);
  const id = SPOTIFY_TRACK_ID.exec(hit?.href ?? "")?.[1];
  return hit && id ? spotifyFound(id, hit.artists, hit.title, hit.album ?? "", "search") : { status: "none" };
}

export function createSongMatches(ports: BrowserPorts, getJson: GetJson, timing: GeniusNavTiming): SongMatches {
  /** Answers of songs already resolved this session (a failed half is not kept, so a later try can fix it). */
  const done = new Map<string, SongMatchesAnswer>();
  const running = new Map<string, Promise<SongMatchesAnswer>>();

  async function waitLoaded(tabId: number): Promise<boolean> {
    const deadline = Date.now() + timing.loadMs;
    while (Date.now() < deadline) {
      const tab = await ports.getTab(tabId);
      if (tab === null) return false;
      if (tab.status === "complete") return true;
      await sleep(timing.pollMs);
    }
    return false;
  }

  /** What the song page says. `undefined` when the page never answered; null when it is not a song page. */
  async function readPage(tabId: number): Promise<GeniusSongInfo | null | undefined> {
    const deadline = Date.now() + timing.askMs;
    let injected = false;
    for (;;) {
      const reply = await ports.askGenius(tabId, { type: "genius/song-info" });
      if (isResult(reply) && reply.ok) return isGeniusSongInfo(reply.data) ? reply.data : null;
      // A tab that was open before the extension was installed or reloaded has no content script yet.
      if (!injected) {
        injected = true;
        await ports.injectContentScript(tabId, GENIUS_CONTENT_SCRIPT).catch(() => undefined);
      } else if (Date.now() >= deadline) {
        return undefined;
      } else {
        await sleep(timing.pollMs);
      }
    }
  }

  async function lookUp(info: GeniusSongInfo, tools: SongMatchTools): Promise<SongMatchesAnswer> {
    const [apple, spotify] = await Promise.all([
      resolveApple(getJson, tools, info).catch(() => appleDown),
      resolveSpotify(getJson, tools, info).catch(() => spotifyDown),
    ]);
    return {
      status: "ready",
      path: info.path,
      title: info.title,
      artists: [...info.primary, ...info.featured],
      apple,
      spotify,
    };
  }

  return {
    async resolve(tabId, tools) {
      const tab = await ports.getTab(tabId);
      if (!tab || !URL.canParse(tab.url) || new URL(tab.url).origin !== GENIUS_ORIGIN) {
        return { ok: true, data: { status: "not-song" } };
      }
      if (!(await waitLoaded(tabId))) {
        return { ok: false, error: { code: "timeout", message: "The Genius page did not finish loading." } };
      }
      const info = await readPage(tabId);
      if (info === undefined) {
        return { ok: false, error: { code: "tab-failed", message: "The Genius page did not answer." } };
      }
      if (info === null) return { ok: true, data: { status: "not-song" } };

      const known = done.get(info.path);
      if (known) return { ok: true, data: known };
      let job = running.get(info.path);
      if (!job) {
        job = lookUp(info, tools).finally(() => running.delete(info.path));
        running.set(info.path, job);
      }
      const answer = await job;
      if (answer.status === "ready" && answer.apple.status !== "failed" && answer.spotify.status !== "failed") {
        done.set(info.path, answer);
      }
      return { ok: true, data: answer };
    },
  };
}
