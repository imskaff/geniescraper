// Content script injected on demand into open.spotify.com tabs. It answers the worker's requests with the in-page
// driver and returns every outcome, including failures, as data.
import type { Result } from "../shared/messages";
import { REAL_TIMING } from "./driver";
import { handleRequest } from "./handler";

declare global {
  interface Window {
    __geniescraperSpotify?: true;
  }
}

// Injection can happen more than once per tab (one per request); the listener must exist exactly once.
if (!window.__geniescraperSpotify) {
  window.__geniescraperSpotify = true;
  chrome.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse: (response: Result<unknown>) => void) => {
      // Only this extension's own worker may drive the page.
      if (sender.id !== chrome.runtime.id) return false;
      void handleRequest(message, document, REAL_TIMING).then(sendResponse);
      return true;
    },
  );
}
