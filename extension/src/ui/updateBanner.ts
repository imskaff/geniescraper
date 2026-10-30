// The "Update available" notice. It is shown only where it does not get in the way: not during the first-time
// set-up and not while pasting. It names the version, links to the release page and offers Later and Skip this
// version. Nothing is downloaded or installed for the user.
import { el } from "./dom";
import { type PanelState } from "./panelState";
import { type ViewContext } from "./viewContext";

/** Whether the notice shows now. The permission counts too: one taken back in chrome://extensions hides it at once. */
export function updateBannerVisible(state: PanelState): boolean {
  const { update, settings, hosts } = state;
  return (
    update.offer !== null &&
    update.eligible &&
    settings.checkUpdates &&
    hosts.github &&
    !state.setup.open &&
    !state.paste.active
  );
}

export function updateBanner(v: ViewContext, state: PanelState): HTMLElement | null {
  const offer = state.update.offer;
  if (!offer || !updateBannerVisible(state)) return null;
  // The button that was pressed is gone after the redraw: the reader continues at the screen's heading.
  const dismiss = (action: () => Promise<void>): void => {
    void action().then(() => {
      v.root.querySelector<HTMLElement>("#screen h2")?.focus();
    });
  };
  return el(
    "section",
    { class: "update-notice", attrs: { "aria-label": "Update available" } },
    el("p", { class: "update-title", text: "Update available" }),
    el("p", { text: `Version ${offer.version} of Géniescraper is out.` }),
    el("p", {
      class: "help",
      text: "Download the zip from the release page, unzip it over your current folder, then press the reload icon on the extension's card in chrome://extensions.",
    }),
    el(
      "div",
      { class: "row" },
      el("a", {
        class: "button primary link-button",
        text: "Open the release page",
        attrs: { href: offer.url, target: "_blank", rel: "noopener noreferrer", "data-key": "update-open" },
      }),
      v.button(
        "Later",
        "quiet",
        "update-later",
        () => {
          dismiss(() => v.panel.snoozeUpdate());
        },
        false,
      ),
      v.button(
        "Skip this version",
        "quiet",
        "update-skip",
        () => {
          dismiss(() => v.panel.skipUpdate());
        },
        false,
      ),
    ),
  );
}
