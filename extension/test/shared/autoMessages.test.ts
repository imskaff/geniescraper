import { describe, expect, it } from "vitest";
import {
  isBeginReply,
  isGeniusNotice,
  isGeniusRequest,
  isPasteCommand,
  isPasteStatus,
  isWorkerRequest,
} from "../../src/shared/messages";

describe("the messages automatic pasting adds", () => {
  it("lets the panel start and pause a run", () => {
    for (const type of ["paste-auto-start", "paste-auto-pause"]) {
      expect(isPasteCommand({ type })).toBe(true);
      expect(isWorkerRequest({ type })).toBe(true);
    }
  });

  it.each([
    [{ type: "paste-begin" }, true],
    [{ type: "paste-begin", source: "auto" }, true],
    [{ type: "paste-begin", source: "robot" }, false],
    [{ type: "paste-confirm" }, true],
    [{ type: "paste-pause", reason: "input" }, true],
    [{ type: "paste-pause", reason: "user" }, true],
    [{ type: "paste-pause", reason: "page-changed" }, true],
    // Only the page can know these: the page may not claim a problem or the panel's own pause.
    [{ type: "paste-pause", reason: "problem" }, false],
    [{ type: "paste-pause", reason: "panel-closed" }, false],
    [{ type: "paste-pause" }, false],
    [{ type: "paste-auto-start" }, false],
  ])("the Genius page may send %j: %s", (message, ok) => {
    expect(isGeniusRequest(message)).toBe(ok);
  });

  it("does not let a Genius page start, pause or resume a run through the panel's commands", () => {
    expect(isGeniusRequest({ type: "paste-auto-start" })).toBe(false);
    expect(isGeniusRequest({ type: "paste-auto-pause" })).toBe(false);
    expect(isGeniusRequest({ type: "paste-stop" })).toBe(false);
  });

  it.each([
    [{ action: "await", item: ["written_by", "X"], position: 2 }, true],
    [{ action: "await", item: ["written_by", "X"], position: 2, paceMs: 600 }, true],
    [{ action: "await", item: ["written_by"], position: 2 }, false],
    [{ action: "await", item: ["written_by", "X"] }, false],
    [{ action: "await", item: ["written_by", "X"], position: 2, paceMs: "fast" }, false],
    [{ action: "fill", item: ["written_by", "X"], position: 0, autoConfirm: true, settleMs: 5, paceMs: 600 }, true],
    [{ action: "fill", item: ["written_by", "X"], position: 0, autoConfirm: true, settleMs: 5, paceMs: "x" }, false],
    [{ action: "fill", item: ["artist", "X"], position: 0, autoConfirm: true, settleMs: 5, role: "Vocals" }, true],
    [{ action: "fill", item: ["artist", "X"], position: 0, autoConfirm: true, settleMs: 5, role: 7 }, false],
    [{ action: "await", item: ["artist", "X"], position: 2, role: "Vocals" }, true],
    [{ action: "await", item: ["artist", "X"], position: 2, role: 7 }, false],
  ])("checks the reply %j: %s", (reply, ok) => {
    expect(isBeginReply(reply)).toBe(ok);
  });

  it("checks the status reply", () => {
    expect(isPasteStatus({ active: true, auto: "running", awaiting: false, position: 1 })).toBe(true);
    expect(isPasteStatus({ active: true, auto: "fast", awaiting: false, position: 1 })).toBe(false);
    expect(isPasteStatus({ active: true, auto: "off", awaiting: "no", position: 1 })).toBe(false);
    expect(isPasteStatus({ active: true, auto: "off", awaiting: false })).toBe(false);
  });

  it("checks the notice that tells the page how a run stands", () => {
    for (const auto of ["off", "running", "paused"])
      expect(isGeniusNotice({ type: "genius/auto-state", auto })).toBe(true);
    expect(isGeniusNotice({ type: "genius/auto-state", auto: "turbo" })).toBe(false);
    expect(isGeniusNotice({ type: "genius/auto-state" })).toBe(false);
  });
});
