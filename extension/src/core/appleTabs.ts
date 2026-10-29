// The Apple Music pages the user already has open, as the panel offers them: one entry per album or song page, named
// from the tab's title, the page the user is looking at first. Pure, so the rules are tested without a browser.
import { parseAppleMusicUrl } from "../apple/url";

/** A tab of the browser that shows Apple Music, as the panel is told of it. */
export interface OpenTab {
  tabId: number;
  url: string;
  title: string;
  /** The tab the user is looking at: the active one in the current window. */
  current: boolean;
}

export interface AppleTabEntry {
  /** The page's address, as the tab shows it. */
  url: string;
  /** What to call it in the list. */
  name: string;
  kind: "album" | "song";
  /** The page the user is looking at now. */
  current: boolean;
}

/** Marks Apple puts in titles for right-to-left layout and the like: invisible, and no part of the name. */
const INVISIBLE = new RegExp("[\u200b-\u200f\u202a-\u202e\u2060\ufeff]", "g");

/** The site's name closing a title, in any of the ways Apple's titles join it: " - ", " – ", " — ", " | " or " on ". */
const SITE_SUFFIX = /\s*(?:[-–—|]\s*|\bon\s+)?Apple Music\s*$/i;

const MAX_NAME = 120;

/** "/us/album/hit-me-hard-and-soft/123" is "Hit Me Hard And Soft"; with no name in the address, just the kind. */
function nameFromAddress(url: string, kind: "album" | "song"): string {
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

/** Control and private-use characters, which belong in no name. Spaces are turned into plain ones before this. */
const CONTROL = /[\p{Cc}\p{Co}]/gu;

function nameOf(tab: OpenTab, kind: "album" | "song"): string {
  // Titles carry no-break and thin spaces and the odd tab; the desktop app shows the same one-line name.
  const plain = tab.title.replace(INVISIBLE, "").replace(/\s+/g, " ").replace(CONTROL, "");
  const title = plain.trim().replace(SITE_SUFFIX, "").trim();
  const name = title || nameFromAddress(tab.url, kind);
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
}

/** One entry for each album or song page among `tabs`; anything else Apple Music shows is left out. */
export function appleTabEntries(tabs: readonly OpenTab[]): AppleTabEntry[] {
  const byPage = new Map<string, AppleTabEntry>();
  for (const tab of tabs) {
    const parsed = parseAppleMusicUrl(tab.url);
    if (!parsed) continue;
    // The same page in two tabs, or with a track picked after the address, is one entry.
    const key = new URL(tab.url).pathname;
    const known = byPage.get(key);
    if (known) {
      if (tab.current) known.current = true;
      continue;
    }
    byPage.set(key, { url: tab.url, name: nameOf(tab, parsed.kind), kind: parsed.kind, current: tab.current });
  }
  const entries = [...byPage.values()];
  // The page being looked at comes first; the others keep the browser's order.
  return [...entries.filter((e) => e.current), ...entries.filter((e) => !e.current)];
}
