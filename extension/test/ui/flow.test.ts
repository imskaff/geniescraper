import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PageScrape, Result } from "../../src/shared/messages";
import { PanelController } from "../../src/ui/controller";
import { PanelView } from "../../src/ui/view";
import { ALBUM, SINGLE, deferred, fakeEnv, scrapeFor } from "./fakes";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
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

/** Start pasting the first track and walk every step, so the done screen is up. */
async function toDone(options: Parameters<typeof fakeEnv>[0] = {}) {
  const ui = await toReview(options);
  await ui.panel.startPaste(0);
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
    const { root } = await toReview();
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
    await panel.startPaste(0);
    await flush();
    const steps = details(root, "Steps left");
    expect(steps.open).toBe(true);
    expect(steps.querySelector("summary")?.textContent).toMatch(/^Steps left \(\d+\)$/);
  });

  it("keeps the steps as the user leaves them when they close them", async () => {
    const { root, panel } = await toReview();
    await panel.startPaste(0);
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
    await panel.startPaste(0);
    await flush();
    expect(details(root, "Steps left").open).toBe(true);
    await panel.stopPaste();
    await flush();
    expect(details(root, "Paste queue").open).toBe(false);
  });

  it("styles Back to credits like Back to main menu", async () => {
    const { root, panel } = await toReview();
    await panel.startPaste(0);
    await flush();
    const stop = button(root, "Back to credits");
    expect(stop.classList.contains("nav")).toBe(true);
    expect(stop.classList.contains("quiet")).toBe(false);
  });

  it("marks the current step, and only it, for the stylesheet to fill yellow", async () => {
    const { root, panel } = await toReview();
    await panel.startPaste(0);
    await flush();
    const here = root.querySelectorAll("ol.steps li.here");
    expect(here).toHaveLength(1);
    expect(here[0]?.getAttribute("aria-current")).toBe("step");
    expect(root.querySelectorAll("ol.steps li.done")).toHaveLength(0);
  });

  it("shows no Steps done list until a step is finished", async () => {
    const { root, panel } = await toReview();
    await panel.startPaste(0);
    await flush();
    expect(() => details(root, "Steps done")).toThrow();
  });

  it("moves a finished step into a closed Steps done list above the steps left", async () => {
    const { root, panel } = await toReview();
    await panel.startPaste(0);
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
    await panel.startPaste(0);
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
    await panel.startPaste(0);
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
    expect(next.textContent).toBe("Paste next track: Three");
    expect(next.classList.contains("primary")).toBe(true);
    next.click();
    await flush();
    expect(env.api.pasteState.title).toBe("Three");
    expect($(root, "h2").textContent).toBe("Paste into Genius");
  });

  it("offers no next track after the last one", async () => {
    const { root, panel, env } = await toReview();
    await panel.startPaste(2);
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
    await panel.startPaste(0);
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
