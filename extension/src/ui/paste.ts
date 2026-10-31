// The paste screen and the finished screen.
import { type QueueKind } from "../core/models";
import { STEP_LABELS, instruction } from "../core/paste";
import { el } from "./dom";
import { type PanelState } from "./controller";
import { type ViewContext } from "./viewContext";
import { geniusButton, geniusNotice } from "./geniusView";
import { geniusMessage } from "./geniusText";

/** "Artist - Song name" for the track being pasted; just the song name when its artist is not known. */
export function pasteHeading(state: PanelState): string {
  const { paste, pasteIndex, session } = state;
  const song = session.results.find((r) => r.index === pasteIndex)?.song;
  const artist = (song?.artist || session.album?.artist || "").trim();
  return artist && pasteIndex !== null ? `${artist} - ${paste.title}` : paste.title;
}

export function pasteScreen(v: ViewContext, state: PanelState): Node[] {
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
    el(
      "div",
      { class: "screen-head" },
      v.heading(pasteHeading(state)),
      state.pasteIndex === null
        ? null
        : geniusButton(v, state, state.pasteIndex, paste.title, false, "screen-head-action"),
    ),
    geniusNotice(state, state.pasteIndex),
    pasteError(v, state),
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
      ...pasteControls(v, state, finished),
      v.button(
        `Previous (${settings.backHotkey})`,
        "quiet",
        "pback",
        () => void v.panel.pasteBack(),
        paste.position === 0,
      ),
      v.button("Skip", "quiet", "pskip", () => void v.panel.pasteSkip(), finished),
      // Leaving a paste in progress looks like the other ways out, so it is easy to tell from the step buttons.
      v.button("Back to credits", "nav", "pstop", () => void v.panel.stopPaste(), false),
    ),
    el("p", {
      class: "help",
      text: "Keep the song's Edit Metadata form open on Genius. Nothing is saved for you: check the form, then save it there.",
    }),
    // While pasting the steps are the map of what is left, so they start open.
    doneCount > 0 ? v.disclosure("stepsdone", `Steps done (${String(doneCount)})`, doneSteps) : null,
    total - doneCount > 0 ? v.disclosure("steps", `Steps left (${String(total - doneCount)})`, steps, true) : null,
  ].filter((node): node is HTMLElement => node !== null);
}

/** Auto-paste mode toggle, shared by Settings and the paste screen. */
export function autoSwitch(v: ViewContext, on: boolean, onClick: () => void, disabled: boolean): HTMLElement {
  const toggle = v.button(
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
export function pasteControls(v: ViewContext, state: PanelState, finished: boolean): HTMLElement[] {
  const { paste, settings } = state;
  const on = paste.auto === "running";
  const toggle = autoSwitch(v, on, () => void (on ? v.panel.pauseAutoPaste() : v.panel.autoPaste()), finished);
  if (on) return [toggle];
  const fill = v.button(
    `Next (${settings.nextHotkey})`,
    "quiet",
    "fill",
    () => void v.panel.fillNext(),
    finished || paste.busy,
  );
  return [toggle, fill];
}

/** The error above the step counter. A new error, or the same one on a new attempt, plays the attention animation once. */
export function pasteError(v: ViewContext, state: PanelState): HTMLElement | null {
  // The Open on Genius notice already shows its own words.
  if (!state.error || state.error === geniusMessage(state.genius)?.text) return null;
  const fresh = state.errorSeq !== v.shownErrorSeq;
  v.shownErrorSeq = state.errorSeq;
  return el(
    "div",
    { class: `paste-error${fresh ? " fresh" : ""}`, attrs: { "aria-hidden": "true" } },
    el("span", { class: "paste-error-mark", text: "!" }),
    el("span", { text: state.error }),
  );
}

/** The screen in front of the finished paste, as in the desktop app: a clear success and the ways on. */
export function doneScreen(v: ViewContext, state: PanelState): Node[] {
  const next = v.panel.nextPastable();
  const nextTitle = state.session.results.find((r) => r.index === next)?.song?.title;
  const tracks = (state.session.album?.trackCount ?? 0) > 1;
  const nextLabel = nextTitle ? `Paste next track: ${nextTitle}` : "Paste next track";
  return [
    el(
      "div",
      { class: "finished" },
      el("div", { class: "done-mark", text: "✓", attrs: { "aria-hidden": "true" } }),
      v.heading("All credits entered"),
      el("p", { class: "help", text: state.paste.title }),
      el("p", { text: "Check the Genius page, then press Save there." }),
    ),
    geniusNotice(state, next),
    el(
      "div",
      { class: "stack" },
      next !== null
        ? v.button(
            state.nextCountdown === null ? nextLabel : `${nextLabel} (${String(state.nextCountdown)}s)`,
            "primary",
            "pnext",
            () => void v.panel.startPaste(next),
            false,
            true,
          )
        : null,
      v.button("Back to the credits", "quiet", "pcredits", () => void v.panel.leavePasting("credits"), false, true),
      tracks
        ? v.button("Back to the track list", "quiet", "ptracks", () => void v.panel.leavePasting("tracks"), false, true)
        : null,
      v.button(
        state.doneCountdown === null ? "Back to main menu" : `Back to main menu (${String(state.doneCountdown)}s)`,
        "nav",
        "pmenu",
        () => void v.panel.leavePasting("menu"),
        false,
        true,
      ),
    ),
  ].filter((node): node is HTMLElement => node !== null);
}
