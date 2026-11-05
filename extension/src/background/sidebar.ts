// Firefox shows the panel in its sidebar and opens it only from a user action, so a toolbar click has to ask for it.
// Chrome opens its side panel by itself (see setPanelBehavior in worker.ts) and Safari has neither: both skip this.

/** The slice of the browser object the toolbar-click handler needs. */
export interface SidebarHost {
  action: { onClicked: { addListener: (listener: () => void) => void } };
  sidebarAction?: { toggle: () => Promise<void> };
}

/** Toggles the sidebar on a toolbar click. Returns whether the browser has a sidebar at all. */
export function toggleSidebarOnClick(host: SidebarHost): boolean {
  const sidebar = host.sidebarAction;
  if (sidebar === undefined) return false;
  // Called straight from the click handler, before anything async: the browser only allows it inside the gesture.
  host.action.onClicked.addListener(() => {
    sidebar.toggle().catch(() => undefined);
  });
  return true;
}
