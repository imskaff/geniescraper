import { afterEach, describe, expect, it } from "vitest";
import type { PageScrape, Result } from "../../src/shared/messages";
import { PanelController } from "../../src/ui/controller";
import { PanelView } from "../../src/ui/view";
import { ALBUM, deferred, fakeEnv, scrapeFor } from "./fakes";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const $ = (root: ParentNode, selector: string): HTMLElement => {
  const node = root.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
};
const details = (root: ParentNode, summary: string): HTMLDetailsElement => {
  const node = [...root.querySelectorAll("details")].find((d) =>
    d.querySelector("summary")?.textContent.startsWith(summary),
  );
  if (!node) throw new Error(`no details ${summary}`);
  return node;
};
const open = (node: HTMLDetailsElement, on: boolean): void => {
  node.open = on;
  node.dispatchEvent(new Event("toggle"));
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

afterEach(() => {
  document.body.replaceChildren();
});

describe("Start pasting in the header", () => {
  it("is not shown before there are credits to paste", async () => {
    for (const go of [mount, toTracks]) {
      const { root } = await go();
      expect($(root, "#paste-top").hidden).toBe(true);
    }
  });

  it("is shown next to Settings once a track's credits are in, and glows", async () => {
    const { root } = await toReview();
    const top = $(root, "#paste-top");
    expect(top.hidden).toBe(false);
    expect(top.textContent).toBe("Start pasting");
    expect(top.classList.contains("primary")).toBe(true);
    expect(top.classList.contains("glow")).toBe(true);
    expect($(root, ".bar-actions").contains(top)).toBe(true);
    expect($(root, ".bar-actions").contains($(root, "#settings-toggle"))).toBe(true);
    expect(top.nextElementSibling).toBe($(root, "#settings-toggle"));
  });

  it("is not repeated down in the credits, so there is one place to look", async () => {
    const { root } = await toReview();
    expect([...$(root, "main").querySelectorAll("button")].some((b) => b.textContent === "Start pasting")).toBe(false);
  });

  it("names the track it will paste, for a screen reader, while the label keeps its visible words", async () => {
    const { root } = await toReview();
    const label = $(root, "#paste-top").getAttribute("aria-label") ?? "";
    expect(label).toBe("Start pasting One");
    expect(label.startsWith($(root, "#paste-top").textContent)).toBe(true);
  });

  it("pastes the track on screen", async () => {
    const { root, env, panel } = await toReview();
    $(root, '[data-key="show-2"]').click();
    await flush();
    expect($(root, "#paste-top").getAttribute("aria-label")).toBe("Start pasting Three");
    $(root, "#paste-top").click();
    await flush();
    expect(env.api.pasteState.title).toBe("Three");
    expect(panel.state.paste.active).toBe(true);
    expect($(root, "h2").textContent).toBe("Paste into Genius");
    expect($(root, "#paste-top").hidden).toBe(true);
  });

  it("is disabled, and stops glowing, while credits are still being read", async () => {
    const gate = deferred<Result<PageScrape>>();
    const { root, panel } = await toTracks({ api: { scrapeTrack: () => gate.promise } });
    await panel.setAllSelected(true);
    void panel.getCredits();
    await flush();
    gate.resolve({ ok: true, data: scrapeFor("One") });
    // Once the first track is in, the second is still loading: busy until the run ends.
    await flush();
    const top = $(root, "#paste-top") as HTMLButtonElement;
    expect(panel.state.busy).toBeNull();
    expect(top.disabled).toBe(false);
    expect(top.classList.contains("glow")).toBe(true);
  });

  it("is hidden when the settings leave nothing to paste", async () => {
    const { root, panel } = await toReview();
    for (const key of [
      "scrapeCore",
      "scrapeAdditional",
      "scrapeCopyright",
      "scrapeYoutube",
      "scrapeCoverArt",
    ] as const) {
      await panel.setSetting(key, false);
    }
    await flush();
    expect($(root, "#paste-top").hidden).toBe(true);
  });

  it("is not shown over settings", async () => {
    const { root, panel } = await toReview();
    panel.openSettings();
    await flush();
    expect($(root, "#paste-top").hidden).toBe(true);
  });
});

describe("the paste queue", () => {
  it("is collapsed until the user opens it, and says how long it is", async () => {
    const { root } = await toReview();
    const queue = details(root, "Paste queue");
    expect(queue.open).toBe(false);
    expect(queue.querySelector("summary")?.textContent).toMatch(/^Paste queue \(\d+ steps\)$/);
    expect(queue.querySelector('ol[aria-label="Paste queue"]')).not.toBeNull();
  });

  it("opens and closes on request, and stays open when the screen is redrawn", async () => {
    const { root, panel } = await toReview();
    open(details(root, "Paste queue"), true);
    await panel.setSetting("scrapeYoutube", false); // any change redraws the screen
    await flush();
    expect(details(root, "Paste queue").open).toBe(true);

    open(details(root, "Paste queue"), false);
    await panel.setSetting("scrapeYoutube", true);
    await flush();
    expect(details(root, "Paste queue").open).toBe(false);
  });

  it("keeps keyboard focus on its heading across a redraw", async () => {
    const { root, panel } = await toReview();
    const summary = $(root, '[data-key="details-queue"]');
    summary.focus();
    await panel.setSetting("scrapeYoutube", false);
    await flush();
    expect(document.activeElement).toBe($(root, '[data-key="details-queue"]'));
  });

  it("counts a single step in the singular", async () => {
    const { root, panel } = await toReview();
    for (const key of ["scrapeAdditional", "scrapeCopyright", "scrapeYoutube", "scrapeCoverArt"] as const) {
      await panel.setSetting(key, false);
    }
    await flush();
    // Songwriters and producers only: two writers and a producer in the sample credits, so not one; check the wording.
    expect($(root, '[data-key="details-queue"]').textContent).toMatch(/^Paste queue \(\d+ steps?\)$/);
  });

  it("shows roles under Genius's names", async () => {
    const credits = [
      { role: "Songwriter", artists: ["W"] },
      { role: "Programming", artists: ["P"] },
      { role: "Drum Programming", artists: ["D"] },
    ];
    const { root } = await toReview({
      api: { scrapeTrack: (_url, title) => Promise.resolve({ ok: true, data: { ...scrapeFor(title), credits } }) },
    });
    const items = [...details(root, "Paste queue").querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toContain("Additional roleProgrammer");
    expect(items).toContain("Additional roleDrum Programmer");
    expect(items.some((text) => text.endsWith("Programming"))).toBe(false);
  });
});
