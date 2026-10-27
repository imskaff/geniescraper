import { describe, expect, it } from "vitest";
import { createRouter } from "../../src/background/router";
import { Serial } from "../../src/background/serial";
import { ALBUM_INFO, ALBUM_URL, FAST_CLIENT, PAGE_SCRAPE, SONG_URL, fakeBrowser } from "./fakePorts";

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
    const route = createRouter(browser.ports, FAST_CLIENT);
    expect(await route(raw)).toMatchObject({ ok: false, error: { code: "bad-request" } });
    expect(browser.log).toEqual([]);
  });

  it("routes a detect request", async () => {
    const route = createRouter(fakeBrowser().ports, FAST_CLIENT);
    expect(await route({ type: "detect", url: ALBUM_URL })).toEqual({ ok: true, data: ALBUM_INFO });
  });

  it("routes a scrape-track request", async () => {
    const route = createRouter(fakeBrowser().ports, FAST_CLIENT);
    expect(await route({ type: "scrape-track", url: SONG_URL, trackTitle: "Fortnight" })).toEqual({
      ok: true,
      data: PAGE_SCRAPE,
    });
  });

  it("runs requests one at a time: at most one tab is ever open", async () => {
    const browser = fakeBrowser({ loadingPolls: 3 });
    const route = createRouter(browser.ports, FAST_CLIENT);
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => route({ type: "scrape-track", url: SONG_URL, trackTitle: "" })),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(browser.maxOpenTabs()).toBe(1);
    expect(browser.log.filter((entry) => entry.startsWith("create:"))).toHaveLength(4);
  });

  it("keeps the worker alive while a request runs and stops afterwards, even on failure", async () => {
    const browser = fakeBrowser({ neverLoads: true });
    const route = createRouter(browser.ports, FAST_CLIENT);
    const pending = route({ type: "scrape-track", url: SONG_URL, trackTitle: "" });
    await Promise.resolve();
    expect(browser.keepAliveActive()).toBe(1);
    await pending;
    expect(browser.keepAliveActive()).toBe(0);
  });

  it("a failed request does not block the next one", async () => {
    const browser = fakeBrowser({ createFails: true });
    const route = createRouter(browser.ports, FAST_CLIENT);
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
