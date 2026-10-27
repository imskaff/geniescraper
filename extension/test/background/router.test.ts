import { describe, expect, it } from "vitest";
import type { CoverService } from "../../src/background/covers";
import { PasteService } from "../../src/background/paste";
import { MAX_OPEN_TABS, createRouter } from "../../src/background/router";
import { Limiter, Serial } from "../../src/background/serial";
import { MAX_YOUTUBE_REQUESTS, realYoutube, youtubePages, type YoutubeService } from "../../src/background/youtube";
import { createFetchText, type GetText } from "../../src/lookups/http";
import { memoryStore } from "../ui/fakes";
import { ALBUM_INFO, ALBUM_URL, FAST_CLIENT, PAGE_SCRAPE, SONG_URL, fakeBrowser } from "./fakePorts";

const NO_COVERS: CoverService = { exact: () => Promise.resolve(""), search: () => Promise.resolve("") };

function pasteFor(browser: ReturnType<typeof fakeBrowser>): PasteService {
  return new PasteService(browser.ports, { settings: memoryStore(), session: memoryStore() });
}

describe("router", () => {
  it.each([
    null,
    "scrape",
    {},
    { type: "detect" },
    { type: "detect", url: 5 },
    { type: "scrape-track", url: SONG_URL },
  ])("rejects the malformed request %j", async (raw) => {
    const browser = fakeBrowser();
    const route = createRouter(browser.ports, FAST_CLIENT, pasteFor(browser), NO_COVERS);
    expect(await route(raw)).toMatchObject({ ok: false, error: { code: "bad-request" } });
    expect(browser.log).toEqual([]);
  });

  it("routes a detect request", async () => {
    const route = createRouter(fakeBrowser().ports, FAST_CLIENT, pasteFor(fakeBrowser()), NO_COVERS);
    expect(await route({ type: "detect", url: ALBUM_URL })).toEqual({ ok: true, data: ALBUM_INFO });
  });

  it("routes a scrape-track request", async () => {
    const route = createRouter(fakeBrowser().ports, FAST_CLIENT, pasteFor(fakeBrowser()), NO_COVERS);
    expect(await route({ type: "scrape-track", url: SONG_URL, trackTitle: "Fortnight" })).toEqual({
      ok: true,
      data: { ...PAGE_SCRAPE, youtubeUrl: "", youtubeIsMv: false },
    });
  });

  it("reads tracks at the same time, but never more than MAX_OPEN_TABS tabs", async () => {
    const browser = fakeBrowser({ loadingPolls: 3 });
    const route = createRouter(browser.ports, FAST_CLIENT, pasteFor(browser), NO_COVERS);
    const count = MAX_OPEN_TABS + 6;
    const results = await Promise.all(
      Array.from({ length: count }, () => route({ type: "scrape-track", url: SONG_URL, trackTitle: "" })),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(browser.maxOpenTabs()).toBeGreaterThan(1);
    expect(browser.maxOpenTabs()).toBeLessThanOrEqual(MAX_OPEN_TABS);
    expect(browser.log.filter((entry) => entry.startsWith("create:"))).toHaveLength(count);
  });

  it("still detects albums one at a time", async () => {
    const browser = fakeBrowser({ loadingPolls: 3 });
    const route = createRouter(browser.ports, FAST_CLIENT, pasteFor(browser), NO_COVERS);
    const results = await Promise.all([1, 2, 3].map(() => route({ type: "detect", url: ALBUM_URL })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(browser.maxOpenTabs()).toBe(1);
  });

  it("keeps the worker alive while a request runs and stops afterwards, even on failure", async () => {
    const browser = fakeBrowser({ neverLoads: true });
    const route = createRouter(browser.ports, FAST_CLIENT, pasteFor(browser), NO_COVERS);
    const pending = route({ type: "scrape-track", url: SONG_URL, trackTitle: "" });
    await Promise.resolve();
    expect(browser.keepAliveActive()).toBe(1);
    await pending;
    expect(browser.keepAliveActive()).toBe(0);
  });

  it("a failed request does not block the next one", async () => {
    const browser = fakeBrowser({ createFails: true });
    const route = createRouter(browser.ports, FAST_CLIENT, pasteFor(browser), NO_COVERS);
    expect(await route({ type: "scrape-track", url: SONG_URL, trackTitle: "" })).toMatchObject({ ok: false });
    expect(await route({ type: "detect", url: "https://example.com" })).toMatchObject({ ok: false });
  });
});

describe("Serial", () => {
  it("runs jobs in submission order, never overlapping", async () => {
    const serial = new Serial();
    const events: string[] = [];
    const job = (name: string, ms: number) => async () => {
      events.push(`start:${name}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      events.push(`end:${name}`);
      return name;
    };
    const results = await Promise.all([serial.run(job("a", 20)), serial.run(job("b", 1)), serial.run(job("c", 1))]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(events).toEqual(["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
  });

  it("keeps running after a job throws, and still reports the throw to its caller", async () => {
    const serial = new Serial();
    const failing = serial.run(() => Promise.reject(new Error("boom")));
    const next = serial.run(() => Promise.resolve("ok"));
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});

describe("Limiter", () => {
  it("runs at most `limit` jobs at once and starts the rest in order as places free up", async () => {
    const limiter = new Limiter(2);
    let active = 0;
    let peak = 0;
    const started: string[] = [];
    const job = (name: string) => async () => {
      started.push(name);
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return name;
    };
    const results = await Promise.all(["a", "b", "c", "d", "e"].map((n) => limiter.run(job(n))));
    expect(results).toEqual(["a", "b", "c", "d", "e"]);
    expect(started).toEqual(["a", "b", "c", "d", "e"]);
    expect(peak).toBe(2);
  });

  it("frees its place when a job throws", async () => {
    const limiter = new Limiter(1);
    await expect(limiter.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await limiter.run(() => Promise.resolve("ok"))).toBe("ok");
  });
});

describe("the YouTube link of a scraped track", () => {
  const LINK = { url: "https://www.youtube.com/watch?v=abc", isMusicVideo: true };

  function setup(find: YoutubeService["find"], scrape: Partial<typeof PAGE_SCRAPE> = {}) {
    const browser = fakeBrowser({ answer: () => Promise.resolve({ ok: true, data: { ...PAGE_SCRAPE, ...scrape } }) });
    const route = createRouter(browser.ports, FAST_CLIENT, pasteFor(browser), NO_COVERS, { find });
    return (artist?: string) =>
      route({
        type: "scrape-track",
        url: SONG_URL,
        trackTitle: "Fortnight",
        ...(artist === undefined ? {} : { artist }),
      });
  }

  it("is put on the scrape, with whether it is a music video", async () => {
    const run = setup(() => Promise.resolve(LINK));
    expect(await run("Taylor Swift")).toMatchObject({
      ok: true,
      data: { youtubeUrl: LINK.url, youtubeIsMv: true },
    });
  });

  it("starts the search before the page is read, when the album's artist is known", async () => {
    const order: string[] = [];
    const browser = fakeBrowser({
      answer: () => {
        order.push("page-read");
        return Promise.resolve({ ok: true, data: PAGE_SCRAPE });
      },
    });
    const route = createRouter(browser.ports, FAST_CLIENT, pasteFor(browser), NO_COVERS, {
      find: () => {
        order.push("youtube-started");
        return Promise.resolve(LINK);
      },
    });
    await route({ type: "scrape-track", url: SONG_URL, trackTitle: "Fortnight", artist: PAGE_SCRAPE.artist });
    expect(order).toEqual(["youtube-started", "page-read"]);
  });

  it("asks once with the album's title and artist, and does not repeat a question that found nothing", async () => {
    const asked: string[] = [];
    const run = setup(
      (title, artist) => {
        asked.push(`${artist} / ${title}`);
        return Promise.resolve({ url: "", isMusicVideo: false });
      },
      { title: "Fortnight", artist: PAGE_SCRAPE.artist },
    );
    await run(PAGE_SCRAPE.artist);
    expect(asked).toEqual([`${PAGE_SCRAPE.artist} / Fortnight`]);
  });

  it("tries again with the song page's own artist when that differs from the album's and the first found nothing", async () => {
    const asked: string[] = [];
    const run = setup((title, artist) => {
      asked.push(`${artist} / ${title}`);
      return Promise.resolve(artist === PAGE_SCRAPE.artist ? LINK : { url: "", isMusicVideo: false });
    });
    const result = await run("Various Artists");
    expect(asked).toEqual(["Various Artists / Fortnight", `${PAGE_SCRAPE.artist} / Fortnight`]);
    expect(result).toMatchObject({ ok: true, data: { youtubeUrl: LINK.url } });
  });

  it("searches after the page read, with the song page's artist, when the album's is not known", async () => {
    const asked: string[] = [];
    const run = setup((title, artist) => {
      asked.push(`${artist} / ${title}`);
      return Promise.resolve(LINK);
    });
    await run();
    expect(asked).toEqual([`${PAGE_SCRAPE.artist} / Fortnight`]);
  });

  it("searches for the cover beside the YouTube search, not after it", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const browser = fakeBrowser({
      answer: () => Promise.resolve({ ok: true, data: { ...PAGE_SCRAPE, coverArtUrl: "" } }),
    });
    const covers: CoverService = {
      exact: () => Promise.resolve(""),
      search: () => {
        order.push("cover-started");
        return Promise.resolve("");
      },
    };
    const route = createRouter(browser.ports, FAST_CLIENT, pasteFor(browser), covers, {
      find: async () => {
        order.push("youtube-started");
        await held;
        return LINK;
      },
    });
    const done = route({ type: "scrape-track", url: SONG_URL, trackTitle: "Fortnight", artist: PAGE_SCRAPE.artist });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["youtube-started", "cover-started"]);
    release();
    expect(await done).toMatchObject({ ok: true, data: { youtubeUrl: LINK.url } });
  });

  it("is empty, and the read still succeeds, when the search throws", async () => {
    const run = setup(() => Promise.reject(new Error("offline")));
    expect(await run("Taylor Swift")).toMatchObject({ ok: true, data: { youtubeUrl: "", youtubeIsMv: false } });
  });

  it("is not searched for when the page read fails", async () => {
    const asked: string[] = [];
    const browser = fakeBrowser({
      answer: () => Promise.resolve({ ok: false, error: { code: "not-found", message: "x" } }),
    });
    const route = createRouter(browser.ports, FAST_CLIENT, pasteFor(browser), NO_COVERS, {
      find: (t) => {
        asked.push(t);
        return Promise.resolve(LINK);
      },
    });
    expect(await route({ type: "scrape-track", url: SONG_URL, trackTitle: "x" })).toMatchObject({ ok: false });
    expect(asked).toEqual([]);
  });
});

describe("youtubePages", () => {
  const html = (name: string, data: unknown) => `<html><script>var ${name} = ${JSON.stringify(data)};</script></html>`;

  it("asks for the results page and the watch page, encoding the query, and parses what comes back", async () => {
    const urls: string[] = [];
    const getText: GetText = (url) => {
      urls.push(url);
      return Promise.resolve(
        html(url.includes("/results") ? "ytInitialData" : "ytInitialPlayerResponse", { n: url.length }),
      );
    };
    const pages = youtubePages(getText, new Limiter(3));
    expect(await pages.search('"SOS" "SZA - Topic" & more')).toMatchObject({ n: expect.any(Number) as number });
    await pages.watch("abc_-123");
    expect(urls).toEqual([
      "https://www.youtube.com/results?search_query=%22SOS%22+%22SZA+-+Topic%22+%26+more",
      "https://www.youtube.com/watch?v=abc_-123",
    ]);
  });

  it("gives null when the page cannot be fetched or holds no data", async () => {
    expect(await youtubePages(() => Promise.resolve(null), new Limiter(3)).search("x")).toBeNull();
    expect(await youtubePages(() => Promise.resolve("<html></html>"), new Limiter(3)).watch("x")).toBeNull();
  });

  it("never has more than MAX_YOUTUBE_REQUESTS requests in flight, however many tracks ask at once", async () => {
    let active = 0;
    let peak = 0;
    const getText: GetText = async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return html("ytInitialData", {});
    };
    const pages = youtubePages(getText, new Limiter(MAX_YOUTUBE_REQUESTS));
    await Promise.all(Array.from({ length: 20 }, (_, i) => pages.search(`q${String(i)}`)));
    expect(peak).toBe(MAX_YOUTUBE_REQUESTS);
  });
});

describe("realYoutube", () => {
  it("gives no link, and contacts nothing, while the permission is not granted", async () => {
    let called = 0;
    const getText = createFetchText(() => Promise.resolve(false));
    const spy: GetText = (url) => {
      called++;
      return getText(url);
    };
    expect(await realYoutube(spy).find("SOS", "SZA")).toEqual({ url: "", isMusicVideo: false });
    expect(called).toBeGreaterThan(0);
  });
});
