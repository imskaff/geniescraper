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

  it("forgets the old link after Back to main menu, and offers the current page again", async () => {
    const { root, panel } = await mount({ tab: { tabId: 3, url: "https://music.apple.com/us/album/other/77" } });
    await submitLink(root, ALBUM.url);
    byText(root, "button", "Back to main menu").click();
    await flush();
    expect($input(root, "#link").value).toBe("https://music.apple.com/us/album/other/77");
    expect(panel.state.session.screen).toBe("link");
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
    // The label stays and three dots appear one after another, so the press is seen to be working.
    expect(button.textContent).toBe("Get credits...");
    expect(button.querySelectorAll(".dots i")).toHaveLength(3);
    expect(button.getAttribute("aria-label")).toBe("Reading the page…");
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
    // Nothing is picked for the user; the track without a page cannot be picked at all.
    expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([
      [false, false],
      [false, true],
      [false, false],
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
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(document.activeElement).toBe($(root, '[data-key="track-0"]'));
    expect(byText(root, "button", "Get credits for").textContent).toBe("Get credits for 1 track");
  });

  it("starts with Get credits disabled, and Select all highlighted like Get credits", async () => {
    const { root } = await onTracks();
    expect(byText(root, "button", "Get credits for").textContent).toBe("Get credits for 0 tracks");
    expect(byText(root, "button", "Get credits for").hasAttribute("disabled")).toBe(true);
    // The first move is the yellow one, the same style as the button it leads to.
    expect(byText(root, "button", "Select all").classList.contains("primary")).toBe(true);
    expect(byText(root, "button", "Select all").hasAttribute("disabled")).toBe(false);
    expect(byText(root, "button", "Get credits for").classList.contains("primary")).toBe(true);
    expect(byText(root, "button", "Select none").classList.contains("primary")).toBe(false);
  });

  it("Select all picks every available track and Select none clears them", async () => {
    const { root } = await onTracks();
    byText(root, "button", "Select all").click();
    await flush();
    expect(byText(root, "button", "Get credits for").textContent).toBe("Get credits for 2 tracks");
    byText(root, "button", "Select none").click();
    await flush();
    expect(byText(root, "button", "Get credits for").hasAttribute("disabled")).toBe(true);
  });

  it("keeps keyboard focus on Select all and Select none after they are used", async () => {
    const { root } = await onTracks();
    for (const key of ["all", "none", "all"]) {
      const button = $(root, `[data-key="${key}"]`);
      button.focus();
      button.click();
      await flush();
      expect(document.activeElement, key).toBe($(root, `[data-key="${key}"]`));
    }
  });
});

describe("review screen", () => {
  async function onReview(api: Parameters<typeof fakeEnv>[0] = {}) {
    const ui = await mount(api);
    await submitLink(ui.root, ALBUM.url);
    byText(ui.root, "button", "Select all").click();
    await flush();
    byText(ui.root, "button", "Get credits for").click();
    await flush();
    return ui;
  }

  /** The review screen with the first track's credits opened, which the user does by clicking it. */
  async function withFirstOpen(api: Parameters<typeof fakeEnv>[0] = {}) {
    const ui = await onReview(api);
    $(ui.root, '[data-key="show-0"]').click();
    await flush();
    return ui;
  }

  it("shows the credits, the album's copyright and the paste queue, accessibly", async () => {
    const { root } = await withFirstOpen();
    expectAccessible(root);
    expect(root.querySelector("h2")?.textContent).toBe("Credits");
    expect(byText(root, "dt", "Songwriter").nextElementSibling?.textContent).toBe("Writer One, Writer Two");
    expect(byText(root, "dt", "Phonographic copyright").nextElementSibling?.textContent).toBe("℗ 2024 Demo Records");

    const queue = [...root.querySelectorAll('ol[aria-label="Paste queue"] li')].map((li) => li.textContent);
    expect(queue[0]).toBe("Written ByWriter One");
    expect(queue).toContain("Cover art URLhttps://example.com/album-cover.png");
  });

  it("shows when the song was released, from its own page", async () => {
    const { root } = await withFirstOpen();
    expect(byText(root, "dt", "Released").nextElementSibling?.textContent).toBe("May 17, 2024");
  });

  it("falls back to the album's date when the song page names none", async () => {
    const { root } = await withFirstOpen({
      api: {
        scrapeTrack: (_url, title) =>
          Promise.resolve({ ok: true, data: { ...scrapeFor(title), releaseDate: "" } } as const),
      },
    });
    expect(byText(root, "dt", "Released").nextElementSibling?.textContent).toBe("May 21, 2024");
  });

  it("hides the release date when neither page gave one", async () => {
    const { root } = await withFirstOpen({
      api: {
        detect: () => Promise.resolve({ ok: true, data: { ...ALBUM, releaseDate: "" } } as const),
        scrapeTrack: (_url, title) =>
          Promise.resolve({ ok: true, data: { ...scrapeFor(title), releaseDate: "" } } as const),
      },
    });
    expect([...root.querySelectorAll("dt")].some((dt) => dt.textContent === "Released")).toBe(false);
  });

  it("has no track list to choose from when there is only one track", async () => {
    const ui = await mount({ api: { detect: () => Promise.resolve({ ok: true, data: SINGLE }) } });
    await submitLink(ui.root, SINGLE.url);
    expect(ui.root.querySelector("nav")).toBeNull();
  });

  it("marks the shown track in the track list and lets the user switch", async () => {
    const { root } = await withFirstOpen();
    const current = $(root, '[aria-current="true"]');
    expect(current.getAttribute("aria-label")).toBe("1. One: All found");
    byText(root, "button", "3. Three").click();
    await flush();
    expect($(root, "#track-heading").textContent).toBe("Three");
    expect($(root, '[aria-current="true"]').getAttribute("aria-label")).toBe("3. Three: All found");
  });

  describe("the state of each track in the list", () => {
    const state = (root: HTMLElement, index: number) => {
      const button = $(root, `[data-key="show-${String(index)}"]`);
      return {
        health: button.getAttribute("data-health"),
        mark: button.querySelector(".mark")?.textContent,
        markHidden: button.querySelector(".mark")?.getAttribute("aria-hidden"),
        words: button.querySelector(".state")?.textContent,
        name: button.getAttribute("aria-label"),
      };
    };

    it("shows a tick and 'All found' for a track with everything", async () => {
      const { root } = await onReview();
      expect(state(root, 0)).toEqual({
        health: "ok",
        mark: "✓",
        markHidden: "true",
        words: "All found",
        name: "1. One: All found",
      });
    });

    it("asks for a look, naming what is missing, when something was not found", async () => {
      const { root } = await onReview({
        api: {
          scrapeTrack: (_url, title) =>
            Promise.resolve({ ok: true, data: { ...scrapeFor(title), coverArtUrl: "", credits: [] } }),
        },
      });
      expect(state(root, 0)).toMatchObject({ health: "attention", mark: "!" });
      expect(state(root, 0).words).toContain("Needs a look:");
      expect(state(root, 0).words).toContain("credits");
    });

    it("marks a track that failed with a cross and 'Failed'", async () => {
      const { root } = await onReview({
        api: { scrapeTrack: () => Promise.resolve({ ok: false, error: { code: "timeout", message: "x" } }) },
      });
      expect(state(root, 0)).toMatchObject({ health: "error", mark: "✕", words: "Failed" });
    });

    it("says Reading while a track is being read", async () => {
      const gate = deferred<Result<PageScrape>>();
      const { root } = await onReview({ api: { scrapeTrack: () => gate.promise } });
      expect(state(root, 0)).toMatchObject({ health: "working", words: "Reading" });
    });
  });

  describe("with no track opened", () => {
    it("shows no credits, no queue and no YouTube box, and says how to see them", async () => {
      const { root } = await onReview();
      expect(root.querySelector("dl.credits")).toBeNull();
      expect(root.querySelector("#youtube-link")).toBeNull();
      expect(root.querySelector('[data-key="details-queue"]')).toBeNull();
      expect(root.querySelector('[aria-current="true"]')).toBeNull();
      expect(root.textContent).toContain("Choose a track to see its credits");
      const buttons = [...root.querySelectorAll<HTMLElement>('[data-key^="show-"]')];
      expect(buttons).toHaveLength(2);
      expect(buttons.every((b) => b.getAttribute("aria-expanded") === "false")).toBe(true);
    });

    it("has Start pasting right under the track list, ready for the first track", async () => {
      const { root } = await onReview();
      const start = root.querySelector<HTMLButtonElement>('main [data-key="start"]');
      expect(start?.textContent).toBe("Start pasting");
      expect(start?.classList.contains("magic")).toBe(false);
      expect(start?.getAttribute("aria-label")).toBe(
        "Start pasting One automatically. It pauses when you interact with Genius.",
      );
      expect(start?.hasAttribute("disabled")).toBe(false);
      const list = $(root, "ul.tracks");
      expect(list.compareDocumentPosition(start as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("starts the first track that is ready when Start pasting is pressed", async () => {
      const { root, env } = await onReview();
      $(root, '[data-key="start"]').click();
      await flush();
      expect(env.api.pasteState.title).toBe("One");
    });

    it("opens a track's credits, with the YouTube box for when no link was found, on a click, and closes them on another", async () => {
      const { root } = await onReview();
      $(root, '[data-key="show-2"]').click();
      await flush();
      expect($(root, "#track-heading").textContent).toBe("Three");
      expect($(root, '[data-key="show-2"]').getAttribute("aria-expanded")).toBe("true");
      expect(root.querySelector("dl.credits")).not.toBeNull();
      expect(root.querySelector("#youtube-link")).not.toBeNull();
      expect(root.querySelector('[data-key="youtube-find"]')).not.toBeNull();

      $(root, '[data-key="show-2"]').click();
      await flush();
      expect(root.querySelector("dl.credits")).toBeNull();
      expect(root.querySelector("#youtube-link")).toBeNull();
      expect($(root, '[data-key="show-2"]').getAttribute("aria-expanded")).toBe("false");
    });
  });

  it("changes the queue at once when a setting changes", async () => {
    const { root } = await withFirstOpen();
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
    const { root } = await withFirstOpen({
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
    expect(root.querySelector('[data-key="show-0"]')?.textContent).toContain("All found");
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
    const { root } = await withFirstOpen();
    byText(root, "button", "Back to tracks").click();
    await flush();
    expect($(root, "h2").textContent).toBe("Demo Album");
    byText(root, "button", "Back to main menu").click();
    await flush();
    expect($(root, "h2").textContent).toBe("Get credits from Apple Music");
  });

  it("says when a track has no credits", async () => {
    const empty = { ...scrapeFor("One"), credits: [] };
    const { root } = await withFirstOpen({ api: { scrapeTrack: () => Promise.resolve({ ok: true, data: empty }) } });
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
      "PNG cover art link",
      "Release date",
      "Choose the exact match in Genius's suggestions for me",
      "Go back to the main menu after the last track",
      "Find a YouTube link for each track (recommended)",
      "Show the key",
      "Check for updates",
      "Search Deezer for a cover when Apple has none",
    ]);
    // Selects and the number box are named by their labels too (expectAccessible checks every control).
    expect([...root.querySelectorAll<HTMLElement>("select, input[type=number]")].map(accessibleName)).toEqual([
      "Seconds between fields when pasting automatically",
      "Key that fills the next step",
      "Key that goes back one step",
      "Wait for suggestions to settle (seconds)",
      "Seconds before going back to the main menu",
      "Seconds before pasting the next track",
      "Tracks read at the same time",
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
    byText(ui.root, "button", "Select all").click();
    await flush();
    byText(ui.root, "button", "Get credits for").click();
    await flush();
    $(ui.root, '[data-key="show-0"]').click();
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
    byText(root, "button", "Select all").click();
    await flush();
    byText(root, "button", "Get credits for").click();
    await flush();
    $(root, '[data-key="show-0"]').click();
    await flush();
    const link = $link(root, "dd a");
    expect(link.getAttribute("href")).toBe(ALBUM.coverArtUrl);
    expect(link.rel).toBe("noopener noreferrer");
  });
});

describe("the Deezer look-up box", () => {
  const open = async (options: Parameters<typeof fakeEnv>[0] = {}) => {
    const ui = await mount(options);
    byText(ui.root, "button", "Settings").click();
    await flush();
    return { ...ui, box: ui.root.querySelector<HTMLInputElement>('[data-key="host-deezer"]') as HTMLInputElement };
  };

  it("shows the permission Chrome has, not a saved choice", async () => {
    expect((await open()).box.checked).toBe(false);
    expect((await open({ hosts: { deezer: true } })).box.checked).toBe(true);
  });

  it("asks Chrome inside the click itself, before anything is awaited", async () => {
    const { env, box } = await open();
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(env.hosts.log).toEqual(["request:deezer"]);
  });

  it("unticks again when the user declines Chrome's prompt", async () => {
    const { env, root, box } = await open();
    env.hosts.allow = false;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(root.querySelector<HTMLInputElement>('[data-key="host-deezer"]')?.checked).toBe(false);
  });

  it("unticks live when the permission is taken back in chrome://extensions", async () => {
    const { env, root } = await open({ hosts: { deezer: true } });
    env.hosts.changeElsewhere("deezer", false);
    await flush();
    expect(root.querySelector<HTMLInputElement>('[data-key="host-deezer"]')?.checked).toBe(false);
  });
});

describe("the YouTube look-up box", () => {
  it("is off until Chrome says the permission is granted, and asks inside the click", async () => {
    const { root, env } = await mount();
    byText(root, "button", "Settings").click();
    await flush();
    const box = root.querySelector<HTMLInputElement>('[data-key="host-youtube"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(env.hosts.log).toEqual(["request:youtube"]);
    await flush();
    expect(root.querySelector<HTMLInputElement>('[data-key="host-youtube"]')?.checked).toBe(true);
  });
});

describe("the YouTube key help in Settings", () => {
  const KEY = "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";
  const openSettings = async (options: Parameters<typeof fakeEnv>[0] = {}) => {
    const ui = await mount(options);
    byText(ui.root, "button", "Settings").click();
    await flush();
    return ui;
  };
  const input = (root: HTMLElement) => root.querySelector<HTMLInputElement>("#youtube-key") as HTMLInputElement;
  const stepsDetails = (root: HTMLElement) =>
    [...root.querySelectorAll("details")].find((d) => d.textContent.startsWith("How do I get a key?"));

  it("explains what the key is for, and why it is safe, in plain words", async () => {
    const { root } = await openSettings();
    const text = root.querySelector("#youtube-key-help")?.textContent ?? "";
    expect(text).toContain("official YouTube service");
    expect(text).toContain("free");
    expect(text).toContain("stays in this browser");
  });

  it("has every step to get a key, each with a link that opens Google's own page safely", async () => {
    const { root } = await openSettings();
    expect(root.querySelectorAll(".how-to > li")).toHaveLength(5);
    const links = [...root.querySelectorAll<HTMLAnchorElement>(".how-to a")];
    expect(links.map((a) => a.href)).toEqual([
      "https://console.cloud.google.com/projectcreate",
      "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
      "https://console.cloud.google.com/apis/credentials",
    ]);
    for (const a of links) {
      expect(a.target).toBe("_blank");
      expect(a.rel).toBe("noopener noreferrer");
    }
    expect(root.textContent).toContain("starts with AIza");
    const restrict = root.querySelectorAll(".how-to > li")[2]?.textContent ?? "";
    expect(restrict).toContain("Restrict key");
    expect(restrict).toContain("YouTube Data API v3");
    expect(restrict).toContain("bottom of the list");
    expect(restrict).toContain("Don't restrict key");
    expect(root.querySelector('a[href^="https://developers.google.com/youtube/v3/"]')).not.toBeNull();
  });

  it("highlights the Keep it private step, and only it, for the stylesheet to fill yellow", async () => {
    const { root } = await openSettings();
    const marked = root.querySelectorAll(".how-to li.highlight");
    expect(marked).toHaveLength(1);
    expect(marked[0]?.textContent).toContain("Keep it private.");
  });

  it("keeps the steps closed until opened, then remembers", async () => {
    const { root, panel } = await openSettings();
    const steps = stepsDetails(root);
    expect(steps?.open).toBe(false);
    if (steps) {
      steps.open = true;
      steps.dispatchEvent(new Event("toggle"));
    }
    panel.noteKeyMessage("x");
    await flush();
    expect(stepsDetails(root)?.open).toBe(true);
  });

  it("hides the key as it is typed, and shows it on request", async () => {
    const { root } = await openSettings();
    expect(input(root).type).toBe("password");
    const show = root.querySelector<HTMLInputElement>('[data-key="youtube-key-show"]') as HTMLInputElement;
    show.checked = true;
    show.dispatchEvent(new Event("change", { bubbles: true }));
    expect(input(root).type).toBe("text");
  });

  it("asks Chrome inside the click on Save, and keeps what was typed across redraws", async () => {
    const { root, env } = await openSettings();
    const box = input(root);
    box.value = KEY;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    byText(root, "button", "Save and check key").click();
    expect(env.hosts.log).toEqual(["request:youtubeApi"]);
    await flush();
    expect(input(root).value).toBe(KEY);
    expect(root.querySelector("#youtube-key-message")?.textContent).toContain("Key saved and working");
    expect(root.querySelector('[data-key="youtube-key-state"]')?.textContent).toBe("A key is saved in this browser.");
  });

  it("says to paste a key first when the box is empty", async () => {
    const { root } = await openSettings();
    byText(root, "button", "Save and check key").click();
    await flush();
    expect(root.querySelector("#youtube-key-message")?.textContent).toContain("Paste your key into the box first.");
  });

  it("offers Remove only when a key is saved, and removing it says so", async () => {
    const without = await openSettings();
    expect(without.root.querySelector('[data-key="youtube-key-remove"]')).toBeNull();
    document.body.replaceChildren();
    const withKey = await openSettings({ youtubeKey: KEY, hosts: { youtubeApi: true } });
    byText(withKey.root, "button", "Remove my key").click();
    await flush();
    expect(withKey.root.querySelector('[data-key="youtube-key-remove"]')).toBeNull();
    expect(withKey.root.querySelector("#youtube-key-message")?.textContent).toContain("removed");
  });

  it("fills the box from the clipboard, or explains when Chrome does not allow it", async () => {
    const { root } = await openSettings();
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: () => Promise.resolve(` ${KEY}\n`) },
      configurable: true,
    });
    byText(root, "button", "Paste from clipboard").click();
    await flush();
    expect(input(root).value).toBe(KEY);
    input(root).value = "";
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
    byText(root, "button", "Paste from clipboard").click();
    await flush();
    expect(root.querySelector("#youtube-key-message")?.textContent).toContain("Ctrl+V");
  });
});

describe("the key message shows success or error", () => {
  const KEY = "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";
  const settings = async (options: Parameters<typeof fakeEnv>[0] = {}) => {
    const ui = await mount(options);
    byText(ui.root, "button", "Settings").click();
    await flush();
    return ui;
  };
  const message = (root: HTMLElement) => root.querySelector<HTMLElement>("#youtube-key-message") as HTMLElement;
  const save = async (root: HTMLElement, text = KEY) => {
    const box = root.querySelector<HTMLInputElement>("#youtube-key") as HTMLInputElement;
    box.value = text;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    byText(root, "button", "Save and check key").click();
    await flush();
  };

  it("is a success, with a tick, when the key is saved and working", async () => {
    const { root } = await settings();
    await save(root);
    expect(message(root).classList.contains("ok")).toBe(true);
    expect(message(root).dataset["tone"]).toBe("ok");
    expect(message(root).querySelector(".tone-mark")?.textContent).toBe("✓ ");
    expect(message(root).textContent).toContain("Key saved and working");
  });

  it.each([
    [
      "Google rejects it",
      { api: { checkYoutubeKey: () => Promise.resolve({ ok: true as const, data: "key" as const }) } },
    ],
    [
      "the allowance is used up",
      { api: { checkYoutubeKey: () => Promise.resolve({ ok: true as const, data: "quota" as const }) } },
    ],
    [
      "the service is not enabled",
      { api: { checkYoutubeKey: () => Promise.resolve({ ok: true as const, data: "not-enabled" as const }) } },
    ],
  ])("is an error, with a cross, when %s", async (_name, options) => {
    const { root } = await settings(options);
    await save(root);
    expect(message(root).classList.contains("error")).toBe(true);
    expect(message(root).classList.contains("ok")).toBe(false);
    expect(message(root).querySelector(".tone-mark")?.textContent).toBe("✗ ");
  });

  it("is an error for a key of the wrong shape, an empty box, and a declined prompt", async () => {
    const { root, env } = await settings();
    await save(root, "hello");
    expect(message(root).classList.contains("error")).toBe(true);
    await save(root, "");
    expect(message(root).classList.contains("error")).toBe(true);
    env.hosts.allow = false;
    await save(root);
    expect(message(root).classList.contains("error")).toBe(true);
  });

  it("is neither while checking, and neither after the key is removed", async () => {
    const { root } = await settings({ youtubeKey: KEY, hosts: { youtubeApi: true } });
    byText(root, "button", "Remove my key").click();
    await flush();
    expect(message(root).dataset["tone"]).toBe("");
    expect(message(root).querySelector(".tone-mark")).toBeNull();
  });
});

describe("Save and check key waits for a different key", () => {
  const KEY = "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";
  const OTHER = "AIzaSyZ9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J";
  const setup = async (options: Parameters<typeof fakeEnv>[0] = {}) => {
    const ui = await mount(options);
    byText(ui.root, "button", "Settings").click();
    await flush();
    const box = () => ui.root.querySelector<HTMLInputElement>("#youtube-key") as HTMLInputElement;
    const saveButton = () => byText(ui.root, "button", "Save and check key") as HTMLButtonElement;
    const type = (text: string) => {
      box().value = text;
      box().dispatchEvent(new Event("input", { bubbles: true }));
    };
    return { ...ui, box, saveButton, type };
  };

  it("is enabled for a new key, disabled once that key is saved and working, and enabled again when it changes", async () => {
    const { saveButton, type } = await setup();
    type(KEY);
    expect(saveButton().disabled).toBe(false);
    saveButton().click();
    await flush();
    expect(saveButton().disabled).toBe(true);
    type(OTHER);
    expect(saveButton().disabled).toBe(false);
    type(`  ${KEY}  `);
    expect(saveButton().disabled).toBe(true);
  });

  it("stays enabled after a key that failed, so the user can try it again", async () => {
    const { saveButton, type } = await setup({
      api: { checkYoutubeKey: () => Promise.resolve({ ok: true as const, data: "quota" as const }) },
    });
    type(KEY);
    saveButton().click();
    await flush();
    expect(saveButton().disabled).toBe(false);
  });

  it("is enabled again after the key is removed", async () => {
    const { saveButton, type, root } = await setup();
    type(KEY);
    saveButton().click();
    await flush();
    byText(root, "button", "Remove my key").click();
    await flush();
    expect(saveButton().disabled).toBe(false);
  });

  it("moves keyboard focus to the key box when Save becomes disabled, instead of losing it", async () => {
    const { saveButton, type, box } = await setup();
    type(KEY);
    saveButton().focus();
    saveButton().click();
    await flush();
    expect(saveButton().disabled).toBe(true);
    expect(document.activeElement).toBe(box());
  });
});

describe("the YouTube link section in the credits", () => {
  const LINK = "https://www.youtube.com/watch?v=BY_XwvKogC8";
  const reviewed = async (options: Parameters<typeof fakeEnv>[0] = {}) => {
    const ui = await mount(options);
    await submitLink(ui.root, ALBUM.url);
    byText(ui.root, "button", "Select all").click();
    await flush();
    byText(ui.root, "button", "Get credits for").click();
    await flush();
    $(ui.root, '[data-key="show-0"]').click();
    await flush();
    return ui;
  };
  const box = (root: HTMLElement) => root.querySelector<HTMLInputElement>("#youtube-link") as HTMLInputElement;
  const type = (root: HTMLElement, text: string): void => {
    box(root).value = text;
    box(root).dispatchEvent(new Event("input", { bubbles: true }));
  };
  const hasRow = (root: HTMLElement, label: string): boolean =>
    [...root.querySelectorAll("dl.credits dt")].some((d) => d.textContent === label);

  it("offers a way to find the video: a link that opens YouTube's own search in a new tab, safely", async () => {
    const { root } = await reviewed();
    const find = root.querySelector<HTMLAnchorElement>('[data-key="youtube-find"]');
    expect(find?.textContent).toBe("Find on YouTube");
    const url = new URL(find?.href ?? "");
    expect(url.origin + url.pathname).toBe("https://www.youtube.com/results");
    expect(url.searchParams.get("search_query")).toBe("Demo Artist One official music video");
    expect(find?.target).toBe("_blank");
    expect(find?.rel).toBe("noopener noreferrer");
  });

  describe("when the program looks for the link itself", () => {
    const FOUND = {
      ok: true as const,
      data: { url: LINK, isMusicVideo: true, throttled: false, keyProblem: "" as const },
    };
    const NONE = {
      ok: true as const,
      data: { url: "", isMusicVideo: false, throttled: false, keyProblem: "" as const },
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("hides the section when it found the link", async () => {
      const ui = await reviewed({ hosts: { youtube: true }, api: { lookupYoutube: () => Promise.resolve(FOUND) } });
      await settle();
      await flush();
      expect(ui.root.querySelector("#youtube-link")).toBeNull();
      expect(ui.root.querySelector('[data-key="youtube-find"]')).toBeNull();
      expect(hasRow(ui.root, "YouTube (music video)")).toBe(true);
      expect($(ui.root, '[data-key="show-0"]').getAttribute("data-health")).toBe("ok");
    });

    it("shows the section, and marks the missing link in amber, when it found none", async () => {
      const ui = await reviewed({ hosts: { youtube: true }, api: { lookupYoutube: () => Promise.resolve(NONE) } });
      await settle();
      await flush();
      expect(ui.root.querySelector("#youtube-link")).not.toBeNull();
      const dt = [...ui.root.querySelectorAll("dl.credits dt")].find((d) => d.textContent === "YouTube");
      expect(dt?.classList.contains("attn")).toBe(true);
      expect(dt?.nextElementSibling?.classList.contains("attn")).toBe(true);
      expect($(ui.root, '[data-key="show-0"]').getAttribute("aria-label")).toBe("1. One: Needs a look: YouTube link");
    });

    it("keeps the section out of the way, and the track unfinished, while the link is still being looked for", async () => {
      const gate = deferred<typeof FOUND>();
      const ui = await reviewed({ hosts: { youtube: true }, api: { lookupYoutube: () => gate.promise } });
      expect(ui.root.querySelector("#youtube-link")).toBeNull();
      expect($(ui.root, '[data-key="show-0"]').getAttribute("data-health")).toBe("working");
      expect($(ui.root, '[data-key="show-0"]').getAttribute("aria-label")).toBe("1. One: Finding YouTube link");
      gate.resolve(FOUND);
    });

    it("keeps the section for a link the user gave, so it can be taken off", async () => {
      const ui = await reviewed({ hosts: { youtube: true }, api: { lookupYoutube: () => Promise.resolve(FOUND) } });
      await settle();
      await ui.panel.setYoutubeLink(0, "https://youtu.be/BY_XwvKogC8");
      await flush();
      expect(ui.root.querySelector('[data-key="youtube-remove"]')).not.toBeNull();
    });
  });

  it("marks what the read did not find in the credits too, for a track that needs a look", async () => {
    const bare = { ...ALBUM, coverArtUrl: "", phonographicCopyright: "", copyrightNotice: "" };
    const { root } = await reviewed({ api: { detect: () => Promise.resolve({ ok: true, data: bare }) } });
    const flagged = [...root.querySelectorAll("dl.credits dt.attn")].map((d) => d.textContent);
    expect(flagged).toContain("Copyright");
    expect(flagged).toContain("Cover art");
    expect(root.querySelector("dl.credits dd.attn")?.textContent).toBe("Not found");
  });

  it("has a labelled box for the link, described by its help text", async () => {
    const { root } = await reviewed();
    expect(root.querySelector('label[for="youtube-link"]')?.textContent).toBe("YouTube video URL");
    expect(box(root).getAttribute("aria-describedby")).toBe("youtube-link-help");
    expect(root.querySelector("#youtube-link-help")?.textContent).toContain("choose Use");
    expect(root.querySelector(".input-action")?.contains(box(root))).toBe(true);
    expect((byText(root, "button", "Use") as HTMLButtonElement).disabled).toBe(true);
  });

  it("takes a pasted link, shows it as the user's, and puts it in the paste queue", async () => {
    const { root, panel } = await reviewed();
    type(root, "https://youtu.be/BY_XwvKogC8");
    expect((byText(root, "button", "Use") as HTMLButtonElement).disabled).toBe(false);
    byText(root, "button", "Use").click();
    await flush();
    const dt = [...root.querySelectorAll("dl.credits dt")].find((d) => d.textContent === "YouTube (your link)");
    expect(dt?.nextElementSibling?.querySelector("a")?.getAttribute("href")).toBe(LINK);
    expect(box(root).value).toBe("");
    expect(panel.queueFor(0).some(([kind, value]) => kind === "youtube_url" && value === LINK)).toBe(true);
  });

  it("submits with Enter in the box too", async () => {
    const { root } = await reviewed();
    type(root, LINK);
    box(root).form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(hasRow(root, "YouTube (your link)")).toBe(true);
  });

  it("says what is wrong with something that is not a YouTube link, keeps what was typed, and marks the box", async () => {
    const { root } = await reviewed();
    type(root, "hello");
    byText(root, "button", "Use").click();
    await flush();
    expect(root.querySelector("#youtube-link-help")?.textContent).toContain("not a link to one YouTube video");
    expect(box(root).getAttribute("aria-invalid")).toBe("true");
    expect(box(root).value).toBe("hello");
  });

  it("can take the user's link off again", async () => {
    const { root } = await reviewed();
    type(root, LINK);
    byText(root, "button", "Use").click();
    await flush();
    byText(root, "button", "Remove my link").click();
    await flush();
    expect([...root.querySelectorAll("dl.credits dt")].some((d) => d.textContent.startsWith("YouTube"))).toBe(false);
  });

  it("says so when the YouTube step is turned off, because the link would not be pasted", async () => {
    const { root } = await reviewed({ settings: { scrapeYoutube: false } });
    expect(root.querySelector("#youtube-link-help")?.textContent).toContain("off in Settings");
  });

  it("does not carry a half-typed link to another track", async () => {
    const { root } = await reviewed();
    type(root, "half");
    (root.querySelector('[data-key="show-2"]') as HTMLElement).click();
    await flush();
    expect(box(root).value).toBe("");
  });
});
