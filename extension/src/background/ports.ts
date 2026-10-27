// The slice of the chrome.* API the worker uses, behind an interface so tests can fake it.
// Nothing here needs the "tabs" permission: tabs.create and tabs.remove are unrestricted, and the host
// permission for music.apple.com is what lets the worker read the URL of an Apple Music tab.
import type { ContentRequest } from "../shared/messages";

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
  /** Inject the Apple Music content script (idempotent in the page). */
  injectContentScript(tabId: number): Promise<void>;
  sendMessage(tabId: number, message: ContentRequest): Promise<unknown>;
  /** Keep the service worker alive while work is in flight; returns the function that stops it. */
  keepAlive(): () => void;
}

export const CONTENT_SCRIPT_FILE = "apple/content.js";
const KEEP_ALIVE_MS = 20_000;

export function chromePorts(): BrowserPorts {
  return {
    async createTab(url, active) {
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
    async injectContentScript(tabId) {
      await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
    },
    sendMessage(tabId, message) {
      return chrome.tabs.sendMessage(tabId, message);
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
