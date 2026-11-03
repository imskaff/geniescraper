// Deciding whether a search result is exactly the Genius song, ported from docs/match-search-fallback.md section 4.
// Pure. The rule is strict on purpose: the same title and the same set of artists, on a release that is not another
// edition by name, or nothing. A guess would put one song's credits on another song's form.

/** A Genius song as the matcher needs it: the title as shown, and the artists as separate names. */
export interface SongRef {
  title: string;
  primary: string[];
  featured: string[];
}

/** One search result. For Apple `artists` may hold the one joined string ("Drake & 21 Savage"); `href` is its link. */
export interface Hit {
  title: string;
  artists: string[];
  /** The release the result is on, when the service shows it (Spotify, iTunes). */
  album?: string;
  href?: string;
}

export type SearchService = "spotify" | "apple";

/** Folded text: no accents or case, no apostrophes, "&" as "and", every other run of symbols one space. */
export const fold = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’‘'`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const FEAT = /[([]\s*(?:feat\.?|ft\.?|featuring)\s[^)\]]*[)\]]|\s[-–]\s*(?:feat\.?|ft\.?|featuring)\s.*$/gi;
const WITH = /[([]\s*with\s+([^)\]]*)[)\]]/i;
const NON_LATIN_BRACKET = /[([](?=[^)\]]*\p{L})(?![^)\]]*[A-Za-z0-9])[^)\]]*[)\]]/gu;
const REMASTER = String.raw`(?:\d{4}\s+)?(?:digital\s+)?remaster(?:ed)?(?:\s+\d{4})?`;
const EDITION = new RegExp(
  String.raw`[(\[]\s*(?:${REMASTER}|radio edit|single version|album version|deluxe(?: edition)?|explicit)\s*[)\]]` +
    String.raw`|\s[-–]\s*(?:${REMASTER}|radio edit|single version|album version)\s*$`,
  "gi",
);
const FLAG_WORDS =
  /\b(live|acoustic|remix(?:es)?|instrumental|karaoke|sped up|slowed|reverb|tribute|cover|lullaby|8 bit|piano version|mixed)\b/gi;

const flagWords = (text: string): Set<string> => new Set((text.match(FLAG_WORDS) ?? []).map((w) => w.toLowerCase()));

const splitNames = (list: string): string[] => list.split(/\s*(?:,|&|\band\b)\s*/).filter(Boolean);

/**
 * A title as a comparable key. Featured parts, edition words that do not change the recording and a bracket that
 * only holds non-Latin letters are dropped; "Remix", "Live" and the like stay, so they must agree on both sides.
 */
export function normTitle(title: string, artists: string[]): string {
  let text = title.replace(FEAT, " ");
  const known = artists.map(fold);
  const withNames = WITH.exec(text);
  // "(with Justin Bieber)" is dropped only when every name in it is one of the song's artists: "Stay (With Me)" stays.
  if (withNames?.[1] !== undefined && splitNames(withNames[1]).every((name) => known.includes(fold(name)))) {
    text = text.replace(WITH, " ");
  }
  return fold(text.replace(EDITION, " ").replace(NON_LATIN_BRACKET, " "));
}

const sameSet = (a: string[], b: string[]): boolean => {
  const x = new Set(a.map(fold));
  const y = new Set(b.map(fold));
  return x.size === y.size && [...x].every((name) => y.has(name));
};

/** Whether Apple's one joined artist string is exactly these names, with nothing but "and", "x" or "with" between. */
function sameArtistsJoined(joined: string, names: string[]): boolean {
  let rest = ` ${fold(joined)} `;
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const folded = ` ${fold(name)} `;
    if (!rest.includes(folded)) return false;
    rest = rest.replace(folded, " ");
  }
  return rest
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => word === "and" || word === "x" || word === "with");
}

/** The artists a title names in a "(feat. ...)" bracket; Apple keeps featured artists there. */
function featuredInTitle(title: string): string[] {
  return [...title.matchAll(/[([]\s*(?:feat\.?|ft\.?|featuring)\s+([^)\]]*)[)\]]/gi)].flatMap((m) =>
    splitNames(m[1] ?? ""),
  );
}

/** The release name: the result's album, or the words of the album slug in an Apple link. */
function releaseOf(hit: Hit): string {
  if (hit.album !== undefined) return hit.album;
  const slug = /\/album\/([^/]+)\//.exec(hit.href ?? "")?.[1] ?? "";
  try {
    return decodeURIComponent(slug).replace(/-/g, " ");
  } catch {
    return slug.replace(/-/g, " ");
  }
}

/** True when the result is exactly this song: same title, same artists, and not an edition the title does not name. */
export function acceptsHit(service: SearchService, song: SongRef, hit: Hit): boolean {
  const all = [...song.primary, ...song.featured];
  if (normTitle(hit.title, all) !== normTitle(song.title, all)) return false;
  const artistsOk =
    service === "spotify"
      ? sameSet(hit.artists, all)
      : sameArtistsJoined(hit.artists.join(" and "), song.primary) &&
        sameSet(featuredInTitle(hit.title), song.featured);
  if (!artistsOk) return false;
  // Every flag word of the release ("Live", "Remixes") must be one the Genius title has too.
  const allowed = flagWords(song.title);
  return [...flagWords(releaseOf(hit))].every((word) => allowed.has(word));
}

/** The first accepted result in the service's own order, or null: never the top result by default. */
export function pickHit(service: SearchService, song: SongRef, hits: readonly Hit[]): Hit | null {
  return hits.find((hit) => acceptsHit(service, song, hit)) ?? null;
}
