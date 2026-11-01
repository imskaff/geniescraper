// Spotify as the second credits provider. The in-page reader lives in src/spotify/.
import { normaliseSpotifyRole } from "../spotify/roles";
import { canonicalSpotifyUrl, parseSpotifyUrl } from "../spotify/url";
import type { CreditsProvider, PageKind } from "./types";

/** Spotify's own page titles close with the site name; the title of a playing song ("Song • Artist") does not. */
const OWN_TITLE = /\|\s*Spotify\s*$/i;
const SITE_SUFFIX = /\s*\|\s*Spotify\s*$/i;
/** English page titles: "Song - song and lyrics by Artist" and "Album - Album by Artist". */
const ENGLISH_TITLE = /^(.+?)\s+-\s+(?:song and lyrics|album|single|ep)\s+by\s+(.+)$/i;

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
  isOwnTitle: (title) => OWN_TITLE.test(title),
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
    // "Listen to After Hours - Album by The Weeknd": the English album form starts with a call to action.
    const bare = title
      .trim()
      .replace(SITE_SUFFIX, "")
      .trim()
      .replace(/^Listen to\s+/i, "");
    const english = ENGLISH_TITLE.exec(bare);
    if (english?.[1] && english[2]) return `${english[1]} by ${english[2]}`;
    return bare || (kind === "album" ? "Spotify album" : "Spotify track");
  },
  normaliseRole: normaliseSpotifyRole,
};
