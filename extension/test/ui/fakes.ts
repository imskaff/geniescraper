import { IDLE_PASTE, back, skip, startPaste, stop, type PasteState } from "../../src/core/paste";
import type { AlbumInfo, PageScrape, PasteCommand, Result, YoutubeAnswer } from "../../src/shared/messages";
import type { KeyValueStore, Stores } from "../../src/shared/storage";
import type { WorkerApi } from "../../src/ui/api";
import type { OptionalHost } from "../../src/lookups/http";
import type { ActiveTab, Env, HostPermissions } from "../../src/ui/controller";

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
    warnings: [],
  };
}

export interface FakeApi extends WorkerApi {
  calls: string[];
  /** The paste session the fake worker holds. */
  pasteState: PasteState;
}

const NO_LINK: YoutubeAnswer = { url: "", isMusicVideo: false, throttled: false };

export interface ApiScript {
  detect?: (url: string, tabId?: number) => Promise<Result<AlbumInfo>>;
  scrapeTrack?: (url: string, title: string) => Promise<Result<PageScrape>>;
  lookupYoutube?: (title: string, artist: string) => Promise<Result<YoutubeAnswer>>;
  paste?: (command: PasteCommand) => Promise<Result<PasteState>>;
}

export function fakeApi(script: ApiScript = {}): FakeApi {
  const calls: string[] = [];
  const api: FakeApi = {
    calls,
    pasteState: { ...IDLE_PASTE },
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
        case "paste-fill":
          break;
      }
      return Promise.resolve({ ok: true, data: api.pasteState });
    },
    detect(url, tabId) {
      calls.push(`detect:${url}:${String(tabId)}`);
      return (script.detect ?? (() => Promise.resolve({ ok: true, data: ALBUM } as const)))(url, tabId);
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
    state: { deezer: false, youtube: false, ...initial },
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
  api: FakeApi;
  hosts: FakeHosts;
  settingsStore: ReturnType<typeof memoryStore>;
  sessionStore: ReturnType<typeof memoryStore>;
}

export function fakeEnv(
  options: {
    api?: ApiScript;
    tab?: ActiveTab | null;
    settings?: unknown;
    session?: unknown;
    hosts?: Partial<Record<OptionalHost, boolean>>;
  } = {},
): FakeEnv {
  const settingsStore = memoryStore(options.settings === undefined ? {} : { settings: options.settings });
  const sessionStore = memoryStore(options.session === undefined ? {} : { session: options.session });
  const stores: Stores = { settings: settingsStore, session: sessionStore };
  const tab = options.tab ?? null;
  return {
    api: fakeApi(options.api),
    hosts: fakeHosts(options.hosts),
    stores,
    activeTab: () => Promise.resolve(tab),
    settingsStore,
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
