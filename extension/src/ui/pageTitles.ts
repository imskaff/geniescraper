// Gives each open tab of a provider whose tab titles cannot be trusted its page's own title, read from the tab.
import type { OpenTab } from "../core/musicTabs";
import { recogniseUrl } from "../providers/registry";
import type { PageLabel } from "../spotify/pageLabel";
import { labelText } from "../spotify/pageLabel";

/** How the label is read from a tab: null when the tab cannot be read (no access, closed, still loading). */
export type ReadLabel = (tabId: number) => Promise<PageLabel | null>;

/** The path of an address, for comparing a label with the tab it came from. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/**
 * Adds `pageTitle` to the tabs that need it. A label is kept only when it was read from the page the tab's address
 * names: a heading read while the player was still moving to another page is dropped, so the list shows a generic
 * name for a moment instead of a wrong one.
 */
export async function withPageTitles(tabs: readonly OpenTab[], read: ReadLabel): Promise<OpenTab[]> {
  return Promise.all(
    tabs.map(async (tab) => {
      if (recogniseUrl(tab.url)?.provider.liveTitle !== true) return tab;
      const label = await read(tab.tabId).catch(() => null);
      return label && label.path === pathOf(tab.url) ? { ...tab, pageTitle: labelText(label) } : tab;
    }),
  );
}
