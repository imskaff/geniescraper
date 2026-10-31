import { describe, expect, it } from "vitest";
import { detectAlbum, scrapeTrack } from "../../src/background/providerClient";
import { ALBUM_INFO, ALBUM_URL, FAST_CLIENT, PAGE_SCRAPE, SONG_URL, fakeBrowser } from "./fakePorts";

const NEVER = new Promise<never>(() => undefined);

describe("scrapeTrack", () => {
  it("opens an inactive tab, injects the script, asks once, and closes the tab", async () => {
    const browser = fakeBrowser({ loadingPolls: 2 });
    const result = await scrapeTrack(browser.ports, SONG_URL, "Fortnight", FAST_CLIENT);

    expect(result).toEqual({ ok: true, data: PAGE_SCRAPE });
    expect(browser.log).toEqual([
      `create:${SONG_URL}:active=false`,
      "inject:1000",
      "send:1000:apple/scrape",
      "remove:1000",
    ]);
    expect(browser.openTabs.size).toBe(0);
  });

  it("sends the track title along with the page it scrapes", async () => {
    const seen: unknown[] = [];
    const browser = fakeBrowser({
      answer: (request) => {
        seen.push(request);
        return Promise.resolve({ ok: true, data: PAGE_SCRAPE });
      },
    });
    await scrapeTrack(browser.ports, SONG_URL, "Known Title", FAST_CLIENT);
    expect(seen).toEqual([{ type: "apple/scrape", url: SONG_URL, trackTitle: "Known Title" }]);
  });

  it.each([
    ["an album link", ALBUM_URL],
    ["a foreign host", "https://evil.example/us/song/x/1"],
    ["plain http", "http://music.apple.com/us/song/x/1"],
    ["a lookalike host", "https://music.apple.com.evil.example/us/song/x/1"],
    ["a non-URL", "javascript:alert(1)"],
  ])("refuses %s before any tab exists", async (_label, url) => {
    const browser = fakeBrowser();
    const result = await scrapeTrack(browser.ports, url, "", FAST_CLIENT);
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-url" } });
    expect(browser.log).toEqual([]);
  });

  it("closes the tab and reports a timeout when the page never finishes loading", async () => {
    const browser = fakeBrowser({ neverLoads: true });
    const result = await scrapeTrack(browser.ports, SONG_URL, "", FAST_CLIENT);
    expect(result).toMatchObject({ ok: false, error: { code: "timeout" } });
    expect(browser.log.at(-1)).toBe("remove:1000");
    expect(browser.openTabs.size).toBe(0);
  });

  it("reports tab-failed when the user closes the tab while it loads", async () => {
    const browser = fakeBrowser({ tabGone: true });
    const result = await scrapeTrack(browser.ports, SONG_URL, "", FAST_CLIENT);
    expect(result).toMatchObject({ ok: false, error: { code: "tab-failed" } });
    expect(browser.log).not.toContain("inject:1000");
  });

  it("closes the tab when the content script cannot be injected", async () => {
    const browser = fakeBrowser({ injectFails: true });
    const result = await scrapeTrack(browser.ports, SONG_URL, "", FAST_CLIENT);
    expect(result).toMatchObject({ ok: false, error: { code: "tab-failed" } });
    expect(browser.openTabs.size).toBe(0);
  });

  it("closes the tab when the page never answers, instead of hanging the queue", async () => {
    const browser = fakeBrowser({ answer: () => NEVER });
    const result = await scrapeTrack(browser.ports, SONG_URL, "", FAST_CLIENT);
    expect(result).toMatchObject({ ok: false, error: { code: "timeout" } });
    expect(browser.openTabs.size).toBe(0);
  });

  it("closes the tab when sending the message throws", async () => {
    const browser = fakeBrowser({ answer: () => Promise.reject(new Error("Receiving end does not exist.")) });
    const result = await scrapeTrack(browser.ports, SONG_URL, "", FAST_CLIENT);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "tab-failed", message: "Receiving end does not exist." },
    });
    expect(browser.openTabs.size).toBe(0);
  });

  it("passes the page's own failure through, still closing the tab", async () => {
    const failure = { ok: false, error: { code: "not-found", message: "Page not found." } };
    const browser = fakeBrowser({ answer: () => Promise.resolve(failure) });
    expect(await scrapeTrack(browser.ports, SONG_URL, "", FAST_CLIENT)).toEqual(failure);
    expect(browser.openTabs.size).toBe(0);
  });

  it.each([
    ["not a result", "nonsense"],
    ["a result without data", { ok: true }],
    ["data of the wrong shape", { ok: true, data: { title: 5 } }],
    ["data for another request", { ok: true, data: ALBUM_INFO }],
  ])("rejects %s from the page", async (_label, answer) => {
    const browser = fakeBrowser({ answer: () => Promise.resolve(answer) });
    const result = await scrapeTrack(browser.ports, SONG_URL, "", FAST_CLIENT);
    expect(result).toMatchObject({ ok: false, error: { code: "tab-failed" } });
    expect(browser.openTabs.size).toBe(0);
  });

  it("reports tab-failed when the browser cannot create the tab", async () => {
    const browser = fakeBrowser({ createFails: true });
    const result = await scrapeTrack(browser.ports, SONG_URL, "", FAST_CLIENT);
    expect(result).toMatchObject({ ok: false, error: { code: "tab-failed" } });
  });
});

describe("detectAlbum", () => {
  it("reads an album in a background tab and closes it", async () => {
    const browser = fakeBrowser();
    const result = await detectAlbum(browser.ports, ALBUM_URL, undefined, FAST_CLIENT);
    expect(result).toEqual({ ok: true, data: ALBUM_INFO });
    expect(browser.log).toEqual([
      `create:${ALBUM_URL}:active=false`,
      "inject:1000",
      "send:1000:apple/detect",
      "remove:1000",
    ]);
  });

  it("reads the user's own tab without opening, navigating or closing anything", async () => {
    const browser = fakeBrowser({ userTabs: { 7: { status: "complete", url: ALBUM_URL } } });
    const result = await detectAlbum(browser.ports, ALBUM_URL, 7, FAST_CLIENT);
    expect(result).toEqual({ ok: true, data: ALBUM_INFO });
    expect(browser.log).toEqual(["inject:7", "send:7:apple/detect"]);
  });

  it("refuses a tab that is not showing the page it was asked about", async () => {
    const browser = fakeBrowser({ userTabs: { 7: { status: "complete", url: "https://example.com/" } } });
    const result = await detectAlbum(browser.ports, ALBUM_URL, 7, FAST_CLIENT);
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-url" } });
    expect(browser.log).toEqual([]);
  });

  it("refuses a tab that no longer exists", async () => {
    const browser = fakeBrowser();
    expect(await detectAlbum(browser.ports, ALBUM_URL, 99, FAST_CLIENT)).toMatchObject({
      ok: false,
      error: { code: "invalid-url" },
    });
  });

  it("refuses a URL that is not an Apple Music page before opening anything", async () => {
    const browser = fakeBrowser();
    const result = await detectAlbum(browser.ports, "https://example.com/", undefined, FAST_CLIENT);
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-url" } });
    expect(browser.log).toEqual([]);
  });
});
