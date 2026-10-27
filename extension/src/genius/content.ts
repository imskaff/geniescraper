// Content script for genius.com. It is idle until the worker says a paste session is running: only then do the
// hotkeys do anything, and it never presses Save or Cancel (see fill.ts for the rules it follows).
import { isGeniusNotice, isResult } from "../shared/messages";
import { normaliseSettings, SETTINGS_KEY } from "../shared/settings";
import { REAL_COMBOBOX_TIMING } from "./fill";
import { GeniusPage } from "./page";

declare global {
  interface Window {
    __geniescraperGenius?: true;
  }
}

// A page can be given this script more than once (navigation, reinstall); the listeners must exist exactly once.
if (!window.__geniescraperGenius) {
  window.__geniescraperGenius = true;

  const page = new GeniusPage({
    doc: document,
    send: (request) => chrome.runtime.sendMessage(request),
    timing: REAL_COMBOBOX_TIMING,
  });

  const applySettings = (raw: unknown): void => {
    const settings = normaliseSettings(raw);
    page.setHotkeys(settings.nextHotkey, settings.backHotkey);
  };
  chrome.storage.sync
    .get(SETTINGS_KEY)
    .then((items) => {
      applySettings(items[SETTINGS_KEY]);
    })
    .catch(() => undefined);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && SETTINGS_KEY in changes) applySettings(changes[SETTINGS_KEY].newValue);
  });

  // Capture phase, so Genius's own handlers never see a press that belongs to the paste session.
  window.addEventListener(
    "keydown",
    (event) => {
      page.onKeyDown(event);
    },
    true,
  );

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: unknown) => void) => {
    // Only this extension's own worker may drive the page.
    if (sender.id !== chrome.runtime.id || !isGeniusNotice(message)) return false;
    if (message.type === "genius/paste-active") page.setActive(message.active);
    else void page.next();
    sendResponse({ ok: true });
    return false;
  });

  // The page may have loaded while a session was already running.
  chrome.runtime
    .sendMessage({ type: "paste-status" })
    .then((answer: unknown) => {
      if (isResult(answer) && answer.ok) {
        const data = answer.data as { active?: unknown };
        page.setActive(data.active === true);
      }
    })
    .catch(() => undefined);
}
