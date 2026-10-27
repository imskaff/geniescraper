// The paste session as a pure state machine. The worker is the only writer: it applies these transitions to the
// stored state, so the panel's buttons and the hotkey on the Genius page can never advance the position twice.
import type { QueueItem, QueueKind } from "./models";

export interface PasteState {
  active: boolean;
  /** The track being pasted, for the panel's heading. */
  title: string;
  queue: QueueItem[];
  /** Index of the next step; equal to queue.length when every step is done. */
  position: number;
  /** The text is typed but the user has to choose it; the next press means "I did". */
  awaiting: boolean;
  /** A fill is in progress; presses are ignored until it reports. */
  busy: boolean;
  message: string;
  tone: "info" | "ok" | "attention";
}

export const PASTE_KEY = "paste";

export const IDLE_PASTE: Readonly<PasteState> = {
  active: false,
  title: "",
  queue: [],
  position: 0,
  awaiting: false,
  busy: false,
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

/** Decide what a press does, and mark a fill as in progress. */
export function begin(state: PasteState): { state: PasteState; result: Begin } {
  if (!state.active || state.busy || state.position >= state.queue.length) {
    return { state, result: { action: "none" } };
  }
  if (state.awaiting) {
    // The user chose the suggestion themselves; the press confirms it and moves on.
    const position = state.position + 1;
    return {
      state: { ...state, position, awaiting: false, message: "", tone: "info" },
      result: { action: "advanced" },
    };
  }
  const item = state.queue[state.position];
  if (!item) return { state, result: { action: "none" } };
  return { state: { ...state, busy: true }, result: { action: "fill", item, position: state.position } };
}

/** Apply a fill's outcome. A report for a step that is no longer current, or that nobody started, is ignored. */
export function report(state: PasteState, position: number, outcome: Outcome): PasteState {
  if (!state.active || !state.busy || position !== state.position) return state;
  switch (outcome.status) {
    case "filled":
      return { ...state, busy: false, awaiting: false, position: position + 1, message: outcome.message, tone: "ok" };
    case "needs-choice":
      return { ...state, busy: false, awaiting: true, message: outcome.message, tone: "attention" };
    case "unavailable":
      return { ...state, busy: false, awaiting: false, message: outcome.message, tone: "attention" };
  }
}

/** One step back. Nothing on the form is undone: the user fixes it there if they want to. */
export function back(state: PasteState): PasteState {
  if (!state.active) return state;
  return {
    ...state,
    busy: false,
    awaiting: false,
    position: Math.max(0, state.position - 1),
    message: "",
    tone: "info",
  };
}

/** Skip a step that is already filled on Genius, or that cannot be filled. */
export function skip(state: PasteState): PasteState {
  if (!state.active || state.position >= state.queue.length) return state;
  return { ...state, busy: false, awaiting: false, position: state.position + 1, message: "", tone: "info" };
}

export function stop(state: PasteState): PasteState {
  return { ...state, active: false, busy: false, awaiting: false, message: "", tone: "info" };
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
  return {
    active: r["active"] === true && queue.length > 0,
    title: typeof r["title"] === "string" ? r["title"] : "",
    queue: queue.map(([kind, value]) => [kind, value] as const),
    position,
    awaiting: r["awaiting"] === true,
    // A fill cannot still be running after a restart; a stuck busy flag would block every press.
    busy: false,
    message: typeof r["message"] === "string" ? r["message"] : "",
    tone,
  };
}
