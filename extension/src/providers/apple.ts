// Apple Music as the first credits provider. The reader itself stays in src/apple/.
import { readApplePageLabel } from "../apple/pageLabel";
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
  // An album address with a song picked ("?i=") is still the album, but Apple titles the tab after that song: such a
  // page is named from its own header. Every other Apple page keeps its tab title, which is its own.
  liveTitle: (url) => parseAppleMusicUrl(url)?.kind === "album" && new URL(url).searchParams.has("i"),
  readPageLabel: readApplePageLabel,
  pageKey(url) {
    // The path names the page; a track picked after the address (?i=) does not make a second one.
    const { origin, pathname } = new URL(url);
    return origin + pathname;
  },
  openUrl: (url) => url,
  tabName(title, url, kind) {
    const { title: name, artist } = appleTitleParts(title);
    if (!name) return nameFromAddress(url, kind);
    return artist ? `${artist} - ${name}` : name;
  },
  normaliseRole,
};
