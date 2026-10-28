// Service worker entry point. MV3 workers are ephemeral, so nothing here relies on in-memory state between
// requests: each request opens, reads and closes its own tab, and the paste session lives in storage.
import { isGeniusRequest, type Result } from "../shared/messages";
import { chromeStores } from "../shared/storage";
import { REAL_CLIENT_TIMING } from "./appleClient";
import { realCovers } from "./covers";
import { checkKey } from "../lookups/youtubeApi";
import { fetchResult } from "../lookups/http";
import { loadYoutubeKey } from "../shared/secrets";
import { realYoutube } from "./youtube";
import { PasteService } from "./paste";
import { chromePorts } from "./ports";
import { createRouter } from "./router";

const ports = chromePorts();
const paste = new PasteService(ports, chromeStores());
// The user's YouTube key sits in this browser's local storage (never the synced area).
const secrets = {
  get: async (key: string): Promise<unknown> => (await chrome.storage.local.get(key))[key],
  set: (key: string, value: unknown): Promise<void> => chrome.storage.local.set({ [key]: value }),
};
const route = createRouter(
  ports,
  REAL_CLIENT_TIMING,
  paste,
  realCovers(),
  realYoutube({ getKey: () => loadYoutubeKey(secrets) }),
  (key) => checkKey(fetchResult, key),
);

// The toolbar button opens the side panel. The setting persists, so this is harmless on every worker start.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

const GENIUS_ORIGIN = "https://genius.com";

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: Result<unknown>) => void) => {
  if (sender.id !== chrome.runtime.id) return false;

  // The extension's own pages (the side panel) may ask for anything.
  if (sender.url?.startsWith(chrome.runtime.getURL("")) === true) {
    void route(message).then(sendResponse);
    return true;
  }
  // A Genius page may only drive the paste session, and only a content script of this extension on genius.com
  // (not a frame of another origin) counts as one.
  if (sender.origin === GENIUS_ORIGIN && sender.tab !== undefined && isGeniusRequest(message)) {
    void paste.fromGenius(message).then(sendResponse);
    return true;
  }
  // Anything else, including the Apple Music content script, gets no answer.
  return false;
});
