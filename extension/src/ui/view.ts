// Renders the controller's state. The structure follows the accessibility basics rather than decoration:
// real headings, labelled controls, a status and an alert region that are never rebuilt (so announcements
// fire), focus moved to the new screen's heading, and focus kept where it was across a re-render.
import type { QueueKind, SongCredits, VideoKind } from "../core/models";
import type { AlbumInfo } from "../shared/messages";
import { shownTrack, type TrackResult } from "../shared/session";
import { trackHealth, type Health, type HealthLevel } from "../core/trackHealth";
import { STEP_LABELS, instruction } from "../core/paste";
import type { OptionalHost } from "../lookups/http";
import { COUNTDOWN_RANGE, HOTKEY_CHOICES, PACE_RANGE, PARALLEL_CHOICES, WAIT_RANGE } from "../shared/settings";
import { youtubeSearchUrl } from "../core/youtubeLink";
import { el } from "./dom";
import { renderSetup } from "./setup";
import { MESSAGES, type PanelController, type PanelState } from "./controller";

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
  ["scrapeCoverArt", "PNG cover art link"],
];

/** The mark in front of a track in the list; it repeats what the words say, so it is hidden from screen readers. */
const HEALTH_MARKS: Readonly<Record<HealthLevel, string>> = {
  waiting: "·",
  working: "…",
  ok: "✓",
  attention: "!",
  error: "✕",
  none: "–",
};

/** Only https links are made clickable; the value shown is always the text. */
const VIDEO_KIND_LABELS: Readonly<Record<VideoKind, string>> = {
  "music-video": "music video",
  "lyric-video": "lyric video",
  "official-audio": "official audio",
  "auto-generated": "auto-generated",
};

/** What to call the song's link: its kind when known, otherwise what the older record can say. */
function videoKindLabel(song: Pick<SongCredits, "youtubeKind" | "youtubeIsMv">): string {
  if (song.youtubeKind) return VIDEO_KIND_LABELS[song.youtubeKind];
  return song.youtubeIsMv ? "music video" : "audio";
}

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
  /** What the user has typed into the key box, kept across re-renders and never stored by the view. */
  private keyDraft = "";
  /** What the user has typed into the pairing code box, kept across re-renders. */
  private codeDraft = "";
  /** What the user typed into the YouTube link box, and for which track; a draft is not carried to another track. */
  private linkDraft: { index: number; text: string } | null = null;

  private keyBusy(): boolean {
    return this.panel.state.youtubeKey.busy;
  }
  /** The welcome's intro has played; later redraws show it still. */
  private welcomePlayed = false;

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
            youtubeFieldset: () => this.youtubeSettings(state),
            deezerFieldset: () => this.deezerSettings(state),
            animateWelcome: () => this.playWelcome(),
          })
        : state.settingsOpen
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

  /** Use the single start action with the fill mode the user selected in Settings. */
  private startButtons(state: PanelState, busy: boolean): HTMLElement[] {
    const index = this.startableIndex(state);
    if (index === null) return [];
    const title = state.session.results.find((r) => r.index === index)?.song?.title;
    const start = this.button("Start pasting", "primary", "start", () => void this.panel.startPaste(index), busy);
    if (title) {
      start.setAttribute(
        "aria-label",
        state.settings.pasteMode === "auto"
          ? `Start pasting ${title} automatically. It pauses when you interact with Genius.`
          : `Start pasting ${title} one field at a time using the selected hotkey.`,
      );
    }
    return [start];
  }

  /** The track whose credits are on screen and can be pasted now, or null. */
  private startableIndex(state: PanelState): number | null {
    if (state.setup.open || state.settingsOpen || state.paste.active || state.session.screen !== "review") return null;
    const shown = shownTrack(state.session);
    // With no track open it starts the first one that is ready, so Start pasting never needs a choice first.
    if (!shown) return this.panel.firstPastable();
    return shown.song && this.panel.queueFor(shown.index).length > 0 ? shown.index : null;
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
    const start = this.draft ?? state.pageUrl;
    // Get credits needs a link: it stays off while the box is empty and while a page is being read.
    const go = el(
      "button",
      {
        class: "button primary",
        attrs: {
          type: "submit",
          "data-key": "go",
          ...(busy ? { "aria-label": "Reading the page…" } : {}),
          ...(busy || start.trim() === "" ? { disabled: "" } : {}),
        },
      },
      "Get credits",
      // Three dots that light up one after another while the page is read.
      busy
        ? el(
            "span",
            { class: "dots", attrs: { "aria-hidden": "true" } },
            el("i", { text: "." }),
            el("i", { text: "." }),
            el("i", { text: "." }),
          )
        : null,
    );
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
          go.disabled = busy || this.draft.trim() === "";
        },
      },
    });
    input.value = start;

    const form = el(
      "form",
      {
        class: "stack link-form",
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
      go,
    );
    return [this.heading("Get credits from Apple Music"), form, ...this.openPages(state)];
  }

  /**
   * The detector: listens for Apple Music pages already open in the browser. With none it says so and waits (the
   * radar animates); with some, it announces them and the page in view stands out. The status line is in the page
   * before anything is found, so a screen reader announces a detection instead of a new block appearing.
   */
  private openPages(state: PanelState): Node[] {
    const pages = state.appleTabs;
    const found = pages.length > 0;
    const busy = state.busy !== null;
    const title = !found
      ? "Listening for Apple Music pages…"
      : pages.length === 1
        ? "Apple Music page detected"
        : `${String(pages.length)} Apple Music pages detected`;
    const hint = found
      ? "Pick one to get its credits."
      : "Open an album or song on Apple Music in your browser and it shows up here.";
    const items = pages.map((page, index) =>
      el(
        "li",
        {},
        el(
          "button",
          {
            class: "button track detected",
            attrs: {
              type: "button",
              "data-key": `open-page-${String(index)}`,
              "aria-label": `Get tracks for ${page.name}${page.current ? ", the page you are on" : ""}`,
              ...(page.current ? { "data-current": "true" } : {}),
              ...(busy ? { disabled: "" } : {}),
            },
            on: {
              click: () => {
                this.draft = page.url;
                void this.panel.detect(page.url);
              },
            },
          },
          el(
            "span",
            { class: "body" },
            el("span", { class: "open-name name", text: page.name }),
            el("span", {
              class: "tag",
              text: `${page.kind === "album" ? "Album" : "Song"}${page.current ? " · this page" : ""}`,
            }),
          ),
          el("span", { class: "go", text: "Get credits", attrs: { "aria-hidden": "true" } }),
        ),
      ),
    );
    return [
      el(
        "section",
        { class: "detector", attrs: { "data-key": "open-pages", "data-state": found ? "found" : "listening" } },
        el(
          "div",
          { class: "detector-head", attrs: { "aria-live": "polite" } },
          el(
            "span",
            { class: "radar", attrs: { "aria-hidden": "true" } },
            el("i", {}),
            el("i", {}),
            el("i", {}),
            el("b", {}),
          ),
          el(
            "div",
            { class: "detector-text" },
            el("h3", { class: "detector-title", text: title }),
            el("p", { class: "detector-hint", text: hint }),
          ),
        ),
        found ? el("ul", { class: "open-pages" }, ...items) : null,
      ),
    ];
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
    const shown = shownTrack(session);
    const busy = state.busy === "scrape";

    const nav = el(
      "nav",
      { attrs: { "aria-label": "Tracks" } },
      el(
        "ul",
        { class: "tracks" },
        ...session.results.map((result) =>
          el("li", {}, this.trackButton(state, result, result.index === shown?.index)),
        ),
      ),
    );

    return [
      this.heading("Credits"),
      // One track needs no list to choose from.
      session.results.length > 1 ? nav : null,
      shown
        ? this.trackDetail(state, shown)
        : el("p", { class: "help", text: "Choose a track to see its credits, or fix its YouTube link." }),
      el(
        "div",
        { class: "row" },
        busy ? this.button("Stop", "quiet", "stop", () => void this.panel.stop(), false) : null,
        // Start pasting sits with the other ways on and off this screen, so there is one row to look at.
        ...this.startButtons(state, busy),
        // One song has no list to go back to.
        (session.album?.trackCount ?? 0) > 1
          ? this.button("Back to tracks", "quiet", "back", () => void this.panel.backToTracks(), busy)
          : null,
        this.button("Back to main menu", "nav", "menu", () => void this.panel.newAlbum(), false),
      ),
      this.startableIndex(state) !== null
        ? el("p", {
            class: "help",
            text:
              (state.settings.pasteMode === "auto"
                ? "Auto-paste is ON: fields fill in sequence and pause if you interact with Genius. "
                : `Auto-paste is OFF: press ${state.settings.nextHotkey} or Next in the panel for each field. `) +
              "Review your changes and save them on Genius; the extension does not submit the form.",
          })
        : null,
    ].filter((node): node is HTMLElement => node !== null);
  }

  /** How a track is doing under the user's settings; a missing YouTube link counts once a look-up came back empty. */
  private healthOf(state: PanelState, result: TrackResult): Health {
    const note = state.youtubeNotes[result.index];
    const { settings } = state;
    return trackHealth({
      status: result.status,
      song: result.song,
      wants: {
        copyright: settings.scrapeCopyright,
        coverArt: settings.scrapeCoverArt,
        // A link that cannot be asked for (no permission, or the step is off) is the user's choice, not a miss.
        youtube: this.panel.youtubeAskable(),
      },
      youtubeSearching: note === MESSAGES.lookingForYoutubeShort,
    });
  }

  /** A track in the list: a mark and words for how its read went, so the state never rests on colour alone. */
  private trackButton(state: PanelState, result: TrackResult, open: boolean): HTMLElement {
    const health = this.healthOf(state, result);
    const name = `${String(result.index + 1)}. ${result.title}`;
    return el(
      "button",
      {
        class: `${open ? "button track current" : "button track"} health-${health.level}`,
        attrs: {
          type: "button",
          "aria-label": `${name}: ${health.label}`,
          "data-key": `show-${String(result.index)}`,
          "data-health": health.level,
          "aria-expanded": open ? "true" : "false",
          ...(open ? { "aria-current": "true" } : {}),
        },
        on: {
          click: () => {
            void this.panel.showTrack(result.index);
          },
        },
      },
      el("span", { class: "mark", text: HEALTH_MARKS[health.level], attrs: { "aria-hidden": "true" } }),
      el(
        "span",
        { class: "body" },
        el("span", { class: "name", text: name }),
        el("span", { class: "state", text: health.label }),
      ),
    );
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
    const { missing } = this.healthOf(state, result);
    // What the read should have found and did not is spelled out in the list, in the colour of the "Needs a look" mark.
    const notFound = (label: string, words = "Not found"): void => {
      groups.append(el("dt", { class: "attn", text: label }), el("dd", { class: "attn", text: words }));
    };
    if (song.phonographicCopyright)
      groups.append(el("dt", { text: "Phonographic copyright" }), el("dd", { text: song.phonographicCopyright }));
    if (song.copyrightNotice) groups.append(el("dt", { text: "Copyright" }), el("dd", { text: song.copyrightNotice }));
    if (missing.includes("copyright")) notFound("Copyright");
    if (!song.coverArtUrl && missing.includes("cover art")) notFound("Cover art");
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
        el("dt", {
          text: song.youtubeByUser ? "YouTube (your link)" : `YouTube (${videoKindLabel(song)})`,
        }),
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

    const note = state.youtubeNotes[result.index];
    if (missing.includes("YouTube link")) notFound("YouTube", note || "Not found");
    else if (note && !song.youtubeUrl)
      groups.append(el("dt", { text: "YouTube" }), el("dd", { class: "help", text: note }));

    // The link box is for a link the program did not find (or one the user gave, which they may take off again).
    const searching = note === MESSAGES.lookingForYoutubeShort;
    const needsOwnLink = song.youtubeByUser === true || (!song.youtubeUrl && !searching);

    const queue = this.panel.queueFor(result.index);
    section.append(
      song.credits.length === 0
        ? el("p", { class: "problem attn", text: "No credits were found for this track." })
        : groups,
      ...(needsOwnLink ? [this.youtubeLinkSection(state, result.index, song)] : []),
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

  /**
   * The way to a YouTube link that needs no look-up: a button that opens YouTube's own search for the song in a new tab,
   * and a box to paste the link chosen there. The look-up may find nothing, or the wrong video; this always works.
   */
  private youtubeLinkSection(state: PanelState, index: number, song: SongCredits): HTMLElement {
    const artist = song.artist || state.session.album?.artist || "";
    const draft = this.linkDraft?.index === index ? this.linkDraft.text : "";
    const input = el("input", {
      class: "field",
      attrs: {
        id: "youtube-link",
        "data-key": "youtube-link",
        type: "text",
        autocomplete: "off",
        spellcheck: "false",
        placeholder: "https://www.youtube.com/watch?v=…",
        "aria-describedby": "youtube-link-help",
        ...(state.youtubeLinkError ? { "aria-invalid": "true" } : {}),
      },
      on: {
        input: (event) => {
          this.linkDraft = { index, text: (event.target as HTMLInputElement).value };
          const useButton = this.root.querySelector<HTMLButtonElement>('[data-key="youtube-use"]');
          if (useButton) useButton.disabled = !(event.target as HTMLInputElement).value.trim();
        },
      },
    });
    input.value = draft;
    const use = (): void => {
      void this.panel.setYoutubeLink(index, input.value).then((ok) => {
        if (ok) {
          this.linkDraft = null;
          this.render();
        }
      });
    };
    const form = el(
      "form",
      {
        class: "stack",
        attrs: { novalidate: "" },
        on: {
          submit: (event) => {
            event.preventDefault();
            use();
          },
        },
      },
      el("label", { text: "YouTube video URL", attrs: { for: "youtube-link" } }),
      el("div", { class: "input-action" }, input, this.button("Use", "quiet", "youtube-use", use, !draft.trim())),
    );
    // The YouTube step is a setting like the other fields: with it off, a link has nowhere to go.
    const off = !state.settings.scrapeYoutube;
    return el(
      "section",
      { class: "stack youtube-link", attrs: { "aria-label": "YouTube link" } },
      el("h4", { text: "YouTube video link" }),
      !song.youtubeUrl
        ? el("p", { class: "help", text: "No video link is available. Search for a video or paste its address below." })
        : null,
      el("a", {
        class: "button quiet link-button",
        text: "Find on YouTube",
        attrs: {
          href: youtubeSearchUrl(song.title, artist),
          target: "_blank",
          rel: "noopener noreferrer",
          "data-key": "youtube-find",
        },
      }),
      form,
      el("p", {
        class: state.youtubeLinkError ? "help problem" : "help",
        text: state.youtubeLinkError
          ? state.youtubeLinkError
          : off
            ? "The YouTube field is off in Settings, so this link will not be added to Genius."
            : "Paste a YouTube video address and choose Use. You can check and save the Genius form yourself.",
        attrs: { id: "youtube-link-help", "aria-live": "polite" },
      }),
      song.youtubeByUser && song.youtubeUrl
        ? this.button("Remove my link", "quiet", "youtube-remove", () => void this.panel.clearYoutubeLink(index), false)
        : null,
    );
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
        ...this.pasteControls(state, finished),
        this.button(
          `Previous (${settings.backHotkey})`,
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

  /** Auto-paste mode toggle, shared by Settings and the paste screen. */
  private autoSwitch(on: boolean, onClick: () => void, disabled: boolean): HTMLElement {
    const toggle = this.button(
      on ? "Auto-paste: ON" : "Auto-paste: OFF",
      on ? "primary" : "quiet",
      "auto-toggle",
      onClick,
      disabled,
    );
    toggle.classList.add(on ? "magic" : "magic-off");
    toggle.setAttribute("data-state", on ? "on" : "off");
    toggle.setAttribute(
      "aria-label",
      on ? "Auto-paste: ON. Press to turn it off and take over." : "Auto-paste: OFF. Press to turn it on.",
    );
    toggle.append(el("span", { class: "sparkles", attrs: { "aria-hidden": "true" } }));
    return toggle;
  }

  /**
   * Auto-paste can be paused or resumed; manual Next is available whenever auto-paste is off.
   */
  private pasteControls(state: PanelState, finished: boolean): HTMLElement[] {
    const { paste, settings } = state;
    const on = paste.auto === "running";
    const toggle = this.autoSwitch(
      on,
      () => void (on ? this.panel.pauseAutoPaste() : this.panel.autoPaste()),
      finished,
    );
    if (on) return [toggle];
    const fill = this.button(
      `Next (${settings.nextHotkey})`,
      "quiet",
      "fill",
      () => void this.panel.fillNext(),
      finished || paste.busy,
    );
    return [toggle, fill];
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
    const nextLabel = nextTitle ? `Paste next track: ${nextTitle}` : "Paste next track";
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
              state.nextCountdown === null ? nextLabel : `${nextLabel} (${String(state.nextCountdown)}s)`,
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
        this.button(
          state.doneCountdown === null ? "Back to main menu" : `Back to main menu (${String(state.doneCountdown)}s)`,
          "nav",
          "pmenu",
          () => void this.panel.leavePasting("menu"),
          false,
          true,
        ),
      ),
    ];
  }

  // ── settings ────────────────────────────────────────────────────────

  private settings(state: PanelState): Node[] {
    return [
      this.heading("Settings"),
      this.settingsCard(
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
      this.youtubeSettings(state),
      this.desktopSettings(state),
      this.deezerSettings(state),
    ];
  }

  /**
   * A section of the settings: a card with its own heading, so where one starts and ends is plain. The space between
   * cards is larger than the space inside one, and inside a card the groups are told apart by `subgroup`.
   */
  private settingsCard(id: string, title: string, ...children: (Node | null)[]): HTMLElement {
    return el(
      "section",
      { class: "settings-card", attrs: { "aria-labelledby": id } },
      el("h3", { text: title, attrs: { id } }),
      ...children,
    );
  }

  /** A titled group inside a card, set off from the one before it by a line. */
  private subgroup(title: string, ...children: Node[]): HTMLElement {
    return el("div", { class: "subgroup" }, el("h4", { text: title }), ...children);
  }

  /** One setting: its label, its control and its help, close together, so they read as one thing. */
  private setting(label: string, forId: string, control: Node, helpId: string, help: string): HTMLElement {
    return el(
      "div",
      { class: "setting" },
      el("label", { text: label, attrs: { for: forId } }),
      control,
      el("p", { class: "help", text: help, attrs: { id: helpId } }),
    );
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

    const autoReturn = el("input", {
      attrs: { type: "checkbox", "data-key": "setting-autoReturn" },
      on: {
        change: (event) => {
          void this.panel.setSetting("autoReturn", (event.target as HTMLInputElement).checked);
        },
      },
    });
    autoReturn.checked = settings.autoReturn;

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
            void this.panel.setSetting(key, Number((event.target as HTMLInputElement).value));
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
          void this.panel.setSetting("autocompleteWaitSeconds", Number((event.target as HTMLInputElement).value));
        },
      },
    });
    wait.value = String(settings.autocompleteWaitSeconds);

    // Auto-paste mode is enabled by default.
    const autoOn = settings.pasteMode === "auto";
    const modeSwitch = this.autoSwitch(
      autoOn,
      () => void this.panel.setSetting("pasteMode", autoOn ? "manual" : "auto"),
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
          void this.panel.setSetting("autoPaceSeconds", Number((event.target as HTMLInputElement).value));
        },
      },
    });
    paceBox.value = String(settings.autoPaceSeconds);

    return this.settingsCard(
      "settings-pasting",
      "Pasting on Genius",
      el("div", { class: "setting" }, el("p", { class: "setting-label", text: "Start pasting" }), modeSwitch, meanings),
      this.setting(
        "Seconds between fields when pasting automatically",
        "setting-autoPace",
        paceBox,
        "setting-autoPace-help",
        `Between ${String(PACE_RANGE.min)} and ${String(PACE_RANGE.max)}. A longer pause is gentler on Genius and easier to follow.`,
      ),
      this.subgroup(
        "Keys",
        keySelect("nextHotkey", "Key that fills the next step"),
        keySelect("backHotkey", "Key that goes back one step"),
      ),
      this.subgroup(
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
        this.setting(
          "Wait for suggestions to settle (seconds)",
          "setting-wait",
          wait,
          "setting-wait-help",
          "Raise this if Genius is slow to show suggestions.",
        ),
      ),
      this.subgroup(
        "After a track",
        el(
          "label",
          { class: "check" },
          autoReturn,
          el("span", { text: "Go back to the main menu after the last track" }),
        ),
        this.setting(
          "Seconds before going back to the main menu",
          "setting-returnSeconds",
          returnBox,
          "setting-returnSeconds-help",
          `Between ${String(COUNTDOWN_RANGE.min)} and ${String(COUNTDOWN_RANGE.max)}. It waits while you are using the panel.`,
        ),
        this.setting(
          "Seconds before pasting the next track",
          "setting-nextTrackSeconds",
          nextBox,
          "setting-nextTrackSeconds-help",
          `Between ${String(COUNTDOWN_RANGE.min)} and ${String(COUNTDOWN_RANGE.max)}, or 0 to wait for you to press the button.`,
        ),
      ),
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

    return this.settingsCard(
      "settings-reading",
      "Reading credits",
      this.setting(
        "Tracks read at the same time",
        "setting-parallelReads",
        reads,
        "setting-parallelReads-help",
        "More at once is faster for an album, but opens that many hidden tabs on Apple Music together. One by one is the gentlest; three is the default.",
      ),
    );
  }

  /** One optional look-up: a box that asks Chrome for the site's permission, with what it does underneath. */
  private hostBox(state: PanelState, host: OptionalHost, label: string, help: string): HTMLElement {
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
    return el(
      "div",
      { class: "setting" },
      el("label", { class: "check" }, input, el("span", { text: label })),
      el("p", { class: "help", text: help, attrs: { id: `host-${host}-help` } }),
    );
  }

  /** The Deezer cover search. It comes last in Settings, as it does in the desktop app. */
  private deezerSettings(state: PanelState): HTMLElement {
    return this.settingsCard(
      "settings-deezer",
      "Cover art look-up",
      this.hostBox(
        state,
        "deezer",
        "Search Deezer for a cover when Apple has none",
        "Chrome asks before this contacts api.deezer.com, and you can take the permission back here or in chrome://extensions.",
      ),
    );
  }

  /** The YouTube look-up and, under it, the optional key that makes it reliable: one card, as in the desktop app. */
  private youtubeSettings(state: PanelState): HTMLElement {
    return this.settingsCard(
      "settings-youtube",
      "YouTube links",
      this.hostBox(
        state,
        "youtube",
        "Find a YouTube link for each track (recommended)",
        "Searches www.youtube.com's pages for the song, as the desktop app does. Off until you allow it, and it needs the YouTube link ticked above to be pasted. Chrome asks first; take the permission back here or in chrome://extensions.",
      ),
      this.subgroup("Better YouTube links (optional)", ...this.youtubeKeyContent(state)),
    );
  }

  /**
   * The optional YouTube key, with everything a first-time user needs on the page: what it is for, every step to get
   * one with a link to the exact Google page for each, and a way to paste and check it. The links open Google's own
   * pages in a new tab; the extension never reads those pages, so nothing here needs another permission.
   */
  /** The link to the desktop app: what pairing does, how it stands now, and the code box. */
  private desktopSettings(state: PanelState): HTMLElement {
    const { bridge } = state;
    const statusText = !bridge.known
      ? "Checking the link to the desktop app…"
      : !bridge.paired
        ? "Not paired. No desktop app is linked to this browser."
        : bridge.connected
          ? "Paired and connected to the desktop app."
          : "Paired, desktop app not running. Open the desktop app and this panel reconnects by itself.";
    const pair = (): void => {
      const input = this.root.querySelector<HTMLInputElement>("#bridge-code");
      const typed = input ? input.value : this.codeDraft;
      void this.panel.pairBridge(typed).then(() => {
        // A code that worked is spent; one that did not stays, so a typo can be fixed rather than retyped.
        if (this.panel.state.bridge.tone === "ok") this.codeDraft = "";
        this.render();
      });
    };
    const input = el("input", {
      class: "field",
      attrs: {
        id: "bridge-code",
        type: "text",
        "data-key": "bridge-code",
        autocomplete: "off",
        autocapitalize: "characters",
        spellcheck: "false",
        maxlength: "16",
        placeholder: "ABCD-EFGH",
        "aria-describedby": bridge.message ? "bridge-code-help bridge-message" : "bridge-code-help",
        ...(bridge.tone === "error" ? { "aria-invalid": "true" } : {}),
      },
      on: {
        input: (event) => {
          this.codeDraft = (event.target as HTMLInputElement).value;
        },
        keydown: (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            pair();
          }
        },
      },
    });
    input.value = this.codeDraft;
    const message = el(
      "p",
      {
        class: bridge.message ? `help key-message ${bridge.tone}`.trim() : "help",
        attrs: {
          id: "bridge-message",
          "aria-live": bridge.tone === "error" ? "assertive" : "polite",
          "data-tone": bridge.tone,
        },
      },
      ...(bridge.message && bridge.tone
        ? [
            el("span", {
              class: "tone-mark",
              text: bridge.tone === "ok" ? "✓ " : "✗ ",
              attrs: { "aria-hidden": "true" },
            }),
          ]
        : []),
      bridge.message,
    );
    return this.settingsCard(
      "settings-desktop",
      "Desktop app",
      el("label", { text: "Pairing code", attrs: { for: "bridge-code" } }),
      input,
      el(
        "div",
        { class: "row" },
        this.button("Pair", "primary", "bridge-pair", pair, bridge.busy),
        bridge.paired
          ? this.button(
              "Unpair",
              "quiet",
              "bridge-unpair",
              () => {
                void this.panel.unpairBridge().then(() => {
                  this.root.querySelector<HTMLElement>("#bridge-code")?.focus();
                });
              },
              bridge.busy,
            )
          : null,
      ),
      el("p", { class: "help", text: statusText, attrs: { id: "bridge-status", "aria-live": "polite" } }),
      message,
      this.subgroup(
        "What is this?",
        el(
          "div",
          { class: "stack", attrs: { id: "bridge-help" } },
          el("p", {
            text: "The Géniescraper desktop app is this extension's companion on your computer, and pairing links the two. Once paired, the app lists the Apple Music pages you have open and this extension fills the Genius form for you, one step at a time or all at once.",
          }),
          el(
            "ul",
            { class: "plain-list" },
            el("li", {
              text: "To pair, open the desktop app, choose Connect browser extension and type its code above (capitals, dashes and spaces do not matter).",
              attrs: { id: "bridge-code-help" },
            }),
            el("li", { text: "The link stays on this computer (127.0.0.1) and never goes over the internet." }),
            el("li", {
              text: "Your Genius password is never shared: you stay signed in in this browser, and the app never sees it.",
            }),
            el("li", { text: "Unpair at any time to cut the link." }),
          ),
        ),
      ),
    );
  }

  private youtubeKeyContent(state: PanelState): Node[] {
    const link = (text: string, href: string): HTMLElement =>
      el("a", {
        class: "button quiet link-button",
        text,
        attrs: { href, target: "_blank", rel: "noopener noreferrer" },
      });
    const step = (title: string, detail: string, action?: HTMLElement, highlight = false): HTMLElement =>
      el(
        "li",
        highlight ? { class: "highlight" } : {},
        el("strong", { text: title }),
        el("span", { class: "step-detail", text: detail }),
        ...(action ? [action] : []),
      );

    const steps = el(
      "ol",
      { class: "how-to" },
      step(
        "Create a project.",
        "Sign in with your Google account when asked. Type any name, for example Geniescraper, then press Create. If Google asks you to accept its terms, tick the box and continue. You should not need to add a payment card; if Google asks for one, skip it.",
        link("Open step 1 in Google", "https://console.cloud.google.com/projectcreate"),
      ),
      step(
        "Switch on the YouTube service.",
        "Check that your new project is named at the top of the page, then press the blue Enable button. Wait until the page changes.",
        link("Open step 2 in Google", "https://console.cloud.google.com/apis/library/youtube.googleapis.com"),
      ),
      step(
        "Create your key.",
        "Press + Create credentials, then choose API key. Under API restrictions choose Restrict key, open the list, and tick only YouTube Data API v3 (it is at the bottom of the list; you can also type YouTube in the list's search box). Press OK, then Create. If you are unsure, choosing Don't restrict key also works. A box then shows your key: a long text that starts with AIza. Press the copy icon next to it.",
        link("Open step 3 in Google", "https://console.cloud.google.com/apis/credentials"),
      ),
      step(
        "Paste it here.",
        "Come back to this panel, click the box below and press Ctrl+V (Cmd+V on a Mac), or press Paste from clipboard. Then press Save and check key. You will see whether Google accepted it.",
      ),
      step(
        "Keep it private.",
        "Never share your key or post it online. If it ever leaks, delete it on Google's Credentials page and create a new one.",
        undefined,
        true,
      ),
    );

    const input = el("input", {
      class: "field",
      attrs: {
        id: "youtube-key",
        "data-key": "youtube-key",
        type: "password",
        autocomplete: "off",
        spellcheck: "false",
        placeholder: "AIza…",
        "aria-describedby": "youtube-key-help",
      },
      on: {
        input: (event) => {
          this.keyDraft = (event.target as HTMLInputElement).value;
          // Pressing Save for a key that is already saved and working changes nothing, so it waits for a different one.
          const save = this.root.querySelector<HTMLButtonElement>('[data-key="youtube-key-save"]');
          if (save) save.disabled = this.keyBusy() || this.panel.keyIsCurrent(this.keyDraft);
        },
      },
    });
    input.value = this.keyDraft;
    const show = el("input", {
      attrs: { type: "checkbox", "data-key": "youtube-key-show" },
      on: {
        change: (event) => {
          input.type = (event.target as HTMLInputElement).checked ? "text" : "password";
        },
      },
    });

    const busy = state.youtubeKey.busy;
    const message = state.youtubeKey.message;
    return [
      el("p", {
        class: "help",
        text: "The free YouTube search can be blocked by Google, and then no link is found. For reliable links you can use Google's official YouTube service with your own free key. It is free for roughly 25 songs a day, and the key stays in this browser: it is not synced and it is sent only to Google.",
        attrs: { id: "youtube-key-help" },
      }),
      this.disclosure("youtube-key-steps", "How do I get a key? Step by step (about 3 minutes)", steps),
      el("label", { text: "Your YouTube key", attrs: { for: "youtube-key" } }),
      input,
      el("label", { class: "check" }, show, el("span", { text: "Show the key" })),
      el(
        "div",
        { class: "row" },
        this.button(
          "Save and check key",
          "primary",
          "youtube-key-save",
          () => void this.panel.saveYoutubeKey(input.value),
          busy || this.panel.keyIsCurrent(this.keyDraft),
        ),
        this.button(
          "Paste from clipboard",
          "quiet",
          "youtube-key-paste",
          () => {
            void this.pasteKey(input);
          },
          busy,
        ),
        state.youtubeKey.saved
          ? this.button("Remove my key", "quiet", "youtube-key-remove", () => void this.panel.removeYoutubeKey(), busy)
          : null,
      ),
      el("p", {
        class: "help",
        text: state.youtubeKey.saved ? "A key is saved in this browser." : "No key is saved.",
        attrs: { "data-key": "youtube-key-state" },
      }),
      el(
        "p",
        {
          class: message ? `help key-message ${state.youtubeKey.tone}`.trim() : "help",
          attrs: { id: "youtube-key-message", "aria-live": "polite", "data-tone": state.youtubeKey.tone },
        },
        // The mark is for sighted users; the words carry the meaning for everyone else.
        ...(message && state.youtubeKey.tone
          ? [
              el("span", {
                class: "tone-mark",
                text: state.youtubeKey.tone === "ok" ? "✓ " : "✗ ",
                attrs: { "aria-hidden": "true" },
              }),
            ]
          : []),
        message,
      ),
      el(
        "p",
        { class: "help" },
        link("Google's own guide to API keys", "https://developers.google.com/youtube/v3/getting-started"),
      ),
    ];
  }

  /** Fill the key box from the clipboard; Chrome may ask first, or refuse, and then typing it in works as well. */
  private async pasteKey(input: HTMLInputElement): Promise<void> {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        input.value = text;
        this.keyDraft = text;
        input.focus();
        return;
      }
      this.panel.noteKeyMessage("The clipboard is empty. Copy the key from Google's page first.");
    } catch {
      this.panel.noteKeyMessage(
        "Chrome did not let the extension read the clipboard. Click in the box and press Ctrl+V (Cmd+V on a Mac) instead.",
      );
    }
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
