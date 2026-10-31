// The slice of the chrome.* API the worker uses, behind an interface so tests can fake it.
// Nothing here needs the "tabs" permission: tabs.create and tabs.remove are unrestricted, and the host
// permission for music.apple.com is what lets the worker read the URL of an Apple Music tab.
import type { ContentRequest, GeniusNotice } from "../shared/messages";

export interface TabState {
  status: "loading" | "complete";
  url: string;
}

export interface BrowserPorts {
  /** Open a tab without focusing it; returns its id. */
  createTab(url: string, active: boolean): Promise<number>;
  /** Current state of a tab, or null when it no longer exists. */
  getTab(tabId: number): Promise<TabState | null>;
  removeTab(tabId: number): Promise<void>;
  /** Inject a provider's content script, Apple Music's by default (idempotent in the page). */
  injectContentScript(tabId: number, file?: string): Promise<void>;
  sendMessage(tabId: number, message: ContentRequest): Promise<unknown>;
  /** Tabs showing genius.com, so a paste session can tell them it started or ended. */
  geniusTabIds(): Promise<number[]>;
  /** The genius.com tab the user is looking at in their current window, or null. */
  activeGeniusTab(): Promise<number | null>;
  /** Tell a Genius tab something; resolves false when nothing there is listening. */
  notifyGenius(tabId: number, notice: GeniusNotice): Promise<boolean>;
  /** Tabs showing genius.com with their addresses (readable through the host permission). */
  geniusTabs(): Promise<{ id: number; url: string }[]>;
  /** Bring a tab, and its window, to the front. */
  focusTab(tabId: number): Promise<void>;
  /** Ask a Genius tab something and wait for its answer; resolves undefined when nothing there is listening. */
  askGenius(tabId: number, notice: GeniusNotice): Promise<unknown>;
  /** Keep the service worker alive while work is in flight; returns the function that stops it. */
  keepAlive(): () => void;
}

export const CONTENT_SCRIPT_FILE = "apple/content.js";
const KEEP_ALIVE_MS = 20_000;
const GENIUS_MATCH = "https://genius.com/*";

export function chromePorts(): BrowserPorts {
  return {
    async createTab(url, active) {
      if (!active) {
        // A background read gets a window of its own, minimized, so no tab appears in the user's tab strip. The
        // window closes with its only tab. If the browser will not make one, a background tab does the same job.
        try {
          const win = await chrome.windows.create({ url, state: "minimized", focused: false });
          const id = win?.tabs?.[0]?.id;
          if (id !== undefined) return id;
          // A window with no tab id we can use would stay open with nobody to close it: close it before falling back.
          if (win?.id !== undefined) await chrome.windows.remove(win.id).catch(() => undefined);
        } catch {
          // fall through to a tab
        }
      }
      const tab = await chrome.tabs.create({ url, active });
      if (tab.id === undefined) throw new Error("The browser did not return a tab id.");
      return tab.id;
    },
    async getTab(tabId) {
      try {
        const tab = await chrome.tabs.get(tabId);
        return { status: tab.status === "complete" ? "complete" : "loading", url: tab.url ?? "" };
      } catch {
        return null;
      }
    },
    async removeTab(tabId) {
      await chrome.tabs.remove(tabId);
    },
    async injectContentScript(tabId, file = CONTENT_SCRIPT_FILE) {
      await chrome.scripting.executeScript({ target: { tabId }, files: [file], injectImmediately: true });
    },
    sendMessage(tabId, message) {
      return chrome.tabs.sendMessage(tabId, message);
    },
    async geniusTabIds() {
      const tabs = await chrome.tabs.query({ url: GENIUS_MATCH });
      return tabs.flatMap((tab) => (tab.id === undefined ? [] : [tab.id]));
    },
    async activeGeniusTab() {
      const [tab] = await chrome.tabs.query({ url: GENIUS_MATCH, active: true, lastFocusedWindow: true });
      return tab?.id ?? null;
    },
    async notifyGenius(tabId, notice) {
      try {
        await chrome.tabs.sendMessage(tabId, notice);
        return true;
      } catch {
        return false;
      }
    },
    async geniusTabs() {
      const tabs = await chrome.tabs.query({ url: GENIUS_MATCH });
      return tabs.flatMap((tab) => (tab.id === undefined ? [] : [{ id: tab.id, url: tab.url ?? "" }]));
    },
    async focusTab(tabId) {
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    },
    async askGenius(tabId, notice) {
      try {
        return (await chrome.tabs.sendMessage(tabId, notice)) as unknown;
      } catch {
        return undefined;
      }
    },
    keepAlive() {
      // MV3 stops an idle worker after about 30 seconds; an extension API call resets that timer.
      const timer = setInterval(() => void chrome.runtime.getPlatformInfo(), KEEP_ALIVE_MS);
      return () => {
        clearInterval(timer);
      };
    },
  };
}
