// The look-ups that turn a Genius song's ids (or its title and artist) into pages on Apple Music and Spotify.
// Best-effort like every lookup here: a failure is null ("could not ask"), never an exception, and an answer that
// does not have the expected shape is skipped, not repaired. Hosts: itunes.apple.com and open.spotify.com only.
import type { Hit } from "../core/searchMatch";
import type { GetJson } from "./itunes";

const LOOKUP_URL = "https://itunes.apple.com/lookup";
const SEARCH_URL = "https://itunes.apple.com/search";
const OEMBED_URL = "https://open.spotify.com/oembed";

/** An iTunes song record reduced to what listing it needs. */
export interface AppleSong {
  /** The catalogue track id, digits only. */
  id: string;
  title: string;
  artist: string;
  /** The release's name ("SOUR", "Fortnight - Single"). */
  release: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The song records in an iTunes answer; null when the answer is not one (so "could not ask" stays apart from "none"). */
function appleSongs(data: unknown): AppleSong[] | null {
  const list = isRecord(data) ? data["results"] : undefined;
  if (!Array.isArray(list)) return null;
  const songs: AppleSong[] = [];
  for (const entry of list) {
    if (!isRecord(entry) || (entry["kind"] !== undefined && entry["kind"] !== "song")) continue;
    const { trackId, trackName, artistName, collectionName } = entry;
    if (typeof trackId !== "number" || !Number.isSafeInteger(trackId) || trackId <= 0) continue;
    if (typeof trackName !== "string" || typeof artistName !== "string") continue;
    songs.push({
      id: String(trackId),
      title: trackName,
      artist: artistName,
      release: typeof collectionName === "string" ? collectionName : "",
    });
  }
  return songs;
}

/** The song with this catalogue id in the US storefront; "none" when Apple has no such song (a retired id), null when not asked. */
export async function lookupAppleSong(getJson: GetJson, id: string): Promise<AppleSong | "none" | null> {
  const url = new URL(LOOKUP_URL);
  url.searchParams.set("id", id);
  url.searchParams.set("country", "us");
  const songs = appleSongs(await getJson(url.href));
  if (songs === null) return null;
  return songs.find((song) => song.id === id) ?? "none";
}

/** A search hit in the matcher's shape; `href` is a song page address built from the id, not taken from the answer. */
export function appleHit(song: AppleSong): Hit {
  return { title: song.title, artists: [song.artist], album: song.release, href: appleSongUrl(song.id) };
}

/** The song's page on Apple Music, built from its id alone. */
export const appleSongUrl = (id: string): string => `https://music.apple.com/us/song/${id}`;

/** The songs iTunes finds for a query (first 25); null when it could not be asked. */
export async function searchAppleSongs(getJson: GetJson, query: string): Promise<AppleSong[] | null> {
  if (query.trim() === "") return null;
  const url = new URL(SEARCH_URL);
  url.searchParams.set("term", query);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("country", "us");
  url.searchParams.set("limit", "25");
  return appleSongs(await getJson(url.href));
}

/** The title Spotify gives the track with this id (its oEmbed answer); "" when there is none, null when not asked. */
export async function lookupSpotifyTitle(getJson: GetJson, id: string): Promise<string | null> {
  const url = new URL(OEMBED_URL);
  url.searchParams.set("url", `https://open.spotify.com/track/${id}`);
  const data = await getJson(url.href);
  if (!isRecord(data)) return null;
  return typeof data["title"] === "string" ? data["title"].trim() : "";
}
