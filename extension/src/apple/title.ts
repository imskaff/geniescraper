// Port of scraper.apple_music._extract_title_artist: "Title - Single by Artist - Apple Music" into its parts.
import { stripChars } from "../core/text";

// Left-to-right and right-to-left marks Apple Music wraps around titles.
const DIRECTION_MARKS = String.fromCodePoint(0x200e, 0x200f);

const TYPE_LABELS: ReadonlySet<string> = new Set(["single", "ep", "album", "soundtrack", "deluxe edition", "live"]);
const SUFFIXES = [" - Apple Music", " – Apple Music", " on Apple Music"];
const SEPARATORS = [" – ", " - "];

const ARTIST_PREFIX = /^(?:album|ep|single|song)(?:\s+with\s+lyrics)?\s+by\s+/i;
const TITLE_EDITION_SUFFIX =
  /\s*[-–—]\s*(?:single|ep|deluxe|expanded|remastered|reissue|bonus track|live|acoustic|remix|radio edit|version|edition)\s*$/i;

/** (title, artist) of an Apple Music page title, or ("", "") when it has neither. */
export function extractTitleArtist(pageTitle: string): [title: string, artist: string] {
  if (!pageTitle) return ["", ""];

  let clean = stripChars(pageTitle, DIRECTION_MARKS);
  for (const suffix of SUFFIXES) {
    if (clean.toLowerCase().endsWith(suffix.toLowerCase())) clean = clean.slice(0, -suffix.length);
  }

  for (const separator of SEPARATORS) {
    const parts = clean.split(separator).map((part) => part.trim());
    if (parts.length < 2) continue;
    const rawTitle = stripChars(parts[0] ?? "", DIRECTION_MARKS);
    let rawArtist = parts[1] ?? "";
    // Skip type labels Apple Music inserts between the title and the artist name.
    if (TYPE_LABELS.has(rawArtist.toLowerCase()) && parts.length >= 3) rawArtist = parts[2] ?? "";
    const artist = rawArtist.replace(ARTIST_PREFIX, "").trim();
    const title = rawTitle.replace(TITLE_EDITION_SUFFIX, "").trim();
    return [title, artist];
  }

  // Last resort: "Title by Artist".
  const byAt = clean.indexOf(" by ");
  if (byAt !== -1) return [clean.slice(0, byAt).trim(), clean.slice(byAt + " by ".length).trim()];
  return ["", ""];
}
