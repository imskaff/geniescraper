// Apple Music as the first credits provider. The reader itself stays in src/apple/.
import { parseAppleMusicUrl } from "../apple/url";
import { normaliseRole } from "../core/roles";
import { appleTitleParts } from "./tabTitles";
import type { CreditsProvider, PageKind } from "./types";

/** "/us/album/hit-me-hard-and-soft/123" is "Hit Me Hard And Soft"; with no name in the address, just the kind. */
function nameFromAddress(url: string, kind: PageKind): string {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const slug = parts[2] && !/^\d+$/.test(parts[2]) ? parts[2] : "";
  let words = slug;
  try {
    words = decodeURIComponent(slug);
  } catch {
    // An address with a broken escape keeps the slug as it is.
  }
  const spaced = words.replace(/-+/g, " ").trim();
  if (!spaced) return kind === "album" ? "Apple Music album" : "Apple Music song";
  return spaced.replace(/(^|\s)(\S)/g, (_, space: string, letter: string) => space + letter.toUpperCase());
}

export const APPLE_PROVIDER: CreditsProvider = {
  id: "apple",
  label: "Apple Music",
  origins: ["https://music.apple.com/*"],
  permission: "required",
  contentScript: "apple/content.js",
  worksHidden: true,
  messages: {
    notAlbumOrSong: "Not an Apple Music album or song link.",
    notSong: "Not an Apple Music song link.",
    tabNotShowing: "That tab is not showing this Apple Music page.",
    slowResponse: "Apple Music took too long to respond. Try again.",
  },
  parseUrl(url) {
    const parsed = parseAppleMusicUrl(url);
    return parsed ? { kind: parsed.kind, region: parsed.storefront } : null;
  },
  pageKey(url) {
    // The path names the page; a track picked after the address (?i=) does not make a second one.
    const { origin, pathname } = new URL(url);
    return origin + pathname;
  },
  openUrl: (url) => url,
  songOfAlbumUrl(url) {
    // An album address with a song picked ("?i=<song id>") is a song: its own address names it directly.
    const parsed = parseAppleMusicUrl(url);
    const song = parsed?.kind === "album" ? /^\d+$/.exec(new URL(url).searchParams.get("i") ?? "")?.[0] : undefined;
    return parsed && song ? `https://music.apple.com/${parsed.storefront}/song/song/${song}` : null;
  },
  tabName(title, url, kind) {
    const { title: name, artist } = appleTitleParts(title);
    if (!name) return nameFromAddress(url, kind);
    return artist ? `${artist} - ${name}` : name;
  },
  normaliseRole,
};
