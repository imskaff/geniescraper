// The music pages the user already has open, as the panel offers them: one entry per album or song page of any
// provider, named from the tab's title, the page the user is looking at first. Pure, so the rules are tested
// without a browser. Which sites count, and how a title becomes a name, is the providers' business.
import { PROVIDERS, recogniseUrl } from "../providers/registry";
import type { CreditsProvider, PageKind } from "../providers/types";

/** A tab of the browser that shows a music site, as the panel is told of it. */
export interface OpenTab {
  tabId: number;
  url: string;
  title: string;
  /** The page's own title, read from the page, for a provider whose tab titles cannot be trusted (`liveTitle`). */
  pageTitle?: string;
  /** The tab the user is looking at: the active one in the current window. */
  current: boolean;
}

export interface MusicTabEntry {
  /** The page's address, as the tab shows it. */
  url: string;
  /** What to call it in the list. */
  name: string;
  kind: PageKind;
  /** The site the page belongs to ("Apple Music"), so the list can say where each page is from. */
  source: string;
  /** The page the user is looking at now. */
  current: boolean;
}

/** Marks sites put in titles for right-to-left layout and the like: invisible, and no part of the name. */
const INVISIBLE = new RegExp("[\u200b-\u200f\u202a-\u202e\u2060\ufeff]", "g");

const MAX_NAME = 120;

/** Control and private-use characters, which belong in no name. Spaces are turned into plain ones before this. */
const CONTROL = /[\p{Cc}\p{Co}]/gu;

function nameOf(provider: CreditsProvider, tab: OpenTab, kind: PageKind): string {
  // Titles carry no-break and thin spaces and the odd tab; the desktop app shows the same one-line name.
  // A provider that cannot trust the tab title is named from the page's own title, or from nothing: a name the page
  // does not have is never shown.
  const source = provider.liveTitle === true ? (tab.pageTitle ?? "") : tab.title;
  const plain = source.replace(INVISIBLE, "").replace(/\s+/g, " ").replace(CONTROL, "");
  const name = provider.tabName(plain, tab.url, kind);
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
}

/** One entry for each album or song page among `tabs`; anything else a provider's site shows is left out. */
export function musicTabEntries(
  tabs: readonly OpenTab[],
  providers: readonly CreditsProvider[] = PROVIDERS,
): MusicTabEntry[] {
  const byPage = new Map<string, MusicTabEntry>();
  for (const tab of tabs) {
    const recognised = recogniseUrl(tab.url, providers);
    if (!recognised) continue;
    // The same page in two tabs, or with a track picked after the address, is one entry.
    const key = recognised.provider.pageKey(tab.url);
    const known = byPage.get(key);
    if (known) {
      if (tab.current) known.current = true;
      continue;
    }
    byPage.set(key, {
      url: tab.url,
      name: nameOf(recognised.provider, tab, recognised.url.kind),
      kind: recognised.url.kind,
      source: recognised.provider.label,
      current: tab.current,
    });
  }
  const entries = [...byPage.values()];
  // The page being looked at comes first; the others keep the browser's order.
  return [...entries.filter((e) => e.current), ...entries.filter((e) => !e.current)];
}
