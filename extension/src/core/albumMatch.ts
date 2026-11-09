// Deciding whether search results are exactly the Genius album. Pure. Stricter than the song rule on purpose: a deluxe
// edition, a single and an EP all share their name with the album they come from but have another tracklist, so the
// edition words of the title must agree on both sides, the artists must be the same set, the release year must be
// (nearly) the same and, where a service tells the number of tracks, so must that be. Several results may pass; the
// caller then lists them all (at most MAX_SHOWN) instead of picking one, and none passing is "no match", never a guess.
import { fold, sameArtists, sameArtistsJoined, type SearchService } from "./searchMatch";

/** A Genius album as the matcher needs it. */
export interface AlbumRef {
  title: string;
  primary: string[];
  /** The release year, "" when the page gives none. */
  year: string;
  /** The number of tracks on Genius's tracklist, 0 when unknown. */
  tracks: number;
  /** Genius's own type of release ("album", "single"...), "" when unknown. */
  type: string;
}

/** One album result. For Apple `artists` may hold the one joined string ("Drake & 21 Savage"). */
export interface AlbumHit {
  title: string;
  artists: string[];
  year: string;
  /** 0 when the service does not say (Spotify's search cards). */
  tracks: number;
  /** An address the worker built itself from the result's id. */
  href: string;
  /** "cleaned" marks the censored twin of an explicit album, which has the same tracks. */
  explicitness?: string;
}

/** The most results listed for one service: more than that is a search that matched too loosely to help the user. */
export const MAX_SHOWN = 3;

/** " - Single" and " - EP": Apple appends them to the name of such a release; Genius does not. */
const TYPE_SUFFIX = /\s[-–]\s*(?:single|ep)\s*$/i;
const EXPLICIT = /[([]\s*explicit\s*[)\]]/gi;
const STANDARD = /[([]\s*standard(?:\s+edition)?\s*[)\]]/gi;
const EDITION_NOUN =
  /\b(deluxe|expanded|anniversary|collector'?s|special|super deluxe|complete|platinum|tour|extended)\s+edition\b/gi;

/**
 * An album title as a comparable key. The type suffix, "(Explicit)" and "(Standard Edition)" do not make another album
 * and are dropped; every other word stays, so "(Deluxe)", "(Taylor's Version)" and "(Live)" must agree on both sides.
 */
export function normAlbumTitle(title: string): string {
  const plain = title
    .replace(TYPE_SUFFIX, " ")
    .replace(EXPLICIT, " ")
    .replace(STANDARD, " ")
    .replace(EDITION_NOUN, "$1")
    .replace(/\bremaster(?:ed)?\b/gi, "remaster")
    // "MOTOMAMI +" is the expanded edition of "MOTOMAMI": a plus sign is a word, not punctuation.
    .replace(/\+/g, " plus ");
  // A title of symbols only ("÷", "×", "=") folds to nothing and would equal every other such title.
  return fold(plain) || plain.trim().toLowerCase();
}

const hasTypeSuffix = (title: string): boolean => TYPE_SUFFIX.test(title);

function agreesOnType(album: AlbumRef, hit: AlbumHit): boolean {
  if (/\s[-–]\s*single\s*$/i.test(hit.title) && album.type === "single") return true;
  return album.tracks > 0 && hit.tracks === album.tracks;
}

/** The year of a date or year text ("2021-05-21", "2021"), or "". */
export function yearOf(text: string): string {
  return /^(\d{4})/.exec(text.trim())?.[1] ?? "";
}

const yearsClose = (a: string, b: string): boolean => a === "" || b === "" || Math.abs(Number(a) - Number(b)) <= 1;

/** True when the result is exactly this album by name, artists, year and (where known) size. */
export function acceptsAlbum(service: SearchService, album: AlbumRef, hit: AlbumHit): boolean {
  if (normAlbumTitle(hit.title) !== normAlbumTitle(album.title)) return false;
  const artistsOk =
    service === "spotify"
      ? sameArtists(hit.artists, album.primary)
      : sameArtistsJoined(hit.artists.join(" and "), album.primary);
  if (!artistsOk || !yearsClose(album.year, hit.year)) return false;
  // "X - Single" and "X - EP" claim a kind of release the name alone does not show: they are the album "X" only when
  // Genius calls it a single too, or when the tracklists are as long as one another.
  if (hasTypeSuffix(hit.title) && !agreesOnType(album, hit)) return false;
  return true;
}

/** What tells two results apart to anyone looking at them: the same key means the same line in a list. */
const lookKey = (hit: AlbumHit): string =>
  [normAlbumTitle(hit.title), hit.artists.map(fold).sort().join("|"), hit.year, String(hit.tracks)].join("\n");

/**
 * Every result that is exactly the album, in the service's order, without repeats. The censored twin of an explicit
 * result is dropped, and when some results have the tracklist's length and others do not, only the former are kept.
 * Results that look the same in every way a list can show (Spotify lists an album's explicit and clean releases as two
 * cards of one name) are one entry, the first: choosing between them would be choosing blind.
 */
export function pickAlbumHits(service: SearchService, album: AlbumRef, hits: readonly AlbumHit[]): AlbumHit[] {
  const seen = new Set<string>();
  let accepted = hits.filter((hit) => {
    if (seen.has(hit.href) || !acceptsAlbum(service, album, hit)) return false;
    seen.add(hit.href);
    return true;
  });
  const explicitKeys = new Set(
    accepted.filter((hit) => hit.explicitness === "explicit").map((hit) => normAlbumTitle(hit.title)),
  );
  accepted = accepted.filter((hit) => hit.explicitness !== "cleaned" || !explicitKeys.has(normAlbumTitle(hit.title)));
  const sameSize = accepted.filter((hit) => album.tracks > 0 && hit.tracks === album.tracks);
  const kept = sameSize.length > 0 ? sameSize : accepted;
  const looks = new Set<string>();
  return kept.filter((hit) => {
    const key = lookKey(hit);
    if (looks.has(key)) return false;
    looks.add(key);
    return true;
  });
}
