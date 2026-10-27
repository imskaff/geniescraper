import { describe, expect, it } from "vitest";
import { BUSY_TIMEOUT_MS, PASTE_KEY, normalisePaste } from "../../src/core/paste";
import { PasteService } from "../../src/background/paste";
import type { BeginReply, GeniusRequest, PasteCommand } from "../../src/shared/messages";
import { SETTINGS_KEY } from "../../src/shared/settings";
import { memoryStore } from "../ui/fakes";
import { fakeBrowser, type FakeBehaviour } from "./fakePorts";

const QUEUE: [string, string][] = [
  ["written_by", "Writer One"],
  ["role", "Mixing Engineer"],
  ["artist", "Mixer One"],
];

function setup(behaviour: FakeBehaviour = {}, settings?: unknown) {
  const browser = fakeBrowser({
    geniusTabs: [
      { id: 7, active: true },
      { id: 8, active: false },
    ],
    ...behaviour,
  });
  const session = memoryStore();
  const store = memoryStore(settings === undefined ? {} : { [SETTINGS_KEY]: settings });
  let clock = 1_000_000;
  const service = new PasteService(browser.ports, { settings: store, session }, () => clock);
  const stored = () => normalisePaste(session.data.get(PASTE_KEY));
  const start = () => service.command({ type: "paste-start", title: "Song", queue: QUEUE });
  const begin = async (): Promise<BeginReply> => {
    const result = await service.fromGenius({ type: "paste-begin" });
    if (!result.ok) throw new Error("begin failed");
    return result.data as BeginReply;
  };
  return { browser, service, session, stored, start, begin, tick: (ms: number) => (clock += ms) };
}

describe("starting and stopping", () => {
  it("stores the queue at the first step and tells every Genius tab the hotkeys are live", async () => {
    const { browser, stored, start } = setup();
    const result = await start();
    expect(result).toMatchObject({ ok: true, data: { active: true, position: 0, title: "Song" } });
    expect(stored().queue).toEqual(QUEUE);
    expect(browser.notices.sort()).toEqual(["7:genius/paste-active:true", "8:genius/paste-active:true"]);
  });

  it("ignores queue entries of an unknown kind", async () => {
    const { stored, service } = setup();
    await service.command({ type: "paste-start", title: "S", queue: [...QUEUE, ["bogus", "x"]] });
    expect(stored().queue).toEqual(QUEUE);
  });

  it("stop ends the session and tells the tabs", async () => {
    const { browser, stored, start, service } = setup();
    await start();
    browser.notices.length = 0;
    await service.command({ type: "paste-stop" });
    expect(stored().active).toBe(false);
    expect(browser.notices.sort()).toEqual(["7:genius/paste-active:false", "8:genius/paste-active:false"]);
  });

  it("copes with a Genius tab that has no content script to hear it", async () => {
    const { start, stored } = setup({ deaf: [7] });
    await start();
    expect(stored().active).toBe(true);
  });
});

describe("a press from the Genius page", () => {
  it("is told to do nothing while no session is running", async () => {
    const { begin } = setup();
    expect(await begin()).toEqual({ action: "none" });
  });

  it("hands out the current step with the settings that apply", async () => {
    const { start, begin } = setup({}, { autoConfirm: false, autocompleteWaitSeconds: 1.5 });
    await start();
    expect(await begin()).toEqual({
      action: "fill",
      item: ["written_by", "Writer One"],
      position: 0,
      autoConfirm: false,
      settleMs: 1500,
    });
  });

  it("moves the position only when the page reports the step filled", async () => {
    const { start, begin, service, stored } = setup();
    await start();
    await begin();
    expect(stored()).toMatchObject({ position: 0 });
    await service.fromGenius({ type: "paste-report", position: 0, outcome: { status: "filled", message: "Added." } });
    expect(stored()).toMatchObject({ position: 1, message: "Added.", tone: "ok" });
  });

  it("lets only one press fill: a second press while the first is running is told to do nothing", async () => {
    const { start, service } = setup();
    await start();
    const asks = await Promise.all([1, 2, 3].map(() => service.fromGenius({ type: "paste-begin" })));
    const actions = asks.map((r) => (r.ok ? (r.data as BeginReply).action : "error"));
    expect(actions.filter((a) => a === "fill")).toHaveLength(1);
    expect(actions.filter((a) => a === "none")).toHaveLength(2);
  });

  it("ignores a report for a step that is no longer current", async () => {
    const { start, begin, service, stored } = setup();
    await start();
    await begin();
    await service.command({ type: "paste-skip" });
    await service.fromGenius({ type: "paste-report", position: 0, outcome: { status: "filled", message: "late" } });
    expect(stored().position).toBe(1);
    expect(stored().message).toBe("");
  });

  it("waits for the user's choice after a needs-choice report, and the next press moves on", async () => {
    const { start, begin, service, stored } = setup();
    await start();
    await begin();
    await service.fromGenius({
      type: "paste-report",
      position: 0,
      outcome: { status: "needs-choice", message: "No exact match." },
    });
    expect(stored()).toMatchObject({ position: 0, awaiting: true, tone: "attention" });
    expect(await begin()).toEqual({ action: "advanced" });
    expect(stored()).toMatchObject({ position: 1, awaiting: false });
  });

  it("gives up on a fill that never reported, so the next press works", async () => {
    const { start, begin, tick } = setup();
    await start();
    await begin();
    expect(await begin()).toEqual({ action: "none" });
    tick(BUSY_TIMEOUT_MS + 1);
    expect(await begin()).toMatchObject({ action: "fill", position: 0 });
  });

  it("answers status and back", async () => {
    const { start, service, stored } = setup();
    expect(await service.fromGenius({ type: "paste-status" })).toEqual({ ok: true, data: { active: false } });
    await start();
    await service.command({ type: "paste-skip" });
    await service.fromGenius({ type: "paste-back" });
    expect(stored().position).toBe(0);
  });

  it("rejects a report with a malformed outcome", async () => {
    const { start, service } = setup();
    await start();
    const bad = {
      type: "paste-report",
      position: 0,
      outcome: { status: "bogus", message: 1 },
    } as unknown as GeniusRequest;
    expect(await service.fromGenius(bad)).toMatchObject({ ok: false });
  });
});

describe("a command from the panel", () => {
  it("back and skip change the position and clear a wait", async () => {
    const { start, begin, service, stored } = setup();
    await start();
    await begin();
    await service.fromGenius({ type: "paste-report", position: 0, outcome: { status: "needs-choice", message: "m" } });
    await service.command({ type: "paste-skip" });
    expect(stored()).toMatchObject({ position: 1, awaiting: false });
    await service.command({ type: "paste-back" });
    expect(stored().position).toBe(0);
  });

  it("asks the Genius tab the user is looking at to fill the next step", async () => {
    const { browser, start, service } = setup();
    await start();
    browser.notices.length = 0;
    expect(await service.command({ type: "paste-fill" })).toMatchObject({ ok: true });
    expect(browser.notices).toEqual(["7:genius/fill-now"]);
  });

  it("says what to do when no Genius tab is in front, or it cannot hear", async () => {
    const none = setup({ geniusTabs: [{ id: 7, active: false }] });
    const noTab = await none.service.command({ type: "paste-fill" });
    expect(noTab).toMatchObject({ ok: false, error: { message: expect.stringContaining("Genius") as string } });

    const deaf = setup({ geniusTabs: [{ id: 7, active: true }], deaf: [7] });
    expect(await deaf.service.command({ type: "paste-fill" })).toMatchObject({ ok: false });
  });

  it("serialises everything: interleaved commands and presses end in a consistent state", async () => {
    const { start, service, stored } = setup();
    await start();
    const commands: PasteCommand[] = [{ type: "paste-skip" }, { type: "paste-skip" }, { type: "paste-back" }];
    await Promise.all([...commands.map((c) => service.command(c)), service.fromGenius({ type: "paste-status" })]);
    expect(stored().position).toBe(1);
  });
});
