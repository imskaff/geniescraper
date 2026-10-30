// The "Open on Genius" button and its notice, shown beside Start pasting and on the finished screen. The notice says
// how far the attempt got; the worker's answer is the only thing it reports, and for several matches it lists plain
// links to the Genius pages so the user opens the right one themselves.
import { el } from "./dom";
import { geniusMessage } from "./geniusText";
import { type PanelState } from "./panelState";
import { type ViewContext } from "./viewContext";

/** The button for one track. It is disabled while a read or another attempt is under way. */
export function geniusButton(
  v: ViewContext,
  state: PanelState,
  index: number,
  title: string,
  busy: boolean,
): HTMLElement {
  const button = v.button(
    "Open on Genius",
    "quiet",
    "genius-open",
    () => void v.panel.openOnGenius(index),
    busy || state.genius.phase === "working",
  );
  button.setAttribute("aria-label", title ? `Open ${title} on Genius` : "Open on Genius");
  return button;
}

/** The notice for the track on screen, or null when nothing was tried for it. */
export function geniusNotice(state: PanelState, index: number | null): HTMLElement | null {
  const { genius } = state;
  if (index === null || genius.index !== index) return null;
  const message = geniusMessage(genius);
  if (!message) return null;
  const links =
    genius.phase === "several" ? genius.songs : genius.phase === "none" ? [] : genius.song ? [genius.song] : [];
  const linkText = (title: string, artists: string[]): string =>
    artists.length ? `${title} by ${artists.join(", ")}` : title;
  return el(
    "section",
    { class: `genius-open ${message.tone}`, attrs: { "aria-label": "Open on Genius", "data-key": "genius-notice" } },
    // The live regions at the top of the panel carry the words; this copy is for the eye.
    el("p", { text: message.text, attrs: { "aria-hidden": "true" } }),
    links.length > 0 && genius.phase !== "opened"
      ? el(
          "ul",
          { class: "genius-links" },
          ...links.map((song) =>
            el(
              "li",
              {},
              el("a", {
                text: linkText(song.title, song.artists),
                attrs: { href: song.url, target: "_blank", rel: "noopener noreferrer" },
              }),
            ),
          ),
        )
      : null,
  );
}
