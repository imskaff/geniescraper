import { describe, expect, it } from "vitest";
import type { CoverService } from "../../src/background/covers";
import { PasteService } from "../../src/background/paste";
import { MAX_OPEN_TABS, createRouter } from "../../src/background/router";
import { Limiter, Serial } from "../../src/background/serial";
import type { YoutubeService } from "../../src/background/youtube";
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

  it("answers with an internal error, never a rejection, when a job throws unexpectedly", async () => {
    const browser = fakeBrowser();
    const route = createRouter(browser.ports, FAST_CLIENT, pasteFor(browser), NO_COVERS, undefined, () =>
      Promise.reject(new Error("boom")),
    );
    const answer = await route({ type: "youtube-key-check", key: "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q" });
    expect(answer).toMatchObject({ ok: false, error: { code: "internal" } });
    // Nothing of the failure's own text is passed on: it may name paths or keys.
    expect(JSON.stringify(answer)).not.toContain("boom");
  });

  it("routes a detect request", async () => {
    const route = createRouter(fakeBrowser().ports, FAST_CLIENT, pasteFor(fakeBrowser()), NO_COVERS);
    expect(await route({ type: "detect", url: ALBUM_URL })).toEqual({ ok: true, data: ALBUM_INFO });
  });

  it("routes a scrape-track request", async () => {
    const route = createRouter(fakeBrowser().ports, FAST_CLIENT, pasteFor(fakeBrowser()), NO_COVERS);
    expect(await route({ type: "scrape-track", url: SONG_URL, trackTitle: "Fortnight" })).toEqual({
      ok: true,
      data: PAGE_SCRAPE,
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

describe("the YouTube look-up", () => {
  const LINK = { url: "https://www.youtube.com/watch?v=abcDEF_-123", isMusicVideo: true, keyProblem: "" as const };
  const none = { url: "", isMusicVideo: false, keyProblem: "" as const };

  const route = (service: Partial<YoutubeService>, browser = fakeBrowser()) =>
    createRouter(browser.ports, FAST_CLIENT, pasteFor(browser), NO_COVERS, {
      find: () => Promise.resolve(none),
      throttled: () => false,
      ...service,
    });

  it("answers a youtube-lookup request with the link and whether it is a music video", async () => {
    const asked: string[] = [];
    const answer = await route({
      find: (title, artist) => {
        asked.push(`${artist} / ${title}`);
        return Promise.resolve(LINK);
      },
    })({ type: "youtube-lookup", title: "Fortnight", artist: "Taylor Swift" });
    expect(answer).toEqual({ ok: true, data: { ...LINK, throttled: false, keyProblem: "" } });
    expect(asked).toEqual(["Taylor Swift / Fortnight"]);
  });

  it("says when no link was found only because YouTube is limiting requests", async () => {
    const answer = await route({ throttled: () => true })({ type: "youtube-lookup", title: "x", artist: "y" });
    expect(answer).toEqual({ ok: true, data: { url: "", isMusicVideo: false, throttled: true, keyProblem: "" } });
  });

  it("passes on why the user's key could not be used, with that lookup's own answer", async () => {
    const answer = await route({
      find: () => Promise.resolve({ ...none, keyProblem: "quota" as const }),
    })({ type: "youtube-lookup", title: "x", artist: "y" });
    expect(answer).toEqual({ ok: true, data: { ...none, throttled: false, keyProblem: "quota" } });
  });

  it("keeps each concurrent lookup's key problem to itself", async () => {
    const r = route({
      find: (title) => Promise.resolve({ ...none, keyProblem: title === "a" ? ("key" as const) : ("" as const) }),
    });
    const [a, b] = await Promise.all([
      r({ type: "youtube-lookup", title: "a", artist: "y" }),
      r({ type: "youtube-lookup", title: "b", artist: "y" }),
    ]);
    expect(a).toMatchObject({ data: { keyProblem: "key" } });
    expect(b).toMatchObject({ data: { keyProblem: "" } });
  });

  it("does not call a found link throttled", async () => {
    const answer = await route({ find: () => Promise.resolve(LINK), throttled: () => true })({
      type: "youtube-lookup",
      title: "x",
      artist: "y",
    });
    expect(answer).toMatchObject({ ok: true, data: { throttled: false } });
  });

  it("answers with no link, not an error, when the search throws", async () => {
    const answer = await route({ find: () => Promise.reject(new Error("offline")) })({
      type: "youtube-lookup",
      title: "x",
      artist: "y",
    });
    expect(answer).toEqual({ ok: true, data: { url: "", isMusicVideo: false, throttled: false, keyProblem: "" } });
  });

  it.each([
    { type: "youtube-lookup" },
    { type: "youtube-lookup", title: "x" },
    { type: "youtube-lookup", title: 1, artist: "y" },
  ])("rejects the malformed request %j", async (raw) => {
    expect(await route({})(raw)).toMatchObject({ ok: false, error: { code: "bad-request" } });
  });

  it("is not made while an album is read: a scrape never asks YouTube", async () => {
    const asked: string[] = [];
    const browser = fakeBrowser();
    const result = await route(
      {
        find: (t) => {
          asked.push(t);
          return Promise.resolve(LINK);
        },
      },
      browser,
    )({ type: "scrape-track", url: SONG_URL, trackTitle: "Fortnight" });
    expect(result).toMatchObject({ ok: true });
    expect(asked).toEqual([]);
  });

  it("is not held up by album reads waiting for tabs", async () => {
    const browser = fakeBrowser({ neverLoads: true });
    const r = route({ find: () => Promise.resolve(LINK) }, browser);
    void r({ type: "scrape-track", url: SONG_URL, trackTitle: "x" });
    const answer = await r({ type: "youtube-lookup", title: "x", artist: "y" });
    expect(answer).toMatchObject({ ok: true, data: { url: LINK.url } });
  });
});
