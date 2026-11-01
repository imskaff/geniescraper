import type { CreditsProvider } from "../../src/providers/types";

export const FAKE_ALBUM = "https://tunes.example/album/blue-hour/42";
export const FAKE_SONG = "https://tunes.example/track/low-light/77";

/** A second source with its own URL rules, tab names and role table, and no Apple code behind it. */
export const FAKE_PROVIDER: CreditsProvider = {
  id: "fake",
  label: "Tunes",
  origins: ["https://tunes.example/*"],
  permission: "optional",
  contentScript: "fake/content.js",
  worksHidden: false,
  timing: { requestMs: 77 },
  messages: {
    notAlbumOrSong: "Not a Tunes album or track link.",
    notSong: "Not a Tunes track link.",
    tabNotShowing: "That tab is not showing this Tunes page.",
    slowResponse: "Tunes took too long to respond.",
  },
  parseUrl(url) {
    const match = /^https:\/\/tunes\.example\/(album|track)\/[^/?#]+\/\d+(?:[/?#]|$)/.exec(url);
    const kind = match?.[1];
    if (kind === "album") return { kind: "album", region: "" };
    if (kind === "track") return { kind: "song", region: "" };
    return null;
  },
  pageKey: (url) => url.split(/[?#]/)[0] ?? url,
  openUrl: (url) => url,
  tabName(title) {
    return title.replace(/\s*\|\s*Tunes$/, "").trim() || "Tunes page";
  },
  normaliseRole(raw) {
    const aliases: Record<string, string> = { "words by": "Writer", "mixed by": "Mixing Engineer" };
    return aliases[raw.trim().toLowerCase()] ?? raw.trim();
  },
};
