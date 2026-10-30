// The settings screen and its smaller sections (reading, YouTube and Deezer permissions).
import { type OptionalHost } from "../lookups/http";
import { PARALLEL_CHOICES } from "../shared/settings";
import { el } from "./dom";
import { type PanelState } from "./controller";
import { type ViewContext } from "./viewContext";
import { SETTING_LABELS, setting, settingsCard, subgroup } from "./settingsParts";
import { pastingSettings } from "./settingsPasting";
import { desktopSettings } from "./settingsDesktop";
import { youtubeKeyContent } from "./settingsKey";

export function settings(v: ViewContext, state: PanelState): Node[] {
  return [
    v.heading("Settings"),
    settingsCard(
      "settings-paste",
      "What to paste",
      el(
        "ul",
        { class: "tracks" },
        ...SETTING_LABELS.map(([key, label]) => {
          const box = el("input", {
            attrs: { type: "checkbox", "data-key": `setting-${key}` },
            on: {
              change: (event) => {
                void v.panel.setSetting(key, (event.target as HTMLInputElement).checked);
              },
            },
          });
          box.checked = state.settings[key];
          return el("li", {}, el("label", { class: "check" }, box, el("span", { text: label })));
        }),
      ),
      el("p", { class: "help", text: "Changes apply to the paste queue at once and are saved to your browser." }),
    ),
    pastingSettings(v, state),
    readingSettings(v, state),
    youtubeSettings(v, state),
    desktopSettings(v, state),
    ...(state.update.eligible ? [updateSettings(v, state)] : []),
    deezerSettings(v, state),
  ];
}

export function readingSettings(v: ViewContext, state: PanelState): HTMLElement {
  const { settings } = state;
  const reads = el(
    "select",
    {
      class: "field",
      attrs: {
        id: "setting-parallelReads",
        "data-key": "setting-parallelReads",
        "aria-describedby": "setting-parallelReads-help",
      },
      on: {
        change: (event) => {
          void v.panel.setSetting("parallelReads", Number((event.target as HTMLSelectElement).value));
        },
      },
    },
    ...PARALLEL_CHOICES.map((n) =>
      el("option", {
        text: n === 0 ? "All at once" : n === 1 ? "1 (one by one)" : String(n),
        attrs: { value: String(n) },
      }),
    ),
  );
  reads.value = String(settings.parallelReads);

  return settingsCard(
    "settings-reading",
    "Reading credits",
    setting(
      "Tracks read at the same time",
      "setting-parallelReads",
      reads,
      "setting-parallelReads-help",
      "More at once is faster for an album, but opens that many hidden tabs on Apple Music together. One by one is the gentlest; three is the default.",
    ),
  );
}

/** One optional look-up: a box that asks Chrome for the site's permission, with what it does underneath. */
export function hostBox(
  v: ViewContext,
  state: PanelState,
  host: OptionalHost,
  label: string,
  help: string,
): HTMLElement {
  const input = el("input", {
    attrs: { type: "checkbox", "data-key": `host-${host}`, "aria-describedby": `host-${host}-help` },
    on: {
      change: (event) => {
        // Straight from the click: Chrome shows its permission prompt only for a call made in the gesture.
        void v.panel.setHost(host, (event.target as HTMLInputElement).checked);
      },
    },
  });
  input.checked = state.hosts[host];
  return el(
    "div",
    { class: "setting" },
    el("label", { class: "check" }, input, el("span", { text: label })),
    el("p", { class: "help", text: help, attrs: { id: `host-${host}-help` } }),
  );
}

/** The optional update notice: off until chosen, and it says exactly what is contacted and what is not. */
export function updateSettings(v: ViewContext, state: PanelState): HTMLElement {
  const input = el("input", {
    attrs: { type: "checkbox", "data-key": "setting-checkUpdates", "aria-describedby": "setting-checkUpdates-help" },
    on: {
      change: (event) => {
        // Straight from the click: Chrome shows its permission prompt only for a call made in the gesture.
        void v.panel.setCheckUpdates((event.target as HTMLInputElement).checked);
      },
    },
  });
  // Both the choice and Chrome's permission must stand: a permission taken back elsewhere unticks the box.
  input.checked = state.settings.checkUpdates && state.hosts.github;
  return settingsCard(
    "settings-updates",
    "Updates",
    el(
      "div",
      { class: "setting" },
      el("label", { class: "check" }, input, el("span", { text: "Check for updates" })),
      el("p", {
        class: "help",
        text: "This copy does not update itself. When on, Chrome asks first, then about once a day while this panel is open the extension asks api.github.com for the list of Géniescraper releases (nothing about you or your songs is sent) and shows a notice when a newer version exists. It never downloads or installs anything; you do that by hand. Take the permission back here or in chrome://extensions.",
        attrs: { id: "setting-checkUpdates-help" },
      }),
    ),
  );
}

/** The Deezer cover search. It comes last in Settings, as it does in the desktop app. */
export function deezerSettings(v: ViewContext, state: PanelState): HTMLElement {
  return settingsCard(
    "settings-deezer",
    "Cover art look-up",
    hostBox(
      v,
      state,
      "deezer",
      "Search Deezer for a cover when Apple has none",
      "Chrome asks before this contacts api.deezer.com, and you can take the permission back here or in chrome://extensions.",
    ),
  );
}

/** The YouTube look-up and, under it, the optional key that makes it reliable: one card, as in the desktop app. */
export function youtubeSettings(v: ViewContext, state: PanelState): HTMLElement {
  return settingsCard(
    "settings-youtube",
    "YouTube links",
    hostBox(
      v,
      state,
      "youtube",
      "Find a YouTube link for each track (recommended)",
      "Searches www.youtube.com's pages for the song, as the desktop app does. Off until you allow it, and it needs the YouTube link ticked above to be pasted. Chrome asks first; take the permission back here or in chrome://extensions.",
    ),
    subgroup("Better YouTube links (optional)", ...youtubeKeyContent(v, state)),
  );
}
