import { describe, expect, it } from "vitest";
import type { QueueItem } from "../../src/core/models";
import {
  IDLE_PASTE,
  STEP_LABELS,
  back,
  begin,
  instruction,
  isFinished,
  normalisePaste,
  report,
  skip,
  startPaste,
  stop,
  type PasteState,
} from "../../src/core/paste";

const QUEUE: QueueItem[] = [
  ["written_by", "Writer One"],
  ["role", "Mixing Engineer"],
  ["artist", "Mixer One"],
];

const started = (): PasteState => startPaste("Song", QUEUE);

/** One full press: begin, then report the outcome. */
function press(state: PasteState, outcome: Parameters<typeof report>[2]): PasteState {
  const { state: busy, result } = begin(state);
  if (result.action !== "fill") return busy;
  return report(busy, result.position, outcome);
}

describe("starting", () => {
  it("is active at the first step with nothing awaited", () => {
    expect(started()).toMatchObject({ active: true, position: 0, awaiting: false, busy: false, title: "Song" });
  });

  it("is not active for an empty queue, and says why", () => {
    const state = startPaste("Song", []);
    expect(state.active).toBe(false);
    expect(state.message).toContain("nothing to paste");
  });
});

describe("a press", () => {
  it("asks for the current step and marks the fill as in progress", () => {
    const { state, result } = begin(started());
    expect(result).toEqual({ action: "fill", item: ["written_by", "Writer One"], position: 0 });
    expect(state.busy).toBe(true);
  });

  it("is ignored while a fill is in progress, so a double press cannot fill twice", () => {
    const { state } = begin(started());
    const second = begin(state);
    expect(second.result).toEqual({ action: "none" });
    expect(second.state).toBe(state);
  });

  it.each([
    ["inactive", { ...IDLE_PASTE }],
    ["finished", { ...startPaste("S", QUEUE), position: 3 }],
  ])("does nothing when %s", (_name, state) => {
    expect(begin(state).result).toEqual({ action: "none" });
  });

  it("moves on after a filled step", () => {
    const next = press(started(), { status: "filled", message: "Added Writer One." });
    expect(next).toMatchObject({ position: 1, busy: false, awaiting: false, message: "Added Writer One.", tone: "ok" });
  });

  it("stays on a step Genius could not match, and treats the next press as the user's own choice", () => {
    const attention = press(started(), { status: "needs-choice", message: "No exact match." });
    expect(attention).toMatchObject({ position: 0, awaiting: true, busy: false, tone: "attention" });

    const { state, result } = begin(attention);
    expect(result).toEqual({ action: "advanced" });
    expect(state).toMatchObject({ position: 1, awaiting: false, busy: false });
  });

  it("stays on a step whose field is missing, without waiting for a choice", () => {
    const next = press(started(), { status: "unavailable", message: "Open the form." });
    expect(next).toMatchObject({
      position: 0,
      awaiting: false,
      busy: false,
      message: "Open the form.",
      tone: "attention",
    });
  });

  it("walks the whole queue to the end", () => {
    let state = started();
    for (let i = 0; i < QUEUE.length; i++) state = press(state, { status: "filled", message: "ok" });
    expect(state.position).toBe(3);
    expect(isFinished(state)).toBe(true);
    expect(begin(state).result).toEqual({ action: "none" });
  });
});

describe("reports", () => {
  it("ignores a report for another step, or one nobody asked for", () => {
    const { state } = begin(started());
    expect(report(state, 2, { status: "filled", message: "x" })).toBe(state);
    expect(report(started(), 0, { status: "filled", message: "x" }).position).toBe(0);
  });

  it("ignores a late report after stop or back", () => {
    const { state } = begin(started());
    const stopped = stop(state);
    expect(report(stopped, 0, { status: "filled", message: "x" })).toBe(stopped);
    const backed = back({ ...state, position: 1, busy: true });
    expect(report(backed, 1, { status: "filled", message: "x" })).toBe(backed);
  });
});

describe("back, skip and stop", () => {
  it("back moves one step and clears the wait, never below the first step", () => {
    const attention = press({ ...started(), position: 1 }, { status: "needs-choice", message: "m" });
    expect(back(attention)).toMatchObject({ position: 0, awaiting: false, busy: false, message: "" });
    expect(back(started()).position).toBe(0);
  });

  it("skip moves forward without filling, and not past the end", () => {
    expect(skip(started()).position).toBe(1);
    expect(skip({ ...started(), position: 3 }).position).toBe(3);
  });

  it("skip works on a step waiting for a choice", () => {
    const waiting = press(started(), { status: "needs-choice", message: "m" });
    expect(skip(waiting)).toMatchObject({ position: 1, awaiting: false });
  });

  it("stop ends the session but keeps the queue for the panel to show", () => {
    const state = stop(begin(started()).state);
    expect(state).toMatchObject({ active: false, busy: false, awaiting: false });
    expect(state.queue).toEqual(QUEUE);
  });

  it("do nothing when no session is active", () => {
    expect(back({ ...IDLE_PASTE })).toEqual(IDLE_PASTE);
    expect(skip({ ...IDLE_PASTE })).toEqual(IDLE_PASTE);
  });
});

describe("instruction", () => {
  it("never asks the user to click a field, and never says Written By", () => {
    const state = started();
    const texts = QUEUE.map((_item, position) => instruction({ ...state, position }, "f8"));
    expect(texts).toEqual([
      "Press F8 to add Writer One as a writer.",
      "Press F8 to add the role Mixing Engineer.",
      "Press F8 to add Mixer One to that role.",
    ]);
    for (const text of texts) expect(text).not.toMatch(/click|Written By/i);
  });

  it("covers every kind of step", () => {
    for (const kind of Object.keys(STEP_LABELS) as (keyof typeof STEP_LABELS)[]) {
      const state = { ...started(), queue: [[kind, "Value"] as const], position: 0 };
      expect(instruction(state, "F8"), kind).toContain("F8");
    }
  });

  it("asks the user to choose when waiting, and sends them to the form when finished", () => {
    const waiting = press(started(), { status: "needs-choice", message: "m" });
    expect(instruction(waiting, "F8")).toBe("Choose Writer One in Genius's suggestions, then press F8. Or use Skip.");
    expect(instruction({ ...started(), position: 3 }, "F8")).toBe(
      "Every step is done. Check the form on Genius, then save it there.",
    );
  });
});

describe("normalisePaste", () => {
  it.each([
    undefined,
    null,
    5,
    "x",
    { queue: "nope" },
    { queue: [["bogus", "x"]], position: 0 },
    { queue: QUEUE, position: 9 },
    { queue: QUEUE, position: -1 },
  ])("is idle for %j", (raw) => {
    expect(normalisePaste(raw)).toEqual(IDLE_PASTE);
  });

  it("restores a valid state but never a stuck busy flag", () => {
    const stored = { ...started(), position: 1, busy: true, awaiting: true, message: "m", tone: "attention" };
    expect(normalisePaste(stored)).toMatchObject({
      active: true,
      position: 1,
      busy: false,
      awaiting: true,
      tone: "attention",
    });
  });

  it("is not active with an empty queue and ignores an unknown tone", () => {
    expect(normalisePaste({ active: true, queue: [], position: 0 }).active).toBe(false);
    expect(normalisePaste({ ...started(), tone: "loud" }).tone).toBe("info");
  });
});
