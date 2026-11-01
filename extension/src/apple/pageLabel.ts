// The title and artist an Apple Music album page shows for itself, read from its header. The browser tab's title cannot
// be used for an album address with a song picked ("?i="): Apple then titles the tab after that song.
// Self-contained on purpose: `chrome.scripting.executeScript({ func })` sends this function's text to the tab.
import type { PageLabel } from "../providers/types";

export function readApplePageLabel(): PageLabel {
  const text = (el: Element | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const header = document.querySelector("[data-testid='container-detail-header']");
  const heading =
    text(document.querySelector("[data-testid='non-editable-product-title']")) || text(header?.querySelector("h1"));
  // Apple names a single "TITLE - Single" in its header; the type is not part of the song's name.
  const single = /\s[-–—]\s(?:Single|シングル)$/i.test(heading);
  return {
    path: location.pathname,
    single,
    title: single ? heading.replace(/\s[-–—]\s[^-–—]+$/, "") : heading,
    artists: [...(header?.querySelectorAll("a[href*='/artist/']") ?? [])]
      .slice(0, 1)
      .map((a) => text(a))
      .filter(Boolean),
  };
}
