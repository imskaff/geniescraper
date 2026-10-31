// The review screen: the track list with health marks, each track's credits and its YouTube link.
import { releaseDateText, type SongCredits, type VideoKind } from "../core/models";
import { shownTrack, type TrackResult } from "../shared/session";
import { trackHealth, type Health, type HealthLevel } from "../core/trackHealth";
import { youtubeSearchUrl } from "../core/youtubeLink";
import { el } from "./dom";
import { MESSAGES, type PanelState } from "./controller";
import { type ViewContext } from "./viewContext";
import { FIELD_LABELS } from "./fieldLabels";
import { geniusButton, geniusNotice } from "./geniusView";

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

/** Use the single start action with the fill mode the user selected in Settings. */
export function startButtons(v: ViewContext, state: PanelState, busy: boolean): HTMLElement[] {
  const index = startableIndex(v, state);
  if (index === null) return [];
  const title = state.session.results.find((r) => r.index === index)?.song?.title;
  const start = v.button("Start pasting", "primary", "start", () => void v.panel.startPaste(index), busy);
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

/** Open on Genius for the track Start pasting would start, so the two always mean the same song. */
function openOnGeniusButton(v: ViewContext, state: PanelState, busy: boolean): HTMLElement[] {
  const index = startableIndex(v, state);
  if (index === null) return [];
  const title = state.session.results.find((r) => r.index === index)?.song?.title ?? "";
  return [geniusButton(v, state, index, title, busy)];
}

/** The track whose credits are on screen and can be pasted now, or null. */
export function startableIndex(v: ViewContext, state: PanelState): number | null {
  if (state.setup.open || state.settingsOpen || state.paste.active || state.session.screen !== "review") return null;
  const shown = shownTrack(state.session);
  // With no track open it starts the first one that is ready, so Start pasting never needs a choice first.
  if (!shown) return v.panel.firstPastable();
  return shown.song && v.panel.queueFor(shown.index).length > 0 ? shown.index : null;
}

export function reviewScreen(v: ViewContext, state: PanelState): Node[] {
  const { session } = state;
  const shown = shownTrack(session);
  const busy = state.busy === "scrape";

  const nav = el(
    "nav",
    { attrs: { "aria-label": "Tracks" } },
    el(
      "ul",
      { class: "tracks" },
      ...session.results.map((result) => el("li", {}, trackButton(v, state, result, result.index === shown?.index))),
    ),
  );

  return [
    v.heading("Credits"),
    // One track needs no list to choose from.
    session.results.length > 1 ? nav : null,
    shown
      ? trackDetail(v, state, shown)
      : el("p", { class: "help", text: "Choose a track to see its credits, or fix its YouTube link." }),
    el(
      "div",
      { class: "row" },
      busy ? v.button("Stop", "quiet", "stop", () => void v.panel.stop(), false) : null,
      // Start pasting sits with the other ways on and off this screen, so there is one row to look at.
      ...startButtons(v, state, busy),
      ...openOnGeniusButton(v, state, busy),
      // One song has no list to go back to.
      (session.album?.trackCount ?? 0) > 1
        ? v.button("Back to tracks", "quiet", "back", () => void v.panel.backToTracks(), busy)
        : null,
      v.button("Back to main menu", "nav", "menu", () => void v.panel.newAlbum(), false),
    ),
    geniusNotice(state, startableIndex(v, state)),
    startableIndex(v, state) !== null
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
export function healthOf(v: ViewContext, state: PanelState, result: TrackResult): Health {
  const note = state.youtubeNotes[result.index];
  const { settings } = state;
  return trackHealth({
    status: result.status,
    song: result.song,
    wants: {
      copyright: settings.scrapeCopyright,
      coverArt: settings.scrapeCoverArt,
      // A link that cannot be asked for (no permission, or the step is off) is the user's choice, not a miss.
      youtube: v.panel.youtubeAskable(),
    },
    youtubeSearching: note === MESSAGES.lookingForYoutubeShort,
  });
}

/** A track in the list: a mark and words for how its read went, so the state never rests on colour alone. */
export function trackButton(v: ViewContext, state: PanelState, result: TrackResult, open: boolean): HTMLElement {
  const health = healthOf(v, state, result);
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
          void v.panel.showTrack(result.index);
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

export function trackDetail(v: ViewContext, state: PanelState, result: TrackResult): HTMLElement {
  const section = el("section", { class: "stack", attrs: { "aria-labelledby": "track-heading" } });
  section.append(el("h3", { text: result.song?.title || result.title, attrs: { id: "track-heading" } }));

  if (result.status === "error") {
    section.append(
      el("p", { class: "problem", text: result.error }),
      v.button("Try again", "primary", "retry", () => void v.panel.retry(result.index), state.busy !== null),
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
  const released = releaseDateText(song);
  if (released) groups.append(el("dt", { text: "Released" }), el("dd", { text: released }));
  for (const credit of song.credits) {
    groups.append(el("dt", { text: credit.role }), el("dd", { text: credit.artists.join(", ") }));
  }
  const { missing } = healthOf(v, state, result);
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

  const queue = v.panel.queueFor(result.index);
  section.append(
    song.credits.length === 0
      ? el("p", { class: "problem attn", text: "No credits were found for this track." })
      : groups,
    ...(song.notes && song.notes.length > 0 ? [sourceNotes(song.notes)] : []),
    ...(needsOwnLink ? [youtubeLinkSection(v, state, result.index, song)] : []),
    queue.length === 0
      ? el("p", { class: "help", text: "Nothing to paste with the current settings." })
      : v.disclosure(
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

/** What the source could not give and what was left out, said next to the credits so no gap is a mystery. */
function sourceNotes(notes: readonly string[]): HTMLElement {
  return el(
    "aside",
    { class: "source-notes", attrs: { "data-key": "source-notes", "aria-label": "About this read" } },
    el("h4", { text: "About this read" }),
    el("ul", {}, ...notes.map((note) => el("li", { text: note }))),
  );
}

/**
 * The way to a YouTube link that needs no look-up: a button that opens YouTube's own search for the song in a new tab,
 * and a box to paste the link chosen there. The look-up may find nothing, or the wrong video; this always works.
 */
export function youtubeLinkSection(v: ViewContext, state: PanelState, index: number, song: SongCredits): HTMLElement {
  const artist = song.artist || state.session.album?.artist || "";
  const draft = v.linkDraft?.index === index ? v.linkDraft.text : "";
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
        v.linkDraft = { index, text: (event.target as HTMLInputElement).value };
        const useButton = v.root.querySelector<HTMLButtonElement>('[data-key="youtube-use"]');
        if (useButton) useButton.disabled = !(event.target as HTMLInputElement).value.trim();
      },
    },
  });
  input.value = draft;
  const use = (): void => {
    void v.panel.setYoutubeLink(index, input.value).then((ok) => {
      if (ok) {
        v.linkDraft = null;
        v.render();
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
    el("div", { class: "input-action" }, input, v.button("Use", "quiet", "youtube-use", use, !draft.trim())),
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
      ? v.button("Remove my link", "quiet", "youtube-remove", () => void v.panel.clearYoutubeLink(index), false)
      : null,
  );
}
