// Building blocks shared by the settings sections.
import { el } from "./dom";

type ScrapeKey =
  "scrapeCore" | "scrapeAdditional" | "scrapeCopyright" | "scrapeYoutube" | "scrapeCoverArt" | "scrapeReleaseDate";

export const SETTING_LABELS: readonly (readonly [ScrapeKey, string])[] = [
  ["scrapeCore", "Songwriters and producers"],
  ["scrapeAdditional", "Additional credits"],
  ["scrapeCopyright", "Copyright lines (℗ and ©)"],
  ["scrapeYoutube", "YouTube link"],
  ["scrapeCoverArt", "PNG cover art link"],
  ["scrapeReleaseDate", "Release date"],
];

/**
 * A section of the settings: a card with its own heading, so where one starts and ends is plain. The space between
 * cards is larger than the space inside one, and inside a card the groups are told apart by `subgroup`.
 */
export function settingsCard(id: string, title: string, ...children: (Node | null)[]): HTMLElement {
  return el(
    "section",
    { class: "settings-card", attrs: { "aria-labelledby": id } },
    el("h3", { text: title, attrs: { id } }),
    ...children,
  );
}

/** A titled group inside a card, set off from the one before it by a line. */
export function subgroup(title: string, ...children: Node[]): HTMLElement {
  return el("div", { class: "subgroup" }, el("h4", { text: title }), ...children);
}

/** One setting: its label, its control and its help, close together, so they read as one thing. */
export function setting(label: string, forId: string, control: Node, helpId: string, help: string): HTMLElement {
  return el(
    "div",
    { class: "setting" },
    el("label", { text: label, attrs: { for: forId } }),
    control,
    el("p", { class: "help", text: help, attrs: { id: helpId } }),
  );
}
