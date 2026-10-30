// Content script for genius.com. It is idle until the worker says a paste session is running: only then do the
// hotkeys do anything, and it never presses Save or Cancel (see fill.ts for the rules it follows).
import { isGeniusNotice, isPasteStatus, isResult } from "../shared/messages";
import { normaliseSettings, SETTINGS_KEY } from "../shared/settings";
import { REAL_COMBOBOX_TIMING } from "./fill";
import { REAL_OPEN_EDIT_TIMING, openEditForm } from "./openEdit";
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

  // What counts as the user acting on the form during an automatic run. Only trusted events count (the page checks),
  // so the extension's own typing never pauses its own run.
  for (const type of ["mousedown", "keydown", "input"]) {
    window.addEventListener(
      type,
      (event) => {
        page.onUserActivity(event);
      },
      true,
    );
  }

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: unknown) => void) => {
    // Only this extension's own worker may drive the page.
    if (sender.id !== chrome.runtime.id || !isGeniusNotice(message)) return false;
    if (message.type === "genius/open-edit") {
      // The one answer that takes a while: the page may still be loading its button.
      void openEditForm(document, REAL_OPEN_EDIT_TIMING).then((state) => {
        sendResponse({ ok: true, data: { state } });
      });
      return true;
    }
    if (message.type === "genius/paste-active") page.setActive(message.active);
    else if (message.type === "genius/auto-state") page.setAuto(message.auto);
    else if (message.type === "genius/clear") page.clearStep(message.item, message.role);
    else void page.next();
    sendResponse({ ok: true });
    return false;
  });

  // The page may have loaded while a session was already running.
  chrome.runtime
    .sendMessage({ type: "paste-status" })
    .then((answer: unknown) => {
      if (isResult(answer) && answer.ok && isPasteStatus(answer.data)) {
        page.setActive(answer.data.active);
        // A page that loads under a running automatic run was reloaded or navigated: it never resumes by itself, the
        // user presses Resume once the song's edit form is open again.
        if (answer.data.auto === "running") page.pauseFromPage("page-changed");
      }
    })
    .catch(() => undefined);
}
