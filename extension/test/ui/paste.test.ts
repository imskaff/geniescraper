import type { PasteState } from "../../src/core/paste";
import { afterEach, describe, expect, it } from "vitest";
import { report, begin } from "../../src/core/paste";
import { PanelController } from "../../src/ui/controller";
import { PanelView } from "../../src/ui/view";
import { ALBUM, fakeEnv } from "./fakes";

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

/** The panel, opened on the credits of an album and ready to start pasting the first track. */
async function onReview(options: Parameters<typeof fakeEnv>[0] = {}) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const env = fakeEnv(options);
  const panel = await PanelController.create(env);
  new PanelView(root, panel);
  await panel.detect(ALBUM.url);
  await panel.setAllSelected(true);
  await panel.getCredits();
  await flush();
  return { root, env, panel };
}

/** A track started step by step, as these tests are about the Next key; automatic pasting has its own tests. */
async function onPaste() {
  const ui = await onReview({ settings: { pasteMode: "manual" } });
  button(ui.root, "Start pasting").click();
  await flush();
  return ui;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("starting to paste", () => {
  it("offers Start pasting on a track whose credits are in, and opens the paste screen", async () => {
    const { root, env, panel } = await onReview();
    button(root, "Start pasting").click();
    await flush();

    expect(env.api.calls).toContain("paste:paste-start");
    expect(panel.state.paste.active).toBe(true);
    expect($(root, "h2").textContent).toMatch(/^Demo Artist - [A-Za-z]+$/);
    expect(document.activeElement).toBe($(root, "h2"));
  });

  it("sends the queue the settings produce, not the whole credits", async () => {
    const { panel, env } = await onReview();
    await panel.setSetting("scrapeCore", false);
    await panel.startPaste(0, "manual");
    expect(env.api.pasteState.queue.map(([kind]) => kind)).not.toContain("written_by");
    expect(env.api.pasteState.queue.map(([kind]) => kind)).toContain("role");
  });

  it("does not offer it when the settings leave nothing to paste", async () => {
    const { root, panel } = await onReview();
    for (const key of [
      "scrapeCore",
      "scrapeAdditional",
      "scrapeCopyright",
      "scrapeYoutube",
      "scrapeCoverArt",
      "scrapeReleaseDate",
    ] as const) {
      await panel.setSetting(key, false);
    }
    await flush();
    expect(root.querySelector('[data-key="start"]')).toBeNull();
  });
});

describe("the paste screen", () => {
  it("shows the step, its value and an instruction that never asks the user to click a field", async () => {
    const { root } = await onPaste();
    expect($(root, ".progress").textContent).toMatch(/^Step 1 of \d+$/);
    expect($(root, ".step .tag").textContent).toBe("Writer");
    expect($(root, ".step .value").textContent).toBe("Writer One");
    const instruction = $(root, ".step + p").textContent;
    expect(instruction).toBe("Press F8 to add Writer One as a writer.");
    expect(instruction).not.toMatch(/click/i);
  });

  it("is accessible: labelled buttons, ordered headings, a marked current step", async () => {
    const { root } = await onPaste();
    for (const control of root.querySelectorAll("button")) expect(control.textContent.trim()).not.toBe("");
    expect([...root.querySelectorAll("h1, h2, h3")].map((h) => h.tagName)).toEqual(["H1", "H2"]);
    expect(root.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect($(root, '[aria-current="step"]').textContent).toContain("Next");
    expect($(root, "ol.steps").getAttribute("aria-label")).toBe("Steps left");
  });

  it("names the keys on the buttons from the settings", async () => {
    const { root, panel } = await onPaste();
    expect(button(root, "Next").textContent).toBe("Next (F8)");
    expect(button(root, "Previous").textContent).toBe("Previous (F7)");
    await panel.setSetting("nextHotkey", "F9");
    expect(button(root, "Next").textContent).toBe("Next (F9)");
  });

  it("sends Fill next, Skip and Back to the worker, and follows the state it answers with", async () => {
    const { root, env } = await onPaste();
    button(root, "Next").click();
    await flush();
    expect(env.api.calls).toContain("paste:paste-fill");

    button(root, "Skip").click();
    await flush();
    expect($(root, ".progress").textContent).toMatch(/^Step 2 of/);
    expect($(root, '[aria-current="step"]').textContent).toContain("Next");
    expect(root.querySelector("li.done")?.textContent).toContain("Done");

    button(root, "Previous").click();
    await flush();
    expect($(root, ".progress").textContent).toMatch(/^Step 1 of/);
  });

  it("disables Back at the first step", async () => {
    const { root } = await onPaste();
    expect(button(root, "Previous").disabled).toBe(true);
  });

  it("follows the worker when a hotkey press on Genius moves the position", async () => {
    const { root, panel, env } = await onPaste();
    const started = env.api.pasteState;
    const { state: busy, result } = begin(started, 1);
    if (result.action !== "fill") throw new Error("expected a fill");
    panel.setPaste(report(busy, result.position, { status: "filled", message: "Added Writer One." }));
    await flush();
    expect($(root, ".progress").textContent).toMatch(/^Step 2 of/);
    expect($(root, "#status").textContent).toBe("Added Writer One.");
    expect($(root, "#alert").textContent).toBe("");
  });

  it("announces a step that needs the user as an alert and says what to do", async () => {
    const { root, panel, env } = await onPaste();
    const { state: busy, result } = begin(env.api.pasteState, 1);
    if (result.action !== "fill") throw new Error("expected a fill");
    panel.setPaste(
      report(busy, result.position, { status: "needs-choice", message: "Genius has no exact match for Writer One." }),
    );
    await flush();
    expect($(root, "#alert").textContent).toBe("Genius has no exact match for Writer One.");
    expect($(root, ".step + p").textContent).toContain("Choose Writer One in Genius's suggestions");
    expect($(root, '[aria-current="step"]').textContent).toContain("Waiting for you");
  });

  it("goes back to the credits", async () => {
    const { root, panel } = await onPaste();
    button(root, "Back to credits").click();
    await flush();
    expect(panel.state.paste.active).toBe(false);
    expect($(root, "h2").textContent).toBe("Credits");
    expect($(root, "#status").textContent).toBe("Stopped pasting.");
  });

  it("explains that nothing is saved for the user", async () => {
    const { root } = await onPaste();
    expect(root.textContent).toContain("Nothing is saved for you");
  });

  it("shows a failure to reach Genius as an alert", async () => {
    const env = fakeEnv({
      api: {
        paste: (command) =>
          Promise.resolve(
            command.type === "paste-fill"
              ? { ok: false, error: { code: "tab-failed", message: "Open the song's page on Genius." } }
              : { ok: true, data: { ...env.api.pasteState } },
          ),
      },
    });
    document.body.replaceChildren();
    const root = document.createElement("div");
    document.body.append(root);
    const panel = await PanelController.create(env);
    new PanelView(root, panel);
    await panel.detect(ALBUM.url);
    await panel.setAllSelected(true);
    await panel.getCredits();
    await panel.startPaste(0, "manual");
    panel.setPaste({ ...env.api.pasteState, active: true, queue: [["written_by", "A"]], title: "T" });
    await flush();
    button(root, "Next").click();
    await flush();
    expect($(root, "#alert").textContent).toContain("Open the song's page on Genius.");
  });
});

describe("a session the panel finds already running", () => {
  it("opens on the paste screen when it was opened mid-session", async () => {
    document.body.replaceChildren();
    const root = document.createElement("div");
    document.body.append(root);
    const env = fakeEnv();
    env.sessionStore.data.set("paste", {
      active: true,
      title: "Song",
      queue: [["written_by", "Writer One"]],
      position: 0,
      awaiting: false,
      busy: false,
      busySince: 0,
      message: "",
      tone: "info",
    });
    const panel = await PanelController.create(env);
    new PanelView(root, panel);
    expect($(root, "h2").textContent).toBe("Song");
  });
});

describe("pasting settings", () => {
  async function onSettings() {
    const ui = await onReview();
    button(ui.root, "Settings").click();
    await flush();
    return ui;
  }

  it("swaps the keys when one is chosen for the other's job, instead of silently resetting both", async () => {
    const { root, panel } = await onSettings();
    const next = $(root, "#setting-nextHotkey") as HTMLSelectElement;
    next.value = "F7";
    next.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(panel.state.settings).toMatchObject({ nextHotkey: "F7", backHotkey: "F8" });
    expect(($(root, "#setting-backHotkey") as HTMLSelectElement).value).toBe("F8");
  });

  it("saves the auto-confirm choice and clamps the wait", async () => {
    const { root, panel, env } = await onSettings();
    $(root, '[data-key="setting-autoConfirm"]').click();
    await flush();
    expect(panel.state.settings.autoConfirm).toBe(false);
    expect(env.settingsStore.data.get("settings")).toMatchObject({ autoConfirm: false });

    const wait = $(root, "#setting-wait") as HTMLInputElement;
    wait.value = "99";
    wait.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(panel.state.settings.autocompleteWaitSeconds).toBe(3);
  });

  it("saves the seconds for the two countdowns, clamped, and shows what is kept", async () => {
    const { root, panel, env } = await onSettings();
    const back = $(root, "#setting-returnSeconds") as HTMLInputElement;
    const next = $(root, "#setting-nextTrackSeconds") as HTMLInputElement;
    expect([back.value, next.value]).toEqual(["30", "0"]);

    back.value = "45";
    back.dispatchEvent(new Event("change", { bubbles: true }));
    next.value = "0";
    next.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(panel.state.settings).toMatchObject({ returnSeconds: 45, nextTrackSeconds: 0 });
    expect(env.settingsStore.data.get("settings")).toMatchObject({ returnSeconds: 45, nextTrackSeconds: 0 });

    back.value = "1";
    back.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(panel.state.settings.returnSeconds).toBe(5);
  });
});

describe("the automatic pasting settings", () => {
  async function onSettings() {
    const ui = await onReview();
    button(ui.root, "Settings").click();
    await flush();
    return ui;
  }

  const change = async (field: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> => {
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
  };

  it("shows the same automatic filling switch as the paste screen, ON by default, with 0.6 seconds between fields", async () => {
    const { root } = await onSettings();
    const toggle = $(root, "#setting-pasteMode");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.textContent).toBe("Auto-paste: ON");
    expect(toggle.getAttribute("data-state")).toBe("on");
    expect(toggle.classList.contains("magic")).toBe(true);
    expect($(toggle, ".sparkles").getAttribute("aria-hidden")).toBe("true");
    expect(($(root, "#setting-autoPace") as HTMLInputElement).value).toBe("0.6");
  });

  it("explains what ON and OFF mean for the user below the switch, and marks the one that is in force", async () => {
    const { root } = await onSettings();
    const help = $(root, "#setting-pasteMode-help");
    expect($(root, "#setting-pasteMode").getAttribute("aria-describedby")).toBe("setting-pasteMode-help");
    const [on, off] = [...help.querySelectorAll(".onoff")];
    expect(on?.querySelector("strong")?.textContent).toBe("ON");
    expect(on?.textContent).toContain("fills the whole track by itself");
    expect(on?.textContent).toContain("stops when you interact with the Genius form");
    expect(off?.querySelector("strong")?.textContent).toBe("OFF");
    expect(off?.textContent).toContain("each time you press F8");
    expect(on?.classList.contains("current")).toBe(true);
    expect(off?.classList.contains("current")).toBe(false);
  });

  it("turns automatic filling off and on from the switch, saving each, and the switch and the marked meaning follow", async () => {
    const { root, panel, env } = await onSettings();
    $(root, "#setting-pasteMode").click();
    await flush();
    expect(panel.state.settings.pasteMode).toBe("manual");
    expect(env.settingsStore.data.get("settings")).toMatchObject({ pasteMode: "manual" });
    const off = $(root, "#setting-pasteMode");
    expect(off.textContent).toBe("Auto-paste: OFF");
    expect(off.classList.contains("magic-off")).toBe(true);
    expect($(root, ".onoff.current strong").textContent).toBe("OFF");

    $(root, "#setting-pasteMode").click();
    await flush();
    expect(panel.state.settings.pasteMode).toBe("auto");
    expect($(root, ".onoff.current strong").textContent).toBe("ON");
  });

  it("gives every settings section its own labelled card with a heading, so each starts and ends in plain view", async () => {
    const { root } = await onSettings();
    const cards = [...root.querySelectorAll<HTMLElement>("section.settings-card")];
    expect(cards.map((card) => card.querySelector("h3")?.textContent)).toEqual([
      "What to paste",
      "Pasting on Genius",
      "Reading credits",
      "YouTube links",
      "Desktop app",
    ]);
    for (const card of cards) {
      const heading = card.querySelector("h3");
      expect(card.getAttribute("aria-labelledby"), heading?.textContent).toBe(heading?.id);
    }
  });

  it("groups the pasting settings under their own headings", async () => {
    const { root } = await onSettings();
    const card = $(root, 'section[aria-labelledby="settings-pasting"]');
    expect([...card.querySelectorAll(".subgroup > h4")].map((h) => h.textContent)).toEqual([
      "Keys",
      "When Genius has no exact match",
      "After a track",
    ]);
  });

  it("saves the pace, kept between 0.2 and 5 seconds", async () => {
    const { root, panel, env } = await onSettings();
    const pace = $(root, "#setting-autoPace") as HTMLInputElement;
    await change(pace, "1.5");
    expect(panel.state.settings.autoPaceSeconds).toBe(1.5);
    expect(env.settingsStore.data.get("settings")).toMatchObject({ autoPaceSeconds: 1.5 });
    await change(pace, "99");
    expect(panel.state.settings.autoPaceSeconds).toBe(5);
    await change(pace, "0");
    expect(panel.state.settings.autoPaceSeconds).toBe(0.2);
  });

  it("describes each field for a screen reader", async () => {
    const { root } = await onSettings();
    for (const id of ["setting-pasteMode", "setting-autoPace"]) {
      const help = $(root, `#${id}`).getAttribute("aria-describedby") ?? "";
      expect(root.querySelector(`#${help}`)?.textContent, id).toBeTruthy();
    }
  });
});

describe("the paste error box", () => {
  const attention = (env: { api: { pasteState: PasteState } }, message: string): PasteState => ({
    ...env.api.pasteState,
    tone: "attention",
    message,
  });

  it("shows above the step counter and plays its animation once per attempt, not on every redraw", async () => {
    const { root, env, panel } = await onPaste();
    expect(root.querySelector(".paste-error")).toBeNull();
    panel.setPaste(attention(env, "Genius has no field named Writer."));
    await flush();
    const box = $(root, ".paste-error");
    expect(box.textContent).toContain("Genius has no field named Writer.");
    expect(box.classList.contains("fresh")).toBe(true);
    expect(box.nextElementSibling?.classList.contains("progress")).toBe(true);
    panel.openSettings();
    panel.closeSettings();
    await flush();
    expect($(root, ".paste-error").classList.contains("fresh")).toBe(false);
    panel.setPaste(attention(env, "Genius has no field named Writer."));
    await flush();
    expect($(root, ".paste-error").classList.contains("fresh")).toBe(true);
  });
});
