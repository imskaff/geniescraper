// Reads what a Genius album page says about its album: the title, the album artists, the release year, how many
// tracks the tracklist has and Genius's own type of release. Unlike a song page, an album page carries no Apple Music or Spotify id at all (measured, see
// docs/genius-album-links.md), so these facts are what a search for the album is built from and checked against. They
// come from the page's embedded state (`islands.album`), read as data like the song page's; nothing is ever run.
import type { GeniusAlbumInfo } from "../shared/messages";
import { isRecord, pageState, samePath } from "./songState";

export type { GeniusAlbumInfo };

/** The year of an ISO date ("2021-05-21"), or "". */
const yearOf = (date: unknown): string => (typeof date === "string" ? (/^(\d{4})-/.exec(date)?.[1] ?? "") : "");

/** The album artists' names, or null when there are none or one has no name (never a partial list). */
function artistNames(artists: unknown): string[] | null {
  if (!Array.isArray(artists) || artists.length === 0) return null;
  const names: string[] = [];
  for (const artist of artists) {
    const name = isRecord(artist) ? artist["name"] : undefined;
    if (typeof name !== "string" || name.trim() === "") return null;
    names.push(name.trim());
  }
  return names;
}

/**
 * The album a Genius album page is about, or null when `doc` is not an album page this reader understands.
 * An album page has `currentPage` "islands" and `islands.pageType` "album". The state describes the page as it was
 * first served, so it must belong to the address now showing (`pathname`). A translation of an album (a page by one of
 * Genius's translation accounts) is not the album and is left out.
 */
export function readAlbumInfo(doc: Document, pathname: string): GeniusAlbumInfo | null {
  const state = pageState(doc);
  if (state?.["currentPage"] !== "islands") return null;
  const islands = state["islands"];
  if (!isRecord(islands) || islands["pageType"] !== "album") return null;
  const album = islands["album"];
  if (!isRecord(album) || (album["translationOf"] ?? null) !== null) return null;

  const url = album["url"];
  const name = album["name"];
  if (typeof url !== "string" || !URL.canParse(url) || typeof name !== "string" || name.trim() === "") return null;
  const path = new URL(url).pathname;
  if (!path.startsWith("/albums/") || !samePath(path, pathname)) return null;
  const primary = artistNames(album["primaryArtists"]);
  if (!primary) return null;

  const tracklist = islands["albumAppearances"];
  return {
    path,
    title: name.trim(),
    primary,
    year: yearOf(album["releaseDate"]),
    tracks: Array.isArray(tracklist) ? tracklist.length : 0,
    type: typeof album["albumType"] === "string" ? album["albumType"] : "",
  };
}
