// Finding the Genius song that is exactly an Apple Music track. Pure: the search itself lives in lookups/genius.ts.
// The rules are strict on purpose: a wrong match would put one song's credits on another song's form, so anything
// short of an exact title and artist is "no match", and more than one exact candidate is "several", never a guess.
import { words, withoutFeaturing } from "./text";

/** One song in Genius's search results, reduced to what matching needs. */
export interface GeniusHit {
  id: number;
  title: string;
  /** The primary artists' names, as Genius lists them. */
  primary: string[];
  featured: string[];
  /** The song page's path on genius.com, already checked by `parseHits`. */
  path: string;
}

/** A song the user can be shown: the page address is always built here, never taken from the response. */
export interface GeniusSong {
  id: number;
  title: string;
  artists: string[];
  url: string;
}

export type GeniusMatch =
  { kind: "match"; song: GeniusSong } | { kind: "none" } | { kind: "several"; songs: GeniusSong[] };

export const GENIUS_ORIGIN = "https://genius.com";

// A song page path is one segment of letters, digits and a few separators. Anything else in a response (another
// host, a query, a fragment, a second segment) is not a song page we will open.
const SONG_PATH = /^\/[A-Za-z0-9][A-Za-z0-9._~%-]*$/;

/** The song page address for a path from a search result, or null when the path is not a plain song page. */
export function geniusSongUrl(path: unknown): string | null {
  return typeof path === "string" && path.length <= 300 && SONG_PATH.test(path) ? `${GENIUS_ORIGIN}${path}` : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => (isRecord(entry) && typeof entry["name"] === "string" ? [entry["name"]] : []));
}

/**
 * The songs in a `/api/search/song` response. Anything that does not have the expected shape is skipped, not
 * repaired, and a song whose path is not a plain song page is dropped.
 */
export function parseHits(data: unknown): GeniusHit[] {
  const response = isRecord(data) ? data["response"] : undefined;
  const sections = isRecord(response) && Array.isArray(response["sections"]) ? response["sections"] : [];
  const hits: GeniusHit[] = [];
  for (const section of sections) {
    const list = isRecord(section) && Array.isArray(section["hits"]) ? section["hits"] : [];
    for (const hit of list) {
      if (!isRecord(hit) || hit["type"] !== "song" || !isRecord(hit["result"])) continue;
      const result = hit["result"];
      const id = result["id"];
      const title = result["title"];
      if (typeof id !== "number" || !Number.isInteger(id) || typeof title !== "string") continue;
      const path = result["path"];
      if (geniusSongUrl(path) === null || typeof path !== "string") continue;
      hits.push({
        id,
        title,
        primary: names(result["primary_artists"]),
        featured: names(result["featured_artists"]),
        path,
      });
    }
  }
  return hits;
}

/** Genius writes "&" where Apple may write "and", and the other way round: they are the same word. */
const spellAnd = (text: string): string => text.replace(/&/g, " and ");

/** A title as a comparable key: folded words, no featured-artist part, version words kept ("remix" stays). */
function titleKey(title: string): string {
  return words(withoutFeaturing(spellAnd(title))).join(" ");
}

/** An artist line as a comparable key: the sorted bag of its words, so "A & B" equals A and B listed apart. */
function artistKey(lines: readonly string[]): string {
  return words(spellAnd(lines.join(" ")))
    .filter((word) => word !== "and")
    .sort()
    .join(" ");
}

/** What to type into Genius's search for a track: the artist and the title without its featured-artist part. */
export function searchQuery(title: string, artist: string): string {
  const clean = (text: string): string => withoutFeaturing(text).replace(/\s+/g, " ").trim();
  return `${clean(artist)} ${clean(title)}`.trim();
}

/**
 * Which of the hits is this track. A hit counts only when its title is word for word the track's (version words such
 * as "Remix" or "Live" included) and its primary artists are the track's artists (or the primary and featured ones
 * together, for an Apple line that lists everyone). Translation pages and covers fail the artist test.
 */
export function matchSong(title: string, artist: string, hits: readonly GeniusHit[]): GeniusMatch {
  const wantTitle = titleKey(title);
  const wanted = new Set([artistKey([artist]), artistKey([withoutFeaturing(artist)])]);
  wanted.delete("");
  if (wantTitle === "" || wanted.size === 0) return { kind: "none" };

  const found = new Map<number, GeniusSong>();
  for (const hit of hits) {
    if (found.has(hit.id) || titleKey(hit.title) !== wantTitle) continue;
    const sameArtist = [artistKey(hit.primary), artistKey([...hit.primary, ...hit.featured])].some((key) =>
      wanted.has(key),
    );
    const url = geniusSongUrl(hit.path);
    if (!sameArtist || url === null) continue;
    found.set(hit.id, { id: hit.id, title: hit.title, artists: hit.primary, url });
  }
  const songs = [...found.values()];
  const [only] = songs;
  if (songs.length === 1 && only) return { kind: "match", song: only };
  return songs.length === 0 ? { kind: "none" } : { kind: "several", songs };
}
