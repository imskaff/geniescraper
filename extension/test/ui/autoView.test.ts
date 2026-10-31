import { afterEach, describe, expect, it } from "vitest";
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
const has = (root: ParentNode, selector: string): boolean => root.querySelector(selector) !== null;

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

afterEach(() => {
  document.body.replaceChildren();
});

describe("the ways to start pasting", () => {
  it("shows one plain yellow Start pasting button", async () => {
    const { root } = await onReview();
    const start = $(root, '[data-key="start"]');
    expect(start.textContent).toBe("Start pasting");
    expect(start.classList.contains("primary")).toBe(true);
    expect(start.classList.contains("magic")).toBe(false);
    expect(has(root, '[data-key="start-manual"]')).toBe(false);
    expect(has(root, '[data-key="start-auto"]')).toBe(false);
  });

  it("describes the selected paste mode beside the button", async () => {
    const { root } = await onReview();
    expect($(root, '[data-key="start"]').getAttribute("aria-label")).toBe(
      "Start pasting One automatically. It pauses when you interact with Genius.",
    );
    expect(root.textContent).toContain("Auto-paste is ON");
  });

  it("uses the selected automatic mode and shows the Auto-paste switch", async () => {
    const { root, env, panel } = await onReview();
    $(root, '[data-key="start"]').click();
    await flush();
    expect(env.api.calls.filter((c) => c.startsWith("paste:"))).toEqual([
      "paste:paste-start",
      "paste:paste-auto-start",
    ]);
    expect(panel.state.paste).toMatchObject({ active: true, auto: "running" });
    expect($(root, "h2").textContent).toMatch(/^Demo Artist - [A-Za-z]+$/);
    const toggle = $(root, '[data-key="auto-toggle"]');
    expect(toggle.textContent).toBe("Auto-paste: ON");
    expect(toggle.getAttribute("data-state")).toBe("on");
    expect(toggle.classList.contains("magic")).toBe(true);
    expect(toggle.classList.contains("primary")).toBe(true);
    expect(toggle.parentElement?.firstElementChild).toBe(toggle);
    expect(has(root, '[data-key="fill"]')).toBe(false);
    expect(root.textContent).toContain("Pasting automatically. Turn Auto-paste off to take over.");
    expect(root.textContent).not.toMatch(/Press F8 to add/);
  });

  it("uses the manual mode selected in Settings", async () => {
    const { root, env, panel } = await onReview({ settings: { pasteMode: "manual" } });
    $(root, '[data-key="start"]').click();
    await flush();
    expect(env.api.calls.filter((c) => c.startsWith("paste:"))).toEqual(["paste:paste-start"]);
    expect(panel.state.paste).toMatchObject({ active: true, auto: "off" });
    const toggle = $(root, '[data-key="auto-toggle"]');
    expect(toggle.textContent).toBe("Auto-paste: OFF");
    expect(toggle.getAttribute("data-state")).toBe("off");
    expect(toggle.classList.contains("magic-off")).toBe(true);
    expect(toggle.classList.contains("magic")).toBe(false);
    expect(toggle.parentElement?.firstElementChild).toBe(toggle);
    // Every manual control is secondary to it.
    for (const key of ["fill", "pback", "pskip"]) {
      expect($(root, `[data-key="${key}"]`).classList.contains("primary"), key).toBe(false);
    }
    expect($(root, '[data-key="fill"]').classList.contains("quiet")).toBe(true);
    expect(root.textContent).toContain("Auto-paste: OFF");
  });

  it("can turn Auto-paste on from the paste screen", async () => {
    const { root, panel } = await onReview({ settings: { pasteMode: "manual" } });
    $(root, '[data-key="start"]').click();
    await flush();
    $(root, '[data-key="auto-toggle"]').click();
    await flush();
    expect(panel.state.paste).toMatchObject({ auto: "running", position: 0 });
    expect($(root, '[data-key="auto-toggle"]').getAttribute("data-state")).toBe("on");
  });

  it("labels the Auto-paste switch with its current state and action", async () => {
    const { root } = await onReview({ settings: { pasteMode: "manual" } });
    $(root, '[data-key="start"]').click();
    await flush();
    const off = $(root, '[data-key="auto-toggle"]');
    expect(off.getAttribute("aria-label")).toBe("Auto-paste: OFF. Press to turn it on.");
    $(root, '[data-key="auto-toggle"]').click();
    await flush();
    const on = $(root, '[data-key="auto-toggle"]');
    expect(on.getAttribute("aria-label")).toBe("Auto-paste: ON. Press to turn it off and take over.");
  });
});

describe("when the user chose manual mode in Settings", () => {
  const manualDefault = { settings: { pasteMode: "manual" } };

  it("keeps one plain Start pasting button and explains the selected mode", async () => {
    const { root } = await onReview(manualDefault);
    const start = $(root, '[data-key="start"]');
    expect(start.classList.contains("magic")).toBe(false);
    expect(start.classList.contains("primary")).toBe(true);
    expect(start.textContent).toBe("Start pasting");
    expect(start.getAttribute("aria-label")).toBe("Start pasting One one field at a time using the selected hotkey.");
    expect(has(root, '[data-key="start-auto"]')).toBe(false);
    expect(root.textContent).toContain("Auto-paste is OFF");
  });

  it("Start pasting follows the saved mode", async () => {
    const first = await onReview(manualDefault);
    $(first.root, '[data-key="start"]').click();
    await flush();
    expect(first.env.api.calls.filter((c) => c.startsWith("paste:"))).toEqual(["paste:paste-start"]);

    const second = await onReview(manualDefault);
    $(second.root, '[data-key="start"]').click();
    await flush();
    expect(second.panel.state.paste.auto).toBe("off");
  });

  it("makes the next track follow that choice until the user starts one the other way", async () => {
    const { env, panel } = await onReview(manualDefault);
    await panel.startPaste(0);
    expect(env.api.calls).not.toContain("paste:paste-auto-start");
    await panel.startPaste(2, "auto");
    await panel.startPaste(0);
    expect(env.api.calls.filter((c) => c === "paste:paste-auto-start")).toHaveLength(2);
  });

  it("changing the setting changes what the next Fill automatically does", async () => {
    const { env, panel } = await onReview();
    await panel.setSetting("pasteMode", "manual");
    await panel.startPaste(0);
    expect(env.api.calls).not.toContain("paste:paste-auto-start");
    await panel.setSetting("pasteMode", "auto");
    await panel.startPaste(0);
    expect(env.api.calls).toContain("paste:paste-auto-start");
  });
});

describe("pausing and resuming", () => {
  async function running() {
    const ui = await onReview();
    $(ui.root, '[data-key="start"]').click();
    await flush();
    return ui;
  }

  it("turning automatic filling off pauses the run, and the toggle goes gray with one step on the Next key beside it", async () => {
    const { root, panel } = await running();
    $(root, '[data-key="auto-toggle"]').click();
    await flush();
    expect(panel.state.paste).toMatchObject({ auto: "paused", pauseReason: "user" });
    const toggle = $(root, '[data-key="auto-toggle"]');
    expect(toggle.textContent).toBe("Auto-paste: OFF");
    expect(toggle.classList.contains("magic-off")).toBe(true);
    expect(toggle.parentElement?.firstElementChild).toBe(toggle);
    expect($(root, '[data-key="fill"]').classList.contains("quiet")).toBe(true);
    expect(root.textContent).toMatch(/Press F8 to add/);
  });

  it("says why it paused, and how to carry on", async () => {
    const { root, panel } = await running();
    $(root, '[data-key="auto-toggle"]').click();
    await flush();
    expect($(root, "#status").textContent).toBe(panel.state.paste.message);
    expect($(root, "#status").textContent).toMatch(/Auto-paste/);
  });

  it("turning automatic filling back on carries on from the same step", async () => {
    const { root, panel } = await running();
    $(root, '[data-key="auto-toggle"]').click();
    await flush();
    $(root, '[data-key="auto-toggle"]').click();
    await flush();
    expect(panel.state.paste).toMatchObject({ auto: "running", position: 0, pauseReason: "" });
    expect($(root, '[data-key="auto-toggle"]').getAttribute("data-state")).toBe("on");
  });

  it("shows the toggle as off when a pause came from somewhere else, such as a click in the Genius form", async () => {
    const { root, env, panel } = await running();
    panel.setPaste({
      ...env.api.pasteState,
      auto: "paused",
      pauseReason: "input",
      message: "Paused because you used the form. Turn Auto-paste on to carry on.",
    });
    await flush();
    expect($(root, '[data-key="auto-toggle"]').getAttribute("data-state")).toBe("off");
    expect($(root, "#status").textContent).toContain("used the form");
  });

  it("Back pauses a running run, as taking over by hand does", async () => {
    const { root, env, panel } = await running();
    env.api.pasteState = { ...env.api.pasteState, position: 2 };
    panel.setPaste(env.api.pasteState);
    await flush();
    $(root, '[data-key="pback"]').click();
    await flush();
    expect(panel.state.paste).toMatchObject({ auto: "paused", position: 1 });
  });

  it("a step waiting for the user's choice is explained, with the run still going", async () => {
    const { root, env, panel } = await running();
    panel.setPaste({
      ...env.api.pasteState,
      awaiting: true,
      message: "Genius has no exact match for Writer One.",
      tone: "attention",
    });
    await flush();
    expect(panel.state.paste.auto).toBe("running");
    expect(root.textContent).toContain("Choose Writer One in Genius's suggestions. Automatic pasting carries on");
    expect($(root, '[aria-current="step"]').textContent).toContain("Waiting for you");
    expect($(root, '[data-key="auto-toggle"]').getAttribute("data-state")).toBe("on");
  });
});

describe("which way the next track goes", () => {
  it("follows the way the last one was started", async () => {
    const { env, panel } = await onReview();
    await panel.startPaste(0, "auto");
    await panel.startPaste(2);
    expect(env.api.calls.filter((c) => c === "paste:paste-auto-start")).toHaveLength(2);

    await panel.startPaste(0, "manual");
    env.api.calls.length = 0;
    await panel.startPaste(2);
    expect(env.api.calls).not.toContain("paste:paste-auto-start");
  });

  it("starts the next track by itself after the countdown when the last one ran by itself", async () => {
    const { env, panel } = await onReview();
    await panel.startPaste(0, "auto");
    env.api.calls.length = 0;
    await panel.startPaste(2);
    expect(env.api.calls).toEqual(expect.arrayContaining(["paste:paste-start", "paste:paste-auto-start"]));
    expect(panel.state.paste.auto).toBe("running");
  });
});

describe("when the extension's background part is older than the panel", () => {
  it("says to reload the extension, not that reading the page went wrong", async () => {
    const { root, panel } = await onReview({
      api: {
        paste: (command) =>
          Promise.resolve(
            command.type === "paste-auto-start"
              ? { ok: false, error: { code: "bad-request", message: "Unrecognised request." } }
              : {
                  ok: true,
                  data: { ...panel.state.paste, active: true, queue: [["written_by", "Writer One"]], title: "One" },
                },
          ),
      },
    });
    $(root, '[data-key="start"]').click();
    await flush();
    expect(panel.state.error).toContain("Reload");
    expect(panel.state.error).toContain("chrome://extensions");
    expect(panel.state.error).not.toContain("reading the page");
    // The session itself is fine: the user can still go step by step.
    expect(panel.state.paste.active).toBe(true);
  });
});

describe("when no Genius page can take the run", () => {
  it("says what to open, and leaves a step-by-step session the user can start automatically later", async () => {
    const { root, panel } = await onReview({
      api: {
        paste: (command) =>
          Promise.resolve(
            command.type === "paste-auto-start"
              ? {
                  ok: false,
                  error: { code: "tab-failed", message: "Open the song's Edit Metadata form on Genius first." },
                }
              : {
                  ok: true,
                  data: { ...panel.state.paste, active: true, queue: [["written_by", "Writer One"]], title: "One" },
                },
          ),
      },
    });
    $(root, '[data-key="start"]').click();
    await flush();
    expect(panel.state.paste.active).toBe(true);
    expect(panel.state.paste.auto).toBe("off");
    expect(root.textContent).toContain("Edit Metadata form on Genius");
    expect(has(root, '[data-key="auto-toggle"]')).toBe(true);
  });
});
