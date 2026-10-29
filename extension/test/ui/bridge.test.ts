import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_POLL_MS, BRIDGE_MESSAGES, PanelController } from "../../src/ui/controller";
import { PanelView } from "../../src/ui/view";
import type { BridgeLinkState } from "../../src/shared/bridge";
import type { Result } from "../../src/shared/messages";
import { deferred, fakeEnv } from "./fakes";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

async function open(options: Parameters<typeof fakeEnv>[0] = {}) {
  const env = fakeEnv(options);
  const panel = await PanelController.create(env);
  panel.openSettings();
  await flush();
  return { env, panel };
}

const fail = (code: "bad-request" | "tab-failed", message: string): Result<BridgeLinkState> => ({
  ok: false,
  error: { code, message },
});

afterEach(() => {
  vi.useRealTimers();
});

describe("desktop app link: controller", () => {
  it("asks how the link stands when Settings opens, and starts as not paired", async () => {
    const { env, panel } = await open();
    expect(env.api.calls).toContain("bridge:bridge-status");
    expect(panel.state.bridge).toMatchObject({ known: true, paired: false, connected: false, busy: false });
  });

  it("pairs with a normalised code and reports success", async () => {
    const { env, panel } = await open();
    const seen: unknown[] = [];
    const inner = env.api.bridge.bind(env.api);
    env.api.bridge = (request) => {
      seen.push(request);
      return inner(request);
    };
    await panel.pairBridge("  abcd efgh ");
    expect(seen).toEqual([{ type: "bridge-pair", code: "ABCD-EFGH" }]);
    expect(panel.state.bridge).toMatchObject({ paired: true, connected: true, tone: "ok" });
    expect(panel.state.bridge.message).toBe(BRIDGE_MESSAGES.paired);
  });

  it.each(["", "ABCD", "ABCD-EFG", "ABCD-EFGHI", "ABCD-EF0H", "ABCD-EFGI"])(
    "refuses %j without asking the worker",
    async (code) => {
      const { env, panel } = await open();
      const before = env.api.calls.length;
      await panel.pairBridge(code);
      expect(env.api.calls).toHaveLength(before);
      expect(panel.state.bridge.tone).toBe("error");
      expect(panel.state.bridge.message).toBe(code.trim() ? BRIDGE_MESSAGES.badShape : BRIDGE_MESSAGES.empty);
    },
  );

  it("names every reason a refused code can have, with the ports and the five-try lock", async () => {
    const { panel } = await open({ api: { bridge: () => Promise.resolve(fail("tab-failed", "x")) } });
    await panel.pairBridge("ABCD-EFGH");
    const { message, tone, paired } = panel.state.bridge;
    expect(tone).toBe("error");
    expect(paired).toBe(false);
    expect(message).toContain("47831-47835");
    expect(message).toContain("5");
    expect(message).toMatch(/expires/);
    expect(message).toMatch(/new code/);
  });

  it("shows the worker's own words for a code it called malformed", async () => {
    const { panel } = await open({ api: { bridge: () => Promise.resolve(fail("bad-request", "Bad code.")) } });
    await panel.pairBridge("ABCD-EFGH");
    expect(panel.state.bridge.message).toBe("Bad code.");
  });

  it("ignores a second press while pairing is under way", async () => {
    const wait = deferred<Result<BridgeLinkState>>();
    const { env, panel } = await open();
    let asked = 0;
    env.api.bridge = () => {
      asked++;
      return wait.promise;
    };
    const first = panel.pairBridge("ABCD-EFGH");
    expect(panel.state.bridge.busy).toBe(true);
    await panel.pairBridge("ABCD-EFGH");
    expect(asked).toBe(1);
    wait.resolve({ ok: true, data: { paired: true, connected: false } });
    await first;
    expect(panel.state.bridge).toMatchObject({ busy: false, paired: true, connected: false });
  });

  it("unpairs and says so", async () => {
    const { env, panel } = await open();
    await panel.pairBridge("ABCD-EFGH");
    await panel.unpairBridge();
    expect(env.api.calls).toContain("bridge:bridge-unpair");
    expect(panel.state.bridge).toMatchObject({ paired: false, connected: false, tone: "ok" });
    expect(panel.state.bridge.message).toBe(BRIDGE_MESSAGES.unpaired);
  });

  it("follows the link while Settings is open, and stops when it closes", async () => {
    vi.useFakeTimers();
    const env = fakeEnv();
    const panel = await PanelController.create(env);
    panel.openSettings();
    await vi.advanceTimersByTimeAsync(0);
    env.api.link = { paired: true, connected: true };
    await vi.advanceTimersByTimeAsync(BRIDGE_POLL_MS);
    expect(panel.state.bridge).toMatchObject({ paired: true, connected: true });
    env.api.link = { paired: true, connected: false };
    await vi.advanceTimersByTimeAsync(BRIDGE_POLL_MS);
    expect(panel.state.bridge).toMatchObject({ paired: true, connected: false });
    panel.closeSettings();
    const calls = env.api.calls.length;
    await vi.advanceTimersByTimeAsync(BRIDGE_POLL_MS * 3);
    expect(env.api.calls).toHaveLength(calls);
  });

  it("keeps the last known state when a status check fails", async () => {
    vi.useFakeTimers();
    const env = fakeEnv();
    const panel = await PanelController.create(env);
    env.api.link = { paired: true, connected: true };
    panel.openSettings();
    await vi.advanceTimersByTimeAsync(0);
    env.api.bridge = () => Promise.resolve(fail("tab-failed", "gone"));
    await vi.advanceTimersByTimeAsync(BRIDGE_POLL_MS);
    expect(panel.state.bridge).toMatchObject({ paired: true, connected: true });
  });
});

describe("desktop app link: card", () => {
  async function mount(options: Parameters<typeof fakeEnv>[0] = {}) {
    document.body.replaceChildren();
    const root = document.createElement("div");
    document.body.append(root);
    const env = fakeEnv(options);
    const panel = await PanelController.create(env);
    new PanelView(root, panel);
    panel.openSettings();
    await flush();
    return { root, env, panel };
  }
  const q = (root: ParentNode, sel: string): HTMLElement => {
    const node = root.querySelector<HTMLElement>(sel);
    if (!node) throw new Error(`missing ${sel}`);
    return node;
  };
  const status = (root: ParentNode): string => q(root, "#bridge-status").textContent;
  const type = (root: ParentNode, text: string): void => {
    const input = q(root, "#bridge-code") as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("explains what pairing does and that Genius credentials are never shared", async () => {
    const { root } = await mount();
    const help = q(root, "#bridge-help").textContent;
    expect(help).toContain("127.0.0.1");
    expect(help).toMatch(/Genius (sign-in|password|credentials)/);
    expect(help).toMatch(/never/i);
  });

  it("labels the code box, ties it to its help, and offers Pair but not Unpair when not paired", async () => {
    const { root } = await mount();
    const input = q(root, "#bridge-code") as HTMLInputElement;
    expect(root.querySelector(`label[for="bridge-code"]`)?.textContent).toBe("Pairing code");
    expect(input.getAttribute("aria-describedby")).toContain("bridge-code-help");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(status(root)).toContain("Not paired");
    expect(root.querySelector('[data-key="bridge-unpair"]')).toBeNull();
  });

  it("has a Paste button inside the code box that fills it from the clipboard", async () => {
    const { root } = await mount();
    const field = q(root, ".field-action");
    expect(field.contains(q(root, "#bridge-code"))).toBe(true);
    expect(field.contains(q(root, '[data-key="bridge-paste"]'))).toBe(true);
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: () => Promise.resolve("  ABCD-EFGH \n") },
      configurable: true,
    });
    (q(root, '[data-key="bridge-paste"]') as HTMLButtonElement).click();
    await flush();
    expect((q(root, "#bridge-code") as HTMLInputElement).value).toBe("ABCD-EFGH");
  });

  it("says so when the clipboard is empty or the browser will not let it be read", async () => {
    const { root } = await mount();
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: () => Promise.resolve("   ") },
      configurable: true,
    });
    (q(root, '[data-key="bridge-paste"]') as HTMLButtonElement).click();
    await flush();
    expect(q(root, "#bridge-message").textContent).toContain("clipboard is empty");
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
    (q(root, '[data-key="bridge-paste"]') as HTMLButtonElement).click();
    await flush();
    expect(q(root, "#bridge-message").textContent).toContain("did not let the extension read the clipboard");
  });

  it("announces status through a status region and errors through an alert", async () => {
    const { root } = await mount();
    expect(q(root, "#bridge-status").getAttribute("aria-live")).toBe("polite");
    type(root, "nope");
    (q(root, '[data-key="bridge-pair"]') as HTMLButtonElement).click();
    await flush();
    expect(q(root, "#bridge-message").getAttribute("aria-live")).toBe("assertive");
    expect(q(root, "#bridge-message").textContent).toContain(BRIDGE_MESSAGES.badShape);
    expect(q(root, "#bridge-code").getAttribute("aria-invalid")).toBe("true");
  });

  it("pairs from the box and shows the connected state, then unpairs", async () => {
    const { root, env } = await mount();
    type(root, "abcdefgh");
    (q(root, '[data-key="bridge-pair"]') as HTMLButtonElement).click();
    await flush();
    expect(env.api.calls).toContain("bridge:bridge-pair");
    expect(status(root)).toContain("Paired and connected");
    expect((q(root, "#bridge-code") as HTMLInputElement).value).toBe("");
    (q(root, '[data-key="bridge-unpair"]') as HTMLButtonElement).click();
    await flush();
    expect(status(root)).toContain("Not paired");
  });

  it("submits on Enter in the box", async () => {
    const { root, env } = await mount();
    type(root, "ABCD-EFGH");
    q(root, "#bridge-code").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(env.api.calls).toContain("bridge:bridge-pair");
  });

  it("shows paired but desktop not running, and tells the user what to do", async () => {
    const { root } = await mount({
      api: { bridge: () => Promise.resolve({ ok: true, data: { paired: true, connected: false } }) },
    });
    expect(status(root)).toContain("Paired, desktop app not running");
    expect(status(root)).toMatch(/open/i);
  });

  it("keeps what was typed when the status refreshes", async () => {
    const { root, panel } = await mount();
    type(root, "ABCD-E");
    await panel.refreshBridge();
    expect((q(root, "#bridge-code") as HTMLInputElement).value).toBe("ABCD-E");
  });

  it("never builds the view with innerHTML", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "..", "src", "ui", "view.ts"), "utf-8");
    expect(src).not.toMatch(/innerHTML/);
  });
});
