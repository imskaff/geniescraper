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
  async activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id !== undefined && tab.url ? { tabId: tab.id, url: tab.url } : null;
  },
};

const root = document.getElementById("app");
if (!root) throw new Error("The panel page has no #app element.");

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
  chrome.tabs.onUpdated.addListener((_tabId, change) => {
    if (change.url !== undefined || change.status === "complete") refresh();
  });
});
