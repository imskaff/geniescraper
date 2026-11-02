// Reads what a Genius song page says about its own song: the title, the artists as separate names and the ids of the
// song's Apple Music and Spotify pages. Genius ships these in the page's embedded state, the inline script that sets
// `window.__PRELOADED_STATE__ = JSON.parse('...')`. A content script cannot see that variable (it lives in the page's
// own world), but the script's text is in the DOM, so it is read from there as data: the string literal is decoded by
// hand and parsed as JSON, and nothing in it is ever run. This file and selectors.ts are the only ones that know
// Genius's markup; every field is validated and anything unexpected gives null ("not a song page we can read").
import type { GeniusSongInfo } from "../shared/messages";

export type { GeniusSongInfo };

/** The longest script text read: a song page's state is about 220 KB; a runaway one is not parsed. */
const MAX_SCRIPT_CHARS = 3_000_000;

const APPLE_ID = /^\d{1,12}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_TRACK_URL = /^https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]{22})$/;

// The state is `JSON.parse('<literal>')`: the literal runs to the first quote that is not escaped. Taking everything up
// to the last quote in the script instead would swallow the code that follows it.
const STATE_LITERAL = /window\.__PRELOADED_STATE__\s*=\s*JSON\.parse\('((?:[^'\\]|\\[\s\S])*)'\)/;

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
};

/** The value of the body of a single-quoted JavaScript string literal: `\"`, `\\`, `\n`, `\uXXXX`, `\xXX` and the rest. */
export function decodeStringLiteral(body: string): string {
  return body.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, escape: string) =>
    escape.length > 1 ? String.fromCharCode(parseInt(escape.slice(1), 16)) : (SIMPLE_ESCAPES[escape] ?? escape),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The embedded state of the page as parsed JSON, or null when there is none or it cannot be read. */
function pageState(doc: Document): Record<string, unknown> | null {
  for (const script of doc.scripts) {
    const text = script.textContent;
    if (!text.includes("__PRELOADED_STATE__") || text.length > MAX_SCRIPT_CHARS) continue;
    const literal = STATE_LITERAL.exec(text)?.[1];
    if (literal === undefined) continue;
    try {
      const state: unknown = JSON.parse(decodeStringLiteral(literal));
      return isRecord(state) ? state : null;
    } catch {
      return null;
    }
  }
  return null;
}

function samePath(a: string, b: string): boolean {
  const decode = (path: string): string => {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  };
  return a === b || decode(a) === decode(b);
}

/** The names of the artists a list of ids refers to; null when one cannot be resolved (never a partial list). */
function artistNames(ids: unknown, artists: unknown): string[] | null {
  if (!Array.isArray(ids) || !isRecord(artists)) return null;
  const names: string[] = [];
  for (const id of ids) {
    const artist = typeof id === "number" || typeof id === "string" ? artists[String(id)] : undefined;
    const name = isRecord(artist) ? artist["name"] : undefined;
    if (typeof name !== "string" || name.trim() === "") return null;
    names.push(name.trim());
  }
  return names;
}

/** Spotify's track id from the song's `spotifyUuid`, or from its Spotify media link when that field is empty. */
function spotifyIdOf(song: Record<string, unknown>): string {
  const uuid = song["spotifyUuid"];
  if (typeof uuid === "string" && SPOTIFY_ID.test(uuid)) return uuid;
  const media = song["media"];
  if (!Array.isArray(media)) return "";
  for (const entry of media) {
    if (!isRecord(entry) || entry["provider"] !== "spotify" || typeof entry["url"] !== "string") continue;
    const id = SPOTIFY_TRACK_URL.exec(entry["url"])?.[1];
    if (id) return id;
  }
  return "";
}

/**
 * The song a Genius song page is about, or null when `doc` is not a song page this reader understands.
 * A song page has `og:type` "music.song" and a state whose `currentPage` is "songPage". The state describes the page
 * as it was first served, so it must belong to the address now showing (`pathname`): after a navigation inside the
 * page it would still describe the first song, and listing that one would be wrong.
 */
export function readSongInfo(doc: Document, pathname: string): GeniusSongInfo | null {
  if (doc.querySelector('meta[property="og:type"]')?.getAttribute("content") !== "music.song") return null;
  const state = pageState(doc);
  if (state?.["currentPage"] !== "songPage") return null;
  const songPage = state["songPage"];
  const entities = state["entities"];
  if (!isRecord(songPage) || !isRecord(entities)) return null;
  const songs = entities["songs"];
  const id = songPage["song"];
  const song = isRecord(songs) && (typeof id === "number" || typeof id === "string") ? songs[String(id)] : undefined;
  if (!isRecord(song)) return null;

  const path = song["path"];
  const title = song["title"];
  if (typeof path !== "string" || typeof title !== "string" || title.trim() === "" || !samePath(path, pathname)) {
    return null;
  }
  const primary = artistNames(song["primaryArtists"], entities["artists"]);
  const featured = artistNames(song["featuredArtists"] ?? [], entities["artists"]);
  if (!primary || primary.length === 0 || !featured) return null;

  const apple = song["appleMusicId"];
  return {
    path,
    title: title.trim(),
    primary,
    featured,
    appleId: typeof apple === "string" && APPLE_ID.test(apple) ? apple : "",
    spotifyId: spotifyIdOf(song),
  };
}
