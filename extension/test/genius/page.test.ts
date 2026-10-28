import { describe, expect, it } from "vitest";
import { PasteService } from "../../src/background/paste";
import { PASTE_KEY, normalisePaste } from "../../src/core/paste";
import { fillStep } from "../../src/genius/fill";
import { GeniusPage } from "../../src/genius/page";
import { SETTINGS_KEY } from "../../src/shared/settings";
import { fakeBrowser } from "../background/fakePorts";
import { memoryStore } from "../ui/fakes";
import { chipsIn, loadFakeGenius, rowChips, type FakeOptions } from "./fakeGenius";

const TIMING = { suggestionMs: 400, settleMs: 60, selectMs: 300, pollMs: 5 };
const labelled = (form: HTMLFormElement, text: string): Element | null =>
  [...form.querySelectorAll("label")]
    .find((l) => l.querySelector("span")?.textContent.startsWith(text))
    ?.querySelector('[role="combobox"]') ?? null;

const settle = (ms = 40): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const QUEUE: [string, string][] = [
  ["written_by", "Billie Eilish"],
  ["role", "Mixing Engineer"],
  ["artist", "FINNEAS"],
  ["youtube_url", "https://www.youtube.com/watch?v=abc"],
];

/** The page, the worker's paste service and the fake form, wired together as they are in the browser. */
const QUICK = { autocompleteWaitSeconds: 0.2 };

function setup(options: FakeOptions = {}, settings: Record<string, unknown> = {}) {
  const fake = loadFakeGenius(options);
  const browser = fakeBrowser({ geniusTabs: [{ id: 7, active: true }] });
  const session = memoryStore();
  const service = new PasteService(
    browser.ports,
    { settings: memoryStore({ [SETTINGS_KEY]: { ...QUICK, ...settings } }), session },
    () => Date.now(),
  );
  const sent: string[] = [];
  const page = new GeniusPage({
    doc: fake.doc,
    send: (request) => {
      sent.push(request.type);
      return service.fromGenius(request);
    },
    timing: TIMING,
  });
  const stored = () => normalisePaste(session.data.get(PASTE_KEY));
  const press = async (key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> => {
    const event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, ...init });
    page.onKeyDown(event);
    await page.whenIdle();
    return event;
  };
  const start = async () => {
    const result = await service.command({ type: "paste-start", title: "Song", queue: QUEUE });
    page.setActive(true); // the worker tells the page, as the paste-active notice does in the browser
    return result;
  };
  return { fake, page, service, session, stored, press, start, sent };
}

describe("hotkeys", () => {
  it("fill the next step, one field per press, through the real worker state", async () => {
    const { fake, stored, press, start } = setup();
    await start();

    await press("F8");
    expect(chipsIn(labelled(fake.form, "Writer"))).toEqual(["Billie Eilish"]);
    expect(stored()).toMatchObject({ position: 1, tone: "ok" });
    await press("F8");
    expect(stored().position).toBe(2);
    await press("F8");
    await press("F8");

    expect(stored().position).toBe(4);
    expect(rowChips(fake.form)).toEqual([{ role: ["Mixing Engineer"], artists: ["FINNEAS"] }]);
    expect(fake.form.querySelector<HTMLInputElement>('input[name="youtube_url"]')?.value).toBe(QUEUE[3]?.[1]);
    expect(fake.chosen).toEqual([
      "Writer: Billie Eilish",
      "Additional role: Mixing Engineer",
      "Artists in this role: FINNEAS",
    ]);
    expect(fake.saveClicks + fake.cancelClicks + fake.submits).toBe(0);
  });

  it("suppress the key while pasting, so the browser's own use of it (F7 caret browsing) never fires", async () => {
    const { press, start } = setup();
    await start();
    expect((await press("F8")).defaultPrevented).toBe(true);
    expect((await press("F7")).defaultPrevented).toBe(true);
  });

  it("do nothing, and are not suppressed, when no session is running", async () => {
    const { fake, stored, press } = setup();
    const event = await press("F8");
    expect(event.defaultPrevented).toBe(false);
    expect(stored().position).toBe(0);
    expect(fake.chosen).toEqual([]);
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Alt", { altKey: true }],
    ["Shift", { shiftKey: true }],
    ["Meta", { metaKey: true }],
  ])("ignore the key with %s held, leaving the browser's shortcut alone", async (_name, init) => {
    const { stored, press, start } = setup();
    await start();
    const event = await press("F8", init);
    expect(event.defaultPrevented).toBe(false);
    expect(stored().position).toBe(0);
  });

  it("ignore other keys, including Enter", async () => {
    const { fake, press, start } = setup();
    await start();
    for (const key of ["Enter", "F9", "a", "Tab", "Escape"])
      expect((await press(key)).defaultPrevented, key).toBe(false);
    expect(fake.chosen).toEqual([]);
  });

  it("use the keys from the settings", async () => {
    const { stored, press, start, page } = setup();
    page.setHotkeys("F9", "F4");
    await start();
    expect((await press("F8")).defaultPrevented).toBe(false);
    expect(stored().position).toBe(0);
    await press("F9");
    expect(stored().position).toBe(1);
    await press("F4");
    expect(stored().position).toBe(0);
  });

  it("count a held key once", async () => {
    const { stored, press, start } = setup();
    await start();
    await press("F8");
    await press("F8", { repeat: true });
    await press("F8", { repeat: true });
    expect(stored().position).toBe(1);
  });

  it("ignore a second press while a fill is still running", async () => {
    const { fake, stored, page, start } = setup({ suggestionDelayMs: 50 });
    await start();
    page.onKeyDown(new KeyboardEvent("keydown", { key: "F8", cancelable: true }));
    page.onKeyDown(new KeyboardEvent("keydown", { key: "F8", cancelable: true }));
    await settle(600);
    expect(stored().position).toBe(1);
    expect(fake.chosen).toEqual(["Writer: Billie Eilish"]);
  });
});

describe("when Genius has no exact match", () => {
  it("waits for the user: the next press confirms their own choice and moves on", async () => {
    const { fake, stored, press, start } = setup({ artists: ["Taylor Swift"] });
    await start();
    await press("F8");
    expect(stored()).toMatchObject({ position: 0, awaiting: true, tone: "attention" });
    expect(stored().message).toContain("Billie Eilish");
    expect(fake.chosen).toEqual([]);
    expect(fake.enters).toEqual([]);

    await press("F8");
    expect(stored()).toMatchObject({ position: 1, awaiting: false });
  });

  it("does not type into the form again for a step the user is resolving", async () => {
    const { fake, press, start, sent } = setup({ artists: ["Taylor Swift"] });
    await start();
    await press("F8");
    const typedBefore = fake.form.querySelectorAll("input").length;
    await press("F8");
    expect(fake.form.querySelectorAll("input")).toHaveLength(typedBefore);
    expect(sent.filter((s) => s === "paste-report")).toHaveLength(1);
  });
});

describe("failure handling", () => {
  it("reports a missing form so the step is not left in progress forever", async () => {
    const { fake, stored, press, start } = setup();
    await start();
    fake.form.remove();
    await press("F8");
    expect(stored()).toMatchObject({ position: 0, busy: false, tone: "attention" });
    expect(stored().message).toContain("Edit Metadata");
    // The user opens the form and presses again.
    expect(stored().busy).toBe(false);
  });

  it("reports an unexpected exception instead of leaving the worker waiting", async () => {
    const { fake, stored, press, start } = setup();
    await start();
    Object.defineProperty(fake.doc, "querySelector", {
      value: () => {
        throw new Error("boom");
      },
    });
    await press("F8");
    expect(stored()).toMatchObject({ busy: false, position: 0, tone: "attention" });
    expect(stored().message).toContain("Something went wrong");
  });

  it("survives the worker not answering", async () => {
    const fake = loadFakeGenius();
    const page = new GeniusPage({
      doc: fake.doc,
      send: () => Promise.reject(new Error("no receiver")),
      timing: TIMING,
    });
    page.setActive(true);
    await expect(page.next()).resolves.toBeUndefined();
    await expect(page.back()).resolves.toBeUndefined();
  });

  it("refuses a step of an unknown kind from the worker", async () => {
    const fake = loadFakeGenius();
    const reports: unknown[] = [];
    const page = new GeniusPage({
      doc: fake.doc,
      send: (request) => {
        if (request.type === "paste-report") reports.push(request.outcome);
        return Promise.resolve({
          ok: true,
          data: { action: "fill", item: ["delete_everything", "x"], position: 0, autoConfirm: true, settleMs: 10 },
        });
      },
      timing: TIMING,
    });
    page.setActive(true);
    await page.next();
    expect(reports).toEqual([expect.objectContaining({ status: "unavailable" })]);
    expect(fake.chosen).toEqual([]);
  });
});

describe("the panel's Fill next button", () => {
  it("runs the same step as the hotkey", async () => {
    const { stored, page, start } = setup();
    await start();
    await page.next();
    expect(stored().position).toBe(1);
  });
});

describe("settings from the worker", () => {
  it("leave every combobox for the user when auto-confirm is off", async () => {
    const { fake, stored, press, start } = setup({}, { autoConfirm: false });
    await start();
    await press("F8");
    expect(stored()).toMatchObject({ position: 0, awaiting: true });
    expect(chipsIn(labelled(fake.form, "Writer"))).toEqual([]);
    expect(fake.enters).toEqual([]);
  });
});

describe("a song that already has additional roles", () => {
  const ROLES_QUEUE: [string, string][] = [
    ["role", "Mixing Engineer"],
    ["artist", "Billie Eilish"],
    ["role", "Lead Vocals"],
    ["artist", "FINNEAS"],
  ];

  it("joins the rows it has instead of adding the same roles again", async () => {
    const { fake, page, service } = setup();
    const ctx = { doc: fake.doc, timing: TIMING, autoConfirm: true };
    // Pasted before: a mixing row and a vocals row, each with someone in it.
    await fillStep(["role", "Mixing Engineer"], ctx);
    await fillStep(["artist", "Taylor Swift"], ctx);
    await fillStep(["role", "Lead Vocals"], ctx);
    await fillStep(["artist", "FINNEAS"], ctx);

    await service.command({ type: "paste-start", title: "Song", queue: ROLES_QUEUE });
    page.setActive(true);
    for (let i = 0; i < ROLES_QUEUE.length; i++) {
      page.onKeyDown(new KeyboardEvent("keydown", { key: "F8", cancelable: true, bubbles: true }));
      await page.whenIdle();
    }

    const rows = rowChips(fake.form).map((r) => ({ role: r.role, artists: [...r.artists].sort() }));
    expect(rows).toEqual([
      { role: ["Mixing Engineer"], artists: ["Billie Eilish", "Taylor Swift"] },
      { role: ["Lead Vocals"], artists: ["FINNEAS"] },
    ]);
  });
});
