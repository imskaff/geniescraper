import { describe, expect, it } from "vitest";
import { PASTE_KEY, normalisePaste } from "../../src/core/paste";
import { PasteService } from "../../src/background/paste";
import type { BeginReply, GeniusRequest } from "../../src/shared/messages";
import { SETTINGS_KEY } from "../../src/shared/settings";
import { memoryStore } from "../ui/fakes";
import { fakeBrowser } from "./fakePorts";

const QUEUE: [string, string][] = [
  ["written_by", "Writer One"],
  ["role", "Mixing Engineer"],
  ["artist", "Mixer One"],
];
const AUTO: GeniusRequest = { type: "paste-begin", source: "auto" };

function setup(settings: unknown = {}) {
  const browser = fakeBrowser({
    geniusTabs: [
      { id: 7, active: true },
      { id: 8, active: false },
    ],
  });
  const session = memoryStore();
  const service = new PasteService(
    browser.ports,
    { settings: memoryStore({ [SETTINGS_KEY]: settings }), session },
    () => 1_000_000,
  );
  const stored = () => normalisePaste(session.data.get(PASTE_KEY));
  const auto = async (): Promise<void> => {
    await service.command({ type: "paste-start", title: "Song", queue: QUEUE });
    await service.command({ type: "paste-auto-start" });
    browser.notices.length = 0;
  };
  const begin = async (request: GeniusRequest = AUTO): Promise<BeginReply> => {
    const result = await service.fromGenius(request);
    if (!result.ok) throw new Error("begin failed");
    return result.data as BeginReply;
  };
  return { browser, service, stored, auto, begin };
}

const autoNotices = (notices: string[]): string[] => notices.filter((n) => n.includes("auto-state")).sort();

describe("starting, pausing and stopping a run", () => {
  it("tells every Genius tab when a run starts, pauses and resumes", async () => {
    const { browser, service, stored } = setup();
    await service.command({ type: "paste-start", title: "Song", queue: QUEUE });
    browser.notices.length = 0;

    await service.command({ type: "paste-auto-start" });
    expect(autoNotices(browser.notices)).toEqual(["7:genius/auto-state:running", "8:genius/auto-state:running"]);
    expect(stored().auto).toBe("running");

    browser.notices.length = 0;
    await service.command({ type: "paste-auto-pause" });
    expect(autoNotices(browser.notices)).toEqual(["7:genius/auto-state:paused", "8:genius/auto-state:paused"]);
    expect(stored()).toMatchObject({ auto: "paused", pauseReason: "user" });

    browser.notices.length = 0;
    await service.command({ type: "paste-auto-start" });
    expect(stored()).toMatchObject({ auto: "running", pauseReason: "" });
    expect(autoNotices(browser.notices)).toHaveLength(2);
  });

  it("says nothing when nothing changed, such as pausing a run that is not running", async () => {
    const { browser, service } = setup();
    await service.command({ type: "paste-start", title: "Song", queue: QUEUE });
    browser.notices.length = 0;
    await service.command({ type: "paste-auto-pause" });
    expect(autoNotices(browser.notices)).toEqual([]);
  });

  it("stopping the session, or starting a new one, ends the run for the page too", async () => {
    const { browser, service, stored, auto } = setup();
    await auto();
    await service.command({ type: "paste-stop" });
    expect(stored().auto).toBe("off");
    expect(autoNotices(browser.notices)).toEqual(["7:genius/auto-state:off", "8:genius/auto-state:off"]);

    await auto();
    await service.command({ type: "paste-start", title: "Next", queue: QUEUE });
    expect(stored().auto).toBe("off");
    expect(autoNotices(browser.notices)).toEqual(["7:genius/auto-state:off", "8:genius/auto-state:off"]);
  });

  it("Back from the panel pauses a run and the page hears of it", async () => {
    const { browser, service, stored, auto } = setup();
    await auto();
    await service.command({ type: "paste-back" });
    expect(stored()).toMatchObject({ auto: "paused", pauseReason: "user" });
    expect(autoNotices(browser.notices)).toHaveLength(2);
  });
});

describe("the page's requests", () => {
  it("hands an automatic loop its step with the pace from the settings, and a key press none", async () => {
    const { auto, begin } = setup({ autoPaceSeconds: 1.5 });
    await auto();
    expect(await begin()).toMatchObject({ action: "fill", position: 0, paceMs: 1500 });
  });

  it("clamps a pace that is out of range", async () => {
    const { auto, begin } = setup({ autoPaceSeconds: 99 });
    await auto();
    expect(await begin()).toMatchObject({ paceMs: 5000 });
  });

  it("only hands out steps while the run is going", async () => {
    const { service, begin } = setup();
    await service.command({ type: "paste-start", title: "Song", queue: QUEUE });
    expect(await begin()).toEqual({ action: "none" });
  });

  it("a key press during a run pauses it, fills nothing, and tells the page", async () => {
    const { browser, stored, auto, begin } = setup();
    await auto();
    expect(await begin({ type: "paste-begin" })).toEqual({ action: "none" });
    expect(stored()).toMatchObject({ auto: "paused", pauseReason: "user", busy: false });
    expect(autoNotices(browser.notices)).toHaveLength(2);
  });

  it("answers status with how the run stands", async () => {
    const { service, auto } = setup();
    await auto();
    expect(await service.fromGenius({ type: "paste-status" })).toEqual({
      ok: true,
      data: { active: true, auto: "running", awaiting: false, position: 0 },
    });
  });

  it("a step that cannot be filled pauses the run with Genius's words, and the page hears of it", async () => {
    const { browser, service, stored, auto, begin } = setup();
    await auto();
    const reply = await begin();
    if (reply.action !== "fill") throw new Error("expected a fill");
    await service.fromGenius({
      type: "paste-report",
      position: reply.position,
      outcome: { status: "unavailable", message: "The Writer field is not on the form." },
    });
    expect(stored()).toMatchObject({
      auto: "paused",
      pauseReason: "problem",
      message: "The Writer field is not on the form.",
    });
    expect(autoNotices(browser.notices)).toHaveLength(2);
  });
});

describe("a step that needs the user's choice", () => {
  async function awaiting() {
    const ctx = setup();
    await ctx.auto();
    const reply = await ctx.begin();
    if (reply.action !== "fill") throw new Error("expected a fill");
    await ctx.service.fromGenius({
      type: "paste-report",
      position: reply.position,
      outcome: { status: "needs-choice", message: "Choose Writer One" },
    });
    ctx.browser.notices.length = 0;
    return ctx;
  }

  it("keeps the run going, and the user's own input does not pause it", async () => {
    const { service, stored, browser } = await awaiting();
    await service.fromGenius({ type: "paste-pause", reason: "input" });
    expect(stored()).toMatchObject({ auto: "running", awaiting: true });
    expect(autoNotices(browser.notices)).toEqual([]);
  });

  it("pauses for Esc, the panel and a page change", async () => {
    for (const reason of ["user", "page-changed"] as const) {
      const { service, stored } = await awaiting();
      await service.fromGenius({ type: "paste-pause", reason });
      expect(stored().auto, reason).toBe("paused");
    }
  });

  it("counts the step done when the user's choice is confirmed, and the run goes on", async () => {
    const { service, stored } = await awaiting();
    await service.fromGenius({ type: "paste-confirm" });
    expect(stored()).toMatchObject({ position: 1, awaiting: false, auto: "running" });
  });

  it("tells a resumed run what to wait for instead of filling again", async () => {
    const { service, stored, begin } = await awaiting();
    await service.command({ type: "paste-auto-pause" });
    await service.command({ type: "paste-auto-start" });
    expect(await begin()).toMatchObject({
      action: "await",
      item: ["written_by", "Writer One"],
      position: 0,
      paceMs: 600,
    });
    expect(stored()).toMatchObject({ awaiting: true, position: 0 });
  });

  it("confirms nothing for a run that is not waiting", async () => {
    const { service, stored, auto } = setup();
    await auto();
    await service.fromGenius({ type: "paste-confirm" });
    expect(stored().position).toBe(0);
  });
});
