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

// Letters that Unicode does not split into a base letter and an accent, spelled the way a Latin keyboard would.
const LETTER_MAP: Record<string, string> = {
  ø: "o",
  ł: "l",
  đ: "d",
  ð: "d",
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ı: "i",
  þ: "th",
  // Arabic letters that Arabic and Persian text writes in two shapes; Greek final sigma.
  ي: "ی",
  ى: "ی",
  ك: "ک",
  ة: "ه",
  ς: "σ",
};
// Accents on Latin, Greek and Cyrillic letters, and the optional vowel marks of Arabic and Hebrew, are dropped: the
// services and Genius disagree on them. Every other mark (the vowel signs of Hindi and Thai, the voicing marks of
// Japanese kana) changes the word and stays.
// Ranges: U+0300-036F combining accents, U+0591-05C7 Hebrew niqqud, U+0610-061A and U+064B-065F and U+0670 Arabic marks.
const OPTIONAL_MARKS = new RegExp(String.raw`[̀-֑ͯ-ׇؐ-ًؚ-ٰٟ]`, "gu");

/**
 * Folded text: no accents or case, no apostrophes, "&" as "and", every other run of symbols one space. A text of
 * nothing but symbols ("!!!", "♥") keeps them, so two of them are not read as the same empty text.
 */
export const fold = (text: string): string => {
  const letters = text
    .normalize("NFKD")
    .replace(OPTIONAL_MARKS, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[øłđðßæœıþيىكةأإآٱς]/g, (c) => LETTER_MAP[c] ?? c)
    .replace(/[’‘'`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
  return letters !== "" ? letters : text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
};

const FEAT = /[([]\s*(?:feat\.?|ft\.?|featuring)\s[^)\]]*[)\]]|\s[-–]\s*(?:feat\.?|ft\.?|featuring)\s.*$/gi;
const WITH = /[([]\s*with\s+([^)\]]*)[)\]]/i;
const NON_LATIN_BRACKET = /[([](?=[^)\]]*\p{L})(?![^)\]]*[\p{Script=Latin}0-9])[^)\]]*[)\]]/gu;
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

// Genius writes some non-Latin titles as "アイドル (Idol)": the original, then its Latin spelling in a parenthetical. The
// services list the song under one of the two, so either spelling is accepted and the Latin one is searched.
const TITLE_WITH_PAREN = /^(.*\S)\s*\(([^()]+)\)\s*$/;
// "Latin" is the script, not just A-Z: Vietnamese, Turkish, Polish, Czech and the like are Latin with accents.
const isNonLatin = (text: string): boolean => !/\p{Script=Latin}/u.test(text) && /\p{L}/u.test(text);
const isLatin = (text: string): boolean => /^[\p{Script=Latin}\p{N}\s.,'’!?&-]+$/u.test(text) && /\p{L}/u.test(text);
function titleKeys(title: string): string[] {
  const m = TITLE_WITH_PAREN.exec(title.trim());
  const base = m?.[1]?.trim();
  const inner = m?.[2]?.trim();
  if (!base || !inner) return [];
  const pair = (isNonLatin(base) && isLatin(inner)) || (isLatin(base) && isNonLatin(inner));
  return pair ? [fold(base), fold(inner)].filter((k) => k !== "") : [];
}

// Genius sometimes names an artist "display name (Real Name)" or "name (US)", the services list the name alone. A
// trailing parenthetical is therefore dropped for the search and as a second spelling in the compare, whatever it
// says; the whole name is still tried first. A non-Latin name with its Latin spelling in the parenthetical
// ("ЭВСЭ (EVSE)") may be listed under either spelling.
const TRAILING_PAREN = /^(.*\S)\s*\(([^()]+)\)$/;

interface NameForms {
  /** Every folded spelling a service may list this artist under; the first is the whole name. */
  keys: string[];
  /** The spelling to put in a search query. */
  search: string;
}

function formsOf(name: string): NameForms {
  const whole = { keys: [fold(name)], search: name };
  const m = TRAILING_PAREN.exec(name.trim());
  const base = m?.[1]?.trim();
  const inner = m?.[2]?.trim();
  if (!base || !inner || fold(base) === "") return whole;
  // Several brackets in a row ("Ант (Ant) (RUS)"): every shorter spelling is a form of the name too.
  const shorter = formsOf(base);
  if (isNonLatin(base) && isLatin(inner)) {
    return { keys: [fold(name), ...shorter.keys, fold(inner)], search: inner };
  }
  return { keys: [fold(name), ...shorter.keys], search: shorter.search };
}

/** Every spelling of a name worth searching: the one the services index, then the Genius name without its brackets. */
export function nameSearches(name: string): string[] {
  const spellings = [formsOf(name).search];
  let rest = name.trim();
  for (let m = TRAILING_PAREN.exec(rest); m?.[1] !== undefined; m = TRAILING_PAREN.exec(rest)) {
    rest = m[1].trim();
    spellings.push(rest);
  }
  return [...new Set(spellings)];
}

/** The title as written, then each half of "native (Latin)" or "Latin (native)" when it is written that way. */
export function titleSearches(title: string): string[] {
  const m = TITLE_WITH_PAREN.exec(title.trim());
  const base = m?.[1]?.trim();
  const inner = m?.[2]?.trim();
  const pair = !!base && !!inner && ((isNonLatin(base) && isLatin(inner)) || (isLatin(base) && isNonLatin(inner)));
  return pair ? [title, base, inner] : [title];
}

/** The name as a search query should spell it: without the real-name parenthetical the services do not index. */
export const searchName = (name: string): string => formsOf(name).search;

/**
 * The spellings of each Genius name, one list per distinct name. A shortened spelling shared with another name of the
 * song is dropped, so two different artists can never be read as one.
 */
function formsOfAll(names: string[]): NameForms[] {
  const distinct = [...new Map(names.map((name) => [fold(name), formsOf(name)])).values()];
  return distinct.map((form, i) => ({
    ...form,
    keys: form.keys.filter(
      (key, k) => key !== "" && (k === 0 || !distinct.some((other, j) => j !== i && other.keys.includes(key))),
    ),
  }));
}

/** True when the result's artists are exactly the Genius artists, each under any one of its spellings. */
export function sameArtists(hit: string[], names: string[]): boolean {
  const listed = new Set(hit.map(fold));
  const used = new Set<string>();
  for (const { keys } of formsOfAll(names)) {
    const key = keys.find((k) => listed.has(k) && !used.has(k));
    if (key === undefined) return false;
    used.add(key);
  }
  return used.size === listed.size;
}

/** Whether Apple's one joined artist string is exactly these names, with nothing but "and", "x" or "with" between. */
export function sameArtistsJoined(joined: string, names: string[]): boolean {
  let rest = ` ${fold(joined)} `;
  const forms = formsOfAll(names).sort((a, b) => (b.keys[0]?.length ?? 0) - (a.keys[0]?.length ?? 0));
  for (const { keys } of forms) {
    const key = keys.map((k) => ` ${k} `).find((k) => rest.includes(k));
    if (key === undefined) return false;
    rest = rest.replace(key, " ");
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
  const wanted = normTitle(song.title, all);
  const spellings = titleKeys(song.title);
  const heard = normTitle(hit.title, all);
  if (heard !== wanted && !spellings.includes(heard)) return false;
  const artistsOk =
    service === "spotify"
      ? sameArtists(hit.artists, all)
      : sameArtistsJoined(hit.artists.join(" and "), song.primary) &&
        sameArtists(featuredInTitle(hit.title), song.featured);
  if (!artistsOk) return false;
  // Every flag word of the release ("Live", "Remixes") must be one the Genius title has too.
  const allowed = flagWords(song.title);
  return [...flagWords(releaseOf(hit))].every((word) => allowed.has(word));
}

/** The first accepted result in the service's own order, or null: never the top result by default. */
export function pickHit(service: SearchService, song: SongRef, hits: readonly Hit[]): Hit | null {
  return hits.find((hit) => acceptsHit(service, song, hit)) ?? null;
}
