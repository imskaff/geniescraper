import { afterEach, describe, expect, it } from "vitest";
import { PanelController } from "../../src/ui/controller";
import { PanelView } from "../../src/ui/view";
import { ALBUM, SINGLE, deferred, fakeEnv, scrapeFor } from "./fakes";
import type { PageScrape, Result } from "../../src/shared/messages";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

async function mount(options: Parameters<typeof fakeEnv>[0] = {}) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const env = fakeEnv(options);
  const panel = await PanelController.create(env);
  const view = new PanelView(root, panel);
  return { root, env, panel, view };
}

const $ = (root: ParentNode, selector: string): HTMLElement => {
  const node = root.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
};
const $input = (root: ParentNode, selector: string): HTMLInputElement => $(root, selector) as HTMLInputElement;
const $button = (root: ParentNode, selector: string): HTMLButtonElement => $(root, selector) as HTMLButtonElement;
const $link = (root: ParentNode, selector: string): HTMLAnchorElement => $(root, selector) as HTMLAnchorElement;
const byText = (root: ParentNode, selector: string, text: string): HTMLElement => {
  const node = [...root.querySelectorAll<HTMLElement>(selector)].find((n) => n.textContent.includes(text));
  if (!node) throw new Error(`no ${selector} with text ${text}`);
  return node;
};

async function submitLink(root: HTMLElement, url: string): Promise<void> {
  const input = $input(root, "#link");
  input.value = url;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  $(root, "form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
}

/** The accessible name of a control, as a screen reader would compute it for the cases used here. */
function accessibleName(node: HTMLElement): string {
  const labelled = node.getAttribute("aria-label");
  if (labelled) return labelled;
  const id = node.getAttribute("id");
  const forLabel = id ? document.querySelector(`label[for="${id}"]`) : null;
  const wrapping = node.closest("label");
  return (forLabel ?? wrapping ?? node).textContent.trim();
}

/** Structural accessibility rules that hold on every screen. */
function expectAccessible(root: HTMLElement): void {
  for (const control of root.querySelectorAll<HTMLElement>("button, input, select, textarea")) {
    expect(accessibleName(control), `name of <${control.tagName.toLowerCase()}>`).not.toBe("");
  }
  expect(root.querySelectorAll("h1")).toHaveLength(1);
  const levels = [...root.querySelectorAll("h1, h2, h3, h4")].map((h) => Number(h.tagName.slice(1)));
  levels.forEach((level, i) => {
    if (i > 0) expect(level - (levels[i - 1] ?? 0), `heading order ${levels.join(",")}`).toBeLessThanOrEqual(1);
  });
  expect(root.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(root.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(root.querySelectorAll("main")).toHaveLength(1);
  const ids = [...root.querySelectorAll("[id]")].map((n) => n.id);
  expect(new Set(ids).size, "unique ids").toBe(ids.length);
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')) {
    expect(link.rel).toContain("noopener");
  }
  for (const described of root.querySelectorAll("[aria-describedby]")) {
    expect(document.getElementById(described.getAttribute("aria-describedby") ?? "")).not.toBeNull();
  }
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("link screen", () => {
  it("is accessible, with a labelled link box described by its help text", async () => {
    const { root } = await mount();
    expectAccessible(root);
    const input = $input(root, "#link");
    expect(accessibleName(input)).toBe("Apple Music album or song link");
    expect($(root, "#link-help").textContent).toContain("paste its link");
  });

  it("fills in the Apple Music page the user is on", async () => {
    const { root } = await mount({ tab: { tabId: 3, url: ALBUM.url } });
    expect($input(root, "#link").value).toBe(ALBUM.url);
    expect($(root, "#link-help").textContent).toContain("filled in");
  });

  it("puts focus on the screen heading when the panel opens", async () => {
    const { root } = await mount();
    expect(document.activeElement).toBe($(root, "h2"));
  });

  it("announces an invalid link in the alert region and reads nothing", async () => {
    const { root, env } = await mount();
    await submitLink(root, "https://example.com/");
    expect($(root, "#alert").textContent).toBe("That is not an Apple Music album or song link.");
    expect(env.api.calls).toEqual([]);
  });

  it("marks the link box invalid while a link error is showing", async () => {
    const { root } = await mount();
    expect($input(root, "#link").hasAttribute("aria-invalid")).toBe(false);
    await submitLink(root, "https://example.com/");
    expect($input(root, "#link").getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps what the user typed when the screen re-renders", async () => {
    const { root, panel } = await mount();
    const input = $input(root, "#link");
    input.value = "half typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    panel.openSettings();
    panel.closeSettings();
    expect($input(root, "#link").value).toBe("half typed");
  });

  it("disables the button and says so while reading", async () => {
    const gate = deferred<Result<typeof ALBUM>>();
    const { root } = await mount({ api: { detect: () => gate.promise } });
    await submitLink(root, ALBUM.url);
    const button = $button(root, '[data-key="go"]');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Reading…");
    expect($(root, "main").getAttribute("aria-busy")).toBe("true");
    expect($(root, "#status").textContent).toBe("Reading the page…");
    gate.resolve({ ok: true, data: ALBUM });
    await flush();
    expect($(root, "main").getAttribute("aria-busy")).toBe("false");
  });
});

describe("track screen", () => {
  async function onTracks() {
    const ui = await mount();
    await submitLink(ui.root, ALBUM.url);
    return ui;
  }

  it("lists every track, picked when available and disabled when Apple has no page", async () => {
    const { root } = await onTracks();
    expectAccessible(root);
    const boxes = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([
      [true, false],
      [false, true],
      [true, false],
    ]);
    expect(root.textContent).toContain("No Apple Music page");
    expect(accessibleName(boxes[0] as HTMLElement)).toBe("1. One");
  });

  it("moves focus to the new screen's heading, which names the album and its tracks", async () => {
    const { root } = await onTracks();
    expect(document.activeElement).toBe($(root, "h2"));
    expect($(root, "h2").textContent).toBe("Demo Album");
    expect($(root, "h2 + .help").textContent).toBe("Demo Artist: 3 tracks");
    expect($(root, "#status").textContent).toBe("");
  });

  it("keeps focus on the checkbox the user toggled", async () => {
    const { root } = await onTracks();
    const box = $input(root, '[data-key="track-0"]');
    box.focus();
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(document.activeElement).toBe($(root, '[data-key="track-0"]'));
    expect(byText(root, "button", "Get credits for").textContent).toBe("Get credits for 1 track");
  });

  it("disables Get credits when nothing is picked, and Select none follows", async () => {
    const { root } = await onTracks();
    byText(root, "button", "Select none").click();
    await flush();
    expect(byText(root, "button", "Get credits for").hasAttribute("disabled")).toBe(true);
    expect(byText(root, "button", "Select none").hasAttribute("disabled")).toBe(true);
    byText(root, "button", "Select all").click();
    await flush();
    expect(byText(root, "button", "Get credits for").textContent).toBe("Get credits for 2 tracks");
  });
});

describe("review screen", () => {
  async function onReview(api: Parameters<typeof fakeEnv>[0] = {}) {
    const ui = await mount(api);
    await submitLink(ui.root, ALBUM.url);
    byText(ui.root, "button", "Get credits for").click();
    await flush();
    return ui;
  }

  it("shows the credits, the album's copyright and the paste queue, accessibly", async () => {
    const { root } = await onReview();
    expectAccessible(root);
    expect(root.querySelector("h2")?.textContent).toBe("Credits");
    expect(byText(root, "dt", "Songwriter").nextElementSibling?.textContent).toBe("Writer One, Writer Two");
    expect(byText(root, "dt", "Phonographic copyright").nextElementSibling?.textContent).toBe("℗ 2024 Demo Records");

    const queue = [...root.querySelectorAll('ol[aria-label="Paste queue"] li')].map((li) => li.textContent);
    expect(queue[0]).toBe("Written ByWriter One");
    expect(queue).toContain("Cover art URLhttps://example.com/album-cover.png");
  });

  it("has no track list to choose from when there is only one track", async () => {
    const ui = await mount({ api: { detect: () => Promise.resolve({ ok: true, data: SINGLE }) } });
    await submitLink(ui.root, SINGLE.url);
    expect(ui.root.querySelector("nav")).toBeNull();
  });

  it("marks the shown track in the track list and lets the user switch", async () => {
    const { root } = await onReview();
    const current = $(root, '[aria-current="true"]');
    expect(current.textContent).toBe("1. One: Ready");
    byText(root, "button", "3. Three").click();
    await flush();
    expect($(root, "#track-heading").textContent).toBe("Three");
    expect($(root, '[aria-current="true"]').textContent).toBe("3. Three: Ready");
  });

  it("changes the queue at once when a setting changes", async () => {
    const { root } = await onReview();
    byText(root, "button", "Settings").click();
    await flush();
    $input(root, '[data-key="setting-scrapeCore"]').click();
    await flush();
    byText(root, "button", "Back").click();
    await flush();
    const queue = [...root.querySelectorAll('ol[aria-label="Paste queue"] li')].map((li) => li.textContent);
    expect(queue.some((text) => text.startsWith("Written By"))).toBe(false);
    expect(queue.some((text) => text.startsWith("Additional role"))).toBe(true);
  });

  it("shows a failed track's error with a working Try again", async () => {
    let attempts = 0;
    const { root } = await onReview({
      api: {
        scrapeTrack: (_url, title): Promise<Result<PageScrape>> =>
          Promise.resolve(
            ++attempts === 1
              ? { ok: false, error: { code: "timeout", message: "x" } }
              : { ok: true, data: scrapeFor(title) },
          ),
      },
    });
    expect($(root, ".problem").textContent).toContain("too long");
    expect(root.querySelector('[data-key="show-0"]')?.textContent).toContain("Failed");
    $(root, '[data-key="retry"]').click();
    await flush();
    expect(root.querySelector('[data-key="show-0"]')?.textContent).toContain("Ready");
  });

  it("offers Stop only while reading", async () => {
    const gate = deferred<Result<PageScrape>>();
    const { root } = await onReview({ api: { scrapeTrack: () => gate.promise } });
    expect(byText(root, "button", "Stop")).toBeDefined();
    expect(byText(root, "button", "Back to tracks").hasAttribute("disabled")).toBe(true);
    byText(root, "button", "Stop").click();
    await flush();
    expect([...root.querySelectorAll("button")].some((b) => b.textContent === "Stop")).toBe(false);
    expect($(root, "#status").textContent).toBe("Stopped.");
    gate.resolve({ ok: true, data: scrapeFor("One") });
  });

  it("goes back to the track list and to a new link", async () => {
    const { root } = await onReview();
    byText(root, "button", "Back to tracks").click();
    await flush();
    expect($(root, "h2").textContent).toBe("Demo Album");
    byText(root, "button", "New link").click();
    await flush();
    expect($(root, "h2").textContent).toBe("Get credits from Apple Music");
  });

  it("says when a track has no credits", async () => {
    const empty = { ...scrapeFor("One"), credits: [] };
    const { root } = await onReview({ api: { scrapeTrack: () => Promise.resolve({ ok: true, data: empty }) } });
    expect(root.textContent).toContain("No credits were found for this track.");
  });

  it("opens straight on the credits for a single track", async () => {
    const ui = await mount({ api: { detect: () => Promise.resolve({ ok: true, data: SINGLE }) } });
    await submitLink(ui.root, SINGLE.url);
    expect($(ui.root, "h2").textContent).toBe("Credits");
  });
});

describe("settings screen", () => {
  it("is accessible, closes with Escape and with the Back button, and returns focus to a heading", async () => {
    const { root } = await mount();
    byText(root, "button", "Settings").click();
    await flush();
    expectAccessible(root);
    expect($(root, "h2").textContent).toBe("Settings");
    expect(document.activeElement).toBe($(root, "h2"));
    const checks = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checks.map(accessibleName)).toEqual([
      "Songwriters and producers",
      "Additional credits",
      "Copyright lines (℗ and ©)",
      "YouTube link",
      "Cover art link",
    ]);

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();
    expect($(root, "h2").textContent).toBe("Get credits from Apple Music");
  });

  it("saves a toggled setting", async () => {
    const { root, env } = await mount();
    byText(root, "button", "Settings").click();
    await flush();
    $input(root, '[data-key="setting-scrapeYoutube"]').click();
    await flush();
    expect(env.settingsStore.data.get("settings")).toMatchObject({ scrapeYoutube: false });
  });
});

describe("untrusted text", () => {
  it("shows page-supplied text as text, never as markup", async () => {
    const hostile = '<img src=x onerror="window.__pwned = true"><script>window.__pwned = true</script>';
    const album = {
      ...ALBUM,
      albumTitle: hostile,
      artist: hostile,
      trackTitles: [hostile, "Two", "Three"],
      copyrightNotice: hostile,
      coverArtUrl: "javascript:alert(1)",
    };
    const ui = await mount({ api: { detect: () => Promise.resolve({ ok: true, data: album }) } });
    await submitLink(ui.root, ALBUM.url);
    byText(ui.root, "button", "Get credits for").click();
    await flush();

    expect(ui.root.querySelector("img, script")).toBeNull();
    expect((window as unknown as Record<string, unknown>)["__pwned"]).toBeUndefined();
    expect(ui.root.textContent).toContain(hostile);
    // A cover URL that is not https is shown as text and is not a link.
    expect(ui.root.querySelector('a[href^="javascript"]')).toBeNull();
    expect(ui.root.textContent).toContain("javascript:alert(1)");
  });

  it("makes an https cover URL a safe external link", async () => {
    const { root } = await mount();
    await submitLink(root, ALBUM.url);
    byText(root, "button", "Get credits for").click();
    await flush();
    const link = $link(root, "dd a");
    expect(link.getAttribute("href")).toBe(ALBUM.coverArtUrl);
    expect(link.rel).toBe("noopener noreferrer");
  });
});
