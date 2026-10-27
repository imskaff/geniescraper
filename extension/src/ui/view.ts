// Renders the controller's state. The structure follows the accessibility basics rather than decoration:
// real headings, labelled controls, a status and an alert region that are never rebuilt (so announcements
// fire), focus moved to the new screen's heading, and focus kept where it was across a re-render.
import type { QueueKind } from "../core/models";
import type { AlbumInfo } from "../shared/messages";
import type { TrackResult, TrackStatus } from "../shared/session";
import { STEP_LABELS, instruction } from "../core/paste";
import type { OptionalHost } from "../lookups/http";
import { HOTKEY_CHOICES, PARALLEL_CHOICES, WAIT_RANGE } from "../shared/settings";
import { el } from "./dom";
import type { PanelController, PanelState } from "./controller";

export const FIELD_LABELS: Readonly<Record<QueueKind, string>> = {
  written_by: "Written By",
  produced_by: "Produced By",
  role: "Additional role",
  artist: "Artist in this role",
  copyright_role: "Copyright role",
  phonographic_copyright: "℗ label",
  copyright_notice: "© label",
  youtube_url: "YouTube URL",
  cover_art: "Cover art URL",
};

type ScrapeKey = "scrapeCore" | "scrapeAdditional" | "scrapeCopyright" | "scrapeYoutube" | "scrapeCoverArt";

const SETTING_LABELS: readonly (readonly [ScrapeKey, string])[] = [
  ["scrapeCore", "Songwriters and producers"],
  ["scrapeAdditional", "Additional credits"],
  ["scrapeCopyright", "Copyright lines (℗ and ©)"],
  ["scrapeYoutube", "YouTube link"],
  ["scrapeCoverArt", "Cover art link"],
];

const STATUS_TEXT: Readonly<Record<TrackStatus, string>> = {
  pending: "Waiting",
  loading: "Reading",
  done: "Ready",
  error: "Failed",
  unavailable: "No page",
};

/** Only https links are made clickable; the value shown is always the text. */
function isHttps(value: string): boolean {
  return URL.canParse(value) && new URL(value).protocol === "https:";
}

export class PanelView {
  private screenKey = "";
  /** What the user typed into the link box; kept across re-renders, which would otherwise reset it. */
  private draft: string | null = null;
  /** Which collapsible lists the user has opened; re-rendering rebuilds them, so the choice is kept here. */
  private shownErrorSeq = 0;
  private readonly expanded = new Map<string, boolean>();

  constructor(
    private readonly root: HTMLElement,
    private readonly panel: PanelController,
  ) {
    this.buildFrame();
    panel.subscribe(() => {
      this.render();
    });
    this.render();
  }

  // ── frame: parts that live as long as the panel ─────────────────────

  private buildFrame(): void {
    this.root.replaceChildren(
      el(
        "header",
        { class: "bar" },
        el(
          "div",
          { class: "bar-row" },
          el("h1", { text: "Géniescraper" }),
          el(
            "div",
            { class: "bar-actions" },
            // Start pasting lives here, in the header that stays in view, so it is never a scroll away.
            el("button", {
              class: "button primary glow",
              text: "Start pasting",
              attrs: { type: "button", id: "paste-top", "data-key": "paste-top", hidden: "" },
              on: {
                click: () => {
                  const index = this.startableIndex(this.panel.state);
                  if (index !== null) void this.panel.startPaste(index);
                },
              },
            }),
            el("button", {
              class: "button quiet",
              text: "Settings",
              attrs: { type: "button", id: "settings-toggle", "data-key": "settings-toggle" },
              on: {
                click: () => {
                  if (this.panel.state.settingsOpen) this.panel.closeSettings();
                  else this.panel.openSettings();
                },
              },
            }),
          ),
        ),
      ),
      // Both regions exist from the start and only their text changes, so screen readers announce updates.
      el("div", { class: "alert", attrs: { id: "alert", role: "alert" } }),
      el("div", { class: "status", attrs: { id: "status", role: "status", "aria-live": "polite" } }),
      el("main", { attrs: { id: "screen" } }),
    );
    this.root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.panel.state.settingsOpen) this.panel.closeSettings();
    });
  }

  private region(id: string): HTMLElement {
    const node = this.root.querySelector<HTMLElement>(`#${id}`);
    if (!node) throw new Error(`missing #${id}`);
    return node;
  }

  // ── rendering ───────────────────────────────────────────────────────

  render(): void {
    const state = this.panel.state;
    const main = this.region("screen");
    const focusKey = document.activeElement?.getAttribute("data-key") ?? null;
    // Rebuilding replaces the heading, so a heading that held focus has to be given it again.
    const headingHadFocus = document.activeElement?.tagName === "H2";

    this.region("alert").textContent = state.error;
    this.region("alert").classList.toggle("quiet-visual", state.paste.active && !state.settingsOpen);
    this.region("status").textContent = state.status;
    const toggle = this.region("settings-toggle");
    toggle.textContent = state.settingsOpen ? "Back" : "Settings";
    this.updateHeader(state);

    const finished =
      state.paste.active && state.paste.queue.length > 0 && state.paste.position >= state.paste.queue.length;
    const key = state.settingsOpen
      ? "settings"
      : finished
        ? "done"
        : state.paste.active
          ? "paste"
          : state.session.screen;
    // Starting over with a new link forgets the old one; opening and closing settings does not.
    if (key === "link" && (this.screenKey === "tracks" || this.screenKey === "review")) this.draft = null;
    main.setAttribute("aria-busy", String(state.busy !== null));
    main.replaceChildren(
      ...(state.settingsOpen
        ? this.settings(state)
        : finished
          ? this.doneScreen(state)
          : state.paste.active
            ? this.pasteScreen(state)
            : this.screen(state)),
    );

    if (key !== this.screenKey) {
      // A new screen starts at its heading, so the reader hears where they are.
      this.screenKey = key;
      main.querySelector<HTMLElement>("h2")?.focus();
    } else if (headingHadFocus) {
      main.querySelector<HTMLElement>("h2")?.focus();
    } else if (focusKey) {
      this.root.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
    }
  }

  private screen(state: PanelState): Node[] {
    switch (state.session.screen) {
      case "link":
        return this.linkScreen(state);
      case "tracks":
        return this.tracksScreen(state);
      case "review":
        return this.reviewScreen(state);
    }
  }

  private heading(text: string): HTMLElement {
    return el("h2", { text, attrs: { tabindex: "-1" } });
  }

  /** The track whose credits are on screen and can be pasted now, or null. */
  private startableIndex(state: PanelState): number | null {
    if (state.settingsOpen || state.paste.active || state.session.screen !== "review") return null;
    const { results, current } = state.session;
    const shown = results.find((r) => r.index === current) ?? results[0];
    return shown?.song && this.panel.queueFor(shown.index).length > 0 ? shown.index : null;
  }

  /** The header's shortcut to pasting follows the screen. */
  private updateHeader(state: PanelState): void {
    const top = this.region("paste-top") as HTMLButtonElement;
    const index = this.startableIndex(state);
    top.hidden = index === null;
    top.disabled = state.busy !== null;
    // It glows while it is the thing to do next, not while it cannot be pressed.
    top.classList.toggle("glow", !top.disabled);
    const title = state.session.results.find((r) => r.index === index)?.song?.title;
    if (title) top.setAttribute("aria-label", `Start pasting ${title}`);
    else top.removeAttribute("aria-label");
  }

  /** A section the user can open and close, closed until they do unless it opens by default. Its state survives re-rendering. */
  private disclosure(id: string, summary: string, body: Node, openByDefault = false): HTMLElement {
    const details = el(
      "details",
      { class: "disclosure" },
      el("summary", { text: summary, attrs: { "data-key": `details-${id}` } }),
      body,
    );
    details.open = this.expanded.get(id) ?? openByDefault;
    details.addEventListener("toggle", () => {
      this.expanded.set(id, details.open);
    });
    return details;
  }

  // ── link ────────────────────────────────────────────────────────────

  private linkScreen(state: PanelState): Node[] {
    const busy = state.busy === "detect";
    const input = el("input", {
      class: "field",
      attrs: {
        id: "link",
        "data-key": "link",
        type: "url",
        name: "link",
        autocomplete: "off",
        spellcheck: "false",
        placeholder: "https://music.apple.com/…",
        "aria-describedby": "link-help",
        ...(state.error ? { "aria-invalid": "true" } : {}),
      },
      on: {
        input: (event) => {
          this.draft = (event.target as HTMLInputElement).value;
        },
      },
    });
    input.value = this.draft ?? state.pageUrl;

    const form = el(
      "form",
      {
        class: "stack",
        attrs: { novalidate: "" },
        on: {
          submit: (event) => {
            event.preventDefault();
            this.draft = input.value;
            void this.panel.detect(input.value);
          },
        },
      },
      el("label", { text: "Apple Music album or song link", attrs: { for: "link" } }),
      input,
      el("p", {
        class: "help",
        text: state.pageUrl
          ? "You are on an Apple Music page, so its link is filled in. Paste another to use a different one."
          : "Open an album or song on Apple Music and paste its link.",
        attrs: { id: "link-help" },
      }),
      el("button", {
        class: "button primary",
        text: busy ? "Reading…" : "Get credits",
        attrs: { type: "submit", "data-key": "go", ...(busy ? { disabled: "" } : {}) },
      }),
    );
    return [this.heading("Get credits from Apple Music"), form];
  }

  // ── tracks ──────────────────────────────────────────────────────────

  private tracksScreen(state: PanelState): Node[] {
    const { album, selected } = state.session;
    if (!album) return this.linkScreen(state);
    const available = album.trackUrls.filter(Boolean).length;
    const busy = state.busy !== null;

    const list = el(
      "ul",
      { class: "tracks" },
      ...album.trackTitles.map((title, index) => this.trackRow(album, title, index, selected.includes(index))),
    );
    return [
      this.heading(album.albumTitle || "Tracks"),
      el("p", {
        class: "help",
        text: `${album.artist}: ${String(album.trackCount)} ${album.trackCount === 1 ? "track" : "tracks"}`,
      }),
      el(
        "fieldset",
        { class: "stack" },
        el("legend", { text: "Tracks to get credits for" }),
        el(
          "div",
          { class: "row" },
          // Nothing is picked to begin with, so the first move is highlighted, like the button it leads to.
          // Neither button disables itself after it is used: a disabled button drops keyboard focus.
          this.button("Select all", "primary", "all", () => void this.panel.setAllSelected(true), available === 0),
          this.button("Select none", "quiet", "none", () => void this.panel.setAllSelected(false), available === 0),
        ),
        list,
      ),
      el(
        "div",
        { class: "row" },
        this.button(
          `Get credits for ${String(selected.length)} ${selected.length === 1 ? "track" : "tracks"}`,
          "primary",
          "go",
          () => void this.panel.getCredits(),
          busy || selected.length === 0,
        ),
        this.button("Back to main menu", "nav", "menu", () => void this.panel.newAlbum(), false),
      ),
    ];
  }

  private trackRow(album: AlbumInfo, title: string, index: number, checked: boolean): HTMLElement {
    const unavailable = !album.trackUrls[index];
    const box = el("input", {
      attrs: {
        type: "checkbox",
        "data-key": `track-${String(index)}`,
        ...(unavailable ? { disabled: "" } : {}),
      },
      on: {
        change: (event) => {
          void this.panel.setTrackSelected(index, (event.target as HTMLInputElement).checked);
        },
      },
    });
    box.checked = checked && !unavailable;
    return el(
      "li",
      {},
      el(
        "label",
        { class: unavailable ? "check muted" : "check" },
        box,
        el("span", { text: `${String(index + 1)}. ${title}` }),
        unavailable ? el("span", { class: "tag", text: "No Apple Music page" }) : null,
      ),
    );
  }

  // ── review ──────────────────────────────────────────────────────────

  private reviewScreen(state: PanelState): Node[] {
    const { session } = state;
    const shown = session.results.find((r) => r.index === session.current) ?? session.results[0];
    const busy = state.busy === "scrape";

    const nav = el(
      "nav",
      { attrs: { "aria-label": "Tracks" } },
      el(
        "ul",
        { class: "tracks" },
        ...session.results.map((result) =>
          el(
            "li",
            {},
            el("button", {
              class: result.index === shown?.index ? "button track current" : "button track",
              text: `${String(result.index + 1)}. ${result.title}: ${STATUS_TEXT[result.status]}`,
              attrs: {
                type: "button",
                "data-key": `show-${String(result.index)}`,
                ...(result.index === shown?.index ? { "aria-current": "true" } : {}),
              },
              on: {
                click: () => {
                  void this.panel.showTrack(result.index);
                },
              },
            }),
          ),
        ),
      ),
    );

    return [
      this.heading("Credits"),
      // One track needs no list to choose from.
      session.results.length > 1 ? nav : null,
      shown ? this.trackDetail(state, shown) : null,
      el(
        "div",
        { class: "row" },
        busy ? this.button("Stop", "quiet", "stop", () => void this.panel.stop(), false) : null,
        // One song has no list to go back to.
        (session.album?.trackCount ?? 0) > 1
          ? this.button("Back to tracks", "quiet", "back", () => void this.panel.backToTracks(), busy)
          : null,
        this.button("Back to main menu", "nav", "menu", () => void this.panel.newAlbum(), false),
      ),
    ].filter((node): node is HTMLElement => node !== null);
  }

  private trackDetail(state: PanelState, result: TrackResult): HTMLElement {
    const section = el("section", { class: "stack", attrs: { "aria-labelledby": "track-heading" } });
    section.append(el("h3", { text: result.song?.title || result.title, attrs: { id: "track-heading" } }));

    if (result.status === "error") {
      section.append(
        el("p", { class: "problem", text: result.error }),
        this.button("Try again", "primary", "retry", () => void this.panel.retry(result.index), state.busy !== null),
      );
      return section;
    }
    const song = result.song;
    if (!song) {
      section.append(
        el("p", { class: "help", text: result.status === "loading" ? "Reading credits…" : "Waiting for its turn." }),
      );
      return section;
    }

    const groups = el("dl", { class: "credits" });
    for (const credit of song.credits) {
      groups.append(el("dt", { text: credit.role }), el("dd", { text: credit.artists.join(", ") }));
    }
    if (song.phonographicCopyright)
      groups.append(el("dt", { text: "Phonographic copyright" }), el("dd", { text: song.phonographicCopyright }));
    if (song.copyrightNotice) groups.append(el("dt", { text: "Copyright" }), el("dd", { text: song.copyrightNotice }));
    if (song.coverArtUrl) {
      groups.append(
        el("dt", { text: "Cover art" }),
        el(
          "dd",
          {},
          isHttps(song.coverArtUrl)
            ? el("a", {
                text: song.coverArtUrl,
                attrs: { href: song.coverArtUrl, target: "_blank", rel: "noopener noreferrer" },
              })
            : song.coverArtUrl,
        ),
      );
    }

    if (song.youtubeUrl) {
      groups.append(
        el("dt", { text: song.youtubeIsMv ? "YouTube (music video)" : "YouTube (audio)" }),
        el(
          "dd",
          {},
          isHttps(song.youtubeUrl)
            ? el("a", {
                text: song.youtubeUrl,
                attrs: { href: song.youtubeUrl, target: "_blank", rel: "noopener noreferrer" },
              })
            : song.youtubeUrl,
        ),
      );
    }

    const queue = this.panel.queueFor(result.index);
    section.append(
      song.credits.length === 0 ? el("p", { class: "problem", text: "No credits were found for this track." }) : groups,
      queue.length === 0
        ? el("p", { class: "help", text: "Nothing to paste with the current settings." })
        : this.disclosure(
            "queue",
            `Paste queue (${String(queue.length)} ${queue.length === 1 ? "step" : "steps"})`,
            el(
              "ol",
              { class: "queue", attrs: { "aria-label": "Paste queue" } },
              ...queue.map(([kind, value]) =>
                el("li", {}, el("span", { class: "tag", text: FIELD_LABELS[kind] }), el("span", { text: value })),
              ),
            ),
          ),
    );
    return section;
  }

  // ── pasting ─────────────────────────────────────────────────────────

  private pasteScreen(state: PanelState): Node[] {
    const { paste, settings } = state;
    const total = paste.queue.length;
    const finished = paste.position >= total;
    const current = paste.queue[paste.position];
    const progress = finished ? "All steps done" : `Step ${String(paste.position + 1)} of ${String(total)}`;

    // A finished step moves into the closed "Steps done" list; going back moves it out again.
    const item = ([kind, value]: readonly [QueueKind, string], index: number): HTMLElement => {
      const done = index < paste.position;
      const here = index === paste.position;
      const mark = done ? "Done" : here ? (paste.awaiting ? "Waiting for you" : "Next") : "";
      return el(
        "li",
        { class: done ? "done" : here ? "here" : "", attrs: here ? { "aria-current": "step" } : {} },
        el("span", { class: "tag", text: mark ? `${STEP_LABELS[kind]}: ${mark}` : STEP_LABELS[kind] }),
        el("span", { text: value }),
      );
    };
    const doneCount = Math.min(paste.position, total);
    const doneSteps = el(
      "ol",
      { class: "queue steps", attrs: { "aria-label": "Steps done" } },
      ...paste.queue.slice(0, doneCount).map(item),
    );
    const steps = el(
      "ol",
      { class: "queue steps", attrs: { "aria-label": "Steps left" } },
      ...paste.queue.slice(doneCount).map((entry, offset) => item(entry, doneCount + offset)),
    );

    return [
      this.heading("Paste into Genius"),
      el("p", { class: "help", text: paste.title }),
      this.pasteError(state),
      el("p", { class: "progress", text: progress }),
      current
        ? el(
            "div",
            { class: "step" },
            el("span", { class: "tag", text: STEP_LABELS[current[0]] }),
            el("p", { class: "value", text: current[1] }),
          )
        : null,
      el("p", { text: instruction(paste, settings.nextHotkey) }),
      el(
        "div",
        { class: "row" },
        this.button(
          `Fill next (${settings.nextHotkey})`,
          "primary",
          "fill",
          () => void this.panel.fillNext(),
          finished || paste.busy,
        ),
        this.button(
          `Back (${settings.backHotkey})`,
          "quiet",
          "pback",
          () => void this.panel.pasteBack(),
          paste.position === 0,
        ),
        this.button("Skip", "quiet", "pskip", () => void this.panel.pasteSkip(), finished),
        // Leaving a paste in progress looks like the other ways out, so it is easy to tell from the step buttons.
        this.button("Back to credits", "nav", "pstop", () => void this.panel.stopPaste(), false),
      ),
      el("p", {
        class: "help",
        text: "Keep the song's Edit Metadata form open on Genius. Nothing is saved for you: check the form, then save it there.",
      }),
      // While pasting the steps are the map of what is left, so they start open.
      doneCount > 0 ? this.disclosure("stepsdone", `Steps done (${String(doneCount)})`, doneSteps) : null,
      total - doneCount > 0 ? this.disclosure("steps", `Steps left (${String(total - doneCount)})`, steps, true) : null,
    ].filter((node): node is HTMLElement => node !== null);
  }

  /** The error above the step counter. A new error, or the same one on a new attempt, plays the attention animation once. */
  private pasteError(state: PanelState): HTMLElement | null {
    if (!state.error) return null;
    const fresh = state.errorSeq !== this.shownErrorSeq;
    this.shownErrorSeq = state.errorSeq;
    return el(
      "div",
      { class: `paste-error${fresh ? " fresh" : ""}`, attrs: { "aria-hidden": "true" } },
      el("span", { class: "paste-error-mark", text: "!" }),
      el("span", { text: state.error }),
    );
  }

  // ── done ────────────────────────────────────────────────────────────

  /** The screen in front of the finished paste, as in the desktop app: a clear success and the ways on. */
  private doneScreen(state: PanelState): Node[] {
    const next = this.panel.nextPastable();
    const nextTitle = state.session.results.find((r) => r.index === next)?.song?.title;
    const tracks = (state.session.album?.trackCount ?? 0) > 1;
    return [
      el(
        "div",
        { class: "finished" },
        el("div", { class: "done-mark", text: "✓", attrs: { "aria-hidden": "true" } }),
        this.heading("All credits entered"),
        el("p", { class: "help", text: state.paste.title }),
        el("p", { text: "Check the Genius page, then press Save there." }),
      ),
      el(
        "div",
        { class: "stack" },
        next !== null
          ? this.button(
              nextTitle ? `Paste next track: ${nextTitle}` : "Paste next track",
              "primary",
              "pnext",
              () => void this.panel.startPaste(next),
              false,
              true,
            )
          : null,
        this.button(
          "Back to the credits",
          "quiet",
          "pcredits",
          () => void this.panel.leavePasting("credits"),
          false,
          true,
        ),
        tracks
          ? this.button(
              "Back to the track list",
              "quiet",
              "ptracks",
              () => void this.panel.leavePasting("tracks"),
              false,
              true,
            )
          : null,
        this.button("Back to main menu", "nav", "pmenu", () => void this.panel.leavePasting("menu"), false, true),
      ),
    ];
  }

  // ── settings ────────────────────────────────────────────────────────

  private settings(state: PanelState): Node[] {
    return [
      this.heading("Settings"),
      el(
        "fieldset",
        { class: "stack" },
        el("legend", { text: "What to paste" }),
        el(
          "ul",
          { class: "tracks" },
          ...SETTING_LABELS.map(([key, label]) => {
            const box = el("input", {
              attrs: { type: "checkbox", "data-key": `setting-${key}` },
              on: {
                change: (event) => {
                  void this.panel.setSetting(key, (event.target as HTMLInputElement).checked);
                },
              },
            });
            box.checked = state.settings[key];
            return el("li", {}, el("label", { class: "check" }, box, el("span", { text: label })));
          }),
        ),
        el("p", { class: "help", text: "Changes apply to the paste queue at once and are saved to your browser." }),
      ),
      this.pastingSettings(state),
      this.readingSettings(state),
      this.lookupSettings(state),
    ];
  }

  private pastingSettings(state: PanelState): HTMLElement {
    const { settings } = state;
    const keySelect = (id: "nextHotkey" | "backHotkey", label: string): HTMLElement => {
      const select = el(
        "select",
        {
          class: "field",
          attrs: { id: `setting-${id}`, "data-key": `setting-${id}` },
          on: {
            change: (event) => {
              void this.panel.setSetting(id, (event.target as HTMLSelectElement).value);
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
          void this.panel.setSetting("autoConfirm", (event.target as HTMLInputElement).checked);
        },
      },
    });
    confirm.checked = settings.autoConfirm;

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
          void this.panel.setSetting("autocompleteWaitSeconds", Number((event.target as HTMLInputElement).value));
        },
      },
    });
    wait.value = String(settings.autocompleteWaitSeconds);

    return el(
      "fieldset",
      { class: "stack" },
      el("legend", { text: "Pasting on Genius" }),
      keySelect("nextHotkey", "Key that fills the next step"),
      keySelect("backHotkey", "Key that goes back one step"),
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
      el(
        "div",
        { class: "stack" },
        el("label", { text: "Wait for suggestions to settle (seconds)", attrs: { for: "setting-wait" } }),
        wait,
      ),
      el("p", {
        class: "help",
        text: "Raise this if Genius is slow to show suggestions.",
        attrs: { id: "setting-wait-help" },
      }),
    );
  }

  private readingSettings(state: PanelState): HTMLElement {
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
            void this.panel.setSetting("parallelReads", Number((event.target as HTMLSelectElement).value));
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

    return el(
      "fieldset",
      { class: "stack" },
      el("legend", { text: "Reading credits" }),
      el("label", { text: "Tracks read at the same time", attrs: { for: "setting-parallelReads" } }),
      reads,
      el("p", {
        class: "help",
        text: "More at once is faster for an album, but opens that many hidden tabs on Apple Music together. One by one is the gentlest; three is the default.",
        attrs: { id: "setting-parallelReads-help" },
      }),
    );
  }

  private lookupSettings(state: PanelState): HTMLElement {
    const box = (host: OptionalHost, label: string, help: string): HTMLElement[] => {
      const input = el("input", {
        attrs: { type: "checkbox", "data-key": `host-${host}`, "aria-describedby": `host-${host}-help` },
        on: {
          change: (event) => {
            // Straight from the click: Chrome shows its permission prompt only for a call made in the gesture.
            void this.panel.setHost(host, (event.target as HTMLInputElement).checked);
          },
        },
      });
      input.checked = state.hosts[host];
      return [
        el("label", { class: "check" }, input, el("span", { text: label })),
        el("p", { class: "help", text: help, attrs: { id: `host-${host}-help` } }),
      ];
    };
    return el(
      "fieldset",
      { class: "stack" },
      el("legend", { text: "Look-ups on other sites" }),
      ...box(
        "deezer",
        "Search Deezer for a cover when Apple has none",
        "Chrome asks before this contacts api.deezer.com, and you can take the permission back here or in chrome://extensions.",
      ),
      ...box(
        "youtube",
        "Find a YouTube link for each track",
        "Searches www.youtube.com's pages for the song, as the desktop app does. Off until you allow it, and it needs the YouTube link ticked above to be pasted. Chrome asks first; take the permission back here or in chrome://extensions.",
      ),
    );
  }

  // ── pieces ──────────────────────────────────────────────────────────

  private button(
    text: string,
    variant: "primary" | "quiet" | "nav",
    key: string,
    onClick: () => void,
    disabled: boolean,
    wide = false,
  ): HTMLElement {
    return el("button", {
      class: `button ${variant}${wide ? " wide" : ""}`,
      text,
      attrs: { type: "button", "data-key": key, ...(disabled ? { disabled: "" } : {}) },
      on: { click: onClick },
    });
  }
}
