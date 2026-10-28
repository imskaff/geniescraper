import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageScrape, Result } from "../../src/shared/messages";
import { PanelController } from "../../src/ui/controller";
import { DEFAULT_SETTINGS } from "../../src/shared/settings";
import { PanelView } from "../../src/ui/view";
import { ALBUM, SINGLE, deferred, fakeEnv, scrapeFor } from "./fakes";

/** Let pending promises settle. Microtasks only, so it also works while timers are faked. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

const $ = (root: ParentNode, selector: string): HTMLElement => {
  const node = root.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
};
const button = (root: ParentNode, text: string): HTMLButtonElement => {
  const node = [...root.querySelectorAll("button")].find((b) => b.textContent.startsWith(text));
  if (!node) throw new Error(`no button ${text}`);
  return node;
};
const has = (root: ParentNode, text: string): boolean =>
  [...root.querySelectorAll("button")].some((b) => b.textContent.startsWith(text));
const details = (root: ParentNode, summary: string): HTMLDetailsElement => {
  const node = [...root.querySelectorAll("details")].find((d) =>
    d.querySelector("summary")?.textContent.startsWith(summary),
  );
  if (!node) throw new Error(`no details ${summary}`);
  return node;
};

async function mount(options: Parameters<typeof fakeEnv>[0] = {}) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const env = fakeEnv(options);
  const panel = await PanelController.create(env);
  new PanelView(root, panel);
  return { root, env, panel };
}

async function toTracks(options: Parameters<typeof fakeEnv>[0] = {}) {
  const ui = await mount(options);
  await ui.panel.detect(ALBUM.url);
  await flush();
  return ui;
}

async function toReview(options: Parameters<typeof fakeEnv>[0] = {}) {
  const ui = await toTracks(options);
  await ui.panel.setAllSelected(true);
  await ui.panel.getCredits();
  await flush();
  return ui;
}

/** The review screen with the first track's credits opened, which the user does by clicking it. */
async function toReviewOpen(options: Parameters<typeof fakeEnv>[0] = {}) {
  const ui = await toReview(options);
  await ui.panel.showTrack(0);
  await flush();
  return ui;
}

/** Start pasting the first track and walk every step, so the done screen is up. */
async function toDone(options: Parameters<typeof fakeEnv>[0] = {}, index = 0, alsoPasted: number[] = []) {
  const ui = await toReview(options);
  for (const earlier of alsoPasted) await ui.panel.startPaste(earlier, "manual");
  await ui.panel.startPaste(index, "manual");
  // The fake worker holds the finished state too, so a Back from the done screen starts at the last step.
  ui.env.api.pasteState = { ...ui.env.api.pasteState, position: ui.env.api.pasteState.queue.length };
  ui.panel.setPaste(ui.env.api.pasteState);
  await flush();
  return ui;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Back to main menu", () => {
  it("is not shown on the main menu itself", async () => {
    const { root } = await mount();
    expect(has(root, "Back to main menu")).toBe(false);
  });

  it.each([
    ["the track list", toTracks],
    ["the credits", toReview],
  ])("is at the bottom of %s, in plain words and in its own color", async (_name, go) => {
    const { root } = await go();
    const menu = button($(root, "main"), "Back to main menu");
    expect(menu.classList.contains("nav")).toBe(true);
    expect(menu.classList.contains("quiet")).toBe(false);
    expect(menu.classList.contains("primary")).toBe(false);
  });

  it("sits under the paste queue, in the row Back to tracks is in, and no longer in the header", async () => {
    const { root } = await toReviewOpen();
    const row = button($(root, "main"), "Back to main menu").parentElement;
    expect(row?.contains(button(root, "Back to tracks"))).toBe(true);
    const queue = details(root, "Paste queue");
    expect(queue.compareDocumentPosition(row as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect($(root, "header").textContent).not.toContain("Back to main menu");
  });

  it("returns to the main menu with a clean slate", async () => {
    const { root, panel } = await toReview();
    button(root, "Back to main menu").click();
    await flush();
    expect($(root, "h2").textContent).toBe("Get credits from Apple Music");
    expect(panel.state.session).toMatchObject({ screen: "link", album: null, results: [], selected: [] });
  });

  it("works even while credits are still being read, and drops the late answer", async () => {
    const gate = deferred<Result<PageScrape>>();
    const { root, panel } = await toTracks({ api: { scrapeTrack: () => gate.promise } });
    await panel.setAllSelected(true);
    void panel.getCredits();
    await flush();
    button(root, "Back to main menu").click();
    await flush();
    gate.resolve({ ok: true, data: scrapeFor("One") });
    await flush();
    expect(panel.state.session).toMatchObject({ screen: "link", results: [] });
  });
});

describe("Back to tracks", () => {
  it("is offered for an album with several tracks", async () => {
    const { root } = await toReview();
    expect(has(root, "Back to tracks")).toBe(true);
  });

  it("is not offered when the link has only one song", async () => {
    const { root } = await mount({ api: { detect: () => Promise.resolve({ ok: true, data: SINGLE }) } });
    const input = $(root, "#link") as HTMLInputElement;
    input.value = SINGLE.url;
    $(root, "form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect($(root, "h2").textContent).toBe("Credits");
    expect(has(root, "Back to tracks")).toBe(false);
    expect(has(root, "Back to main menu")).toBe(true);
  });
});

describe("the paste screen", () => {
  it("shows all steps open from the start, with their count", async () => {
    const { root, panel } = await toReview();
    await panel.startPaste(0, "manual");
    await flush();
    const steps = details(root, "Steps left");
    expect(steps.open).toBe(true);
    expect(steps.querySelector("summary")?.textContent).toMatch(/^Steps left \(\d+\)$/);
  });

  it("keeps the steps as the user leaves them when they close them", async () => {
    const { root, panel } = await toReview();
    await panel.startPaste(0, "manual");
    await flush();
    const steps = details(root, "Steps left");
    steps.open = false;
    steps.dispatchEvent(new Event("toggle"));
    await panel.pasteSkip();
    await flush();
    expect(details(root, "Steps left").open).toBe(false);
  });

  it("does not share its open state with the paste queue", async () => {
    const { root, panel } = await toReview();
    await panel.startPaste(0, "manual");
    await flush();
    expect(details(root, "Steps left").open).toBe(true);
    await panel.stopPaste();
    await flush();
    expect(details(root, "Paste queue").open).toBe(false);
  });

  it("styles Back to credits like Back to main menu", async () => {
    const { root, panel } = await toReview();
    await panel.startPaste(0, "manual");
    await flush();
    const stop = button(root, "Back to credits");
    expect(stop.classList.contains("nav")).toBe(true);
    expect(stop.classList.contains("quiet")).toBe(false);
  });

  it("marks the current step, and only it, for the stylesheet to fill yellow", async () => {
    const { root, panel } = await toReview();
    await panel.startPaste(0, "manual");
    await flush();
    const here = root.querySelectorAll("ol.steps li.here");
    expect(here).toHaveLength(1);
    expect(here[0]?.getAttribute("aria-current")).toBe("step");
    expect(root.querySelectorAll("ol.steps li.done")).toHaveLength(0);
  });

  it("shows no Steps done list until a step is finished", async () => {
    const { root, panel } = await toReview();
    await panel.startPaste(0, "manual");
    await flush();
    expect(() => details(root, "Steps done")).toThrow();
  });

  it("moves a finished step into a closed Steps done list above the steps left", async () => {
    const { root, panel } = await toReview();
    await panel.startPaste(0, "manual");
    await flush();
    const total = root.querySelectorAll("ol.steps li").length;
    await panel.pasteSkip();
    await flush();
    const done = details(root, "Steps done");
    expect(done.open).toBe(false);
    expect(done.querySelector("summary")?.textContent).toBe("Steps done (1)");
    expect(done.querySelectorAll("li.done")).toHaveLength(1);
    const left = details(root, "Steps left");
    expect(left.querySelector("summary")?.textContent).toBe(`Steps left (${String(total - 1)})`);
    expect(left.querySelectorAll("li.done")).toHaveLength(0);
    expect(done.compareDocumentPosition(left) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(left.querySelector("li.here")).not.toBeNull();
  });

  it("keeps the Steps done list as the user leaves it", async () => {
    const { root, panel } = await toReview();
    await panel.startPaste(0, "manual");
    await panel.pasteSkip();
    await flush();
    const done = details(root, "Steps done");
    done.open = true;
    done.dispatchEvent(new Event("toggle"));
    await panel.pasteSkip();
    await flush();
    expect(details(root, "Steps done").open).toBe(true);
    expect(details(root, "Steps done").querySelectorAll("li")).toHaveLength(2);
  });

  it("puts a step back into the steps left when the user goes back, and drops the empty list", async () => {
    const { root, panel } = await toReview();
    await panel.startPaste(0, "manual");
    await panel.pasteSkip();
    await flush();
    const total = root.querySelectorAll("ol.steps li").length;
    await panel.pasteBack();
    await flush();
    expect(() => details(root, "Steps done")).toThrow();
    expect(details(root, "Steps left").querySelectorAll("li")).toHaveLength(total);
  });

  it("does not let the finished-screen styles break the done steps", () => {
    const css = readFileSync(join(import.meta.dirname, "..", "..", "src", "ui", "panel.css"), "utf-8");
    expect(css).not.toMatch(/^\.done[\s{,.]/m);
    expect(css).toMatch(/^\.finished \{/m);
  });

  it("fills the current step yellow with dark ink, not only an outline", () => {
    const css = readFileSync(join(import.meta.dirname, "..", "..", "src", "ui", "panel.css"), "utf-8");
    const rule = /\.steps li\.here \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/background:\s*var\(--accent\)/);
    expect(rule).toMatch(/color:\s*var\(--accent-ink\)/);
    expect(css).toMatch(/\.steps li\.here \.tag \{[^}]*color:\s*var\(--accent-ink\)/);
  });
});

describe("the finished screen", () => {
  it("replaces the paste screen with a success message, as the desktop app does", async () => {
    const { root } = await toDone();
    expect($(root, "h2").textContent).toBe("All credits entered");
    expect($(root, ".done-mark").textContent).toBe("✓");
    expect($(root, ".done-mark").getAttribute("aria-hidden")).toBe("true");
    expect(root.textContent).toContain("Check the Genius page, then press Save there.");
    expect(has(root, "Fill next")).toBe(false);
    expect(root.querySelector("ol.steps")).toBeNull();
  });

  it("moves focus to its heading and announces it", async () => {
    const { root } = await toDone();
    expect(document.activeElement).toBe($(root, "h2"));
    expect($(root, "#status").textContent).toBe("All credits entered. Check the Genius page, then press Save there.");
  });

  it("names the song that was pasted", async () => {
    const { root } = await toDone();
    expect($(root, ".finished .help").textContent).toBe("One");
  });

  it("offers the next track with credits, as the main action", async () => {
    const { root, env } = await toDone();
    const next = button(root, "Paste next track");
    expect(next.textContent).toBe(`Paste next track: Three (${String(DEFAULT_SETTINGS.nextTrackSeconds)}s)`);
    expect(next.classList.contains("primary")).toBe(true);
    next.click();
    await flush();
    expect(env.api.pasteState.title).toBe("Three");
    expect($(root, "h2").textContent).toBe("Paste into Genius");
  });

  it("offers no next track after the last one", async () => {
    const { root, panel, env } = await toReview();
    await panel.startPaste(2, "manual");
    const { queue } = env.api.pasteState;
    panel.setPaste({ ...env.api.pasteState, position: queue.length });
    await flush();
    expect(has(root, "Paste next track")).toBe(false);
  });

  it("goes back to the credits, to the track list, or to the main menu, ending the paste quietly", async () => {
    for (const [label, expected] of [
      ["Back to the credits", "Credits"],
      ["Back to the track list", "Demo Album"],
      ["Back to main menu", "Get credits from Apple Music"],
    ] as const) {
      const { root, panel } = await toDone();
      button(root, label).click();
      await flush();
      expect($(root, "h2").textContent, label).toBe(expected);
      expect(panel.state.paste.active, label).toBe(false);
      expect($(root, "#status").textContent, label).toBe("");
    }
  });

  it("styles the way out like the other menu buttons, and is accessible", async () => {
    const { root } = await toDone();
    expect(button(root, "Back to main menu").classList.contains("nav")).toBe(true);
    for (const control of root.querySelectorAll("button")) expect(control.textContent.trim()).not.toBe("");
    expect([...root.querySelectorAll("h1, h2, h3")].map((h) => h.tagName)).toEqual(["H1", "H2"]);
  });

  it("does not offer the track list for a single song", async () => {
    const { root, panel } = await mount({ api: { detect: () => Promise.resolve({ ok: true, data: SINGLE }) } });
    await panel.detect(SINGLE.url);
    await panel.startPaste(0, "manual");
    const state = panel.state.paste;
    panel.setPaste({ ...state, position: state.queue.length });
    await flush();
    expect(has(root, "Back to the track list")).toBe(false);
    expect(has(root, "Back to the credits")).toBe(true);
  });

  it("returns to the paste screen when the user goes back a step from it", async () => {
    const { root, panel, env } = await toDone();
    await panel.pasteBack();
    await flush();
    expect(env.api.pasteState.position).toBe(env.api.pasteState.queue.length - 1);
    expect($(root, "h2").textContent).toBe("Paste into Genius");
  });
});

describe("the YouTube link in the credits list", () => {
  const LINK = "https://www.youtube.com/watch?v=abcDEF_-123";
  const withLink = (isMv: boolean) => ({
    hosts: { youtube: true },
    api: {
      lookupYoutube: () =>
        Promise.resolve({
          ok: true as const,
          data: { url: LINK, isMusicVideo: isMv, throttled: false, keyProblem: "" as const },
        }),
    },
  });

  it("is listed with the credits, as a safe link, saying whether it is the music video", async () => {
    const { root } = await toReviewOpen(withLink(true));
    const dt = [...root.querySelectorAll("dl.credits dt")].find((d) => d.textContent === "YouTube (music video)");
    const link = dt?.nextElementSibling?.querySelector("a");
    expect(link?.getAttribute("href")).toBe(LINK);
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("says audio when it is not a music video", async () => {
    const { root } = await toReviewOpen(withLink(false));
    expect([...root.querySelectorAll("dl.credits dt")].some((d) => d.textContent === "YouTube (audio)")).toBe(true);
  });

  it("is absent when no link was found", async () => {
    const { root } = await toReviewOpen();
    expect([...root.querySelectorAll("dl.credits dt")].some((d) => d.textContent.startsWith("YouTube"))).toBe(false);
  });
});

describe("returning to the main menu after the last step", () => {
  const tick = async (seconds: number): Promise<void> => {
    for (let i = 0; i < seconds; i++) await vi.advanceTimersByTimeAsync(1000);
  };
  const timed = async (options: Parameters<typeof fakeEnv>[0] = {}) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // The countdown belongs to the last track left to paste: track 0 was pasted first, track 2 is the one just finished.
    return toDone(options, 2, [0]);
  };
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a countdown on the finished screen and shows it on the main menu button", async () => {
    const { root } = await timed();
    expect(DEFAULT_SETTINGS.returnSeconds).toBe(30);
    expect(button(root, "Back to main menu").textContent).toBe("Back to main menu (30s)");
    await tick(3);
    expect(button(root, "Back to main menu").textContent).toBe("Back to main menu (27s)");
  });

  it("goes to the main menu with a clean slate when it reaches zero", async () => {
    const { root, panel } = await timed();
    await tick(30);
    await flush();
    expect($(root, "h2").textContent).toBe("Get credits from Apple Music");
    expect(panel.state.paste.active).toBe(false);
    expect(panel.state.doneCountdown).toBeNull();
  });

  it("waits while the pointer is over the panel or a button is focused, and carries on after", async () => {
    const { root, panel } = await timed();
    root.dispatchEvent(new Event("mouseenter"));
    await tick(40);
    expect(panel.state.doneCountdown).toBe(30);
    root.dispatchEvent(new Event("mouseleave"));
    await tick(2);
    expect(panel.state.doneCountdown).toBe(28);
    button(root, "Back to the credits").focus();
    await tick(40);
    expect(panel.state.doneCountdown).toBe(28);
    (document.activeElement as HTMLElement).blur();
    await tick(28);
    await flush();
    expect($(root, "h2").textContent).toBe("Get credits from Apple Music");
  });

  it("does not hold for the heading having focus, which is where focus lands on this screen", async () => {
    const { root } = await timed();
    expect(document.activeElement).toBe($(root, "h2"));
    await tick(30);
    await flush();
    expect($(root, "h2").textContent).toBe("Get credits from Apple Music");
  });

  it("stops when the user chooses a way out or goes back a step", async () => {
    const first = await timed();
    button(first.root, "Back to the credits").click();
    await flush();
    expect(first.panel.state.doneCountdown).toBeNull();
    await tick(40);
    expect($(first.root, "h2").textContent).toBe("Credits");

    const second = await timed();
    await second.panel.pasteBack();
    await flush();
    expect(second.panel.state.doneCountdown).toBeNull();
    await tick(40);
    expect($(second.root, "h2").textContent).toBe("Paste into Genius");
  });

  it("does not start when the setting is off, and stops if it is turned off meanwhile", async () => {
    const off = await timed({ settings: { autoReturn: false } });
    expect(off.panel.state.doneCountdown).toBeNull();
    expect(button(off.root, "Back to main menu").textContent).toBe("Back to main menu");
    vi.useRealTimers();
    const on = await timed();
    expect(on.panel.state.doneCountdown).toBe(30);
    await on.panel.setSetting("autoReturn", false);
    expect(on.panel.state.doneCountdown).toBeNull();
    await tick(40);
    expect($(on.root, "h2").textContent).toBe("All credits entered");
  });

  it("starts the next track by itself after fifteen seconds, then the menu countdown after the last one", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { root, panel, env } = await toDone();
    expect(DEFAULT_SETTINGS.nextTrackSeconds).toBe(15);
    expect(button(root, "Paste next track").textContent).toBe("Paste next track: Three (15s)");
    await tick(3);
    expect(button(root, "Paste next track").textContent).toBe("Paste next track: Three (12s)");
    await tick(12);
    await flush();
    expect(env.api.pasteState.title).toBe("Three");
    expect($(root, "h2").textContent).toBe("Paste into Genius");
    expect(panel.state.nextCountdown).toBeNull();
    expect(panel.state.doneCountdown).toBeNull();
    // The track started by the countdown was counted as pasted, so finishing it starts the menu countdown.
    const state = panel.state.paste;
    panel.setPaste({ ...state, position: state.queue.length });
    expect(panel.state.doneCountdown).toBe(30);
    expect(panel.state.nextCountdown).toBeNull();
  });

  it("counts the next track down from the number of seconds in the settings", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { root, panel } = await toDone({ settings: { nextTrackSeconds: 7 } });
    expect(button(root, "Paste next track").textContent).toBe("Paste next track: Three (7s)");
    await tick(6);
    expect(panel.state.nextCountdown).toBe(1);
    await tick(1);
    await flush();
    expect($(root, "h2").textContent).toBe("Paste into Genius");
  });

  it("returns to the main menu after the number of seconds in the settings", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { root, panel } = await toDone({ settings: { returnSeconds: 12 } }, 2, [0]);
    expect(panel.state.doneCountdown).toBe(12);
    expect(button(root, "Back to main menu").textContent).toBe("Back to main menu (12s)");
    await tick(12);
    await flush();
    expect($(root, "h2").textContent).toBe("Get credits from Apple Music");
  });

  it("does not start the next track by itself when its seconds are zero, and keeps the button", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { root, panel } = await toDone({ settings: { nextTrackSeconds: 0 } });
    expect(panel.state.nextCountdown).toBeNull();
    expect(button(root, "Paste next track").textContent).toBe("Paste next track: Three");
    await tick(200);
    expect($(root, "h2").textContent).toBe("All credits entered");
  });

  it("stops a running next-track countdown when its seconds are set to zero, and leaves the other one alone", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { panel } = await toDone();
    expect(panel.state.nextCountdown).toBe(15);
    await panel.setSetting("autoReturn", false);
    expect(panel.state.nextCountdown).toBe(15);
    await panel.setSetting("nextTrackSeconds", 0);
    expect(panel.state.nextCountdown).toBeNull();
  });

  it("waits while the pointer is over the panel, and starts the next track after it leaves", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { root, panel } = await toDone();
    root.dispatchEvent(new Event("mouseenter"));
    await tick(40);
    expect(panel.state.nextCountdown).toBe(15);
    expect($(root, "h2").textContent).toBe("All credits entered");
    root.dispatchEvent(new Event("mouseleave"));
    await tick(15);
    await flush();
    expect($(root, "h2").textContent).toBe("Paste into Genius");
  });

  it("starts, from thirty, once the last track is finished, after the user moved on from the first", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { root, panel } = await toDone({}, 0);
    button(root, "Paste next track").click();
    await flush();
    expect(panel.state.doneCountdown).toBeNull();
    const state = panel.state.paste;
    panel.setPaste({ ...state, position: state.queue.length });
    expect(panel.state.doneCountdown).toBe(30);
  });

  it("follows the tracks left to paste, not their order: finishing a later track first starts no countdown", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { root, panel } = await toDone({}, 2);
    expect(panel.state.doneCountdown).toBeNull();
    expect(panel.state.nextCountdown).toBeNull();
    await tick(60);
    expect($(root, "h2").textContent).toBe("All credits entered");
  });

  it("keeps waiting when the pointer was already over the panel as the countdown started", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const ui = await toReview();
    await ui.panel.startPaste(0, "manual");
    await ui.panel.startPaste(2, "manual");
    ui.root.dispatchEvent(new Event("mouseenter"));
    const state = ui.panel.state.paste;
    ui.panel.setPaste({ ...state, position: state.queue.length });
    await tick(60);
    expect(ui.panel.state.doneCountdown).toBe(30);
    expect($(ui.root, "h2").textContent).toBe("All credits entered");
  });

  it("does not start when it is not known which track was pasted", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { panel } = await toDone({}, 2);
    panel.cancelCountdown();
    const state = panel.state.paste;
    panel.setPaste({ ...state, position: 0 });
    // A panel restored with no way to tell which track the paste was for:
    (panel as unknown as { current: { pasteIndex: number | null } }).current.pasteIndex = null;
    panel.setPaste({ ...state, position: state.queue.length });
    expect(panel.state.doneCountdown).toBeNull();
  });
});

describe("the YouTube note in the credits list", () => {
  it("says why a track has no link, in its credits", async () => {
    const { root } = await toReviewOpen({
      hosts: { youtube: true },
      api: {
        lookupYoutube: () =>
          Promise.resolve({
            ok: true as const,
            data: { url: "", isMusicVideo: false, throttled: true, keyProblem: "" as const },
          }),
      },
    });
    const dt = [...root.querySelectorAll("dl.credits dt")].find((d) => d.textContent === "YouTube");
    expect(dt?.nextElementSibling?.textContent).toContain("limiting requests");
  });

  it("shows nothing when no look-up was made", async () => {
    const { root } = await toReview();
    expect([...root.querySelectorAll("dl.credits dt")].some((d) => d.textContent === "YouTube")).toBe(false);
  });
});
