// Which changes of a browser tab make the open-pages list worth reading again.

export interface TabChange {
  url?: string | undefined;
  title?: string | undefined;
  status?: string | undefined;
}

/**
 * A new address, a finished load, or a new title. The title matters because a page that renders after it loaded, or a
 * site that rewrites its title (Spotify shows the song that is playing), changes nothing else the panel could notice:
 * without it the list would keep its first, unnamed entry until the user switched tabs.
 */
export function tabChangeNeedsRefresh(change: TabChange): boolean {
  return change.url !== undefined || change.title !== undefined || change.status === "complete";
}
