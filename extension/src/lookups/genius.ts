// Genius's own song search, the one the genius.com web app uses: no token and no sign-in. It is asked only when the
// user presses "Open on Genius" (or has it switched on for pasting), with the track's title and artist as the query.
// Best-effort like every lookup: any failure is null, so the caller can tell "Genius could not be asked" from "no match".
import {
  artistNames,
  creditCandidates,
  creditedHit,
  matchSong,
  parseHits,
  searchQuery,
  type GeniusHit,
} from "../core/geniusMatch";
import type { GetJson } from "./itunes";

const SEARCH_URL = "https://genius.com/api/search/song";

const SONG_URL = "https://genius.com/api/songs";
/** At most this many extra searches (one per listed artist) and credit lookups for one track. */
const EXTRA = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function search(getJson: GetJson, query: string): Promise<GeniusHit[] | null> {
  return getJson(`${SEARCH_URL}?${new URLSearchParams({ q: query }).toString()}`).then((data) => {
    const response = isRecord(data) ? data["response"] : undefined;
    // A page that is not a search answer (a challenge page, an error) must not read as "no song on Genius".
    return isRecord(response) && "sections" in response ? parseHits(data) : null;
  });
}

/** The names a Genius song credits besides its artists (producers, writers, performers), or null when unreadable. */
async function songCredits(getJson: GetJson, id: number): Promise<string[] | null> {
  const data = await getJson(`${SONG_URL}/${String(id)}`);
  const response = isRecord(data) ? data["response"] : undefined;
  const song = isRecord(response) ? response["song"] : undefined;
  if (!isRecord(song)) return null;
  const lists = [song["producer_artists"], song["writer_artists"]];
  if (Array.isArray(song["custom_performances"])) {
    for (const part of song["custom_performances"]) lists.push(isRecord(part) ? part["artists"] : undefined);
  }
  return lists.flatMap((list) =>
    Array.isArray(list)
      ? list.flatMap((entry) => (isRecord(entry) && typeof entry["name"] === "string" ? [entry["name"]] : []))
      : [],
  );
}

/**
 * The songs Genius finds for a track (first page only), or null when it could not be asked or answered oddly.
 * When Apple's artist line names several people, Genius may list only some as the song's artists and the rest as
 * producers: the full line then finds nothing, so each name is searched on its own, and a song whose title is exact
 * and whose artists are some of the names is returned with the other names added only when its credits name them.
 */
export async function searchGenius(getJson: GetJson, title: string, artist: string): Promise<GeniusHit[] | null> {
  const query = searchQuery(title, artist);
  if (query === "") return null;
  const first = await search(getJson, query).catch(() => null);
  if (first === null) return null;
  if (matchSong(title, artist, first).kind === "match") return first;

  const names = artistNames(artist);
  if (names.length < 2) return first;
  const found = new Map(first.map((hit) => [hit.id, hit]));
  for (const name of names.slice(0, EXTRA)) {
    for (const hit of (await search(getJson, searchQuery(title, name)).catch(() => null)) ?? []) {
      if (!found.has(hit.id)) found.set(hit.id, hit);
    }
  }
  const hits = [...found.values()];
  const credited = new Map<number, GeniusHit>();
  for (const hit of creditCandidates(title, artist, hits).slice(0, EXTRA)) {
    const credits = await songCredits(getJson, hit.id).catch(() => null);
    if (credits !== null) credited.set(hit.id, creditedHit(artist, hit, credits));
  }
  return hits.map((hit) => credited.get(hit.id) ?? hit);
}
