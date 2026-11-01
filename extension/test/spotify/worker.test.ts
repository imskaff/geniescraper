import { describe, expect, it } from "vitest";
import type { CoverService } from "../../src/background/covers";
import { PasteService } from "../../src/background/paste";
import { detectAlbum, scrapeTrack } from "../../src/background/providerClient";
import { BLOCKED_PAUSE_MS, createRouter } from "../../src/background/router";
import { PoliteQueue, type Clock } from "../../src/background/serial";
import { SPOTIFY_PROVIDER } from "../../src/providers/spotify";
import type { AlbumInfo, PageScrape } from "../../src/shared/messages";
import { FAST_CLIENT, fakeBrowser } from "../background/fakePorts";
import { memoryStore } from "../ui/fakes";

const TRACK = "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT";
const TRACK_B = "https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b";
const ALBUM = "https://open.spotify.com/album/1uyf3l2d4XYwiEqAb7t7fX";
const ALBUM_TRACK_3 = "https://open.spotify.com/track/7qiZfU4dY1lWllzX7mPBI3";
const ALBUM_TRACK_4 = "https://open.spotify.com/track/2takcwOaAZWiXQijPHIx7B";

const SCRAPE: PageScrape = {
  title: "Song",
  artist: "Band",
  credits: [{ role: "Songwriter", artists: ["A"] }],
  coverArtUrl: "",
  releaseDate: "",
  warnings: [],
  notes: ["note"],
};
const INFO: AlbumInfo = {
  url: ALBUM,
  albumTitle: "Album",
  artist: "Band",
  trackCount: 1,
  trackTitles: ["Song"],
  trackUrls: [TRACK],
  phonographicCopyright: "",
  copyrightNotice: "",
  coverArtUrl: "",
  releaseDate: "",
};

/** A clock that only moves when something sleeps on it. */
function fakeClock(): Clock & { slept: number[]; at: number } {
  const clock = {
    at: 1_000_000,
    slept: [] as number[],
    now: () => clock.at,
    sleep: (ms: number) => {
      clock.slept.push(ms);
      clock.at += ms;
      return Promise.resolve();
    },
  };
  return clock;
}

const NO_COVERS: CoverService = { exact: () => Promise.resolve(""), search: () => Promise.resolve("") };

describe("reading Spotify through the worker", () => {
  it("opens the plain address in a hidden window, asks Spotify's own script, and always closes the tab", async () => {
    const browser = fakeBrowser({
      answer: (request) => Promise.resolve({ ok: true, data: request.type === "spotify/detect" ? INFO : SCRAPE }),
    });
    const messages: string[] = [];
    const send = browser.ports.sendMessage.bind(browser.ports);
    browser.ports.sendMessage = (tabId, message) => {
      messages.push(message.type);
      return send(tabId, message);
    };
    const injected: (string | undefined)[] = [];
    const inject = browser.ports.injectContentScript.bind(browser.ports);
    browser.ports.injectContentScript = (tabId, file) => {
      injected.push(file);
      return inject(tabId, file);
    };

    const scraped = await scrapeTrack(browser.ports, `https://open.spotify.com/intl-de/track/4cOdK2wGLETKBW3PvgPWqT?si=1`, "Song", FAST_CLIENT);
    expect(scraped).toEqual({ ok: true, data: SCRAPE });
    const detected = await detectAlbum(browser.ports, ALBUM, undefined, FAST_CLIENT);
    expect(detected.ok).toBe(true);

    expect(browser.log.filter((entry) => entry.startsWith("create:"))).toEqual([
      `create:${TRACK}:active=false`,
      `create:${ALBUM}:active=false`,
    ]);
    expect(messages).toEqual(["spotify/scrape", "spotify/detect"]);
    expect(injected).toEqual(["spotify/content.js", "spotify/content.js"]);
    expect(browser.openTabs.size).toBe(0);
  });

  it("closes the tab when the page fails to answer", async () => {
    const browser = fakeBrowser({ answer: () => Promise.reject(new Error("The message port closed.")) });
    const result = await scrapeTrack(browser.ports, TRACK, "Song", FAST_CLIENT);
    expect(result).toMatchObject({ ok: false, error: { code: "tab-failed" } });
    expect(browser.openTabs.size).toBe(0);
    expect(browser.log.at(-1)).toMatch(/^remove:/);
  });

  it("passes the page's failure statuses on as they are", async () => {
    for (const code of ["unavailable", "blocked", "tab-failed", "not-found"] as const) {
      const browser = fakeBrowser({ answer: () => Promise.resolve({ ok: false, error: { code, message: `says ${code}` } }) });
      expect(await scrapeTrack(browser.ports, TRACK, "Song", FAST_CLIENT)).toEqual({
        ok: false,
        error: { code, message: `says ${code}` },
      });
      expect(browser.openTabs.size).toBe(0);
    }
  });

  it("asks nothing and opens nothing until the user has allowed Spotify", async () => {
    const browser = fakeBrowser({ noAccess: true });
    for (const result of [
      await scrapeTrack(browser.ports, TRACK, "Song", FAST_CLIENT),
      await detectAlbum(browser.ports, ALBUM, undefined, FAST_CLIENT),
      await detectAlbum(browser.ports, ALBUM, 7, FAST_CLIENT),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: "no-access" } });
    }
    expect(browser.log.every((entry) => entry === "access")).toBe(true);
  });

  it("refuses an album address for a credits read and anything that is not a Spotify page", async () => {
    const browser = fakeBrowser();
    expect(await scrapeTrack(browser.ports, ALBUM, "x", FAST_CLIENT)).toEqual({
      ok: false,
      error: { code: "invalid-url", message: SPOTIFY_PROVIDER.messages.notSong },
    });
    expect(await scrapeTrack(browser.ports, "https://open.spotify.com/artist/abc", "x", FAST_CLIENT)).toMatchObject({
      ok: false,
      error: { code: "invalid-url" },
    });
    expect(browser.log).toEqual([]);
  });
});

describe("the polite queue", () => {
  const trace = (queue: PoliteQueue, clock: ReturnType<typeof fakeClock>, names: string[]) => {
    const log: string[] = [];
    let running = 0;
    let peak = 0;
    const job = (name: string) => async () => {
      running++;
      peak = Math.max(peak, running);
      log.push(`${name}@${String(clock.at - 1_000_000)}`);
      await Promise.resolve();
      await Promise.resolve();
      running--;
    };
    return Promise.all(names.map((n) => queue.run(job(n)))).then(() => ({ log, peak }));
  };

  it("with one at a time, starts jobs in order at least a gap apart", async () => {
    const clock = fakeClock();
    const { log, peak } = await trace(new PoliteQueue(300, 1, clock), clock, ["a", "b", "c"]);
    expect(peak).toBe(1);
    expect(log).toEqual(["a@0", "b@300", "c@600"]);
  });

  it("with two at a time, never has more than two running and spreads their starts", async () => {
    const clock = fakeClock();
    const { log, peak } = await trace(new PoliteQueue(300, 2, clock), clock, ["a", "b", "c", "d"]);
    expect(peak).toBe(2);
    expect(log.map((entry) => entry.split("@")[0])).toEqual(["a", "b", "c", "d"]);
    const starts = log.map((entry) => Number(entry.split("@")[1]));
    for (let i = 1; i < starts.length; i++) expect((starts[i] ?? 0) - (starts[i - 1] ?? 0)).toBeGreaterThanOrEqual(300);
  });

  it("drops to one at a time when told, and never below one", async () => {
    const clock = fakeClock();
    const queue = new PoliteQueue(0, 2, clock);
    queue.setLimit(0);
    expect(queue.concurrency).toBe(1);
    const { peak } = await trace(queue, clock, ["a", "b", "c"]);
    expect(peak).toBe(1);
  });

  it("keeps going after a job fails", async () => {
    const queue = new PoliteQueue(0, 1, fakeClock());
    await expect(queue.run(() => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(queue.run(() => Promise.resolve(5))).resolves.toBe(5);
  });
});

describe("the router and Spotify", () => {
  function routerFor(browser: ReturnType<typeof fakeBrowser>, clock: Clock) {
    const paste = new PasteService(browser.ports, { settings: memoryStore(), session: memoryStore() });
    return createRouter(browser.ports, FAST_CLIENT, paste, NO_COVERS, undefined, undefined, undefined, clock);
  }

  it("reads at most the provider's limit at a time, however many the panel asks for", async () => {
    const clock = fakeClock();
    const browser = fakeBrowser({ answer: () => Promise.resolve({ ok: true, data: SCRAPE }) });
    const route = routerFor(browser, clock);
    const urls = [TRACK, TRACK_B, TRACK, TRACK_B, TRACK];
    const answers = await Promise.all(urls.map((url) => route({ type: "scrape-track", url, trackTitle: "Song" })));
    expect(answers.every((a) => (a as { ok: boolean }).ok)).toBe(true);
    expect(browser.maxOpenTabs()).toBeLessThanOrEqual(SPOTIFY_PROVIDER.readConcurrency ?? 1);
    expect(browser.maxOpenTabs()).toBe(3);
  });

  it("reads the tracks in the order they were asked for, so the first one is ready first", async () => {
    const clock = fakeClock();
    const opened: string[] = [];
    const browser = fakeBrowser({ answer: () => Promise.resolve({ ok: true, data: SCRAPE }) });
    const create = browser.ports.createTab.bind(browser.ports);
    browser.ports.createTab = (url, active) => {
      opened.push(url);
      return create(url, active);
    };
    const route = routerFor(browser, clock);
    const urls = [TRACK, TRACK_B, ALBUM_TRACK_3, ALBUM_TRACK_4];
    await Promise.all(urls.map((url) => route({ type: "scrape-track", url, trackTitle: "Song" })));
    expect(opened).toEqual(urls);
  });

  it("falls back to one at a time after a read fails for a reason that is not the track's own", async () => {
    for (const code of ["tab-failed", "timeout", "blocked"] as const) {
      const clock = fakeClock();
      let fail = true;
      const browser = fakeBrowser({
        answer: () =>
          Promise.resolve(fail ? { ok: false, error: { code, message: code } } : { ok: true, data: SCRAPE }),
      });
      const route = routerFor(browser, clock);
      await route({ type: "scrape-track", url: TRACK, trackTitle: "Song" });
      fail = false;
      clock.at += BLOCKED_PAUSE_MS;
      const before = browser.maxOpenTabs();
      await Promise.all(
        [TRACK, TRACK_B, ALBUM_TRACK_3, ALBUM_TRACK_4].map((url) => route({ type: "scrape-track", url, trackTitle: "x" })),
      );
      expect(browser.maxOpenTabs(), code).toBe(Math.max(before, 1));
      expect(browser.maxOpenTabs(), code).toBe(1);
    }
  });

  it("keeps the full limit when a track is simply unavailable", async () => {
    const clock = fakeClock();
    let first = true;
    const browser = fakeBrowser({
      answer: () => {
        const unavailable = first;
        first = false;
        return Promise.resolve(
          unavailable ? { ok: false, error: { code: "unavailable", message: "gone" } } : { ok: true, data: SCRAPE },
        );
      },
    });
    const route = routerFor(browser, clock);
    await route({ type: "scrape-track", url: TRACK, trackTitle: "Song" });
    await Promise.all([TRACK_B, ALBUM_TRACK_3, ALBUM_TRACK_4].map((url) => route({ type: "scrape-track", url, trackTitle: "x" })));
    expect(browser.maxOpenTabs()).toBe(3);
  });

  it("stops reading Spotify after a captcha, opens nothing for a while, then tries again", async () => {
    const clock = fakeClock();
    let blocked = true;
    const browser = fakeBrowser({
      answer: () =>
        Promise.resolve(
          blocked
            ? { ok: false, error: { code: "blocked", message: "captcha" } }
            : { ok: true, data: SCRAPE },
        ),
    });
    const route = routerFor(browser, clock);
    const read = (): Promise<unknown> => route({ type: "scrape-track", url: TRACK, trackTitle: "Song" });

    expect(await read()).toMatchObject({ ok: false, error: { code: "blocked", message: "captcha" } });
    const opened = browser.log.filter((entry) => entry.startsWith("create:")).length;
    expect(opened).toBe(1);

    expect(await read()).toMatchObject({ ok: false, error: { code: "blocked" } });
    expect(browser.log.filter((entry) => entry.startsWith("create:")).length).toBe(opened);

    clock.at += BLOCKED_PAUSE_MS;
    blocked = false;
    expect(await read()).toMatchObject({ ok: true });
    expect(browser.log.filter((entry) => entry.startsWith("create:")).length).toBe(opened + 1);
  });

  it("reads the user's own Spotify tab at once, without the queue", async () => {
    const clock = fakeClock();
    const browser = fakeBrowser({
      userTabs: { 9: { status: "complete", url: ALBUM } },
      answer: () => Promise.resolve({ ok: true, data: INFO }),
    });
    const route = routerFor(browser, clock);
    expect(await route({ type: "detect", url: ALBUM, tabId: 9 })).toMatchObject({ ok: true });
    expect(browser.log.some((entry) => entry.startsWith("create:"))).toBe(false);
    expect(clock.slept).toEqual([]);
  });

  it("looks the cover up by title and artist, since an address has no Apple catalog id", async () => {
    const searched: string[] = [];
    const covers: CoverService = {
      exact: () => Promise.resolve(""),
      search: (title, artist) => {
        searched.push(`${title}|${artist}`);
        return Promise.resolve("https://is1-ssl.mzstatic.com/cover.png");
      },
    };
    const browser = fakeBrowser({ answer: () => Promise.resolve({ ok: true, data: SCRAPE }) });
    const paste = new PasteService(browser.ports, { settings: memoryStore(), session: memoryStore() });
    const route = createRouter(browser.ports, FAST_CLIENT, paste, covers, undefined, undefined, undefined, fakeClock());
    expect(await route({ type: "scrape-track", url: TRACK, trackTitle: "Song" })).toMatchObject({
      ok: true,
      data: { coverArtUrl: "https://is1-ssl.mzstatic.com/cover.png" },
    });
    expect(searched).toEqual(["Song|Band"]);
  });
});
