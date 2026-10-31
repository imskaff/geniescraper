// Service worker entry point. MV3 workers are ephemeral, so nothing here relies on in-memory state between
// requests: each request opens, reads and closes its own tab, and the paste session lives in storage.
import { isGeniusRequest, type Result } from "../shared/messages";
import { isBridgeRequest, type BridgeRequest } from "../shared/bridge";
import { PASTE_KEY, normalisePaste } from "../core/paste";
import { BridgeClient, type SocketLike } from "./bridge";
import { chromeStores } from "../shared/storage";
import { REAL_CLIENT_TIMING } from "./providerClient";
import { realCovers } from "./covers";
import { checkKey } from "../lookups/youtubeApi";
import { fetchJson, fetchResult } from "../lookups/http";
import { searchGenius } from "../lookups/genius";
import { createGeniusNavigator } from "./geniusNav";
import { loadYoutubeKey } from "../shared/secrets";
import { realYoutube } from "./youtube";
import { PROVIDERS } from "../providers/registry";
import { PasteService } from "./paste";
import { chromePorts } from "./ports";
import { INTERNAL_ERROR, createRouter } from "./router";

const ports = chromePorts();
const stores = chromeStores();
const paste = new PasteService(ports, stores);
// The companion link to the desktop app: it connects only after the user has paired it, and only to 127.0.0.1.
const bridge = new BridgeClient({
  openSocket: (url) => {
    const ws = new WebSocket(url);
    const socket: SocketLike = {
      send: (data) => {
        ws.send(data);
      },
      close: (code) => {
        ws.close(code);
      },
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    ws.onmessage = (event) => socket.onmessage?.({ data: event.data as unknown });
    ws.onclose = () => socket.onclose?.();
    ws.onerror = () => socket.onerror?.();
    return socket;
  },
  paste,
  local: {
    get: async (key: string): Promise<unknown> => (await chrome.storage.local.get(key))[key],
    set: (key: string, value: unknown): Promise<void> => chrome.storage.local.set({ [key]: value }),
  },
  session: stores.session,
  openTabs: async () => {
    // Only tabs showing a provider's site, which its host permission already covers; nothing else is listed or read.
    const [tabs, [inView]] = await Promise.all([
      chrome.tabs.query({ url: PROVIDERS.flatMap((provider) => [...provider.origins]) }),
      chrome.tabs.query({ active: true, currentWindow: true }),
    ]);
    return tabs.flatMap((tab) =>
      tab.id !== undefined && tab.url
        ? [{ tabId: tab.id, url: tab.url, title: tab.title ?? "", current: tab.id === inView?.id }]
        : [],
    );
  },
  randomHex: (bytes) =>
    [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join(""),
  setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimer: (id) => {
    clearTimeout(id);
  },
});
void bridge.start();
chrome.storage.session.onChanged.addListener((changes) => {
  const change = changes[PASTE_KEY];
  if (change) bridge.pushStatus(normalisePaste(change.newValue));
});
// The desktop app lists the Apple Music pages open here; follow the tabs the way the panel does.
const pagesChanged = (): void => {
  bridge.refreshPages();
};
chrome.tabs.onActivated.addListener(pagesChanged);
chrome.tabs.onRemoved.addListener(pagesChanged);
chrome.tabs.onUpdated.addListener((_tabId, change) => {
  if (change.url !== undefined || change.title !== undefined || change.status === "complete") pagesChanged();
});
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
  createGeniusNavigator(ports, stores, (title, artist) => searchGenius(fetchJson, title, artist)),
);

// The toolbar button opens the side panel. The setting persists, so this is harmless on every worker start.
// Browsers without a side panel (Safari) have no such API: the worker must still start there.
if ("sidePanel" in chrome) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

const GENIUS_ORIGIN = "https://genius.com";

async function handleBridge(request: BridgeRequest): Promise<Result<unknown>> {
  try {
    if (request.type === "bridge-pair") return await bridge.pair(request.code);
    if (request.type === "bridge-unpair") await bridge.unpair();
    else await bridge.start();
    return { ok: true, data: await bridge.link() };
  } catch {
    return INTERNAL_ERROR;
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: Result<unknown>) => void) => {
  if (sender.id !== chrome.runtime.id) return false;

  // The extension's own pages (the side panel) may ask for anything.
  if (sender.url?.startsWith(chrome.runtime.getURL("")) === true) {
    if (isBridgeRequest(message)) {
      void handleBridge(message).then(sendResponse);
      return true;
    }
    void route(message).then(sendResponse);
    return true;
  }
  // A Genius page may only drive the paste session, and only a content script of this extension on genius.com
  // (not a frame of another origin) counts as one.
  if (sender.origin === GENIUS_ORIGIN && sender.tab !== undefined && isGeniusRequest(message)) {
    // A Genius page talking to the worker proves the worker is awake: a good moment to reconnect to the desktop app.
    void bridge.start();
    void paste
      .fromGenius(message)
      .catch(() => INTERNAL_ERROR)
      .then(sendResponse);
    return true;
  }
  // Anything else, including the Apple Music content script, gets no answer.
  return false;
});

// The open side panel keeps a connection here; when it ends the panel was closed, and an automatic run pauses.
// Only this extension's own pages count, never a page of another origin.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "panel" || port.sender?.id !== chrome.runtime.id) return;
  if (port.sender.url?.startsWith(chrome.runtime.getURL("")) !== true) return;
  port.onDisconnect.addListener(() => {
    void paste.panelClosed();
  });
});
