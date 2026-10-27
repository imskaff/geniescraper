import type { AlbumInfo, PageScrape, Result } from "../../src/shared/messages";
import type { KeyValueStore, Stores } from "../../src/shared/storage";
import type { WorkerApi } from "../../src/ui/api";
import type { ActiveTab, Env } from "../../src/ui/controller";

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
}

export interface ApiScript {
  detect?: (url: string, tabId?: number) => Promise<Result<AlbumInfo>>;
  scrapeTrack?: (url: string, title: string) => Promise<Result<PageScrape>>;
}

export function fakeApi(script: ApiScript = {}): FakeApi {
  const calls: string[] = [];
  return {
    calls,
    detect(url, tabId) {
      calls.push(`detect:${url}:${String(tabId)}`);
      return (script.detect ?? (() => Promise.resolve({ ok: true, data: ALBUM } as const)))(url, tabId);
    },
    scrapeTrack(url, title) {
      calls.push(`scrape:${url}`);
      return (script.scrapeTrack ?? ((_url, t) => Promise.resolve({ ok: true, data: scrapeFor(t) } as const)))(
        url,
        title,
      );
    },
  };
}

export interface FakeEnv extends Env {
  api: FakeApi;
  settingsStore: ReturnType<typeof memoryStore>;
  sessionStore: ReturnType<typeof memoryStore>;
}

export function fakeEnv(
  options: { api?: ApiScript; tab?: ActiveTab | null; settings?: unknown; session?: unknown } = {},
): FakeEnv {
  const settingsStore = memoryStore(options.settings === undefined ? {} : { settings: options.settings });
  const sessionStore = memoryStore(options.session === undefined ? {} : { session: options.session });
  const stores: Stores = { settings: settingsStore, session: sessionStore };
  const tab = options.tab ?? null;
  return { api: fakeApi(options.api), stores, activeTab: () => Promise.resolve(tab), settingsStore, sessionStore };
}

/** A promise settled from outside, to hold a worker request open while the test acts. */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
