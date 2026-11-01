// Spotify as the second credits provider. The in-page reader lives in src/spotify/.
import { normaliseSpotifyRole } from "../spotify/roles";
import { canonicalSpotifyUrl, parseSpotifyUrl } from "../spotify/url";
import { spotifyTitleParts } from "./tabTitles";
import type { CreditsProvider, PageKind } from "./types";

export const SPOTIFY_PROVIDER: CreditsProvider = {
  id: "spotify",
  label: "Spotify",
  origins: ["https://open.spotify.com/*"],
  permission: "optional",
  contentScript: "spotify/content.js",
  // A hidden tab opens the credits dialog with a plain click (measured), so no visible tab is needed.
  worksHidden: true,
  // Page loads are spread out and few at once: three hidden tabs, starts at least 0.15 s apart. Measured live to
  // behave (no error in 32 reads at 2 and 3 at once); any failed or blocked read drops it to one (see the router).
  // The tab title follows the playing song, so the list reads each page's own title instead.
  liveTitle: true,
  // Only a title that ends with the site name and is in a wording seen live counts as the page's own.
  isOwnTitle: (title) => spotifyTitleParts(title) !== null,
  readGapMs: 150,
  readConcurrency: 3,
  messages: {
    notAlbumOrSong: "Not a Spotify album or track link.",
    notSong: "Not a Spotify track link.",
    tabNotShowing: "That tab is not showing this Spotify page.",
    slowResponse: "Spotify took too long to respond. Try again.",
  },
  parseUrl(url) {
    const parsed = parseSpotifyUrl(url);
    return parsed ? { kind: parsed.kind, region: "" } : null;
  },
  pageKey: (url) => canonicalSpotifyUrl(url) ?? url,
  openUrl: (url) => canonicalSpotifyUrl(url) ?? url,
  tabName(title, _url, kind: PageKind) {
    const parts = spotifyTitleParts(title);
    if (parts) return parts.artist ? `${parts.artist} - ${parts.title}` : parts.title;
    return kind === "album" ? "Spotify album" : "Spotify track";
  },
  normaliseRole: normaliseSpotifyRole,
};
