// Settings for how the fields are pasted: hotkeys, pace, waits and the return countdown.
import { COUNTDOWN_RANGE, HOTKEY_CHOICES, PACE_RANGE, WAIT_RANGE } from "../shared/settings";
import { el } from "./dom";
import { type PanelState } from "./controller";
import { type ViewContext } from "./viewContext";
import { autoSwitch } from "./paste";
import { setting, settingsCard, subgroup } from "./settingsParts";

export function pastingSettings(v: ViewContext, state: PanelState): HTMLElement {
  const { settings } = state;
  const keySelect = (id: "nextHotkey" | "backHotkey", label: string): HTMLElement => {
    const select = el(
      "select",
      {
        class: "field",
        attrs: { id: `setting-${id}`, "data-key": `setting-${id}` },
        on: {
          change: (event) => {
            void v.panel.setSetting(id, (event.target as HTMLSelectElement).value);
          },
        },
      },
      ...HOTKEY_CHOICES.map((key) => el("option", { text: key, attrs: { value: key } })),
    );
    select.value = settings[id];
    return el("div", { class: "stack" }, el("label", { text: label, attrs: { for: `setting-${id}` } }), select);
  };

  const confirm = el("input", {
    attrs: { type: "checkbox", "data-key": "setting-autoConfirm" },
    on: {
      change: (event) => {
        void v.panel.setSetting("autoConfirm", (event.target as HTMLInputElement).checked);
      },
    },
  });
  confirm.checked = settings.autoConfirm;

  const autoReturn = el("input", {
    attrs: { type: "checkbox", "data-key": "setting-autoReturn" },
    on: {
      change: (event) => {
        void v.panel.setSetting("autoReturn", (event.target as HTMLInputElement).checked);
      },
    },
  });
  autoReturn.checked = settings.autoReturn;

  const openOnGenius = el("input", {
    attrs: { type: "checkbox", "data-key": "setting-openOnGenius", "aria-describedby": "setting-openOnGenius-help" },
    on: {
      change: (event) => {
        void v.panel.setSetting("openOnGenius", (event.target as HTMLInputElement).checked);
      },
    },
  });
  openOnGenius.checked = settings.openOnGenius;

  // A whole number of seconds; the model keeps it in range, so an out-of-range entry snaps back on the next draw.
  const seconds = (key: "returnSeconds" | "nextTrackSeconds", id: string, min: number): HTMLInputElement => {
    const input = el("input", {
      class: "field",
      attrs: {
        id,
        "data-key": id,
        type: "number",
        min: String(min),
        max: String(COUNTDOWN_RANGE.max),
        step: "1",
        "aria-describedby": `${id}-help`,
      },
      on: {
        change: (event) => {
          void v.panel.setSetting(key, Number((event.target as HTMLInputElement).value));
        },
      },
    });
    input.value = String(settings[key]);
    return input;
  };
  const returnBox = seconds("returnSeconds", "setting-returnSeconds", COUNTDOWN_RANGE.min);
  const nextBox = seconds("nextTrackSeconds", "setting-nextTrackSeconds", 0);

  const wait = el("input", {
    class: "field",
    attrs: {
      id: "setting-wait",
      "data-key": "setting-wait",
      type: "number",
      min: String(WAIT_RANGE.min),
      max: String(WAIT_RANGE.max),
      step: "0.1",
      "aria-describedby": "setting-wait-help",
    },
    on: {
      change: (event) => {
        void v.panel.setSetting("autocompleteWaitSeconds", Number((event.target as HTMLInputElement).value));
      },
    },
  });
  wait.value = String(settings.autocompleteWaitSeconds);

  // Auto-paste mode is enabled by default.
  const autoOn = settings.pasteMode === "auto";
  const modeSwitch = autoSwitch(
    v,
    autoOn,
    () => void v.panel.setSetting("pasteMode", autoOn ? "manual" : "auto"),
    false,
  );
  modeSwitch.setAttribute("data-key", "setting-pasteMode");
  modeSwitch.id = "setting-pasteMode";
  modeSwitch.setAttribute("aria-describedby", "setting-pasteMode-help");
  const meaning = (label: string, text: string, current: boolean): HTMLElement =>
    el(
      "div",
      { class: current ? "onoff current" : "onoff", attrs: current ? { "aria-current": "true" } : {} },
      el("strong", { text: label }),
      el("span", { text }),
    );
  const meanings = el(
    "div",
    { class: "onoff-list", attrs: { id: "setting-pasteMode-help" } },
    meaning(
      "ON",
      "Start pasting fills the whole track by itself, one field after another, pausing briefly between them. It stops when you interact with the Genius form, press Esc, or close the panel. Turn Auto-paste back on to carry on. You still review and save the form on Genius.",
      autoOn,
    ),
    meaning(
      "OFF",
      `Start pasting fills one field each time you press ${settings.nextHotkey}, so you stay in control of every step. You can turn Auto-paste on from the paste screen whenever you need it.`,
      !autoOn,
    ),
  );
  const paceBox = el("input", {
    class: "field",
    attrs: {
      id: "setting-autoPace",
      "data-key": "setting-autoPace",
      type: "number",
      min: String(PACE_RANGE.min),
      max: String(PACE_RANGE.max),
      step: "0.1",
      "aria-describedby": "setting-autoPace-help",
    },
    on: {
      change: (event) => {
        void v.panel.setSetting("autoPaceSeconds", Number((event.target as HTMLInputElement).value));
      },
    },
  });
  paceBox.value = String(settings.autoPaceSeconds);

  return settingsCard(
    "settings-pasting",
    "Pasting on Genius",
    el("div", { class: "setting" }, el("p", { class: "setting-label", text: "Start pasting" }), modeSwitch, meanings),
    setting(
      "Seconds between fields when pasting automatically",
      "setting-autoPace",
      paceBox,
      "setting-autoPace-help",
      `Between ${String(PACE_RANGE.min)} and ${String(PACE_RANGE.max)}. A longer pause is gentler on Genius and easier to follow.`,
    ),
    subgroup(
      "Keys",
      keySelect("nextHotkey", "Key that fills the next step"),
      keySelect("backHotkey", "Key that goes back one step"),
    ),
    subgroup(
      "When Genius has no exact match",
      el(
        "div",
        { class: "setting" },
        el(
          "label",
          { class: "check" },
          confirm,
          el("span", { text: "Choose the exact match in Genius's suggestions for me" }),
        ),
        el("p", {
          class: "help",
          text: "When Genius has no exact match, the text stays typed and you choose. A close match is never picked for you.",
        }),
      ),
      setting(
        "Wait for suggestions to settle (seconds)",
        "setting-wait",
        wait,
        "setting-wait-help",
        "Raise this if Genius is slow to show suggestions.",
      ),
    ),
    subgroup(
      "After a track",
      el(
        "label",
        { class: "check" },
        autoReturn,
        el("span", { text: "Go back to the main menu after the last track" }),
      ),
      el(
        "div",
        { class: "setting" },
        el(
          "label",
          { class: "check" },
          openOnGenius,
          el("span", { text: "Open each song on Genius before pasting it" }),
        ),
        el("p", {
          class: "help",
          attrs: { id: "setting-openOnGenius-help" },
          text: "Start pasting, and the next-track button, first search Genius for the song and open its Edit Metadata form in a new tab. It only goes on to paste when exactly one Genius song matches; otherwise it stops and tells you. The title and artist are sent to genius.com for the search. It never saves anything.",
        }),
      ),
      setting(
        "Seconds before going back to the main menu",
        "setting-returnSeconds",
        returnBox,
        "setting-returnSeconds-help",
        `Between ${String(COUNTDOWN_RANGE.min)} and ${String(COUNTDOWN_RANGE.max)}. It waits while you are using the panel.`,
      ),
      setting(
        "Seconds before pasting the next track",
        "setting-nextTrackSeconds",
        nextBox,
        "setting-nextTrackSeconds-help",
        `Between ${String(COUNTDOWN_RANGE.min)} and ${String(COUNTDOWN_RANGE.max)}, or 0 to wait for you to press the button.`,
      ),
    ),
  );
}
