// "This album on Apple Music and Spotify": the Genius album page names no Apple Music or Spotify id, so both services are
// found by search and only an exact match counts (core/albumMatch.ts): the same title with the same edition words, the
// same artists, a release year that agrees and, where the service says it, the same number of tracks. One exact result
// is listed, a few are all listed, none is "none" and never a guess. Apple is asked through iTunes's search API, Spotify
// through the albums tab of its search page in one background tab. Nothing is read from the pages found.
import { MAX_SHOWN, pickAlbumHits, type AlbumHit, type AlbumRef } from "../core/albumMatch";
import { searchName } from "../core/searchMatch";
import { appleAlbumHit, searchAppleAlbums } from "../lookups/albumLinks";
import type { GetJson } from "../lookups/itunes";
import type { FoundMatch, GeniusAlbumInfo, Result, SearchRow, ServiceMatch } from "../shared/messages";
import { failedWith } from "./matchFailure";

export interface AlbumMatchTools {
  /** The albums tab of Spotify's search page, read politely (one tab at a time, captcha pause). */
  spotifyAlbumSearch(query: string): Promise<Result<SearchRow[]>>;
}

const albumRef = (info: GeniusAlbumInfo): AlbumRef => ({
  title: info.title,
  primary: info.primary,
  year: info.year,
  tracks: info.tracks,
  type: info.type,
});

/** Title and artists; for a compilation by "Various Artists" the title alone, which is what the services index it by. */
function searchText(info: GeniusAlbumInfo): string {
  const artists = info.primary.filter((name) => name.toLowerCase() !== "various artists").map(searchName);
  return [info.title, ...artists].join(" ");
}

function foundFrom(hit: AlbumHit): FoundMatch {
  return {
    status: "found",
    url: hit.href,
    name: `${hit.artists.join(", ")} - ${hit.title}`,
    release: [hit.year, hit.tracks > 0 ? `${String(hit.tracks)} tracks` : ""].filter(Boolean).join(" · "),
    source: "search",
  };
}

/** One result is found, several are all listed (up to MAX_SHOWN), none is none. */
function matchOf(hits: AlbumHit[]): ServiceMatch {
  const [first, ...rest] = hits;
  if (!first) return { status: "none" };
  if (rest.length === 0) return foundFrom(first);
  return { status: "several", matches: hits.slice(0, MAX_SHOWN).map(foundFrom) };
}

async function resolveApple(getJson: GetJson, info: GeniusAlbumInfo): Promise<ServiceMatch> {
  const albums = await searchAppleAlbums(getJson, searchText(info));
  if (albums === null) return failedWith("Apple Music", "iTunes did not answer");
  return matchOf(pickAlbumHits("apple", albumRef(info), albums.map(appleAlbumHit)));
}

const SPOTIFY_ALBUM_URL = /^https:\/\/open\.spotify\.com\/album\/[A-Za-z0-9]{22}$/;

async function resolveSpotify(tools: AlbumMatchTools, info: GeniusAlbumInfo): Promise<ServiceMatch> {
  const rows = await tools.spotifyAlbumSearch(searchText(info));
  if (!rows.ok) return failedWith("Spotify", `${rows.error.message} (${rows.error.code})`);
  // The address is the reader's own, built from an album id; anything else in a row is not a result.
  const hits: AlbumHit[] = rows.data
    .filter((row) => SPOTIFY_ALBUM_URL.test(row.href))
    .map((row) => ({ title: row.title, artists: row.artists, year: row.year ?? "", tracks: 0, href: row.href }));
  return matchOf(pickAlbumHits("spotify", albumRef(info), hits));
}

/** Both services at once; a failure of one is that service's `failed`, never the whole answer's. */
export async function lookUpAlbum(
  getJson: GetJson,
  tools: AlbumMatchTools,
  info: GeniusAlbumInfo,
): Promise<{ apple: ServiceMatch; spotify: ServiceMatch }> {
  const [apple, spotify] = await Promise.all([
    resolveApple(getJson, info).catch((error: unknown) => failedWith("Apple Music", error)),
    resolveSpotify(tools, info).catch((error: unknown) => failedWith("Spotify", error)),
  ]);
  return { apple, spotify };
}
