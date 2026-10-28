// Panel entry point: wire the real worker, storage and tabs into the controller and mount the view.
import { createWorkerApi, chromeSend } from "./api";
import { PanelController, type Env, type HostPermissions } from "./controller";
import { OPTIONAL_LOOKUP_HOSTS, hostOrigin, type OptionalHost } from "../lookups/http";
import { PanelView } from "./view";
import { PASTE_KEY, normalisePaste } from "../core/paste";
import { chromeStores } from "../shared/storage";

const HOSTS = Object.keys(OPTIONAL_LOOKUP_HOSTS) as OptionalHost[];

const hosts: HostPermissions = {
  async granted() {
    const entries = await Promise.all(
      HOSTS.map(async (host) => [host, await chrome.permissions.contains({ origins: [hostOrigin(host)] })] as const),
    );
    return Object.fromEntries(entries) as Record<OptionalHost, boolean>;
  },
  request: (host) => chrome.permissions.request({ origins: [hostOrigin(host)] }),
  remove: (host) => chrome.permissions.remove({ origins: [hostOrigin(host)] }),
  subscribe(listener) {
    chrome.permissions.onAdded.addListener(listener);
    chrome.permissions.onRemoved.addListener(listener);
  },
};

const env: Env = {
  api: createWorkerApi(chromeSend),
  hosts,
  stores: chromeStores(),
  // The YouTube key stays in this browser: local storage, never the synced area.
  secrets: {
    get: async (key) => (await chrome.storage.local.get(key))[key],
    set: (key, value) => chrome.storage.local.set({ [key]: value }),
  },
  async activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id !== undefined && tab.url ? { tabId: tab.id, url: tab.url } : null;
  },
  async appleTabs() {
    // The extension already has access to Apple Music, so Chrome lists these tabs with their addresses and titles.
    const [tabs, [inView]] = await Promise.all([
      chrome.tabs.query({ url: "https://music.apple.com/*" }),
      chrome.tabs.query({ active: true, currentWindow: true }),
    ]);
    return tabs.flatMap((tab) =>
      tab.id !== undefined && tab.url
        ? [{ tabId: tab.id, url: tab.url, title: tab.title ?? "", current: tab.id === inView?.id }]
        : [],
    );
  },
};

const root = document.getElementById("app");
if (!root) throw new Error("The panel page has no #app element.");

/**
 * An open panel holds a connection to the worker. When the panel closes the worker sees it end and pauses an automatic
 * run, since nobody is watching it. If the worker is stopped and restarted meanwhile (it idles out), the connection
 * ends from this side too, so the panel connects again: it is still open, and a later close must still be noticed.
 */
function keepConnected(): void {
  let leaving = false;
  addEventListener("pagehide", () => {
    leaving = true;
  });
  const connect = (): void => {
    const port = chrome.runtime.connect({ name: "panel" });
    port.onDisconnect.addListener(() => {
      if (!leaving) setTimeout(connect, 1000);
    });
  };
  connect();
}
keepConnected();

void PanelController.create(env).then((panel) => {
  new PanelView(root, panel);
  // The worker is the paste session's only writer; this panel just follows what it stores.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && PASTE_KEY in changes) panel.setPaste(normalisePaste(changes[PASTE_KEY].newValue));
  });
  // Follow the user to another tab or page, so the link box offers the page they are on.
  const refresh = (): void => {
    void panel.refreshPage();
  };
  chrome.tabs.onActivated.addListener(refresh);
  chrome.tabs.onRemoved.addListener(refresh);
  chrome.tabs.onUpdated.addListener((_tabId, change) => {
    if (change.url !== undefined || change.status === "complete") refresh();
  });
});
