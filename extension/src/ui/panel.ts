// Panel entry point: wire the real worker, storage and tabs into the controller and mount the view.
import { createWorkerApi, chromeSend } from "./api";
import { PanelController, type Env } from "./controller";
import { PanelView } from "./view";
import { chromeStores } from "../shared/storage";

const env: Env = {
  api: createWorkerApi(chromeSend),
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
  // Follow the user to another tab or page, so the link box offers the page they are on.
  const refresh = (): void => {
    void panel.refreshPage();
  };
  chrome.tabs.onActivated.addListener(refresh);
  chrome.tabs.onUpdated.addListener((_tabId, change) => {
    if (change.url !== undefined || change.status === "complete") refresh();
  });
});
