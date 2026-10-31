import { IDLE_PASTE, back, pauseAuto, skip, startAuto, startPaste, stop, type PasteState } from "../../src/core/paste";
import type { BridgeLinkState, BridgeRequest } from "../../src/shared/bridge";
import type {
  AlbumInfo,
  GeniusOpenAnswer,
  PageScrape,
  PasteCommand,
  KeyCheck,
  Result,
  YoutubeAnswer,
} from "../../src/shared/messages";
import type { KeyValueStore, Stores } from "../../src/shared/storage";
import type { WorkerApi } from "../../src/ui/api";
import type { OptionalHost } from "../../src/lookups/http";
import type { OpenTab } from "../../src/core/musicTabs";
import type { ActiveTab, Env, HostPermissions, SourcePermissions } from "../../src/ui/controller";

export function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: (key) => Promise.resolve(data.get(key)),
    set: (key, value) => {
      data.set(key, structuredClone(value));
      return Promise.resolve();
    },
  };
}

const SONG = (slug: string, id: number): string => `https://music.apple.com/us/song/${slug}/${String(id)}`;

/** Three tracks; the second has no song page. */
export const ALBUM: AlbumInfo = {
  url: "https://music.apple.com/us/album/demo/100",
  albumTitle: "Demo Album",
  artist: "Demo Artist",
  trackCount: 3,
  trackTitles: ["One", "Two", "Three"],
  trackUrls: [SONG("one", 1), "", SONG("three", 3)],
  phonographicCopyright: "℗ 2024 Demo Records",
  copyrightNotice: "© 2024 Demo Publishing",
  coverArtUrl: "https://example.com/album-cover.png",
  releaseDate: "2024-05-21",
};

export const SINGLE: AlbumInfo = {
  ...ALBUM,
  url: "https://music.apple.com/us/album/single/200",
  albumTitle: "Single",
  trackCount: 1,
  trackTitles: ["Single"],
  trackUrls: [SONG("single", 9)],
};

export function scrapeFor(title: string): PageScrape {
  return {
    title,
    artist: "Demo Artist",
    credits: [
      { role: "Songwriter", artists: ["Writer One", "Writer Two"] },
      { role: "Producer", artists: ["Producer One"] },
      { role: "Mixing Engineer", artists: ["Mixer One"] },
    ],
    coverArtUrl: "",
    releaseDate: "2024-05-17",
    warnings: [],
  };
}

export interface FakeApi extends WorkerApi {
  calls: string[];
  /** The paste session the fake worker holds. */
  pasteState: PasteState;
  /** The link the fake worker holds; change it to simulate the desktop app coming or going. */
  link: BridgeLinkState;
}

const NO_LINK: YoutubeAnswer = { url: "", isMusicVideo: false, throttled: false, keyProblem: "" };

export interface ApiScript {
  detect?: (url: string, tabId?: number) => Promise<Result<AlbumInfo>>;
  scrapeTrack?: (url: string, title: string) => Promise<Result<PageScrape>>;
  lookupYoutube?: (title: string, artist: string) => Promise<Result<YoutubeAnswer>>;
  checkYoutubeKey?: (key: string) => Promise<Result<KeyCheck>>;
  paste?: (command: PasteCommand) => Promise<Result<PasteState>>;
  bridge?: (request: BridgeRequest) => Promise<Result<BridgeLinkState>>;
  openOnGenius?: (title: string, artist: string) => Promise<Result<GeniusOpenAnswer>>;
}

export function fakeApi(script: ApiScript = {}): FakeApi {
  const calls: string[] = [];
  const api: FakeApi = {
    calls,
    pasteState: { ...IDLE_PASTE },
    link: { paired: false, connected: false },
    openOnGenius(title, artist) {
      calls.push(`genius-open:${artist}|${title}`);
      if (script.openOnGenius) return script.openOnGenius(title, artist);
      return Promise.resolve({ ok: true, data: { status: "opened" } });
    },
    bridge(request) {
      calls.push(`bridge:${request.type}`);
      if (script.bridge) return script.bridge(request);
      if (request.type === "bridge-pair") api.link = { paired: true, connected: true };
      if (request.type === "bridge-unpair") api.link = { paired: false, connected: false };
      return Promise.resolve({ ok: true, data: { ...api.link } });
    },
    paste(command) {
      calls.push(`paste:${command.type}`);
      if (script.paste) return script.paste(command);
      switch (command.type) {
        case "paste-start":
          api.pasteState = startPaste(command.title, command.queue as PasteState["queue"]);
          break;
        case "paste-back":
          api.pasteState = back(api.pasteState);
          break;
        case "paste-skip":
          api.pasteState = skip(api.pasteState);
          break;
        case "paste-stop":
          api.pasteState = stop(api.pasteState);
          break;
        case "paste-auto-start":
          api.pasteState = startAuto(api.pasteState);
          break;
        case "paste-auto-pause":
          api.pasteState = pauseAuto(api.pasteState, "user");
          break;
        case "paste-fill":
          break;
      }
      return Promise.resolve({ ok: true, data: api.pasteState });
    },
    detect(url, tabId) {
      calls.push(`detect:${url}:${String(tabId)}`);
      return (script.detect ?? (() => Promise.resolve({ ok: true, data: ALBUM } as const)))(url, tabId);
    },
    checkYoutubeKey(key) {
      calls.push("key-check");
      return (script.checkYoutubeKey ?? (() => Promise.resolve({ ok: true, data: "ok" } as const)))(key);
    },
    lookupYoutube(title, artist) {
      calls.push(`youtube:${artist} / ${title}`);
      return (script.lookupYoutube ?? (() => Promise.resolve({ ok: true, data: NO_LINK } as const)))(title, artist);
    },
    scrapeTrack(url, title) {
      calls.push(`scrape:${url}`);
      return (script.scrapeTrack ?? ((_url, t) => Promise.resolve({ ok: true, data: scrapeFor(t) } as const)))(
        url,
        title,
      );
    },
  };
  return api;
}

export interface FakeHosts extends HostPermissions {
  state: Record<OptionalHost, boolean>;
  log: string[];
  /** What Chrome's prompt will answer; a refusal leaves the host off. */
  allow: boolean;
  /** Change a permission from outside, as chrome://extensions does, and tell the listeners. */
  changeElsewhere(host: OptionalHost, on: boolean): void;
}

export function fakeHosts(initial: Partial<Record<OptionalHost, boolean>> = {}): FakeHosts {
  const listeners: (() => void)[] = [];
  const hosts: FakeHosts = {
    state: { deezer: false, youtube: false, youtubeApi: false, ...initial },
    log: [],
    allow: true,
    granted: () => Promise.resolve({ ...hosts.state }),
    request(host) {
      hosts.log.push(`request:${host}`);
      if (hosts.allow) hosts.state[host] = true;
      return Promise.resolve(hosts.allow);
    },
    remove(host) {
      hosts.log.push(`remove:${host}`);
      hosts.state[host] = false;
      return Promise.resolve(true);
    },
    subscribe: (listener) => {
      listeners.push(listener);
    },
    changeElsewhere(host, on) {
      hosts.state[host] = on;
      listeners.forEach((listener) => {
        listener();
      });
    },
  };
  return hosts;
}

export interface FakeEnv extends Env {
  /** The Apple Music tabs the browser has open; change it to simulate the user opening or closing pages. */
  openTabs: OpenTab[];
  api: FakeApi;
  hosts: FakeHosts;
  sources: FakeSources;
  settingsStore: ReturnType<typeof memoryStore>;
  secretsStore: ReturnType<typeof memoryStore>;
  sessionStore: ReturnType<typeof memoryStore>;
}

export interface FakeSources extends SourcePermissions {
  log: string[];
  state: Record<string, boolean>;
}

export function fakeEnv(
  options: {
    api?: ApiScript;
    tab?: ActiveTab | null;
    openTabs?: OpenTab[];
    settings?: unknown;
    session?: unknown;
    hosts?: Partial<Record<OptionalHost, boolean>>;
    youtubeKey?: string;
    /** Start with an empty settings store, as a new user's browser has, so the set-up shows. */
    firstRun?: boolean;
    /** Which sources the user has allowed; Spotify is allowed unless a test says otherwise. */
    sources?: { spotify?: boolean; allow?: boolean };
  } = {},
): FakeEnv {
  // Tests start past the first-time set-up unless they ask for it: a store with nothing in it would show it.
  const settingsStore = memoryStore(
    options.firstRun ? {} : { settings: options.settings === undefined ? { onboarded: true } : options.settings },
  );
  const sessionStore = memoryStore(options.session === undefined ? {} : { session: options.session });
  const stores: Stores = { settings: settingsStore, session: sessionStore };
  const secretsStore = memoryStore(options.youtubeKey === undefined ? {} : { youtubeApiKey: options.youtubeKey });
  const sourceState: Record<string, boolean> = { apple: true, spotify: options.sources?.spotify ?? true };
  const sources: FakeSources = {
    log: [],
    state: sourceState,
    granted: () => Promise.resolve({ ...sourceState }),
    request(id) {
      sources.log.push(`request:${id}`);
      const allow = options.sources?.allow ?? true;
      if (allow) sourceState[id] = true;
      return Promise.resolve(allow);
    },
  };
  const tab = options.tab ?? null;
  const openTabs = [...(options.openTabs ?? [])];
  return {
    openTabs,
    appleTabs: () => Promise.resolve([...openTabs]),
    api: fakeApi(options.api),
    hosts: fakeHosts(options.hosts),
    sources,
    stores,
    secrets: secretsStore,
    activeTab: () => Promise.resolve(tab),
    settingsStore,
    secretsStore,
    sessionStore,
  };
}

/** A promise settled from outside, to hold a worker request open while the test acts. */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
