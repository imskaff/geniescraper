// Renders the controller's state. The structure follows the accessibility basics rather than decoration:
// real headings, labelled controls, a status and an alert region that are never rebuilt (so announcements
// fire), focus moved to the new screen's heading, and focus kept where it was across a re-render.
import { el } from "./dom";
import { renderSetup } from "./setup";
import type { PanelController, PanelState } from "./controller";
import type { ViewContext } from "./viewContext";
import { linkScreen, tracksScreen } from "./link";
import { reviewScreen } from "./review";
import { doneScreen, pasteScreen } from "./paste";
import { deezerSettings, settings, youtubeSettings } from "./settings";
import { geniusMessage } from "./geniusText";

export class PanelView implements ViewContext {
  private screenKey = "";
  /** What the user typed into the link box; kept across re-renders, which would otherwise reset it. */
  draft: string | null = null;
  /** Which collapsible lists the user has opened; re-rendering rebuilds them, so the choice is kept here. */
  shownErrorSeq = 0;
  private readonly expanded = new Map<string, boolean>();
  /** What the user has typed into the key box, kept across re-renders and never stored by the view. */
  keyDraft = "";
  /** What the user has typed into the pairing code box, kept across re-renders. */
  codeDraft = "";
  /** What the user typed into the YouTube link box, and for which track; a draft is not carried to another track. */
  linkDraft: { index: number; text: string } | null = null;

  keyBusy(): boolean {
    return this.panel.state.youtubeKey.busy;
  }
  /** The welcome's intro has played; later redraws show it still. */
  private welcomePlayed = false;

  constructor(
    readonly root: HTMLElement,
    readonly panel: PanelController,
  ) {
    this.buildFrame();
    panel.subscribe(() => {
      this.render();
    });
    this.render();
  }

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
    // The countdown to the main menu waits while the user is using the panel: the pointer over it, or a button focused.
    let pointerInside = false;
    let buttonFocused = false;
    const hold = (): void => {
      this.panel.pauseCountdown(pointerInside || buttonFocused);
    };
    this.root.addEventListener("mouseenter", () => {
      pointerInside = true;
      hold();
    });
    this.root.addEventListener("mouseleave", () => {
      pointerInside = false;
      hold();
    });
    this.root.addEventListener("focusin", (event) => {
      buttonFocused = event.target instanceof HTMLButtonElement;
      hold();
    });
    this.root.addEventListener("focusout", () => {
      buttonFocused = false;
      hold();
    });
  }

  /** True once: the first time the welcome is drawn. */
  private playWelcome(): boolean {
    const first = !this.welcomePlayed;
    this.welcomePlayed = true;
    return first;
  }

  private region(id: string): HTMLElement {
    const node = this.root.querySelector<HTMLElement>(`#${id}`);
    if (!node) throw new Error(`missing #${id}`);
    return node;
  }

  render(): void {
    const state = this.panel.state;
    const main = this.region("screen");
    const focusKey = document.activeElement?.getAttribute("data-key") ?? null;
    // Rebuilding replaces the heading, so a heading that held focus has to be given it again.
    const headingHadFocus = document.activeElement?.tagName === "H2";

    this.region("alert").textContent = state.error;
    this.region("status").textContent = state.status;
    // The Open on Genius notice shows its own words, so the live regions above must not show them twice.
    const genius = geniusMessage(state.genius)?.text;
    this.region("alert").classList.toggle(
      "quiet-visual",
      (state.paste.active && !state.settingsOpen) ||
        (!state.settingsOpen && genius !== undefined && state.error === genius),
    );
    this.region("status").classList.toggle(
      "quiet-visual",
      !state.settingsOpen && genius !== undefined && state.status === genius,
    );
    const toggle = this.region("settings-toggle");
    toggle.textContent = state.settingsOpen ? "Back" : "Settings";
    // The set-up is the whole screen: no Settings button over it (its steps are the settings that matter).
    toggle.hidden = state.setup.open;

    const finished =
      state.paste.active && state.paste.queue.length > 0 && state.paste.position >= state.paste.queue.length;
    const key = state.setup.open
      ? `setup-${String(state.setup.step)}`
      : state.settingsOpen
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
      ...(state.setup.open
        ? renderSetup(state, this.panel, {
            button: (text, variant, key, onClick, disabled, wide) =>
              this.button(text, variant, key, onClick, disabled, wide),
            heading: (text) => this.heading(text),
            youtubeFieldset: () => youtubeSettings(this, state),
            deezerFieldset: () => deezerSettings(this, state),
            animateWelcome: () => this.playWelcome(),
          })
        : state.settingsOpen
          ? settings(this, state)
          : finished
            ? doneScreen(this, state)
            : state.paste.active
              ? pasteScreen(this, state)
              : this.screen(state)),
    );

    if (key !== this.screenKey) {
      // A new screen starts at its heading, so the reader hears where they are.
      this.screenKey = key;
      main.querySelector<HTMLElement>("h2")?.focus();
    } else if (headingHadFocus) {
      main.querySelector<HTMLElement>("h2")?.focus();
    } else if (focusKey) {
      const target = this.root.querySelector<HTMLElement>(`[data-key="${focusKey}"]`);
      // A button that has just become disabled cannot hold focus: hand it to the key box next to it.
      if (target instanceof HTMLButtonElement && target.disabled && focusKey === "youtube-key-save") {
        this.root.querySelector<HTMLElement>("#youtube-key")?.focus();
      } else target?.focus();
    }
  }

  private screen(state: PanelState): Node[] {
    switch (state.session.screen) {
      case "link":
        return linkScreen(this, state);
      case "tracks":
        return tracksScreen(this, state);
      case "review":
        return reviewScreen(this, state);
    }
  }

  heading(text: string): HTMLElement {
    return el("h2", { text, attrs: { tabindex: "-1" } });
  }

  /** A section the user can open and close, closed until they do unless it opens by default. Its state survives re-rendering. */
  disclosure(id: string, summary: string, body: Node, openByDefault = false): HTMLElement {
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

  button(
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
