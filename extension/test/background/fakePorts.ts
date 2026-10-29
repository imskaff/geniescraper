import type { BrowserPorts, TabState } from "../../src/background/ports";
import type { ClientTiming } from "../../src/background/appleClient";
import type { AlbumInfo, ContentRequest, GeniusNotice, PageScrape } from "../../src/shared/messages";

export const FAST_CLIENT: ClientTiming = { tabLoadMs: 200, requestMs: 100, pollMs: 5 };

export const ALBUM_URL = "https://music.apple.com/us/album/the-tortured-poets-department/1736268215";
export const SONG_URL = "https://music.apple.com/us/song/fortnight/1736268220";

export const ALBUM_INFO: AlbumInfo = {
  url: ALBUM_URL,
  albumTitle: "TTPD",
  artist: "Taylor Swift",
  trackCount: 2,
  trackTitles: ["Fortnight", "The Tortured Poets Department"],
  trackUrls: [SONG_URL, ""],
  phonographicCopyright: "℗ 2024 Taylor Swift",
  copyrightNotice: "",
  coverArtUrl: "",
  releaseDate: "2024-04-19",
};

export const PAGE_SCRAPE: PageScrape = {
  title: "Fortnight",
  artist: "Taylor Swift",
  credits: [{ role: "Songwriter", artists: ["Taylor Swift"] }],
  coverArtUrl: "",
  releaseDate: "2024-04-19",
  warnings: [],
};

export interface FakeBehaviour {
  /** Polls that report "loading" before a tab reports "complete". */
  loadingPolls?: number;
  neverLoads?: boolean;
  /** Tabs report as closed from the first poll on. */
  tabGone?: boolean;
  createFails?: boolean;
  injectFails?: boolean;
  /** Answer to a content request; defaults to a successful answer with the matching sample data. */
  answer?: (request: ContentRequest) => Promise<unknown>;
  /** Tabs that exist before the test starts, as the user's own tabs. */
  userTabs?: Record<number, TabState>;
  /** Genius tabs: id and whether it is the one the user is looking at. */
  geniusTabs?: { id: number; active: boolean }[];
  /** Genius tabs that cannot receive notices (no content script loaded). */
  deaf?: number[];
}

export interface FakeBrowser {
  ports: BrowserPorts;
  /** Ordered record of every call, for example "create:https://...", "remove:1". */
  log: string[];
  openTabs: Set<number>;
  maxOpenTabs: () => number;
  keepAliveActive: () => number;
  /** Notices delivered to Genius tabs, as `tabId:type[:detail]`. */
  notices: string[];
}

export function fakeBrowser(behaviour: FakeBehaviour = {}): FakeBrowser {
  const log: string[] = [];
  const openTabs = new Set<number>();
  const polls = new Map<number, number>();
  const userTabs = new Map(Object.entries(behaviour.userTabs ?? {}).map(([id, tab]) => [Number(id), tab]));
  let nextId = 1000;
  let peak = 0;
  let keepAlive = 0;
  const notices: string[] = [];

  const defaultAnswer = (request: ContentRequest): Promise<unknown> =>
    Promise.resolve({ ok: true, data: request.type === "apple/detect" ? ALBUM_INFO : PAGE_SCRAPE });

  const ports: BrowserPorts = {
    createTab(url, active) {
      log.push(`create:${url}:active=${String(active)}`);
      if (behaviour.createFails) return Promise.reject(new Error("tabs.create failed"));
      const id = nextId++;
      openTabs.add(id);
      peak = Math.max(peak, openTabs.size);
      return Promise.resolve(id);
    },
    getTab(tabId) {
      const user = userTabs.get(tabId);
      if (user) return Promise.resolve(user);
      if (behaviour.tabGone || !openTabs.has(tabId)) return Promise.resolve(null);
      const count = (polls.get(tabId) ?? 0) + 1;
      polls.set(tabId, count);
      const loaded = !behaviour.neverLoads && count > (behaviour.loadingPolls ?? 0);
      return Promise.resolve({ status: loaded ? "complete" : "loading", url: "" });
    },
    removeTab(tabId) {
      log.push(`remove:${String(tabId)}`);
      openTabs.delete(tabId);
      return Promise.resolve();
    },
    injectContentScript(tabId) {
      log.push(`inject:${String(tabId)}`);
      return behaviour.injectFails
        ? Promise.reject(new Error("Cannot access contents of the page."))
        : Promise.resolve();
    },
    sendMessage(tabId, message) {
      log.push(`send:${String(tabId)}:${message.type}`);
      return (behaviour.answer ?? defaultAnswer)(message);
    },
    geniusTabIds() {
      return Promise.resolve((behaviour.geniusTabs ?? []).map((tab) => tab.id));
    },
    activeGeniusTab() {
      return Promise.resolve((behaviour.geniusTabs ?? []).find((tab) => tab.active)?.id ?? null);
    },
    notifyGenius(tabId, notice: GeniusNotice) {
      if (behaviour.deaf?.includes(tabId)) return Promise.resolve(false);
      notices.push(
        `${String(tabId)}:${notice.type}${
          notice.type === "genius/paste-active"
            ? `:${String(notice.active)}`
            : notice.type === "genius/auto-state"
              ? `:${notice.auto}`
              : notice.type === "genius/clear"
                ? `:${notice.item[0]}:${notice.item[1]}${notice.role === undefined ? "" : `@${notice.role}`}`
                : ""
        }`,
      );
      return Promise.resolve(true);
    },
    keepAlive() {
      keepAlive++;
      return () => {
        keepAlive--;
      };
    },
  };

  return { ports, log, openTabs, maxOpenTabs: () => peak, keepAliveActive: () => keepAlive, notices };
}
