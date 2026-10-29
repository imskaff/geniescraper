import { describe, expect, it } from "vitest";
import { PasteService } from "../../src/background/paste";
import type { GeniusRequest } from "../../src/shared/messages";
import { PASTE_KEY, normalisePaste } from "../../src/core/paste";
import { GeniusPage } from "../../src/genius/page";
import { boxOf, comboboxByLabel } from "../../src/genius/selectors";
import { SETTINGS_KEY } from "../../src/shared/settings";
import { fakeBrowser } from "../background/fakePorts";
import { memoryStore } from "../ui/fakes";
import { chipsIn, loadFakeGenius, rowChips, type FakeOptions } from "./fakeGenius";

const TIMING = { suggestionMs: 400, settleMs: 60, selectMs: 300, pollMs: 5 };
const URL = "https://www.youtube.com/watch?v=abc";
const WHOLE: [string, string][] = [
  ["written_by", "Billie Eilish"],
  ["role", "Mixing Engineer"],
  ["artist", "FINNEAS"],
  ["youtube_url", URL],
];
const SHORT: [string, string][] = [
  ["written_by", "Billie Eilish"],
  ["youtube_url", URL],
];

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for a condition instead of a fixed time, so a slow machine only makes the test slower, not wrong. */
async function until(condition: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("the condition never became true");
    await wait(10);
  }
}

/** A real user's event: the browser marks it trusted, which the extension's own synthetic events never are. */
function trusted<T extends Event>(event: T): T {
  Object.defineProperty(event, "isTrusted", { value: true });
  return event;
}

/** The page, the worker's paste service and the fake form, with the worker's notices delivered to the page. */
function setup(options: FakeOptions = {}) {
  const fake = loadFakeGenius(options);
  const browser = fakeBrowser({ geniusTabs: [{ id: 7, active: true }] });
  const session = memoryStore();
  const asked: { type: string; source?: string; at: number }[] = [];
  const holder: { page?: GeniusPage } = {};
  const ports = {
    ...browser.ports,
    notifyGenius: (_tab: number, notice: Parameters<typeof browser.ports.notifyGenius>[1]) => {
      if (notice.type === "genius/auto-state") holder.page?.setAuto(notice.auto);
      return Promise.resolve(true);
    },
  };
  const service = new PasteService(
    ports,
    // The shortest pace and a quick settle, so a whole run takes about a second.
    { settings: memoryStore({ [SETTINGS_KEY]: { autocompleteWaitSeconds: 0.2, autoPaceSeconds: 0.2 } }), session },
    () => Date.now(),
  );
  const send = (request: GeniusRequest): Promise<unknown> => {
    asked.push({
      type: request.type,
      ...(request.type === "paste-begin" && request.source ? { source: request.source } : {}),
      at: Date.now(),
    });
    return service.fromGenius(request);
  };
  const page = new GeniusPage({ doc: fake.doc, send, timing: TIMING });
  holder.page = page;
  page.setActive(true);
  const stored = () => normalisePaste(session.data.get(PASTE_KEY));
  const begin = async (queue: [string, string][] = WHOLE) => {
    await service.command({ type: "paste-start", title: "Song", queue });
    return service.command({ type: "paste-auto-start" });
  };
  const writerBox = () => boxOf(comboboxByLabel(fake.form, "Writer") as HTMLInputElement);
  /** The user picks the suggestion themselves: the chip appears in the field. */
  const choose = (text: string): void => {
    const chip = fake.doc.createElement("div");
    chip.className = "css-user-multiValue";
    chip.textContent = text;
    writerBox().append(chip);
  };
  return { fake, page, send, service, session, stored, begin, choose, asked, writerBox };
}

describe("an automatic run", () => {
  it("fills the whole queue by itself, then switches itself off, and never saves", async () => {
    const { fake, page, stored, begin, writerBox } = setup();
    await begin();
    await page.whenAutoIdle();

    expect(chipsIn(writerBox())).toEqual(["Billie Eilish"]);
    expect(rowChips(fake.form)).toEqual([{ role: ["Mixing Engineer"], artists: ["FINNEAS"] }]);
    expect(stored()).toMatchObject({ position: WHOLE.length, auto: "off", pauseReason: "", busy: false });
    expect(fake.saveClicks + fake.cancelClicks + fake.submits).toBe(0);
    expect(fake.strayEnters).toEqual([]);
  });

  it("fills a form whose additional credits are collapsed, as a song that already has some shows them", async () => {
    const { fake, page, stored, begin } = setup({ collapsedRoles: true });
    await begin();
    await page.whenAutoIdle();
    expect(rowChips(fake.form)).toEqual([{ role: ["Mixing Engineer"], artists: ["FINNEAS"] }]);
    expect(stored()).toMatchObject({ position: WHOLE.length, auto: "off" });
    expect(fake.expands).toBe(1);
  });

  it("pauses between fields for the pace the worker hands out", async () => {
    const { page, begin, asked } = setup();
    await begin(SHORT);
    await page.whenAutoIdle();
    const steps = asked.filter((a) => a.type === "paste-begin" && a.source === "auto");
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect((steps[1]?.at ?? 0) - (steps[0]?.at ?? 0)).toBeGreaterThanOrEqual(190);
  });

  it("does nothing for a session that was never started automatically", async () => {
    const { fake, page, service, stored } = setup();
    await service.command({ type: "paste-start", title: "Song", queue: SHORT });
    page.setAuto("running"); // a stray notice: the worker still says the run is off
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ position: 0, auto: "off" });
    expect(fake.chosen).toEqual([]);
  });
});

describe("when Genius has no exact match", () => {
  it("waits for the user's choice with the run still going, then carries on by itself", async () => {
    const { fake, page, stored, begin, choose } = setup({ artists: ["Taylor Swift"] });
    await begin(SHORT);
    await until(() => stored().awaiting);
    expect(stored()).toMatchObject({ auto: "running", awaiting: true, position: 0 });
    expect(stored().message).toContain("Billie Eilish");
    expect(fake.chosen).toEqual([]);

    choose("Billie Eilish");
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ position: SHORT.length, auto: "off", awaiting: false });
    expect(fake.form.querySelector<HTMLInputElement>('input[name="youtube_url"]')?.value).toBe(URL);
  });

  it("carries on when the user picks a differently named entry, since Genius has no entry with Apple's name", async () => {
    // The usual reason for a no-match: Genius calls the person or label something else. The user picks the right one,
    // and the run must go on, not wait for a chip that has Apple's spelling and never comes.
    const { fake, page, stored, begin, choose } = setup({ artists: ["Taylor Swift"] });
    await begin(SHORT);
    await until(() => stored().awaiting);
    choose("Billie Eilish (Genius's own spelling)");
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ position: SHORT.length, auto: "off", awaiting: false });
    expect(fake.form.querySelector<HTMLInputElement>('input[name="youtube_url"]')?.value).toBe(URL);
  });

  it("carries on when the user picks a different role than Apple's for a role Genius does not have", async () => {
    const { fake, page, stored, begin } = setup({ roles: ["Vocal Engineer"] });
    await begin([
      ["role", "Editing Engineer"],
      ["artist", "FINNEAS"],
      ["youtube_url", URL],
    ]);
    await until(() => stored().awaiting);
    const rowRole = fake.form.querySelector('[id$="-label"]');
    const chip = fake.doc.createElement("div");
    chip.className = "css-user-multiValue";
    chip.textContent = "Vocal Engineer";
    rowRole?.append(chip);
    await page.whenAutoIdle();
    expect(stored().auto).toBe("off");
    expect(stored().position).toBe(3);
  });

  it("carries on when the user picked while the run was paused and then turns it back on", async () => {
    const { page, service, stored, begin, choose } = setup({ artists: ["Taylor Swift"] });
    await begin(SHORT);
    await until(() => stored().awaiting);
    await service.command({ type: "paste-auto-pause" });
    await page.whenAutoIdle();
    choose("Taylor Swift");
    await service.command({ type: "paste-auto-start" });
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ position: SHORT.length, auto: "off" });
  });

  it("does not pause for the user clicking or typing in the form while it waits", async () => {
    const { fake, page, stored, begin, choose } = setup({ artists: ["Taylor Swift"] });
    await begin(SHORT);
    await until(() => stored().awaiting);
    const input = comboboxByLabel(fake.form, "Writer") as HTMLInputElement;
    // The same real events that pause a run at any other time, aimed inside the form.
    const click = trusted(new MouseEvent("mousedown", { bubbles: true }));
    input.dispatchEvent(click);
    page.onUserActivity(click);
    const key = trusted(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    input.dispatchEvent(key);
    page.onUserActivity(key);
    await wait(50);
    expect(stored()).toMatchObject({ auto: "running", awaiting: true });
    choose("Billie Eilish");
    await page.whenAutoIdle();
    expect(stored().auto).toBe("off");
  });

  it("carries on when the user skips the field from the panel", async () => {
    const { fake, page, service, stored, begin } = setup({ artists: ["Taylor Swift"] });
    await begin(SHORT);
    await until(() => stored().awaiting);
    await service.command({ type: "paste-skip" });
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ position: SHORT.length, auto: "off" });
    expect(fake.form.querySelector<HTMLInputElement>('input[name="youtube_url"]')?.value).toBe(URL);
  });

  it("goes back to waiting for the same choice when it is resumed after a pause", async () => {
    const { page, service, stored, begin, choose } = setup({ artists: ["Taylor Swift"] });
    await begin(SHORT);
    await until(() => stored().awaiting);
    await service.command({ type: "paste-auto-pause" });
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ auto: "paused", awaiting: true, position: 0 });

    await service.command({ type: "paste-auto-start" });
    await wait(100);
    expect(stored()).toMatchObject({ auto: "running", awaiting: true, position: 0 });
    choose("Billie Eilish");
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ position: SHORT.length, auto: "off" });
  });
});

describe("the user taking over", () => {
  it("pauses on a real click in the form, after the step in progress, and fills nothing more", async () => {
    const { fake, page, stored, begin } = setup();
    await begin();
    await wait(20);
    const input = comboboxByLabel(fake.form, "Writer") as HTMLInputElement;
    const click = trusted(new MouseEvent("mousedown", { bubbles: true }));
    input.dispatchEvent(click);
    page.onUserActivity(click);
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ auto: "paused", pauseReason: "input" });
    expect(stored().position).toBeLessThan(WHOLE.length);
  });

  it("ignores a click outside the form, and the extension's own synthetic events", async () => {
    const { fake, page, stored, begin } = setup();
    await begin(SHORT);
    await wait(20);
    const outside = trusted(new MouseEvent("mousedown", { bubbles: true }));
    fake.doc.body.dispatchEvent(outside);
    page.onUserActivity(outside);
    const input = comboboxByLabel(fake.form, "Writer") as HTMLInputElement;
    const own = new MouseEvent("mousedown", { bubbles: true }); // not trusted
    input.dispatchEvent(own);
    page.onUserActivity(own);
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ position: SHORT.length, auto: "off" });
  });

  it("pauses on Esc, even while it waits for a choice", async () => {
    const { page, stored, begin } = setup({ artists: ["Taylor Swift"] });
    await begin(SHORT);
    await until(() => stored().awaiting);
    page.onUserActivity(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ auto: "paused", pauseReason: "user", awaiting: true });
  });

  it("pauses on the Next key and fills nothing for that press", async () => {
    const { page, stored, begin } = setup();
    await begin(SHORT);
    await wait(20);
    const press = new KeyboardEvent("keydown", { key: "F8", cancelable: true, bubbles: true });
    expect(page.onKeyDown(press)).toBe(true);
    await page.whenIdle();
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ auto: "paused", pauseReason: "user" });
    expect(stored().position).toBeLessThan(SHORT.length);
  });

  it("pauses from the panel after the step in progress, and resumes where it left off", async () => {
    const { fake, page, service, stored, begin } = setup();
    await begin();
    await wait(20);
    await service.command({ type: "paste-auto-pause" });
    await page.whenAutoIdle();
    const at = stored().position;
    expect(stored()).toMatchObject({ auto: "paused", pauseReason: "user" });
    expect(at).toBeLessThan(WHOLE.length);

    await service.command({ type: "paste-auto-start" });
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ position: WHOLE.length, auto: "off" });
    expect(rowChips(fake.form)).toEqual([{ role: ["Mixing Engineer"], artists: ["FINNEAS"] }]);
  });

  it("pauses a run found running after the page was reloaded, and never resumes by itself", async () => {
    const { fake, send, stored, begin } = setup();
    await begin(SHORT);
    // A freshly loaded page has not heard of the run: it only reports that the page changed.
    const reloaded = new GeniusPage({ doc: fake.doc, send, timing: TIMING });
    reloaded.setActive(true);
    reloaded.pauseFromPage("page-changed");
    await reloaded.whenAutoIdle();
    expect(stored()).toMatchObject({ auto: "paused", pauseReason: "page-changed" });
  });
});

describe("problems stop the run with a plain message", () => {
  it("a field that is not on the form pauses it as a problem, in Genius's own words, without moving on", async () => {
    const { fake, page, stored, begin } = setup();
    fake.form.querySelector('input[name="youtube_url"]')?.remove();
    await begin([["youtube_url", URL]]);
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ auto: "paused", pauseReason: "problem", position: 0, busy: false });
    expect(stored().message).toContain("YouTube URL field is not on the form");
  });

  it("waits for the song's edit form to be open, then carries on by itself", async () => {
    const { fake, page, stored, begin } = setup();
    const parent = fake.form.parentElement;
    fake.form.remove();
    await begin(SHORT);
    await wait(150);
    // Nothing was asked of the worker and nothing was filled while there was no form: the run is simply waiting.
    expect(stored()).toMatchObject({ auto: "running", position: 0, busy: false });
    parent?.append(fake.form);
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ position: SHORT.length, auto: "off" });
  });

  it("stops waiting for the form when the run is paused from the panel", async () => {
    const { fake, page, service, stored, begin } = setup();
    fake.form.remove();
    await begin(SHORT);
    await wait(80);
    await service.command({ type: "paste-auto-pause" });
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ auto: "paused", pauseReason: "user", position: 0 });
  });

  it("a worker that does not answer ends the loop instead of spinning", async () => {
    const fake = loadFakeGenius();
    const page = new GeniusPage({
      doc: fake.doc,
      send: () => Promise.reject(new Error("no receiver")),
      timing: TIMING,
    });
    page.setActive(true);
    page.setAuto("running");
    await expect(page.whenAutoIdle()).resolves.toBeUndefined();
  });
});

describe("the release date steps in an automatic run", () => {
  const DATE: [string, string][] = [
    ["release_month", "May"],
    ["release_day", "5"],
    ["release_year", "2024"],
  ];

  it("runs through the three steps after the other fields, then switches itself off", async () => {
    const { fake, page, stored, begin } = setup({ release: { collapsed: true } });
    await begin([...SHORT, ...DATE]);
    await page.whenAutoIdle();
    expect(fake.chosen).toEqual([
      "Writer: Billie Eilish",
      "Release Month: May",
      "Release Day: 5",
      "Release Year: 2024",
    ]);
    expect(fake.tagsToggles).toBe(1);
    expect(stored()).toMatchObject({ position: SHORT.length + DATE.length, auto: "off", pauseReason: "" });
    expect(fake.saveClicks + fake.cancelClicks + fake.submits).toBe(0);
  });

  it("waits for the user's choice when the list has no exact option, then carries on", async () => {
    const { fake, page, stored, begin } = setup({ release: { years: [2023, 2025] } });
    await begin(DATE);
    await until(() => stored().awaiting);
    expect(stored()).toMatchObject({ auto: "running", awaiting: true, position: 2 });
    expect(stored().message).toContain("release year 2024");
    // The user picks the nearest year themselves.
    const yearBox = fake.doc.querySelector('input[aria-label="Release Year"]')?.closest("div")?.parentElement;
    const chosen = fake.doc.createElement("div");
    chosen.className = "css-user-singleValue";
    chosen.textContent = "2025";
    yearBox?.append(chosen);
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ position: DATE.length, auto: "off", awaiting: false });
  });

  it("pauses as a problem, in plain words, when the Tags and Albums section cannot be opened", async () => {
    const { page, stored, begin } = setup({ release: { collapsed: true, noExpander: true } });
    await begin(DATE);
    await page.whenAutoIdle();
    expect(stored()).toMatchObject({ auto: "paused", pauseReason: "problem", position: 0, busy: false });
    expect(stored().message).toBe("Open the Tags and Albums section, then press Next.");
  });
});
