import { describe, expect, it } from "vitest";
import { IDLE_PASTE, startPaste } from "../../src/core/paste";
import {
  checkCommand,
  isBridgeRequest,
  normaliseCode,
  parseFrame,
  sameSecret,
  toBridgeStatus,
} from "../../src/shared/bridge";

describe("parseFrame", () => {
  it("accepts a JSON object with a type", () => {
    expect(parseFrame('{"type":"ping"}')).toEqual({ type: "ping" });
  });
  it.each([["[]"], ["5"], ["null"], ["{"], ['{"type":5}'], ["{}"], ["x".repeat(70_000)]])("rejects %s", (raw) => {
    expect(parseFrame(raw)).toBeNull();
  });
  it("rejects binary frames", () => {
    expect(parseFrame(new ArrayBuffer(3))).toBeNull();
    expect(parseFrame(undefined)).toBeNull();
  });
});

describe("checkCommand", () => {
  it("accepts a begin and copies only the fields it knows", () => {
    const checked = checkCommand({
      type: "begin",
      v: 1,
      id: 3,
      title: "T",
      queue: [["artist", "A"]],
      mode: "manual",
      extra: "ignored",
    });
    expect(checked).toEqual({
      ok: true,
      command: { type: "begin", id: 3, title: "T", queue: [["artist", "A"]], mode: "manual" },
    });
  });
  it("keeps the id of a refused command so it can be refused by name", () => {
    expect(checkCommand({ type: "nope", v: 1, id: 8 })).toEqual({ ok: false, id: 8 });
    expect(checkCommand({ type: "skip", v: 1, id: -1 })).toEqual({ ok: false, id: null });
    expect(checkCommand({ type: "skip", v: 1 })).toEqual({ ok: false, id: null });
  });
  it("limits the length of every text", () => {
    const long = "x".repeat(2001);
    expect(checkCommand({ type: "begin", v: 1, id: 1, title: long, queue: [], mode: "auto" }).ok).toBe(false);
    expect(checkCommand({ type: "begin", v: 1, id: 1, title: "t", queue: [["artist", long]], mode: "auto" }).ok).toBe(
      false,
    );
  });
});

describe("the panel's link requests", () => {
  it("accepts the three and nothing else", () => {
    expect(isBridgeRequest({ type: "bridge-pair", code: "ABCD-EFGH" })).toBe(true);
    expect(isBridgeRequest({ type: "bridge-unpair" })).toBe(true);
    expect(isBridgeRequest({ type: "bridge-status" })).toBe(true);
    expect(isBridgeRequest({ type: "bridge-pair" })).toBe(false);
    expect(isBridgeRequest({ type: "bridge-pair", code: "x".repeat(33) })).toBe(false);
    expect(isBridgeRequest({ type: "detect", url: "u" })).toBe(false);
  });
});

describe("helpers", () => {
  it("normalises a typed code", () => {
    expect(normaliseCode("abcd efgh")).toBe("ABCD-EFGH");
    expect(normaliseCode("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(normaliseCode("ABCD-EFG0")).toBeNull();
    expect(normaliseCode("ABCD-EFGHJ")).toBeNull();
  });
  it("compares secrets exactly", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("abc", "ab")).toBe(false);
  });
  it("builds a status from the session without the queue's text", () => {
    const status = toBridgeStatus(startPaste("Song", [["artist", "Name"]]));
    expect(status).toMatchObject({ active: true, position: 0, total: 1, title: "Song" });
    expect(JSON.stringify(status)).not.toContain("Name");
    expect(toBridgeStatus({ ...IDLE_PASTE }).total).toBe(0);
  });
});
