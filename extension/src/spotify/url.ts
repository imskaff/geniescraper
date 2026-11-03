// Only Spotify web-player track and album pages are ever opened or read. The check is strict because the extension
// opens tabs for URLs that arrive in messages: anything else is refused before a tab exists.

export interface SpotifyUrl {
  kind: "album" | "song";
  /** The 22-character id of the track or album. */
  id: string;
}

const HOST = "https://open.spotify.com";
// Spotify prefixes the path with a locale for some visitors ("/intl-de/track/..."): the same page, so it is ignored.
const SPOTIFY_URL = new RegExp(
  `^${HOST}/(?:intl-[a-z]{2}(?:-[A-Za-z0-9]{2,4})?/)?(track|album)/([A-Za-z0-9]{22})(?:[/?#]|$)`,
);

/** Kind and id of a Spotify track or album address, or null for anything else (artists, playlists, episodes...). */
export function parseSpotifyUrl(url: string): SpotifyUrl | null {
  const match = SPOTIFY_URL.exec(url);
  const kind = match?.[1];
  const id = match?.[2];
  if (!id || (kind !== "track" && kind !== "album")) return null;
  return { kind: kind === "track" ? "song" : "album", id };
}

/** The plain address of a page: no locale prefix, no query. `null` when `url` is not a Spotify page. */
export function canonicalSpotifyUrl(url: string): string | null {
  const parsed = parseSpotifyUrl(url);
  return parsed ? `${HOST}/${parsed.kind === "song" ? "track" : "album"}/${parsed.id}` : null;
}

/** Query parameter that marks a page as opened by the worker; the playback guard (guard.ts) acts only on such pages. */
export const READ_MARKER = "geniescraper";

/**
 * The address the worker opens in its own tab: the plain page plus `?locale=en` and the read marker, which makes Spotify serve that one
 * request in English (measured: the credits dialog, its headings and its role names, in German, Polish, Japanese,
 * Arabic and Thai browsers) without writing a cookie, so the user's own Spotify tabs keep their language. The locale
 * prefix, the tracking query and the fragment are dropped, since the page is told by the id alone. `null` when `url`
 * is not a Spotify track or album page. The parameter is not documented by Spotify; the reader checks the dialog it
 * gets back and falls back to its role tables when it is not English.
 */
export function spotifyOpenUrl(url: string): string | null {
  const plain = canonicalSpotifyUrl(url);
  return plain ? `${plain}?locale=en&${READ_MARKER}=read` : null;
}

/** Address of a track by id, for reading a track of an album through its own page. */
export const spotifyTrackUrl = (id: string): string => `${HOST}/track/${id}`;

/** The longest search text sent to Spotify. */
const MAX_QUERY = 200;

/**
 * The address of Spotify's search page (its songs tab, or its albums tab), as the worker opens it for an exact-match look-up: English
 * (`locale=en`, as for a read) and marked as a reader tab, so the playback guard is on. The query is encoded into the
 * path, and only a title and artist ever go into it.
 */
export function spotifySearchUrl(query: string, tab: "tracks" | "albums" = "tracks"): string {
  const text = query.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
  return `${HOST}/search/${encodeURIComponent(text)}/${tab}?locale=en&${READ_MARKER}=read`;
}

/** Whether a search page address built by `spotifySearchUrl` is the albums tab (the cards) rather than the songs tab. */
export const isAlbumSearchUrl = (url: string): boolean => new URL(url).pathname.endsWith("/albums");

/** Whether `url` is a search page address built by `spotifySearchUrl`; anything else is refused before it is read. */
export function isSpotifySearchUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const { origin, pathname, search, hash } = new URL(url);
  return (
    origin === HOST &&
    /^\/search\/[^/]{1,1800}\/(?:tracks|albums)$/.test(pathname) &&
    search === `?locale=en&${READ_MARKER}=read` &&
    hash === ""
  );
}
