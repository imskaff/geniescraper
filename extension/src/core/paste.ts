// The paste session as a pure state machine. The worker is the only writer: it applies these transitions to the
// stored state, so the panel's buttons and the hotkey on the Genius page can never advance the position twice.
import type { QueueItem, QueueKind } from "./models";

/** Automatic pasting: off (one step per key press), running by itself, or paused with the reason in `pauseReason`. */
export type AutoMode = "off" | "running" | "paused";

/** Why a run paused. "input" is the user's own clicking or typing in the form, which is not a pause while a choice is awaited. */
export type PauseReason = "user" | "input" | "panel-closed" | "page-changed" | "problem" | "bridge-lost";

export interface PasteState {
  active: boolean;
  auto: AutoMode;
  /** Why `auto` is paused; "" in every other mode. */
  pauseReason: PauseReason | "";
  /** The track being pasted, for the panel's heading. */
  title: string;
  queue: QueueItem[];
  /** Index of the next step; equal to queue.length when every step is done. */
  position: number;
  /** The text is typed but the user has to choose it; the next press means "I did". */
  awaiting: boolean;
  /** A fill is in progress; presses are ignored until it reports. */
  busy: boolean;
  /** When that fill started (ms since the epoch), so one that never reports cannot block presses for good. */
  busySince: number;
  message: string;
  tone: "info" | "ok" | "attention";
}

export const PASTE_KEY = "paste";

const ARTIST_UNDER_ROLE: ReadonlySet<QueueKind> = new Set(["artist", "phonographic_copyright", "copyright_notice"]);

/**
 * The additional role the step at `position` belongs to, when it is an artist or label under one: the nearest role
 * step before it. The page needs it to put the name under that role's row, whichever row that is on a form that
 * already has some. Anything else has none.
 */
export function roleOfStep(queue: readonly QueueItem[], position: number): string | undefined {
  const step = queue[position];
  if (!step || !ARTIST_UNDER_ROLE.has(step[0])) return undefined;
  for (let i = position - 1; i >= 0; i--) {
    const earlier = queue[i];
    if (earlier && (earlier[0] === "role" || earlier[0] === "copyright_role")) return earlier[1];
  }
  return undefined;
}

/** A fill that has not reported after this long is taken to have died (the page navigated, the tab closed). */
export const BUSY_TIMEOUT_MS = 20_000;

export const IDLE_PASTE: Readonly<PasteState> = {
  active: false,
  auto: "off",
  pauseReason: "",
  title: "",
  queue: [],
  position: 0,
  awaiting: false,
  busy: false,
  busySince: 0,
  message: "",
  tone: "info",
};

export type Outcome =
  | { status: "filled"; message: string }
  | { status: "needs-choice"; message: string }
  | { status: "unavailable"; message: string };

/** What a press of the Next key should do now. */
export type Begin = { action: "none" } | { action: "fill"; item: QueueItem; position: number } | { action: "advanced" };

export function startPaste(title: string, queue: readonly QueueItem[]): PasteState {
  const first = queue[0];
  return {
    ...IDLE_PASTE,
    active: queue.length > 0,
    title,
    queue: [...queue],
    message: first ? "" : "There is nothing to paste for this track.",
  };
}

/** An automatic run that has reached the end switches itself off; anything else is left as it is. */
function settle(state: PasteState): PasteState {
  if (state.auto === "off" || state.position < state.queue.length) return state;
  return { ...state, auto: "off", pauseReason: "" };
}

/**
 * Decide what a press does at time `now`, and mark a fill as in progress.
 * `source` is "key" for the user's Next key, and "auto" for the automatic loop asking for its next step. A key press
 * while a run is going takes over from it: the run pauses and the press fills nothing, so a step is never filled twice.
 */
export function begin(
  current: PasteState,
  now: number,
  source: "key" | "auto" = "key",
): { state: PasteState; result: Begin } {
  // A fill that never reported is abandoned rather than allowed to block every later press.
  const state = current.busy && now - current.busySince > BUSY_TIMEOUT_MS ? { ...current, busy: false } : current;
  if (source === "key" && state.auto === "running") {
    return { state: pauseAuto(state, "user"), result: { action: "none" } };
  }
  if (source === "auto" && state.auto !== "running") return { state, result: { action: "none" } };
  if (!state.active || state.busy || state.position >= state.queue.length) {
    return { state, result: { action: "none" } };
  }
  if (state.awaiting) {
    // A run waits for the user's choice and confirms it itself (confirmChoice), never by asking for a step.
    if (source === "auto") return { state, result: { action: "none" } };
    // The user chose the suggestion themselves; the press confirms it and moves on.
    const position = state.position + 1;
    return {
      state: settle({ ...state, position, awaiting: false, message: "", tone: "info" }),
      result: { action: "advanced" },
    };
  }
  const item = state.queue[state.position];
  if (!item) return { state, result: { action: "none" } };
  return {
    state: { ...state, busy: true, busySince: now },
    result: { action: "fill", item, position: state.position },
  };
}

/** Apply a fill's outcome. A report for a step that is no longer current, or that nobody started, is ignored. */
export function report(state: PasteState, position: number, outcome: Outcome): PasteState {
  if (!state.active || !state.busy || position !== state.position) return state;
  switch (outcome.status) {
    case "filled":
      return settle({
        ...state,
        busy: false,
        awaiting: false,
        position: position + 1,
        message: outcome.message,
        tone: "ok",
      });
    case "needs-choice":
      // A run keeps going: it waits for the user's choice, which is the one time the user is expected to act.
      return { ...state, busy: false, awaiting: true, message: outcome.message, tone: "attention" };
    case "unavailable": {
      const stuck: PasteState = { ...state, busy: false, awaiting: false, message: outcome.message, tone: "attention" };
      // A step that cannot be filled stops a run with Genius's own words; going on would only repeat the failure.
      return state.auto === "running" ? { ...stuck, auto: "paused", pauseReason: "problem" } : stuck;
    }
  }
}

/** What to tell the user after a pause: why, and how to carry on. */
export function pauseMessage(reason: PauseReason): string {
  switch (reason) {
    case "user":
      return "Paused. Turn Auto-paste on to carry on, or use the Next key for one step.";
    case "input":
      return "Paused because you used the form. Turn Auto-paste on to carry on.";
    case "panel-closed":
      return "Paused because the panel was closed. Turn Auto-paste on to carry on.";
    case "bridge-lost":
      return "Paused because the link to the desktop app was lost. Turn Auto-paste on to carry on.";
    case "page-changed":
      return "Paused because the Genius page changed. Open the song's edit form, then turn Auto-paste on.";
    case "problem":
      return "Paused because a step could not be filled. Fix it on the form or press Skip, then turn Auto-paste on.";
  }
}

/** Begin or resume an automatic run from the current step. Nothing happens without a session or with every step done. */
export function startAuto(state: PasteState): PasteState {
  if (!state.active || state.position >= state.queue.length) return state;
  return { ...state, auto: "running", pauseReason: "", message: "", tone: "info" };
}

/**
 * Pause a run. The user's own clicking or typing does not pause it while it waits for their choice: acting on the
 * form is exactly what it is waiting for. Every other reason always pauses, and a pause of a run that is not running
 * changes nothing.
 */
export function pauseAuto(state: PasteState, reason: PauseReason): PasteState {
  if (state.auto !== "running") return state;
  if (reason === "input" && state.awaiting) return state;
  // A problem keeps the wording of the failure that caused it.
  const keepsMessage = reason === "problem" && state.message !== "";
  return {
    ...state,
    auto: "paused",
    pauseReason: reason,
    message: keepsMessage ? state.message : pauseMessage(reason),
    tone: reason === "page-changed" || reason === "problem" ? "attention" : "info",
  };
}

/** The user has chosen the awaited suggestion on the form: a run counts the step as done and goes on. */
export function confirmChoice(state: PasteState): PasteState {
  if (!state.active || state.auto !== "running" || !state.awaiting) return state;
  return settle({ ...state, position: state.position + 1, awaiting: false, message: "", tone: "info" });
}

/** A running loop may ask for its next step: nothing is in progress, nothing is awaited, and steps remain. */
export function canAutoStep(state: PasteState): boolean {
  return (
    state.active && state.auto === "running" && !state.busy && !state.awaiting && state.position < state.queue.length
  );
}

/** One step back. Nothing on the form is undone: the user fixes it there if they want to. A run pauses: the user has taken over. */
export function back(state: PasteState): PasteState {
  if (!state.active) return state;
  const moved: PasteState = {
    ...state,
    busy: false,
    awaiting: false,
    position: Math.max(0, state.position - 1),
    message: "",
    tone: "info",
  };
  return pauseAuto(moved, "user");
}

const ARTIST_KINDS: ReadonlySet<QueueKind> = new Set(["artist", "phonographic_copyright", "copyright_notice"]);

/**
 * Skip a step that is already filled on Genius, or that cannot be filled. Skipping a role also skips the artists
 * that belong to it (up to the next role), which would otherwise have nowhere to go.
 */
export function skip(state: PasteState): PasteState {
  if (!state.active || state.position >= state.queue.length) return state;
  const skipped = state.queue[state.position]?.[0];
  let position = state.position + 1;
  if (skipped === "role" || skipped === "copyright_role") {
    while (position < state.queue.length && ARTIST_KINDS.has(state.queue[position]?.[0] ?? "youtube_url")) position++;
  }
  return settle({ ...state, busy: false, awaiting: false, position, message: "", tone: "info" });
}

export function stop(state: PasteState): PasteState {
  return {
    ...state,
    active: false,
    auto: "off",
    pauseReason: "",
    busy: false,
    awaiting: false,
    message: "",
    tone: "info",
  };
}

export function isFinished(state: PasteState): boolean {
  return state.active && state.position >= state.queue.length;
}

// ── wording ─────────────────────────────────────────────────────────────

/** The field names as they appear on the Genius form. */
export const STEP_LABELS: Readonly<Record<QueueKind, string>> = {
  written_by: "Writer",
  produced_by: "Producer",
  role: "Additional role",
  artist: "Artist in this role",
  copyright_role: "Additional role",
  phonographic_copyright: "Artist in this role (℗ label)",
  copyright_notice: "Artist in this role (© label)",
  youtube_url: "YouTube URL",
  cover_art: "Song art URL",
};

/**
 * What to tell the user before they press the hotkey. Unlike the desktop app's wording this never asks them to
 * click a field: the extension finds the field itself.
 */
export function instruction(state: PasteState, hotkey: string): string {
  const key = hotkey.toUpperCase();
  const item = state.queue[state.position];
  if (!item) return "Every step is done. Check the form on Genius, then save it there.";
  // A run is filling by itself: nothing to press, only a choice to make when Genius has no exact match.
  if (state.auto === "running") {
    return state.awaiting
      ? `Choose ${item[1]} in Genius's suggestions. Automatic pasting carries on when you do.`
      : "Pasting automatically. Turn Auto-paste off to take over.";
  }
  if (state.awaiting) return `Choose ${item[1]} in Genius's suggestions, then press ${key}. Or use Skip.`;
  const [kind, value] = item;
  switch (kind) {
    case "written_by":
      return `Press ${key} to add ${value} as a writer.`;
    case "produced_by":
      return `Press ${key} to add ${value} as a producer.`;
    case "role":
    case "copyright_role":
      return `Press ${key} to add the role ${value}.`;
    case "artist":
    case "phonographic_copyright":
    case "copyright_notice":
      return `Press ${key} to add ${value} to that role.`;
    case "youtube_url":
      return `Press ${key} to fill in the YouTube URL.`;
    case "cover_art":
      return `Press ${key} to fill in the song art URL.`;
  }
}

// ── storage ─────────────────────────────────────────────────────────────

const KINDS: ReadonlySet<string> = new Set(Object.keys(STEP_LABELS));
const TONES: ReadonlySet<string> = new Set(["info", "ok", "attention"]);
const AUTO_MODES: ReadonlySet<string> = new Set(["off", "running", "paused"]);
const PAUSE_REASONS: ReadonlySet<string> = new Set([
  "user",
  "input",
  "panel-closed",
  "page-changed",
  "problem",
  "bridge-lost",
]);

function isItem(value: unknown): value is QueueItem {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    KINDS.has(value[0]) &&
    typeof value[1] === "string"
  );
}

/** A paste state from storage, or the idle one when what is stored is missing or malformed. */
export function normalisePaste(raw: unknown): PasteState {
  if (typeof raw !== "object" || raw === null) return { ...IDLE_PASTE };
  const r = raw as Record<string, unknown>;
  const queue = Array.isArray(r["queue"]) ? r["queue"] : [];
  if (!queue.every(isItem)) return { ...IDLE_PASTE };
  const position = r["position"];
  if (typeof position !== "number" || !Number.isInteger(position) || position < 0 || position > queue.length) {
    return { ...IDLE_PASTE };
  }
  const tone = typeof r["tone"] === "string" && TONES.has(r["tone"]) ? (r["tone"] as PasteState["tone"]) : "info";
  const active = r["active"] === true && queue.length > 0;
  // A run needs a session; the mode and the reason must agree, or the stored values are ignored.
  const auto = active && typeof r["auto"] === "string" && AUTO_MODES.has(r["auto"]) ? (r["auto"] as AutoMode) : "off";
  const reason = typeof r["pauseReason"] === "string" && PAUSE_REASONS.has(r["pauseReason"]) ? r["pauseReason"] : "";
  return {
    active,
    auto,
    pauseReason: auto === "paused" ? (reason as PauseReason | "") : "",
    title: typeof r["title"] === "string" ? r["title"] : "",
    queue: queue.map(([kind, value]) => [kind, value] as const),
    position,
    awaiting: r["awaiting"] === true,
    // Kept as stored: the worker reads this state back between a press and its report. A fill that died is
    // abandoned by the timeout in begin(), not by forgetting the flag here.
    busy: r["busy"] === true,
    busySince: typeof r["busySince"] === "number" && Number.isFinite(r["busySince"]) ? r["busySince"] : 0,
    message: typeof r["message"] === "string" ? r["message"] : "",
    tone,
  };
}
