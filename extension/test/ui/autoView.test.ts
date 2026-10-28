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
  it("makes Start pasting the glowing automatic button, with Step by step beside it", async () => {
    const { root } = await onReview();
    const auto = $(root, '[data-key="start"]');
    expect(auto.classList.contains("magic")).toBe(true);
    expect(auto.classList.contains("primary")).toBe(true);
    const manual = $(root, '[data-key="start-manual"]');
    expect(manual.classList.contains("magic")).toBe(false);
    expect(manual.classList.contains("quiet")).toBe(true);
    expect(auto.nextElementSibling).toBe(manual);
  });

  it("keeps the automatic button's name and text plain: the sparkles are decoration", async () => {
    const { root } = await onReview();
    const auto = $(root, '[data-key="start"]');
    expect(auto.textContent).toBe("Start pasting");
    expect(auto.getAttribute("aria-label")).toBe("Start pasting One automatically");
    const sparkles = $(auto, ".sparkles");
    expect(sparkles.getAttribute("aria-hidden")).toBe("true");
    expect(sparkles.textContent).toBe("");
    expect($(root, '[data-key="start-manual"]').getAttribute("aria-label")).toBe(
      "Step by step: One, one key press per field",
    );
  });

  it("Start pasting starts the session and then the run, and the paste screen shows Pause", async () => {
    const { root, env, panel } = await onReview();
    $(root, '[data-key="start"]').click();
    await flush();
    expect(env.api.calls.filter((c) => c.startsWith("paste:"))).toEqual([
      "paste:paste-start",
      "paste:paste-auto-start",
    ]);
    expect(panel.state.paste).toMatchObject({ active: true, auto: "running" });
    expect($(root, "h2").textContent).toBe("Paste into Genius");
    expect($(root, '[data-key="auto-pause"]').textContent).toBe("Pause");
    expect(has(root, '[data-key="fill"]')).toBe(false);
    expect(has(root, ".magic")).toBe(false); // calm while it works: no glow, no sparkles
    expect(root.textContent).toContain("Pasting automatically. Press Pause to take over.");
    expect(root.textContent).not.toMatch(/Press F8 to add/);
  });

  it("Step by step starts only the session, and offers Fill next and the automatic button", async () => {
    const { root, env, panel } = await onReview();
    $(root, '[data-key="start-manual"]').click();
    await flush();
    expect(env.api.calls.filter((c) => c.startsWith("paste:"))).toEqual(["paste:paste-start"]);
    expect(panel.state.paste).toMatchObject({ active: true, auto: "off" });
    expect($(root, '[data-key="fill"]').classList.contains("primary")).toBe(true);
    const auto = $(root, '[data-key="auto-start"]');
    expect(auto.classList.contains("magic")).toBe(true);
    expect(auto.textContent).toBe("Auto-paste");
    expect(root.textContent).toMatch(/Press F8 to add/);
  });

  it("starts a run part-way through a step-by-step session from the paste screen", async () => {
    const { root, panel } = await onReview();
    $(root, '[data-key="start-manual"]').click();
    await flush();
    $(root, '[data-key="auto-start"]').click();
    await flush();
    expect(panel.state.paste).toMatchObject({ auto: "running", position: 0 });
    expect(has(root, '[data-key="auto-pause"]')).toBe(true);
  });
});

describe("pausing and resuming", () => {
  async function running() {
    const ui = await onReview();
    $(ui.root, '[data-key="start"]').click();
    await flush();
    return ui;
  }

  it("Pause pauses the run, and the screen offers Resume and one step with the Next key", async () => {
    const { root, panel } = await running();
    $(root, '[data-key="auto-pause"]').click();
    await flush();
    expect(panel.state.paste).toMatchObject({ auto: "paused", pauseReason: "user" });
    const resume = $(root, '[data-key="auto-resume"]');
    expect(resume.classList.contains("magic")).toBe(true);
    expect(resume.textContent).toBe("Resume");
    const fill = $(root, '[data-key="fill"]');
    expect(fill.classList.contains("quiet")).toBe(true);
    expect(root.textContent).toMatch(/Press F8 to add/);
    expect(has(root, '[data-key="auto-pause"]')).toBe(false);
  });

  it("says why it paused, and how to carry on", async () => {
    const { root, panel } = await running();
    $(root, '[data-key="auto-pause"]').click();
    await flush();
    expect($(root, "#status").textContent).toBe(panel.state.paste.message);
    expect($(root, "#status").textContent).toMatch(/Resume/);
  });

  it("Resume carries on from the same step", async () => {
    const { root, panel } = await running();
    $(root, '[data-key="auto-pause"]').click();
    await flush();
    $(root, '[data-key="auto-resume"]').click();
    await flush();
    expect(panel.state.paste).toMatchObject({ auto: "running", position: 0, pauseReason: "" });
    expect(has(root, '[data-key="auto-pause"]')).toBe(true);
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
    expect(has(root, '[data-key="auto-pause"]')).toBe(true);
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
    expect(has(root, '[data-key="auto-start"]')).toBe(true);
  });
});
