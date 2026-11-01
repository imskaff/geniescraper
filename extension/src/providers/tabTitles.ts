// Turns the title of a browser tab into the page's title and artist, for the open-pages list. Only wordings seen in
// real titles are understood; anything else yields no artist (and for Spotify no name at all), so a source's own
// marketing text ("Song with Lyrics by", "Titel mit Gesang von") never ends up in a label.

export interface TitleParts {
  title: string;
  artist: string;
}

/** Marks Apple Music wraps around titles for right-to-left layout. */
const MARKS = /[‎‏]/g;

const APPLE_SITE = /\s*(?:[-–—|]\s*|\bon\s+)?Apple Music\s*$/i;

// What follows the title: the kind of page and the artist, per language seen on live Apple Music pages (en, de, fr, ja).
const APPLE_ARTIST_PATTERNS: readonly RegExp[] = [
  /^(?:Album|EP|Single|Song)(?: with Lyrics)? by (.+)$/i,
  /^(?:Album|EP|Single|Titel)(?: mit Gesang)? von (.+)$/i,
  /^(?:Album|EP|Single|Morceau)(?: avec paroles)? par (.+)$/i,
  /^(.+?)の(?:曲（歌詞付き）|アルバム|シングル|EP)$/,
];

/** An Apple Music title: "TITLE - Song with Lyrics by ARTIST - Apple Music" (the separator is " - " or " – "). */
export function appleTitleParts(raw: string): TitleParts {
  const clean = raw.replace(MARKS, "").replace(APPLE_SITE, "").trim();
  for (const separator of [" – ", " — ", " - "]) {
    const parts = clean.split(separator).map((part) => part.trim());
    if (parts.length < 2) continue;
    const title = parts[0] ?? "";
    for (const pattern of APPLE_ARTIST_PATTERNS) {
      const artist = pattern.exec(parts.slice(1).join(separator))?.[1]?.trim();
      if (artist) return { title, artist };
    }
    // A wording not known: the title is the part before the first separator, and the rest is not trusted.
    return { title, artist: "" };
  }
  // The older "TITLE by ARTIST" form (no separator): split at the last " by ", since a title may contain one.
  const by = clean.lastIndexOf(" by ");
  if (by > 0) return { title: clean.slice(0, by).trim(), artist: clean.slice(by + " by ".length).trim() };
  return { title: clean, artist: "" };
}

const SPOTIFY_SITE = /\s*\|\s*Spotify\s*$/i;

// Spotify's own page titles, per language seen live (en, da, de, ja). The part that varies is marketing text.
const SPOTIFY_PATTERNS: readonly RegExp[] = [
  /^(?:Listen to\s+)?(.+?)\s+-\s+(?:song and lyrics|album|single|EP)\s+by\s+(.+)$/i,
  /^(?:Streame\s+)?(.+?)\s+–\s+(?:Musik und Lyrics|Album|Single|EP)\s+von\s+(.+)$/i,
  /^(.+?)\s+‑\s+曲・歌詞：(.+)$/,
];
const SPOTIFY_JA_ALBUM = /^(.+?)の(?:アルバム|シングル|EP)\s+-\s+(.+?)を聴く$/;

/** A Spotify page title that ends with the site name, or null when it is not understood (or is not Spotify's own). */
export function spotifyTitleParts(raw: string): TitleParts | null {
  if (!SPOTIFY_SITE.test(raw)) return null;
  const bare = raw.replace(SPOTIFY_SITE, "").trim();
  for (const pattern of SPOTIFY_PATTERNS) {
    const match = pattern.exec(bare);
    if (match?.[1] && match[2]) return { title: match[1].trim(), artist: match[2].trim() };
  }
  const ja = SPOTIFY_JA_ALBUM.exec(bare);
  if (ja?.[1] && ja[2]) return { title: ja[2].trim(), artist: ja[1].trim() };
  return null;
}
