import { afterEach, describe, expect, it, vi } from "vitest";
import { chromePorts } from "../../src/background/ports";

interface Calls {
  windows: unknown[];
  tabs: unknown[];
  removed: number[];
}

function stubChrome(options: { windowsCreate?: () => Promise<unknown>; tabId?: number | undefined } = {}): Calls {
  const calls: Calls = { windows: [], tabs: [], removed: [] };
  vi.stubGlobal("chrome", {
    windows: {
      remove: (id: number) => {
        calls.removed.push(id);
        return Promise.resolve();
      },
      create: (info: unknown) => {
        calls.windows.push(info);
        return (options.windowsCreate ?? (() => Promise.resolve({ tabs: [{ id: 11 }] })))();
      },
    },
    tabs: {
      create: (info: unknown) => {
        calls.tabs.push(info);
        return Promise.resolve({ id: options.tabId === undefined ? 22 : options.tabId });
      },
    },
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("opening a page to read", () => {
  it("opens a background read in a minimized window of its own, so no tab joins the user's tab strip", async () => {
    const calls = stubChrome();
    expect(await chromePorts().createTab("https://music.apple.com/x", false)).toBe(11);
    expect(calls.windows).toEqual([{ url: "https://music.apple.com/x", state: "minimized", focused: false }]);
    expect(calls.tabs).toEqual([]);
  });

  it("falls back to a background tab when the browser will not make a window", async () => {
    const calls = stubChrome({ windowsCreate: () => Promise.reject(new Error("no windows here")) });
    expect(await chromePorts().createTab("https://music.apple.com/x", false)).toBe(22);
    expect(calls.tabs).toEqual([{ url: "https://music.apple.com/x", active: false }]);
  });

  it.each([undefined, {}, { tabs: [] }, { tabs: [{}] }])(
    "falls back to a tab when the window has no tab id (%j)",
    async (win) => {
      const calls = stubChrome({ windowsCreate: () => Promise.resolve(win) });
      expect(await chromePorts().createTab("https://music.apple.com/x", false)).toBe(22);
      expect(calls.tabs).toHaveLength(1);
    },
  );

  it("closes a window it made but cannot use before falling back to a tab, so none is left behind", async () => {
    const calls = stubChrome({ windowsCreate: () => Promise.resolve({ id: 77, tabs: [] }) });
    expect(await chromePorts().createTab("https://music.apple.com/x", false)).toBe(22);
    expect(calls.removed).toEqual([77]);
    expect(calls.tabs).toHaveLength(1);
  });

  it("opens a tab, never a window, when the page is meant to be seen", async () => {
    const calls = stubChrome();
    expect(await chromePorts().createTab("https://genius.com/x", true)).toBe(22);
    expect(calls.windows).toEqual([]);
    expect(calls.tabs).toEqual([{ url: "https://genius.com/x", active: true }]);
  });

  it("says so when the browser gives back no id at all", async () => {
    stubChrome({ windowsCreate: () => Promise.reject(new Error("x")), tabId: undefined });
    vi.stubGlobal("chrome", {
      windows: { create: () => Promise.reject(new Error("x")) },
      tabs: { create: () => Promise.resolve({}) },
    });
    await expect(chromePorts().createTab("https://music.apple.com/x", false)).rejects.toThrow(
      "did not return a tab id",
    );
  });
});
