// Where the panel page is shown. Chrome and Edge open it as a side panel, which stays beside the page. Safari has no
// side panel, so its build points the toolbar button at the same page as a popup. The page tells them apart by the
// API, never by the browser's name, so any browser without a side panel gets the popup behaviour.

/** The slice of the browser object the check reads. */
export interface SurfaceHost {
  sidePanel?: unknown;
}

/** True when the page is a toolbar popup (no side panel API), false when it can be a side panel. */
export function isPopupSurface(host: SurfaceHost): boolean {
  return host.sidePanel === undefined;
}

/**
 * A popup closes as soon as it loses focus, which happens all the time while the user works in the Genius tab. The
 * "panel closed" signal (which pauses an automatic run) is therefore only sent from a real side panel.
 */
export function reportsClosing(popup: boolean): boolean {
  return !popup;
}

export const POPUP_CLASS = "popup";
