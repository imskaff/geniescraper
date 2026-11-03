// The look-up that turns a Genius album's title and artist into albums on Apple Music: iTunes's search API (the host the
// song look-ups already use). Best-effort like every lookup here: a failure is null ("could not ask"), never an
// exception, and an answer that does not have the expected shape is skipped, not repaired.
import { yearOf, type AlbumHit } from "../core/albumMatch";
import type { GetJson } from "./itunes";

const SEARCH_URL = "https://itunes.apple.com/search";

/** An iTunes album record reduced to what listing it needs. */
export interface AppleAlbum {
  /** The catalogue collection id, digits only. */
  id: string;
  title: string;
  artist: string;
  year: string;
  tracks: number;
  explicitness: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The album records in an iTunes answer; null when the answer is not one (so "could not ask" stays apart from "none"). */
function appleAlbums(data: unknown): AppleAlbum[] | null {
  const list = isRecord(data) ? data["results"] : undefined;
  if (!Array.isArray(list)) return null;
  const albums: AppleAlbum[] = [];
  for (const entry of list) {
    if (!isRecord(entry) || entry["wrapperType"] !== "collection") continue;
    const { collectionId, collectionName, artistName, trackCount, releaseDate, collectionExplicitness } = entry;
    if (typeof collectionId !== "number" || !Number.isSafeInteger(collectionId) || collectionId <= 0) continue;
    if (typeof collectionName !== "string" || typeof artistName !== "string") continue;
    albums.push({
      id: String(collectionId),
      title: collectionName,
      artist: artistName,
      year: typeof releaseDate === "string" ? yearOf(releaseDate) : "",
      tracks: typeof trackCount === "number" && Number.isSafeInteger(trackCount) && trackCount > 0 ? trackCount : 0,
      explicitness: typeof collectionExplicitness === "string" ? collectionExplicitness : "",
    });
  }
  return albums;
}

/** The album's page on Apple Music, built from its id alone. */
export const appleAlbumUrl = (id: string): string => `https://music.apple.com/us/album/${id}`;

/** An album record in the matcher's shape; `href` is an address built from the id, not taken from the answer. */
export function appleAlbumHit(album: AppleAlbum): AlbumHit {
  return {
    title: album.title,
    artists: [album.artist],
    year: album.year,
    tracks: album.tracks,
    href: appleAlbumUrl(album.id),
    explicitness: album.explicitness,
  };
}

/** The albums iTunes finds for a query (first 25); null when it could not be asked. */
export async function searchAppleAlbums(getJson: GetJson, query: string): Promise<AppleAlbum[] | null> {
  if (query.trim() === "") return null;
  const url = new URL(SEARCH_URL);
  url.searchParams.set("term", query);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "album");
  url.searchParams.set("country", "us");
  url.searchParams.set("limit", "25");
  return appleAlbums(await getJson(url.href));
}
