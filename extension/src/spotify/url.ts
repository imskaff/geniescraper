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

/** Address of a track by id, for reading a track of an album through its own page. */
export const spotifyTrackUrl = (id: string): string => `${HOST}/track/${id}`;
