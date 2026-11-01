// The title and artists a Spotify page shows for itself, read from the page's own heading. The browser tab's title
// cannot be used: Spotify rewrites it to the song that is playing, which can be another song than the page shown.
import type { PageLabel } from "../providers/types";

// Self-contained on purpose: `chrome.scripting.executeScript({ func })` sends this function's text to the tab.

export function readPageLabel(): PageLabel {
  const text = (el: Element | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  return {
    path: location.pathname,
    title: text(document.querySelector("[data-testid='entityTitle']")),
    artists: [...document.querySelectorAll("[data-testid='entity-header'] [data-testid='creator-link']")]
      .map((a) => text(a))
      .filter(Boolean),
  };
}

/** "Heavy Is The Crown by Anderson .Paak, Cordae", or "" when the page showed no title. */
export function labelText(label: PageLabel): string {
  if (!label.title) return "";
  return label.artists.length > 0 ? `${label.title} by ${label.artists.join(", ")}` : label.title;
}
