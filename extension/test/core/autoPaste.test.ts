import { describe, expect, it } from "vitest";
import type { QueueItem } from "../../src/core/models";
import {
  IDLE_PASTE,
  back,
  begin,
  canAutoStep,
  confirmChoice,
  instruction,
  normalisePaste,
  pauseAuto,
  pauseMessage,
  report,
  skip,
  startAuto,
  startPaste,
  stop,
  type PasteState,
} from "../../src/core/paste";

const QUEUE: QueueItem[] = [
  ["written_by", "Writer One"],
  ["role", "Mixing Engineer"],
  ["artist", "Mixer One"],
];
const NOW = 1_000_000;

const manual = (): PasteState => startPaste("Song", QUEUE);
const running = (): PasteState => startAuto(manual());

/** One automatic step: the loop asks for the step, then reports what happened. */
function autoStep(state: PasteState, outcome: Parameters<typeof report>[2]): PasteState {
  const { state: busy, result } = begin(state, NOW, "auto");
  if (result.action !== "fill") return busy;
  return report(busy, result.position, outcome);
}

describe("starting automatic pasting", () => {
  it("is off until it is started, and a new session never starts running", () => {
    expect(IDLE_PASTE.auto).toBe("off");
    expect(manual()).toMatchObject({ auto: "off", pauseReason: "" });
  });

  it("runs from the current step of an active session", () => {
    expect(running()).toMatchObject({ auto: "running", pauseReason: "", active: true, position: 0 });
  });

  it("does nothing without a session, or when every step is already done", () => {
    expect(startAuto({ ...IDLE_PASTE }).auto).toBe("off");
    expect(startAuto({ ...manual(), position: QUEUE.length }).auto).toBe("off");
  });

  it("resumes from a pause and clears the reason", () => {
    const paused = pauseAuto(running(), "user");
    expect(paused.auto).toBe("paused");
    expect(startAuto(paused)).toMatchObject({ auto: "running", pauseReason: "", message: "" });
  });
});

describe("the steps of an automatic run", () => {
  it("only hands out steps while it is running", () => {
    expect(begin(manual(), NOW, "auto").result).toEqual({ action: "none" });
    expect(begin(pauseAuto(running(), "user"), NOW, "auto").result).toEqual({ action: "none" });
    expect(begin(running(), NOW, "auto").result).toMatchObject({ action: "fill", position: 0 });
  });

  it("walks the whole queue and ends by itself, switched off", () => {
    let state = running();
    for (let i = 0; i < QUEUE.length; i++) {
      expect(canAutoStep(state)).toBe(true);
      state = autoStep(state, { status: "filled", message: "ok" });
    }
    expect(state).toMatchObject({ position: QUEUE.length, auto: "off", pauseReason: "" });
    expect(canAutoStep(state)).toBe(false);
  });

  it("is not ready for a step while a fill is in progress or a choice is awaited", () => {
    const busy = begin(running(), NOW, "auto").state;
    expect(busy.busy).toBe(true);
    expect(canAutoStep(busy)).toBe(false);
    expect(begin(busy, NOW, "auto").result).toEqual({ action: "none" });
    const awaiting = autoStep(running(), { status: "needs-choice", message: "choose" });
    expect(canAutoStep(awaiting)).toBe(false);
    expect(begin(awaiting, NOW, "auto").result).toEqual({ action: "none" });
  });
});

describe("a field that needs the user's choice", () => {
  const awaiting = (): PasteState => autoStep(running(), { status: "needs-choice", message: "Choose Writer One" });

  it("keeps running and waits, so the user's clicks and typing do not pause it", () => {
    expect(awaiting()).toMatchObject({ auto: "running", awaiting: true, position: 0, tone: "attention" });
    expect(pauseAuto(awaiting(), "input")).toEqual(awaiting());
  });

  it("still pauses for a reason that is not the user's own input", () => {
    for (const reason of ["user", "panel-closed", "page-changed", "problem"] as const) {
      expect(pauseAuto(awaiting(), reason).auto, reason).toBe("paused");
    }
  });

  it("moves on once the user's choice is confirmed, and goes on running", () => {
    expect(confirmChoice(awaiting())).toMatchObject({ position: 1, awaiting: false, auto: "running", message: "" });
  });

  it("ends the run when the confirmed choice was the last step", () => {
    const last = { ...awaiting(), position: QUEUE.length - 1 };
    expect(confirmChoice(last)).toMatchObject({ position: QUEUE.length, auto: "off" });
  });

  it("confirms nothing when no choice is awaited, or when not running", () => {
    expect(confirmChoice(running())).toEqual(running());
    expect(confirmChoice(pauseAuto(awaiting(), "user"))).toEqual(pauseAuto(awaiting(), "user"));
  });
});

describe("pausing", () => {
  it.each(["user", "input", "panel-closed", "page-changed"] as const)(
    "for %s says why and how to carry on",
    (reason) => {
      const paused = pauseAuto(running(), reason);
      expect(paused).toMatchObject({ auto: "paused", pauseReason: reason, message: pauseMessage(reason) });
      expect(pauseMessage(reason)).toMatch(/Auto-paste/);
    },
  );

  it("does nothing when it is not running", () => {
    expect(pauseAuto(manual(), "user")).toEqual(manual());
    const paused = pauseAuto(running(), "user");
    expect(pauseAuto(paused, "input")).toEqual(paused);
  });

  it("keeps the step it stopped at, so resuming carries on from there", () => {
    const paused = pauseAuto(autoStep(running(), { status: "filled", message: "ok" }), "user");
    expect(paused.position).toBe(1);
    expect(begin(startAuto(paused), NOW, "auto").result).toMatchObject({ action: "fill", position: 1 });
  });

  it("a field that is not on the form pauses it with Genius's own words", () => {
    const state = autoStep(running(), { status: "unavailable", message: "The Writer field is not on the form." });
    expect(state).toMatchObject({
      auto: "paused",
      pauseReason: "problem",
      message: "The Writer field is not on the form.",
      tone: "attention",
      position: 0,
    });
  });

  it("a fill that finishes after a pause still counts, but does not restart the run", () => {
    const { state: busy, result } = begin(running(), NOW, "auto");
    if (result.action !== "fill") throw new Error("expected a fill");
    const late = report(pauseAuto(busy, "user"), result.position, { status: "filled", message: "ok" });
    expect(late).toMatchObject({ position: 1, auto: "paused", busy: false });
  });

  it("a pause message never tells the user to press a hotkey Genius might not have", () => {
    for (const reason of ["user", "input", "panel-closed", "page-changed", "problem"] as const) {
      expect(pauseMessage(reason)).not.toMatch(/Written By|click the field/i);
    }
  });
});

describe("the user taking over by hand", () => {
  it("a Next-key press while running pauses it and fills nothing", () => {
    const { state, result } = begin(running(), NOW);
    expect(result).toEqual({ action: "none" });
    expect(state).toMatchObject({ auto: "paused", pauseReason: "user", busy: false });
  });

  it("the Next key keeps its one-step meaning once it is paused or off", () => {
    expect(begin(pauseAuto(running(), "user"), NOW).result).toMatchObject({ action: "fill", position: 0 });
    expect(begin(manual(), NOW).result).toMatchObject({ action: "fill", position: 0 });
  });

  it("Back pauses a running run and moves one step back", () => {
    const state = back(autoStep(running(), { status: "filled", message: "ok" }));
    expect(state).toMatchObject({ position: 0, auto: "paused", pauseReason: "user" });
  });

  it("Skip on a field that needs a choice lets the run carry on", () => {
    const awaiting = autoStep(running(), { status: "needs-choice", message: "choose" });
    expect(skip(awaiting)).toMatchObject({ position: 1, awaiting: false, auto: "running" });
  });

  it("Skip past the last step ends the run", () => {
    expect(skip({ ...running(), position: QUEUE.length - 1 })).toMatchObject({ position: QUEUE.length, auto: "off" });
  });

  it("Skip leaves a paused run paused", () => {
    expect(skip(pauseAuto(running(), "user"))).toMatchObject({ position: 1, auto: "paused" });
  });

  it("stop ends the run and forgets why it paused", () => {
    expect(stop(pauseAuto(running(), "user"))).toMatchObject({ auto: "off", pauseReason: "" });
    expect(stop(running())).toMatchObject({ auto: "off", pauseReason: "", active: false });
  });
});

describe("what the panel says while a run goes", () => {
  it("never asks for a key press while it pastes by itself, and says how to take over", () => {
    const text = instruction(running(), "F8");
    expect(text).toMatch(/automatically/i);
    expect(text).toMatch(/Auto-paste off/);
    expect(text).not.toMatch(/Press F8/);
  });

  it("asks for the user's choice, and says it carries on afterwards", () => {
    const awaiting = autoStep(running(), { status: "needs-choice", message: "choose" });
    const text = instruction(awaiting, "F8");
    expect(text).toContain("Choose Writer One in Genius's suggestions");
    expect(text).toMatch(/carries on/);
    expect(text).not.toMatch(/press F8/i);
  });

  it("goes back to the Next key's wording once it is paused or off", () => {
    expect(instruction(pauseAuto(running(), "user"), "F8")).toBe("Press F8 to add Writer One as a writer.");
    expect(instruction(manual(), "F8")).toBe("Press F8 to add Writer One as a writer.");
  });

  it("still sends the user to the form when every step is done", () => {
    expect(instruction({ ...running(), position: QUEUE.length }, "F8")).toContain("Check the form on Genius");
  });
});

describe("stored automatic state", () => {
  it("is restored as it was", () => {
    const stored = pauseAuto(running(), "panel-closed");
    expect(normalisePaste(stored)).toEqual(stored);
    expect(normalisePaste(running()).auto).toBe("running");
  });

  it.each([undefined, "fast", 3, null])("treats a bad mode %j as off", (auto) => {
    expect(normalisePaste({ ...manual(), auto }).auto).toBe("off");
  });

  it("drops a pause reason it does not know, and one that goes with no pause", () => {
    expect(normalisePaste({ ...pauseAuto(running(), "user"), pauseReason: "bored" }).pauseReason).toBe("");
    expect(normalisePaste({ ...running(), pauseReason: "user" }).pauseReason).toBe("");
  });

  it("is never running without a session", () => {
    expect(normalisePaste({ ...running(), active: false }).auto).toBe("off");
    expect(normalisePaste({ ...running(), queue: [], position: 0 }).auto).toBe("off");
  });
});
