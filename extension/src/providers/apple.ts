// Apple Music as the first credits provider. The reader itself stays in src/apple/.
import { parseAppleMusicUrl } from "../apple/url";
import { normaliseRole } from "../core/roles";
import type { CreditsProvider, PageKind } from "./types";

/** The site's name closing a title, in any of the ways Apple's titles join it: " - ", " – ", " — ", " | " or " on ". */
const SITE_SUFFIX = /\s*(?:[-–—|]\s*|\bon\s+)?Apple Music\s*$/i;

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
  tabName(title, url, kind) {
    return title.trim().replace(SITE_SUFFIX, "").trim() || nameFromAddress(url, kind);
  },
  normaliseRole,
};
