// The first-time set-up: a short, skippable walk through the choices that matter, shown the first time the panel
// opens and from Settings ("Run the setup again"). It only reads and changes what Settings already holds; it adds no
// state of its own except which step is showing. Every control here is one the Settings screen also has, so what is
// chosen here can be changed there at any time.
import { HOTKEY_CHOICES, PARALLEL_CHOICES, type Settings } from "../shared/settings";
import { el } from "./dom";
import { SETUP_STEPS, type PanelController, type PanelState } from "./controller";

/** The parts of the main view the set-up borrows, so it does not copy them. */
export interface SetupParts {
  button(
    text: string,
    variant: "primary" | "quiet" | "nav",
    key: string,
    onClick: () => void,
    disabled: boolean,
    wide?: boolean,
  ): HTMLElement;
  heading(text: string): HTMLElement;
  /** The Deezer and YouTube page-reading boxes (each asks Chrome for permission inside its click). */
  youtubeFieldset(): HTMLElement;
  /** The YouTube key box with its step-by-step help. */
  deezerFieldset(): HTMLElement;
  /** True the first time the welcome is drawn, so the intro plays once and a redraw does not replay it. */
  animateWelcome(): boolean;
}

const PARALLEL_TEXT = (n: number): string => (n === 0 ? "All at once" : n === 1 ? "1 (one by one)" : String(n));

type FlagKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

/** One tickable setting with a sentence under it saying what it does and whether it is recommended. */
function option(panel: PanelController, state: PanelState, key: FlagKey, label: string, help: string): HTMLElement {
  const box = el("input", {
    attrs: { type: "checkbox", "data-key": `setting-${key}`, "aria-describedby": `help-${key}` },
    on: {
      change: (event) => {
        void panel.setSetting(key, (event.target as HTMLInputElement).checked);
      },
    },
  });
  box.checked = state.settings[key];
  return el(
    "li",
    {},
    el("label", { class: "check" }, box, el("span", { text: label })),
    el("p", { class: "help option-help", text: help, attrs: { id: `help-${key}` } }),
  );
}

function select(
  panel: PanelController,
  id: "parallelReads" | "nextHotkey" | "backHotkey",
  label: string,
  help: string,
  values: readonly (string | number)[],
  text: (value: string | number) => string,
  current: string | number,
): HTMLElement {
  const field = el(
    "select",
    {
      class: "field",
      attrs: { id: `setup-${id}`, "data-key": `setup-${id}`, "aria-describedby": `help-${id}` },
      on: {
        change: (event) => {
          const raw = (event.target as HTMLSelectElement).value;
          if (id === "parallelReads") void panel.setSetting("parallelReads", Number(raw));
          else void panel.setSetting(id, raw);
        },
      },
    },
    ...values.map((value) => el("option", { text: text(value), attrs: { value: String(value) } })),
  );
  field.value = String(current);
  return el(
    "div",
    { class: "stack" },
    el("label", { text: label, attrs: { for: `setup-${id}` } }),
    field,
    el("p", { class: "help", text: help, attrs: { id: `help-${id}` } }),
  );
}

/** What the user has chosen, in plain words, for the last step. Pure, so it can be tested without a screen. */
export function setupSummary(state: PanelState): string[] {
  const { settings, hosts, youtubeKey } = state;
  const parts = [
    settings.scrapeCore && "songwriters and producers",
    settings.scrapeAdditional && "additional credits",
    settings.scrapeCopyright && "copyright lines",
    settings.scrapeCoverArt && "the PNG cover link",
    settings.scrapeReleaseDate && "the release date",
    settings.scrapeYoutube && "the YouTube link",
  ].filter((part): part is string => typeof part === "string");
  const reads = settings.parallelReads;
  const youtube =
    youtubeKey.saved && hosts.youtubeApi
      ? "from Google's official service, with your key"
      : hosts.youtube
        ? "by reading YouTube's pages (Google may limit this)"
        : "not looked up (you can add a key in Settings)";
  return [
    `Pasting: ${parts.length > 0 ? parts.join(", ") : "nothing is selected yet"}.`,
    `Reading: ${reads === 0 ? "every track at once" : reads === 1 ? "one track at a time" : `${String(reads)} tracks at a time`}.`,
    `Genius keys: ${settings.nextHotkey} fills the next step, ${settings.backHotkey} goes back.`,
    `Covers from Deezer when Apple has none: ${hosts.deezer ? "on" : "off"}.`,
    `YouTube links: ${youtube}.`,
  ];
}

export function renderSetup(state: PanelState, panel: PanelController, parts: SetupParts): Node[] {
  const { step } = state.setup;
  const last = step === SETUP_STEPS - 1;
  const progress = el("p", {
    class: "help setup-progress",
    text: `Set-up, step ${String(step + 1)} of ${String(SETUP_STEPS)}`,
  });

  // The intro plays once, with the first draw of the welcome; its button fades in last.
  const play = step === 0 && parts.animateWelcome();
  const body: Node[] = [];
  switch (step) {
    case 0:
      body.push(
        el(
          "div",
          { class: play ? "welcome animate" : "welcome" },
          el(
            "div",
            { class: "welcome-mark", attrs: { "aria-hidden": "true" } },
            el("span", { class: "welcome-glow" }),
            // The icon ships in the package, so it loads from the extension itself, never from the network.
            el("img", {
              class: "welcome-logo",
              attrs: { src: "../icons/icon-128.png", alt: "", width: "96", height: "96" },
            }),
          ),
          el("div", { class: "welcome-title" }, parts.heading("Welcome to Géniescraper")),
          el("p", {
            class: "welcome-lead",
            text: "Géniescraper copies a song's credits from Apple Music or Spotify into Genius's Edit Metadata form, one field at a time, when you press a key.",
          }),
          el(
            "ul",
            { class: "plain-list welcome-points" },
            el("li", { text: "It never presses Save for you. You look over the form and save it yourself." }),
            el("li", {
              text: "Nothing is sent to us: there is no account and no tracking. Your settings stay in your browser.",
            }),
            el("li", {
              text: "A short set-up follows: what to paste, how fast to read, and the optional look-ups. Every choice can be changed later in Settings.",
            }),
          ),
        ),
      );
      break;
    case 1:
      body.push(
        parts.heading("What should it paste?"),
        el("p", {
          class: "help",
          text: "Tick the parts of the Genius form you want filled. The recommended choices are already ticked.",
        }),
        el(
          "ul",
          { class: "tracks" },
          option(
            panel,
            state,
            "scrapeCore",
            "Songwriters and producers",
            "Who wrote and produced the song. Recommended.",
          ),
          option(
            panel,
            state,
            "scrapeAdditional",
            "Additional credits",
            "Mixing, mastering, vocals, instruments and every other role. Recommended.",
          ),
          option(
            panel,
            state,
            "scrapeCopyright",
            "Copyright lines (℗ and ©)",
            "The label lines from the bottom of the album page. Recommended.",
          ),
          option(
            panel,
            state,
            "scrapeCoverArt",
            "PNG cover art link",
            "A link to the 1000 by 1000 PNG cover, ready to add to Genius. Recommended.",
          ),
          option(
            panel,
            state,
            "scrapeReleaseDate",
            "Release date",
            "The month, day and year, chosen in the three Release Date dropdowns. Recommended.",
          ),
          option(
            panel,
            state,
            "scrapeYoutube",
            "YouTube link",
            "The official video or audio. It appears once a YouTube look-up is set up in step 4; until then there is nothing to paste for it.",
          ),
        ),
      );
      break;
    case 2:
      body.push(
        parts.heading("Speed and comfort"),
        el("p", {
          class: "help",
          text: "These make it faster and save key presses. The recommended choices are already set.",
        }),
        select(
          panel,
          "parallelReads",
          "Tracks read at the same time",
          "Recommended: 3. That is about two and a half times faster than one by one and still gentle on Apple Music. All at once is fastest but opens a tab for every track.",
          PARALLEL_CHOICES,
          (v) => PARALLEL_TEXT(Number(v)),
          state.settings.parallelReads,
        ),
        el(
          "ul",
          { class: "tracks" },
          option(
            panel,
            state,
            "autoConfirm",
            "Choose the exact match in Genius's suggestions for me",
            "Recommended: it saves a key press on every name. A close match is never picked for you; you choose those yourself.",
          ),
          option(
            panel,
            state,
            "autoReturn",
            "Go back to the main menu after the last track",
            "Recommended: the next song is one click away. It waits while you are using the panel.",
          ),
        ),
        select(
          panel,
          "nextHotkey",
          "Key that fills the next step",
          "Pressed on the Genius page. On many laptops the F-keys need the Fn key held down; pick another key if F8 is taken.",
          HOTKEY_CHOICES,
          String,
          state.settings.nextHotkey,
        ),
        select(
          panel,
          "backHotkey",
          "Key that goes back one step",
          "Pressed on the Genius page.",
          HOTKEY_CHOICES,
          String,
          state.settings.backHotkey,
        ),
      );
      break;
    case 3:
      body.push(
        parts.heading("Better covers and links (optional)"),
        el("p", {
          class: "help",
          text: "These look things up on other websites, so Chrome asks your permission for each one. Skip them and everything else still works.",
        }),
        el("p", {
          text: "Recommended: tick the YouTube box to find a link for each track; a free key from Google makes that reliable, and the steps walk you through it. The Deezer box below finds a cover when Apple has none.",
        }),
        parts.youtubeFieldset(),
        parts.deezerFieldset(),
      );
      break;
    default:
      body.push(
        parts.heading("You're all set"),
        el("p", { text: "Here is what you chose. You can change any of it in Settings." }),
        el("ul", { class: "plain-list" }, ...setupSummary(state).map((line) => el("li", { text: line }))),
        el("h3", { text: "How to use it", class: "section" }),
        el(
          "ol",
          { class: "plain-list" },
          el("li", {
            text: "Open an Apple Music or Spotify album or song and click the Géniescraper icon. Tip: pin it with the puzzle-piece button in Chrome's toolbar.",
          }),
          el("li", { text: "Choose the tracks and press Get credits." }),
          el("li", {
            text: "Open the song's Edit Metadata form on Genius and press Start pasting. Auto-paste in Settings decides whether fields fill automatically or one at a time. Review and save the form on Genius.",
          }),
        ),
      );
  }

  // The set-up has to be walked through: there is no skip, and "Back" is the only way out of a step but on.
  const nav = el(
    "div",
    { class: play ? "stack setup-nav animate" : "stack setup-nav" },
    el(
      "div",
      { class: "row" },
      step > 0
        ? parts.button(
            "Back",
            "quiet",
            "setup-back",
            () => {
              panel.setupBack();
            },
            false,
          )
        : null,
      last
        ? parts.button("Start using Géniescraper", "primary", "setup-finish", () => void panel.finishSetup(), false)
        : parts.button(
            step === 0 ? "Get started" : "Next",
            "primary",
            "setup-next",
            () => {
              panel.setupNext();
            },
            false,
          ),
    ),
  );

  return [progress, ...body, nav];
}
