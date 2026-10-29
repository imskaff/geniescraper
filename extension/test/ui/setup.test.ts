import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normaliseSettings } from "../../src/shared/settings";
import { SETUP_STEPS, PanelController } from "../../src/ui/controller";
import { PanelView } from "../../src/ui/view";
import { fakeEnv } from "./fakes";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
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

const $ = (root: ParentNode, selector: string): HTMLElement => {
  const node = root.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
};
const has = (root: ParentNode, text: string): boolean =>
  [...root.querySelectorAll("button")].some((b) => b.textContent.startsWith(text));
const press = async (root: ParentNode, text: string): Promise<void> => {
  const node = [...root.querySelectorAll("button")].find((b) => b.textContent.startsWith(text));
  if (!node) throw new Error(`no button ${text}`);
  node.click();
  await flush();
};
const box = (root: ParentNode, key: string): HTMLInputElement => $(root, `[data-key="${key}"]`) as HTMLInputElement;
const tick = async (root: ParentNode, key: string, on: boolean): Promise<void> => {
  const input = box(root, key);
  input.checked = on;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await flush();
};
const heading = (root: ParentNode): string => $(root, "h2").textContent;
const goTo = async (root: ParentNode, step: number): Promise<void> => {
  for (let i = 0; i < step; i++) await press(root, i === 0 ? "Get started" : "Next");
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("when the set-up shows", () => {
  it.each([undefined, null, {}, 5, "x"])("shows for a store with nothing usable in it (%j)", (raw) => {
    expect(normaliseSettings(raw).onboarded).toBe(false);
  });

  it("does not show for someone who already has saved settings from before the set-up existed", () => {
    expect(normaliseSettings({ scrapeCore: false }).onboarded).toBe(true);
    expect(normaliseSettings({ onboarded: "yes", nextHotkey: "F9" }).onboarded).toBe(true);
  });

  it("follows what was saved when it says so", () => {
    expect(normaliseSettings({ onboarded: false, scrapeCore: true }).onboarded).toBe(false);
    expect(normaliseSettings({ onboarded: true }).onboarded).toBe(true);
  });

  it("opens by itself on the first run, and not after", async () => {
    expect((await mount({ firstRun: true })).panel.state.setup).toEqual({ open: true, step: 0 });
    expect((await mount()).panel.state.setup.open).toBe(false);
    expect((await mount({ settings: { scrapeCore: false } })).panel.state.setup.open).toBe(false);
  });
});

describe("walking through the set-up", () => {
  it("starts with a welcome that says what it does and that it never saves", async () => {
    const { root } = await mount({ firstRun: true });
    expect(heading(root)).toBe("Welcome to Géniescraper");
    expect(root.textContent).toContain("Set-up, step 1 of 5");
    expect(root.textContent).toContain("never presses Save");
    expect(root.textContent).toContain("no account and no tracking");
    expect(document.activeElement).toBe($(root, "h2"));
  });

  it("hides what does not belong over it: the Settings button and Start pasting", async () => {
    const { root } = await mount({ firstRun: true });
    expect($(root, "#settings-toggle").hidden).toBe(true);
    expect(root.querySelector('[data-key="start"]')).toBeNull();
  });

  it("goes through all five steps with Next and Back, moving focus to each heading", async () => {
    const { root } = await mount({ firstRun: true });
    const titles: string[] = [];
    for (let i = 0; i < SETUP_STEPS; i++) {
      titles.push(heading(root));
      expect(document.activeElement).toBe($(root, "h2"));
      expect(root.textContent).toContain(`Set-up, step ${String(i + 1)} of ${String(SETUP_STEPS)}`);
      if (i < SETUP_STEPS - 1) await press(root, i === 0 ? "Get started" : "Next");
    }
    expect(titles).toEqual([
      "Welcome to Géniescraper",
      "What should it paste?",
      "Speed and comfort",
      "Better covers and links (optional)",
      "You're all set",
    ]);
    await press(root, "Back");
    expect(heading(root)).toBe("Better covers and links (optional)");
  });

  it("has no Back on the first step, and no Next past the last", async () => {
    const { root } = await mount({ firstRun: true });
    expect(has(root, "Back")).toBe(false);
    await goTo(root, SETUP_STEPS - 1);
    expect(has(root, "Next")).toBe(false);
    expect(has(root, "Start using Géniescraper")).toBe(true);
  });

  it("cannot be skipped: no step has a skip button, and the only ways on are Next and the last step's finish", async () => {
    const { root, panel } = await mount({ firstRun: true });
    for (let i = 0; i < SETUP_STEPS; i++) {
      expect(has(root, "Skip"), `step ${String(i)}`).toBe(false);
      expect(root.textContent.toLowerCase()).not.toContain("skip the set-up");
      expect(panel.state.setup.open).toBe(true);
      if (i < SETUP_STEPS - 1) await press(root, i === 0 ? "Get started" : "Next");
    }
  });

  it("stays open, with the same step, when the panel is reopened before it is finished", async () => {
    const { root, env } = await mount({ firstRun: true });
    await goTo(root, 2);
    const again = await PanelController.create(fakeEnv({ firstRun: true }));
    expect(again.state.setup.open).toBe(true);
    expect(env.settingsStore.data.get("settings")).toBeUndefined();
  });

  it("finishes on the last step, saves that it was seen, and does not come back by itself", async () => {
    const { root, env } = await mount({ firstRun: true });
    await goTo(root, SETUP_STEPS - 1);
    await press(root, "Start using Géniescraper");
    expect(heading(root)).toBe("Get credits from Apple Music");
    expect($(root, "#settings-toggle").hidden).toBe(false);
    expect(env.settingsStore.data.get("settings")).toMatchObject({ onboarded: true });
    const again = fakeEnv({ settings: env.settingsStore.data.get("settings") });
    expect((await PanelController.create(again)).state.setup.open).toBe(false);
  });
});

describe("the welcome", () => {
  it("shows the logo from the extension's own files, as decoration, above the welcome words", async () => {
    const { root } = await mount({ firstRun: true });
    const logo = $(root, ".welcome-logo") as HTMLImageElement;
    expect(logo.getAttribute("src")).toBe("../icons/icon-128.png");
    expect(logo.getAttribute("alt")).toBe("");
    expect($(root, ".welcome-mark").getAttribute("aria-hidden")).toBe("true");
    const mark = $(root, ".welcome-mark");
    const title = $(root, "h2");
    expect(mark.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("plays its fade-in the first time it is drawn, and not again on a redraw or when coming back to it", async () => {
    const { root, panel } = await mount({ firstRun: true });
    expect($(root, ".welcome").classList.contains("animate")).toBe(true);
    expect($(root, ".setup-nav").classList.contains("animate")).toBe(true);
    await panel.setSetting("autoReturn", true);
    expect($(root, ".welcome").classList.contains("animate")).toBe(false);
    expect($(root, ".setup-nav").classList.contains("animate")).toBe(false);
    await press(root, "Get started");
    await press(root, "Back");
    expect($(root, ".welcome").classList.contains("animate")).toBe(false);
    expect(heading(root)).toBe("Welcome to Géniescraper");
  });

  it("is built so that a part that does not play simply shows: the animation only says where to start from", () => {
    const css = readFileSync(join(import.meta.dirname, "..", "..", "src", "ui", "panel.css"), "utf-8");
    for (const rule of css.match(/\.(welcome|setup-nav)\.animate[^{]*\{[^}]*\}/g) ?? []) {
      expect(rule, rule).toContain("backwards");
      expect(rule, rule).not.toMatch(/forwards|both/);
    }
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[^}]*\{[^}]*animation: none !important/);
    expect(css).not.toMatch(/\.welcome[^{]*\{[^}]*opacity: 0;/);
  });
});

describe("the choices in the set-up", () => {
  it("shows the recommended choices ticked on 'What should it paste?', with a sentence under each", async () => {
    const { root } = await mount({ firstRun: true });
    await goTo(root, 1);
    for (const key of ["scrapeCore", "scrapeAdditional", "scrapeCopyright", "scrapeCoverArt", "scrapeYoutube"]) {
      expect(box(root, `setting-${key}`).checked, key).toBe(true);
      expect(document.getElementById(`help-${key}`)?.textContent.length, key).toBeGreaterThan(20);
    }
  });

  it("applies a change at once, the same way Settings does", async () => {
    const { root, panel } = await mount({ firstRun: true });
    await goTo(root, 1);
    await tick(root, "setting-scrapeCoverArt", false);
    expect(panel.state.settings.scrapeCoverArt).toBe(false);
  });

  it("offers the speed choices with the recommendation named, and applies them", async () => {
    const { root, panel } = await mount({ firstRun: true });
    await goTo(root, 2);
    const reads = $(root, "#setup-parallelReads") as HTMLSelectElement;
    expect(reads.value).toBe("3");
    expect(document.getElementById("help-parallelReads")?.textContent).toContain("Recommended: 3");
    reads.value = "5";
    reads.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(panel.state.settings.parallelReads).toBe(5);
    await tick(root, "setting-autoReturn", false);
    expect(panel.state.settings.autoReturn).toBe(false);
    const next = $(root, "#setup-nextHotkey") as HTMLSelectElement;
    next.value = "F9";
    next.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(panel.state.settings.nextHotkey).toBe("F9");
  });

  it("swaps the two keys instead of leaving one key with two jobs", async () => {
    const { root, panel } = await mount({ firstRun: true });
    await goTo(root, 2);
    const back = $(root, "#setup-backHotkey") as HTMLSelectElement;
    back.value = "F8";
    back.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(panel.state.settings).toMatchObject({ backHotkey: "F8", nextHotkey: "F7" });
  });
});

describe("the look-ups step", () => {
  it("explains that Chrome asks, and what to tick", async () => {
    const { root } = await mount({ firstRun: true });
    await goTo(root, 3);
    expect(root.textContent).toContain("Chrome asks your permission");
    expect(root.textContent).toContain("Recommended: tick the YouTube box");
  });

  it("has the Deezer and YouTube boxes, which ask Chrome inside the click", async () => {
    const { root, env } = await mount({ firstRun: true });
    await goTo(root, 3);
    const deezer = box(root, "host-deezer");
    deezer.checked = true;
    deezer.dispatchEvent(new Event("change", { bubbles: true }));
    expect(env.hosts.log).toEqual(["request:deezer"]);
    await flush();
    expect(box(root, "host-deezer").checked).toBe(true);
  });

  it("has the YouTube key box with its step-by-step help, and saving a key works from here", async () => {
    const KEY = "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";
    const { root, panel, env } = await mount({ firstRun: true });
    await goTo(root, 3);
    expect(root.querySelectorAll(".how-to > li")).toHaveLength(5);
    const field = $(root, "#youtube-key") as HTMLInputElement;
    field.value = KEY;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await press(root, "Save and check key");
    expect(env.hosts.log).toEqual(["request:youtubeApi"]);
    expect(panel.state.youtubeKey.saved).toBe(true);
    expect(panel.state.setup).toEqual({ open: true, step: 3 });
  });
});

describe("the summary", () => {
  it("says what was chosen, in plain words, with the real keys", async () => {
    const { root } = await mount({ firstRun: true });
    await goTo(root, SETUP_STEPS - 1);
    const text = $(root, "main").textContent;
    expect(text).toContain(
      "Pasting: songwriters and producers, additional credits, copyright lines, the PNG cover link, the YouTube link.",
    );
    expect(text).toContain("Reading: 3 tracks at a time.");
    expect(text).toContain("Genius keys: F8 fills the next step, F7 goes back.");
    expect(text).toContain("Covers from Deezer when Apple has none: off.");
    expect(text).toContain("YouTube links: not looked up (you can add a key in Settings).");
    expect(text).toContain("press Start pasting");
  });

  it("follows the choices made", async () => {
    const { root, panel } = await mount({
      firstRun: true,
      hosts: { deezer: true, youtubeApi: true },
      youtubeKey: "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q",
    });
    await panel.setSetting("scrapeCore", false);
    await panel.setSetting("scrapeYoutube", false);
    await panel.setSetting("parallelReads", 0);
    await panel.setSetting("nextHotkey", "F9");
    await goTo(root, SETUP_STEPS - 1);
    const text = $(root, "main").textContent;
    expect(text).toContain("Pasting: additional credits, copyright lines, the PNG cover link.");
    expect(text).toContain("Reading: every track at once.");
    expect(text).toContain("F9 fills the next step");
    expect(text).toContain("Covers from Deezer when Apple has none: on.");
    expect(text).toContain("from Google's official service, with your key");
  });

  it("says when nothing is selected, rather than showing an empty line", async () => {
    const { root, panel } = await mount({ firstRun: true });
    for (const key of [
      "scrapeCore",
      "scrapeAdditional",
      "scrapeCopyright",
      "scrapeCoverArt",
      "scrapeYoutube",
    ] as const) {
      await panel.setSetting(key, false);
    }
    await goTo(root, SETUP_STEPS - 1);
    expect($(root, "main").textContent).toContain("Pasting: nothing is selected yet.");
  });
});

describe("no way to run it again", () => {
  it("is not offered in Settings, and there is no 'Use recommended' anywhere", async () => {
    const { root } = await mount({ settings: { scrapeCore: false } });
    await press(root, "Settings");
    expect(has(root, "Run the setup again")).toBe(false);
    expect(root.textContent).not.toContain("setup again");
    const fresh = await mount({ firstRun: true });
    for (let i = 0; i < SETUP_STEPS; i++) {
      expect(has(fresh.root, "Use recommended")).toBe(false);
      if (i < SETUP_STEPS - 1) await press(fresh.root, i === 0 ? "Get started" : "Next");
    }
  });
});

describe("accessibility of every step", () => {
  const nameOf = (control: HTMLElement): string => {
    const labelled = control.getAttribute("aria-label");
    if (labelled) return labelled;
    const id = control.id;
    const forLabel = id ? document.querySelector(`label[for="${id}"]`)?.textContent : "";
    return (forLabel || control.closest("label")?.textContent || control.textContent || "").trim();
  };

  it("has named controls, ordered headings, unique ids and real description targets on every step", async () => {
    const { root } = await mount({ firstRun: true });
    for (let step = 0; step < SETUP_STEPS; step++) {
      for (const control of root.querySelectorAll<HTMLElement>("button, input, select")) {
        expect(nameOf(control), `step ${String(step)} control`).not.toBe("");
      }
      expect(root.querySelectorAll("h1")).toHaveLength(1);
      const levels = [...root.querySelectorAll("h1, h2, h3")].map((h) => Number(h.tagName.slice(1)));
      levels.forEach((level, i) => {
        if (i > 0) expect(level - (levels[i - 1] ?? 0)).toBeLessThanOrEqual(1);
      });
      const ids = [...root.querySelectorAll("[id]")].map((n) => n.id);
      expect(new Set(ids).size, `step ${String(step)} ids`).toBe(ids.length);
      for (const described of root.querySelectorAll("[aria-describedby]")) {
        for (const id of (described.getAttribute("aria-describedby") ?? "").split(" ")) {
          expect(document.getElementById(id), `step ${String(step)} ${id}`).not.toBeNull();
        }
      }
      for (const link of root.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')) {
        expect(link.rel).toContain("noopener");
      }
      if (step < SETUP_STEPS - 1) await press(root, step === 0 ? "Get started" : "Next");
    }
  });
});
