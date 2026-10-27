// Service worker entry point. MV3 workers are ephemeral, so nothing here relies on in-memory state between
// requests: each request opens, reads and closes its own tab.
import type { Result } from "../shared/messages";
import { REAL_CLIENT_TIMING } from "./appleClient";
import { chromePorts } from "./ports";
import { createRouter } from "./router";

const route = createRouter(chromePorts(), REAL_CLIENT_TIMING);

// The toolbar button opens the side panel. The setting persists, so this is harmless on every worker start.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: Result<unknown>) => void) => {
  // Only this extension's own pages may ask. A content script or a web page never gets an answer.
  const own = sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL("")) === true;
  if (!own) return false;
  void route(message).then(sendResponse);
  return true;
});
