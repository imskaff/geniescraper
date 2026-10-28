import { describe, expect, it, vi } from "vitest";
import { PanelController, MESSAGES, YOUTUBE_WAIT_MS, describeError } from "../../src/ui/controller";
import type { Result, PageScrape } from "../../src/shared/messages";
import { ALBUM, SINGLE, deferred, fakeEnv, scrapeFor } from "./fakes";

const ALBUM_URL = ALBUM.url;

async function open(options: Parameters<typeof fakeEnv>[0] = {}) {
  const env = fakeEnv(options);
  return { env, panel: await PanelController.create(env) };
}

describe("starting up", () => {
  it("offers the Apple Music page the user is on as the link", async () => {
    const { panel } = await open({ tab: { tabId: 5, url: ALBUM_URL } });
    expect(panel.state.pageUrl).toBe(ALBUM_URL);
  });

  it.each(["https://example.com/", "chrome://newtab/", ""])("offers nothing for the tab %j", async (url) => {
    const { panel } = await open({ tab: { tabId: 5, url } });
    expect(panel.state.pageUrl).toBe("");
  });

  it("starts on the link screen with default settings", async () => {
    const { panel } = await open();
    expect(panel.state.session.screen).toBe("link");
    expect(panel.state.settings.scrapeCore).toBe(true);
  });
});

describe("detect", () => {
  it("refuses a link that is not Apple Music before asking the worker", async () => {
    const { env, panel } = await open();
    await panel.detect("https://example.com/album/1");
    expect(panel.state.error).toBe(MESSAGES.invalidLink);
    expect(env.api.calls).toEqual([]);
  });

  it("opens the track list with nothing picked: every choice is the user's own", async () => {
    const { panel } = await open();
    await panel.detect(`  ${ALBUM_URL}  `);
    expect(panel.state.session.screen).toBe("tracks");
    expect(panel.state.session.selected).toEqual([]);
    expect(panel.state.busy).toBeNull();
    expect(panel.state.status).toBe("");
  });

  it("reads the user's own tab when it shows that page, and opens a background tab otherwise", async () => {
    const own = await open({ tab: { tabId: 5, url: ALBUM_URL } });
    await own.panel.detect(ALBUM_URL);
    expect(own.env.api.calls[0]).toBe(`detect:${ALBUM_URL}:5`);

    const other = await open({ tab: { tabId: 5, url: "https://music.apple.com/us/album/other/1" } });
    await other.panel.detect(ALBUM_URL);
    expect(other.env.api.calls[0]).toBe(`detect:${ALBUM_URL}:undefined`);
  });

  it("shows the worker's failure in words and stays on the link screen", async () => {
    const { panel } = await open({
      api: { detect: () => Promise.resolve({ ok: false, error: { code: "not-found", message: "x" } }) },
    });
    await panel.detect(ALBUM_URL);
    expect(panel.state.error).toBe(describeError({ code: "not-found", message: "x" }));
    expect(panel.state.session.screen).toBe("link");
    expect(panel.state.busy).toBeNull();
  });

  it("goes straight to the credits for a single track, picking it itself", async () => {
    const { panel } = await open({ api: { detect: () => Promise.resolve({ ok: true, data: SINGLE }) } });
    await panel.detect(SINGLE.url);
    expect(panel.state.session.selected).toEqual([0]);
    expect(panel.state.session.screen).toBe("review");
  });

  it("goes straight to the credits when there is a single track", async () => {
    const { panel } = await open({ api: { detect: () => Promise.resolve({ ok: true, data: SINGLE }) } });
    await panel.detect(SINGLE.url);
    expect(panel.state.session.screen).toBe("review");
    expect(panel.state.session.results.map((r) => r.status)).toEqual(["done"]);
  });

  it("says so when no track has a page to read", async () => {
    const none = { ...ALBUM, trackUrls: ["", "", ""] };
    const { panel } = await open({ api: { detect: () => Promise.resolve({ ok: true, data: none }) } });
    await panel.detect(ALBUM_URL);
    expect(panel.state.error).toBe(MESSAGES.noPage);
  });
});

describe("choosing tracks", () => {
  it("toggles tracks, keeps them sorted, and never selects a track without a page", async () => {
    const { panel } = await open();
    await panel.detect(ALBUM_URL);
    expect(panel.state.session.selected).toEqual([]);
    await panel.setTrackSelected(2, true);
    await panel.setTrackSelected(0, true);
    await panel.setTrackSelected(1, true); // unavailable
    expect(panel.state.session.selected).toEqual([0, 2]);
    await panel.setTrackSelected(0, false);
    expect(panel.state.session.selected).toEqual([2]);
    await panel.setTrackSelected(0, true);
    expect(panel.state.session.selected).toEqual([0, 2]);
    await panel.setAllSelected(false);
    expect(panel.state.session.selected).toEqual([]);
    await panel.setAllSelected(true);
    expect(panel.state.session.selected).toEqual([0, 2]);
  });

  it("will not start with nothing picked", async () => {
    const { env, panel } = await open();
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(false);
    await panel.getCredits();
    expect(panel.state.error).toBe(MESSAGES.noTracks);
    expect(env.api.calls.filter((c) => c.startsWith("scrape"))).toEqual([]);
  });
});

describe("getting credits", () => {
  it("reads the picked tracks in order, one at a time, and keeps the album's copyright", async () => {
    const { env, panel } = await open();
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    await panel.getCredits();

    expect(env.api.calls.filter((c) => c.startsWith("scrape"))).toEqual([
      "scrape:https://music.apple.com/us/song/one/1",
      "scrape:https://music.apple.com/us/song/three/3",
    ]);
    const [first, second] = panel.state.session.results;
    expect(first?.status).toBe("done");
    expect(second?.song?.phonographicCopyright).toBe("℗ 2024 Demo Records");
    expect(second?.song?.coverArtUrl).toBe(ALBUM.coverArtUrl);
    expect(panel.state.busy).toBeNull();
    expect(panel.state.status).toBe("Got credits for 2 tracks.");
  });

  it("never has two reads in flight when set to 1", async () => {
    let inFlight = 0;
    let peak = 0;
    const { panel } = await open({
      api: {
        scrapeTrack: async (_url, title) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await Promise.resolve();
          inFlight--;
          return { ok: true, data: scrapeFor(title) };
        },
      },
    });
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    await panel.setSetting("parallelReads", 1);
    await panel.getCredits();
    expect(peak).toBe(1);
  });

  it("marks a failed track, goes on with the rest, and can retry it", async () => {
    let attempts = 0;
    const { panel } = await open({
      api: {
        scrapeTrack: (_url, title): Promise<Result<PageScrape>> => {
          attempts++;
          return Promise.resolve(
            attempts === 1
              ? { ok: false, error: { code: "timeout", message: "slow" } }
              : { ok: true, data: scrapeFor(title) },
          );
        },
      },
    });
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    await panel.getCredits();
    expect(panel.state.session.results.map((r) => r.status)).toEqual(["error", "done"]);
    expect(panel.state.session.results[0]?.error).toContain("too long");
    expect(panel.state.status).toBe("Got credits for 1 of 2 tracks; 1 failed.");

    await panel.retry(0);
    expect(panel.state.session.results.map((r) => r.status)).toEqual(["done", "done"]);
  });

  it("shows each track while the next is still loading", async () => {
    const gate = deferred<Result<PageScrape>>();
    let call = 0;
    const { panel } = await open({
      api: {
        scrapeTrack: (_url, title) =>
          ++call === 1 ? Promise.resolve({ ok: true, data: scrapeFor(title) }) : gate.promise,
      },
    });
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    const running = panel.getCredits();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(panel.state.session.results.map((r) => r.status)).toEqual(["done", "loading"]);
    expect(panel.state.busy).toBe("scrape");
    gate.resolve({ ok: true, data: scrapeFor("Three") });
    await running;
    expect(panel.state.session.results.map((r) => r.status)).toEqual(["done", "done"]);
  });

  it("drops a late answer after stop, leaving that track to be asked for again", async () => {
    const gate = deferred<Result<PageScrape>>();
    const { panel } = await open({ api: { scrapeTrack: () => gate.promise } });
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    const running = panel.getCredits();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await panel.stop();
    gate.resolve({ ok: true, data: scrapeFor("One") });
    await running;
    expect(panel.state.session.results.map((r) => r.status)).toEqual(["pending", "pending"]);
    expect(panel.state.busy).toBeNull();
    expect(panel.state.status).toBe("Stopped.");
  });

  it("builds the paste queue from the settings, without reading anything again", async () => {
    const { env, panel } = await open();
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    await panel.getCredits();
    const kinds = () => panel.queueFor(0).map(([kind]) => kind);

    expect(kinds()).toContain("written_by");
    expect(kinds()).toContain("phonographic_copyright");
    const reads = env.api.calls.length;

    await panel.setSetting("scrapeCore", false);
    await panel.setSetting("scrapeCopyright", false);
    expect(kinds()).not.toContain("written_by");
    expect(kinds()).not.toContain("phonographic_copyright");
    expect(kinds()).toContain("role");
    expect(env.api.calls).toHaveLength(reads);
  });

  it("shows and pastes roles under the names Genius uses", async () => {
    const credits = [
      { role: "Songwriter", artists: ["W"] },
      { role: "Programming", artists: ["P"] },
      { role: "Drum Programming", artists: ["D"] },
      { role: "Mixing Engineer", artists: ["M"] },
    ];
    const { panel, env } = await open({
      api: { scrapeTrack: (_url, title) => Promise.resolve({ ok: true, data: { ...scrapeFor(title), credits } }) },
    });
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    await panel.getCredits();

    const roles = panel
      .queueFor(0)
      .filter(([kind]) => kind === "role")
      .map(([, value]) => value);
    expect(roles).toEqual(["Programmer", "Drum Programmer", "Mixing Engineer"]);

    await panel.startPaste(0);
    expect(env.api.pasteState.queue.filter(([kind]) => kind === "role").map(([, value]) => value)).toEqual(roles);
  });

  it("has an empty queue for a track whose credits are not in yet", async () => {
    const { panel } = await open();
    await panel.detect(ALBUM_URL);
    expect(panel.queueFor(0)).toEqual([]);
  });
});

describe("reading tracks in parallel", () => {
  /** Count how many reads are waiting at once, answering each when `release` is called. */
  function gated() {
    const waiting: { resolve: () => void; title: string }[] = [];
    let peak = 0;
    const scrapeTrack = (_url: string, title: string): Promise<Result<PageScrape>> =>
      new Promise((resolve) => {
        waiting.push({
          title,
          resolve: () => {
            resolve({ ok: true, data: scrapeFor(title) });
          },
        });
        peak = Math.max(peak, waiting.length);
      });
    return {
      scrapeTrack,
      peak: () => peak,
      waiting: () => waiting.length,
      release: () => {
        waiting.splice(0).forEach((w) => {
          w.resolve();
        });
      },
    };
  }
  const tick = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("reads three tracks at a time unless told otherwise", async () => {
    const { panel } = await open();
    expect(panel.state.settings.parallelReads).toBe(3);
  });

  it("reads one track at a time when set to 1", async () => {
    const gate = gated();
    const { panel } = await open({ api: { scrapeTrack: gate.scrapeTrack } });
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    await panel.setSetting("parallelReads", 1);
    const run = panel.getCredits();
    await tick();
    expect(gate.waiting()).toBe(1);
    gate.release();
    await tick();
    expect(gate.waiting()).toBe(1);
    gate.release();
    await run;
    expect(gate.peak()).toBe(1);
  });

  it.each([
    [2, 2],
    [0, 2],
  ])("with %i at once it has %i reads waiting together, and ends with every track done", async (setting, expected) => {
    const gate = gated();
    const { panel } = await open({ api: { scrapeTrack: gate.scrapeTrack } });
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    await panel.setSetting("parallelReads", setting);
    const run = panel.getCredits();
    await tick();
    expect(gate.waiting()).toBe(expected);
    expect(panel.state.session.results.map((r) => r.status)).toEqual(["loading", "loading"]);
    gate.release();
    await run;
    expect(panel.state.session.results.map((r) => r.status)).toEqual(["done", "done"]);
    expect(panel.state.busy).toBeNull();
    expect(panel.state.status).toBe("Got credits for 2 tracks.");
  });

  it("never reads a track twice", async () => {
    const gate = gated();
    const { env, panel } = await open({ api: { scrapeTrack: gate.scrapeTrack } });
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    await panel.setSetting("parallelReads", 0);
    const run = panel.getCredits();
    await tick();
    gate.release();
    await run;
    expect(env.api.calls.filter((c) => c.startsWith("scrape"))).toHaveLength(2);
  });

  it("keeps the other tracks when one read fails, and says how many failed", async () => {
    const { panel } = await open({
      api: {
        scrapeTrack: (_url, title) =>
          Promise.resolve(
            title === "One"
              ? { ok: false, error: { code: "timeout", message: "slow" } }
              : { ok: true, data: scrapeFor(title) },
          ),
      },
    });
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    await panel.setSetting("parallelReads", 0);
    await panel.getCredits();
    expect(panel.state.session.results.map((r) => r.status)).toEqual(["error", "done"]);
    expect(panel.state.status).toBe("Got credits for 1 of 2 tracks; 1 failed.");
  });

  it("drops every late answer when stopped", async () => {
    const gate = gated();
    const { panel } = await open({ api: { scrapeTrack: gate.scrapeTrack } });
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    await panel.setSetting("parallelReads", 0);
    const run = panel.getCredits();
    await tick();
    await panel.stop();
    gate.release();
    await run;
    expect(panel.state.session.results.map((r) => r.status)).toEqual(["pending", "pending"]);
    expect(panel.state.busy).toBeNull();
  });
});

describe("navigation", () => {
  it("goes back to the track list and starts over with a new link", async () => {
    const { panel } = await open();
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    await panel.getCredits();
    await panel.showTrack(2);
    expect(panel.state.session.current).toBe(2);
    await panel.backToTracks();
    expect(panel.state.session.screen).toBe("tracks");
    await panel.newAlbum();
    expect(panel.state.session).toMatchObject({ screen: "link", album: null, results: [], selected: [] });
  });

  it("drops the last job's progress message when settings open", async () => {
    const { panel } = await open();
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    await panel.getCredits();
    expect(panel.state.status).not.toBe("");
    panel.openSettings();
    expect(panel.state.status).toBe("");
  });

  it("notifies subscribers of every change, until they unsubscribe", async () => {
    const { panel } = await open();
    let notified = 0;
    const stop = panel.subscribe(() => notified++);
    panel.openSettings();
    expect(notified).toBe(1);
    expect(panel.state.settingsOpen).toBe(true);
    stop();
    panel.closeSettings();
    expect(notified).toBe(1);
  });
});

describe("persistence", () => {
  it("keeps the session, so closing and reopening the panel loses nothing", async () => {
    const first = await open();
    await first.panel.detect(ALBUM_URL);
    await first.panel.setAllSelected(true);
    await first.panel.getCredits();

    const second = await PanelController.create({
      ...first.env,
      stores: { settings: first.env.settingsStore, session: first.env.sessionStore },
    });
    expect(second.state.session.screen).toBe("review");
    expect(second.state.session.results.map((r) => r.status)).toEqual(["done", "done"]);
    expect(second.queueFor(0).length).toBeGreaterThan(0);
  });

  it("carries on with a track that was mid-read when the panel closed", async () => {
    const first = await open();
    await first.panel.detect(ALBUM_URL);
    const stored = first.env.sessionStore.data.get("session") as { results: unknown[]; screen: string };
    stored.screen = "review";
    stored.results = [{ index: 0, title: "One", url: ALBUM.trackUrls[0], status: "loading", song: null, error: "" }];

    const env = fakeEnv({ session: stored });
    const panel = await PanelController.create(env);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(env.api.calls).toEqual([`scrape:${ALBUM.trackUrls[0] ?? ""}`]);
    expect(panel.state.session.results[0]?.status).toBe("done");
  });

  it("saves settings as they change and loads them next time", async () => {
    const { env, panel } = await open();
    await panel.setSetting("scrapeYoutube", false);
    expect(env.settingsStore.data.get("settings")).toMatchObject({ scrapeYoutube: false });
    const reopened = await PanelController.create({
      ...env,
      stores: { settings: env.settingsStore, session: env.sessionStore },
    });
    expect(reopened.state.settings.scrapeYoutube).toBe(false);
  });

  it("works on when storage cannot be written", async () => {
    const env = fakeEnv();
    env.settingsStore.set = () => Promise.reject(new Error("quota"));
    env.sessionStore.set = () => Promise.reject(new Error("quota"));
    const panel = await PanelController.create(env);
    await panel.setSetting("scrapeCore", false);
    await panel.detect(ALBUM_URL);
    expect(panel.state.settings.scrapeCore).toBe(false);
    expect(panel.state.session.screen).toBe("tracks");
  });
});

describe("describeError", () => {
  it.each(["bad-request", "invalid-url", "not-found", "timeout", "tab-failed", "internal"] as const)(
    "words %s",
    (code) => {
      expect(describeError({ code, message: "detail" }).length).toBeGreaterThan(10);
    },
  );
});

describe("optional hosts", () => {
  it("starts from what Chrome reports, not from anything saved", async () => {
    const { panel } = await open({ hosts: { deezer: true } });
    expect(panel.state.hosts).toEqual({ deezer: true, youtube: false, youtubeApi: false });
  });

  it("asks Chrome before it waits for anything, because the prompt needs the click", async () => {
    const { env, panel } = await open();
    void panel.setHost("deezer", true);
    expect(env.hosts.log).toEqual(["request:deezer"]);
  });

  it("turns the host on when Chrome grants it", async () => {
    const { env, panel } = await open();
    await panel.setHost("deezer", true);
    expect(panel.state.hosts.deezer).toBe(true);
    expect(env.hosts.state.deezer).toBe(true);
    expect(panel.state.status).toBe("");
  });

  it("leaves it off, and says so, when the user declines the prompt", async () => {
    const { env, panel } = await open();
    env.hosts.allow = false;
    await panel.setHost("deezer", true);
    expect(panel.state.hosts.deezer).toBe(false);
    expect(panel.state.error).toBe("Chrome did not grant access, so that look-up stays off.");
  });

  it("takes the permission back when it is turned off", async () => {
    const { env, panel } = await open({ hosts: { deezer: true } });
    await panel.setHost("deezer", false);
    expect(env.hosts.log).toEqual(["remove:deezer"]);
    expect(panel.state.hosts.deezer).toBe(false);
  });

  it("follows a permission changed elsewhere, such as taken back in chrome://extensions", async () => {
    const { env, panel } = await open({ hosts: { deezer: true } });
    env.hosts.changeElsewhere("deezer", false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.state.hosts.deezer).toBe(false);
  });

  it("says why when Chrome rejects the request, and what to do about a manifest that was not reloaded", async () => {
    const { env, panel } = await open();
    env.hosts.request = () => Promise.reject(new Error("Only optional permissions can be requested"));
    await panel.setHost("deezer", true);
    expect(panel.state.hosts.deezer).toBe(false);
    expect(panel.state.error).toContain("Only optional permissions can be requested");
    expect(panel.state.error).toContain("reload it in chrome://extensions");
  });
});

describe("the YouTube link of a track", () => {
  const LINK = "https://www.youtube.com/watch?v=abcDEF_-123";
  const FOUND = {
    ok: true as const,
    data: { url: LINK, isMusicVideo: true, throttled: false, keyProblem: "" as const },
  };
  const NOTHING = {
    ok: true as const,
    data: { url: "", isMusicVideo: false, throttled: false, keyProblem: "" as const },
  };
  const THROTTLED = {
    ok: true as const,
    data: { url: "", isMusicVideo: false, throttled: true, keyProblem: "" as const },
  };

  async function ready(options: Parameters<typeof fakeEnv>[0] = {}) {
    const ui = await open({ hosts: { youtube: true }, ...options });
    await ui.panel.detect(ALBUM_URL);
    await ui.panel.setAllSelected(true);
    await ui.panel.getCredits();
    return ui;
  }
  const lookups = (env: Awaited<ReturnType<typeof ready>>["env"]) =>
    env.api.calls.filter((c) => c.startsWith("youtube:"));

  it("is not looked up while an album is read, except for the track in front of the user", async () => {
    const { env } = await ready({ api: { lookupYoutube: () => Promise.resolve(FOUND) } });
    expect(lookups(env)).toHaveLength(1);
  });

  it("is looked up for the track in front of the user once its credits are in, so Start pasting does not wait", async () => {
    const { panel } = await ready({ api: { lookupYoutube: () => Promise.resolve(FOUND) } });
    expect(panel.state.session.results[0]?.song).toMatchObject({ youtubeUrl: LINK, youtubeIsMv: true });
    expect(panel.state.session.results[1]?.song?.youtubeUrl).toBe("");
  });

  it("is looked up for another track when the user starts pasting it, with the song's own artist", async () => {
    const { env, panel } = await ready({ api: { lookupYoutube: () => Promise.resolve(FOUND) } });
    await panel.startPaste(2);
    expect(lookups(env)).toHaveLength(2);
    expect(lookups(env)[1]).toBe("youtube:Demo Artist / Three");
    expect(panel.state.session.results[1]?.song?.youtubeUrl).toBe(LINK);
    expect(env.api.pasteState.queue.some(([kind, value]) => kind === "youtube_url" && value === LINK)).toBe(true);
  });

  it("is asked once per track, however often pasting starts", async () => {
    const { env, panel } = await ready({ api: { lookupYoutube: () => Promise.resolve(FOUND) } });
    await panel.startPaste(0);
    await panel.startPaste(0);
    expect(lookups(env)).toHaveLength(1);
  });

  it("waits for a look-up already running instead of asking again", async () => {
    const gate = deferred<typeof FOUND>();
    const { env, panel } = await ready({ api: { lookupYoutube: () => gate.promise } });
    const started = panel.startPaste(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(env.api.pasteState.active).toBe(false);
    gate.resolve(FOUND);
    await started;
    expect(env.api.pasteState.active).toBe(true);
    expect(lookups(env)).toHaveLength(1);
  });

  it("is not asked at all while the permission is off or the YouTube link setting is off", async () => {
    const off = await ready({ hosts: { youtube: false }, api: { lookupYoutube: () => Promise.resolve(FOUND) } });
    await off.panel.startPaste(0);
    expect(lookups(off.env)).toEqual([]);
    const unticked = await ready({ api: { lookupYoutube: () => Promise.resolve(FOUND) } });
    expect(lookups(unticked.env)).toHaveLength(1);
    const fresh = await open({ hosts: { youtube: true }, settings: { scrapeYoutube: false } });
    await fresh.panel.detect(ALBUM_URL);
    await fresh.panel.setAllSelected(true);
    await fresh.panel.getCredits();
    await fresh.panel.startPaste(0);
    expect(lookups(fresh.env)).toEqual([]);
  });

  it("still pastes when none is found, without asking for that track again", async () => {
    const { env, panel } = await ready({ api: { lookupYoutube: () => Promise.resolve(NOTHING) } });
    await panel.startPaste(0);
    expect(env.api.pasteState.active).toBe(true);
    expect(env.api.pasteState.queue.some(([kind]) => kind === "youtube_url")).toBe(false);
    expect(lookups(env)).toHaveLength(1);
  });

  it("says no link was found, right after the look-up", async () => {
    const { panel } = await ready({ api: { lookupYoutube: () => Promise.resolve(NOTHING) } });
    await panel.ensureYoutube(2, true);
    expect(panel.state.status).toBe(MESSAGES.noYoutube);
  });

  it("says YouTube is limiting requests when it is, and asks again next time", async () => {
    const { env, panel } = await ready({ api: { lookupYoutube: () => Promise.resolve(THROTTLED) } });
    await panel.ensureYoutube(0, true);
    expect(panel.state.status).toBe(MESSAGES.youtubeThrottled);
    await panel.startPaste(0);
    expect(lookups(env)).toHaveLength(3);
  });

  it("pastes without the link when the look-up fails outright", async () => {
    const { env, panel } = await ready({
      api: { lookupYoutube: () => Promise.resolve({ ok: false, error: { code: "internal", message: "x" } }) },
    });
    await panel.startPaste(0);
    expect(env.api.pasteState.active).toBe(true);
    expect(panel.state.session.results[0]?.song?.youtubeUrl).toBe("");
  });

  it("leaves the YouTube step out of the queue when the setting is turned off afterwards", async () => {
    const { panel } = await ready({ api: { lookupYoutube: () => Promise.resolve(FOUND) } });
    await panel.setSetting("scrapeYoutube", false);
    expect(panel.queueFor(0).some(([kind]) => kind === "youtube_url")).toBe(false);
  });

  it("drops an answer that arrives after the panel moved to another album", async () => {
    const gate = deferred<typeof FOUND>();
    const { panel } = await ready({ api: { lookupYoutube: () => gate.promise } });
    await panel.newAlbum();
    gate.resolve(FOUND);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.state.session.results).toEqual([]);
  });
});

describe("the user's own YouTube key", () => {
  const KEY = "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";
  const found = {
    ok: true as const,
    data: {
      url: "https://www.youtube.com/watch?v=abcDEF_-123",
      isMusicVideo: false,
      throttled: false,
      keyProblem: "" as const,
    },
  };

  it("starts with no key saved, and knows about one that is", async () => {
    expect((await open()).panel.state.youtubeKey.saved).toBe(false);
    expect((await open({ youtubeKey: KEY })).panel.state.youtubeKey.saved).toBe(true);
  });

  it("asks Chrome for Google's permission before waiting for anything, once the key has the right shape", async () => {
    const { env, panel } = await open();
    void panel.saveYoutubeKey(KEY);
    expect(env.hosts.log).toEqual(["request:youtubeApi"]);
  });

  it("does not bother Chrome with something that is not a key, and says what a key looks like", async () => {
    const { env, panel } = await open();
    await panel.saveYoutubeKey("hello");
    expect(env.hosts.log).toEqual([]);
    expect(panel.state.youtubeKey.message).toContain("starts with AIza");
    await panel.saveYoutubeKey("   ");
    expect(panel.state.youtubeKey.message).toBe("Paste your key into the box first.");
    expect(env.api.calls).not.toContain("key-check");
  });

  it("cleans quotes and spaces from a pasted key", async () => {
    const { env, panel } = await open();
    await panel.saveYoutubeKey(`  "${KEY}" \n`);
    expect(env.secretsStore.data.get("youtubeApiKey")).toBe(KEY);
  });

  it("keeps a key that Google accepts, and says so", async () => {
    const { env, panel } = await open();
    await panel.saveYoutubeKey(KEY);
    expect(env.secretsStore.data.get("youtubeApiKey")).toBe(KEY);
    expect(panel.state.youtubeKey).toMatchObject({ saved: true, busy: false });
    expect(panel.state.youtubeKey.message).toContain("Key saved and working");
    expect(panel.state.hosts.youtubeApi).toBe(true);
  });

  it("keeps nothing when Google rejects the key, and says what to do", async () => {
    const { env, panel } = await open({ api: { checkYoutubeKey: () => Promise.resolve({ ok: true, data: "key" }) } });
    await panel.saveYoutubeKey(KEY);
    expect(env.secretsStore.data.get("youtubeApiKey")).toBeUndefined();
    expect(panel.state.youtubeKey.saved).toBe(false);
    expect(panel.state.youtubeKey.message).toContain("did not accept this key");
  });

  it.each([
    ["quota", "allowance for today is used up"],
    ["not-enabled", "not switched on yet"],
  ] as const)("keeps a right key that cannot be used yet (%s), and explains", async (outcome, words) => {
    const { env, panel } = await open({ api: { checkYoutubeKey: () => Promise.resolve({ ok: true, data: outcome }) } });
    await panel.saveYoutubeKey(KEY);
    expect(env.secretsStore.data.get("youtubeApiKey")).toBe(KEY);
    expect(panel.state.youtubeKey.saved).toBe(true);
    expect(panel.state.youtubeKey.message).toContain(words);
  });

  it("keeps nothing and says so when Google cannot be reached", async () => {
    const { env, panel } = await open({
      api: { checkYoutubeKey: () => Promise.resolve({ ok: false, error: { code: "internal", message: "x" } }) },
    });
    await panel.saveYoutubeKey(KEY);
    expect(env.secretsStore.data.get("youtubeApiKey")).toBeUndefined();
    expect(panel.state.youtubeKey.message).toContain("Could not reach Google");
  });

  it("does not check the key when the user declines Chrome's prompt, and asks them to try again", async () => {
    const { env, panel } = await open();
    env.hosts.allow = false;
    await panel.saveYoutubeKey(KEY);
    expect(env.api.calls).not.toContain("key-check");
    expect(panel.state.youtubeKey).toMatchObject({ saved: false, busy: false });
    expect(panel.state.youtubeKey.message).toContain("Press Save again and choose Allow");
  });

  it("ignores a second press while one is being checked", async () => {
    const gate = deferred<{ ok: true; data: "ok" }>();
    const { env, panel } = await open({ api: { checkYoutubeKey: () => gate.promise } });
    const first = panel.saveYoutubeKey(KEY);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await panel.saveYoutubeKey(KEY);
    gate.resolve({ ok: true, data: "ok" });
    await first;
    expect(env.api.calls.filter((c) => c === "key-check")).toHaveLength(1);
  });

  it("forgets the key and takes back the permission when removed", async () => {
    const { env, panel } = await open({ youtubeKey: KEY, hosts: { youtubeApi: true } });
    await panel.removeYoutubeKey();
    expect(env.secretsStore.data.get("youtubeApiKey")).toBe("");
    expect(panel.state.youtubeKey).toMatchObject({ saved: false });
    expect(env.hosts.log).toEqual(["remove:youtubeApi"]);
    expect(panel.state.hosts.youtubeApi).toBe(false);
  });

  it("never puts the key itself into the panel's state", async () => {
    const { panel } = await open();
    await panel.saveYoutubeKey(KEY);
    expect(JSON.stringify(panel.state)).not.toContain(KEY);
  });

  it("looks up YouTube links with a saved key even when the page-reading permission is off", async () => {
    const { env, panel } = await open({
      youtubeKey: KEY,
      hosts: { youtubeApi: true },
      api: { lookupYoutube: () => Promise.resolve(found) },
    });
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    await panel.getCredits();
    expect(env.api.calls.some((c) => c.startsWith("youtube:"))).toBe(true);
    expect(panel.state.session.results[0]?.song?.youtubeUrl).toContain("abcDEF_-123");
  });

  it("looks up every track of the album as it is read with a saved key, but only the first without one", async () => {
    const run = async (options: Parameters<typeof open>[0]) => {
      const { env, panel } = await open(options);
      await panel.detect(ALBUM_URL);
      await panel.setAllSelected(true);
      await panel.getCredits();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { env, panel };
    };
    const withKey = await run({
      youtubeKey: KEY,
      hosts: { youtubeApi: true },
      api: { lookupYoutube: () => Promise.resolve(found) },
    });
    expect(withKey.env.api.calls.filter((c) => c.startsWith("youtube:"))).toHaveLength(2);
    expect(withKey.panel.state.session.results.every((r) => r.song?.youtubeUrl)).toBe(true);
    const without = await run({ hosts: { youtube: true }, api: { lookupYoutube: () => Promise.resolve(found) } });
    expect(without.env.api.calls.filter((c) => c.startsWith("youtube:"))).toHaveLength(1);
  });

  it("does not look up with a saved key when Chrome's permission for Google's service is gone", async () => {
    const { env, panel } = await open({ youtubeKey: KEY });
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    await panel.getCredits();
    expect(env.api.calls.some((c) => c.startsWith("youtube:"))).toBe(false);
  });

  it.each([
    ["key", "did not accept your YouTube key"],
    ["quota", "allowance for today is used up"],
    ["not-enabled", "not switched on"],
  ] as const)("tells the user when a lookup could not use the key (%s)", async (problem, words) => {
    const { panel } = await open({
      youtubeKey: KEY,
      hosts: { youtubeApi: true },
      api: {
        lookupYoutube: () =>
          Promise.resolve({ ok: true, data: { url: "", isMusicVideo: false, throttled: false, keyProblem: problem } }),
      },
    });
    await panel.detect(ALBUM_URL);
    await panel.setAllSelected(true);
    await panel.getCredits();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.state.status).toContain(words);
  });
});

describe("what became of each track's YouTube look-up", () => {
  const LINK = "https://www.youtube.com/watch?v=abcDEF_-123";
  const answer = (
    url: string,
    extra: Partial<{ throttled: boolean; keyProblem: "" | "key" | "quota" | "not-enabled" }> = {},
  ) =>
    Promise.resolve({
      ok: true as const,
      data: { url, isMusicVideo: false, throttled: false, keyProblem: "" as const, ...extra },
    });
  const KEY = "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";

  async function readAlbum(options: Parameters<typeof open>[0]) {
    const ui = await open({ youtubeKey: KEY, hosts: { youtubeApi: true }, ...options });
    await ui.panel.detect(ALBUM_URL);
    await ui.panel.setAllSelected(true);
    await ui.panel.getCredits();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return ui;
  }

  it("has no note for a track that got its link", async () => {
    const { panel } = await readAlbum({ api: { lookupYoutube: () => answer(LINK) } });
    expect(panel.state.youtubeNotes).toEqual({});
  });

  it("says plainly that no link was found, for each track that has none", async () => {
    const { panel } = await readAlbum({ api: { lookupYoutube: () => answer("") } });
    expect(panel.state.youtubeNotes).toEqual({
      0: "No link found for this track.",
      2: "No link found for this track.",
    });
  });

  it("says YouTube is limiting requests, or that the key is the problem, when that is why", async () => {
    const limited = await readAlbum({ api: { lookupYoutube: () => answer("", { throttled: true }) } });
    expect(limited.panel.state.youtubeNotes[0]).toContain("limiting requests");
    const quota = await readAlbum({ api: { lookupYoutube: () => answer("", { keyProblem: "quota" }) } });
    expect(quota.panel.state.youtubeNotes[0]).toContain("allowance for today is used up");
  });

  it("says the look-up did not finish when the worker failed to answer", async () => {
    const { panel } = await readAlbum({
      api: { lookupYoutube: () => Promise.resolve({ ok: false, error: { code: "internal", message: "x" } }) },
    });
    expect(panel.state.youtubeNotes[0]).toBe("The look-up did not finish.");
  });

  it("shows that it is looking while it is", async () => {
    const gate = deferred<Awaited<ReturnType<typeof answer>>>();
    const { panel } = await readAlbum({ api: { lookupYoutube: () => gate.promise } });
    expect(panel.state.youtubeNotes[0]).toBe("Looking for it…");
    gate.resolve(await answer(LINK));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.state.youtubeNotes[0]).toBeUndefined();
  });

  it("starts afresh for another album: its tracks are asked about again, whatever the first album's were", async () => {
    const ui = await readAlbum({ api: { lookupYoutube: () => answer(LINK) } });
    const before = ui.env.api.calls.filter((c) => c.startsWith("youtube:")).length;
    await ui.panel.newAlbum();
    await ui.panel.detect(ALBUM_URL);
    await ui.panel.setAllSelected(true);
    await ui.panel.getCredits();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ui.env.api.calls.filter((c) => c.startsWith("youtube:")).length).toBe(before * 2);
    expect(ui.panel.state.youtubeNotes).toEqual({});
  });
});

describe("YouTube look-ups and the status line", () => {
  const found = {
    ok: true as const,
    data: {
      url: "https://www.youtube.com/watch?v=abcDEF_-123",
      isMusicVideo: false,
      throttled: false,
      keyProblem: "" as const,
    },
  };
  const nothing = {
    ok: true as const,
    data: { url: "", isMusicVideo: false, throttled: false, keyProblem: "" as const },
  };

  async function read(api: Parameters<typeof open>[0]) {
    const ui = await open({ hosts: { youtube: true }, ...api });
    await ui.panel.detect(ALBUM_URL);
    await ui.panel.setAllSelected(true);
    await ui.panel.getCredits();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return ui;
  }

  it("leaves the read's summary alone when a look-up started by the read finishes", async () => {
    const { panel } = await read({ api: { lookupYoutube: () => Promise.resolve(nothing) } });
    expect(panel.state.status).toBe("Got credits for 2 tracks.");
    const found2 = await read({ api: { lookupYoutube: () => Promise.resolve(found) } });
    expect(found2.panel.state.status).toBe("Got credits for 2 tracks.");
  });

  it("still tells the track's own note why it has no link", async () => {
    const { panel } = await read({ api: { lookupYoutube: () => Promise.resolve(nothing) } });
    expect(panel.state.youtubeNotes[0]).toBe("No link found for this track.");
  });

  it("does not wait for ever for a slow look-up: pasting starts without the link after the wait", async () => {
    const gate = deferred<typeof found>();
    const { env, panel } = await read({ api: { lookupYoutube: () => gate.promise } });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const started = panel.startPaste(0);
      await vi.advanceTimersByTimeAsync(YOUTUBE_WAIT_MS - 1);
      expect(env.api.pasteState.active).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await started;
      expect(env.api.pasteState.active).toBe(true);
      expect(env.api.pasteState.queue.some(([kind]) => kind === "youtube_url")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts at once when the look-up answers in time", async () => {
    const { env, panel } = await read({ api: { lookupYoutube: () => Promise.resolve(found) } });
    await panel.startPaste(0);
    expect(env.api.pasteState.active).toBe(true);
    expect(env.api.pasteState.queue.some(([kind]) => kind === "youtube_url")).toBe(true);
  });
});

describe("a YouTube link the user pastes", () => {
  const LINK = "https://www.youtube.com/watch?v=BY_XwvKogC8";
  async function ready(options: Parameters<typeof open>[0] = {}) {
    const ui = await open(options);
    await ui.panel.detect(ALBUM_URL);
    await ui.panel.setAllSelected(true);
    await ui.panel.getCredits();
    return ui;
  }

  it("goes onto the track and into its paste queue, in its canonical form", async () => {
    const { panel } = await ready();
    expect(await panel.setYoutubeLink(0, "  https://youtu.be/BY_XwvKogC8?si=abc  ")).toBe(true);
    expect(panel.state.session.results[0]?.song).toMatchObject({ youtubeUrl: LINK, youtubeByUser: true });
    expect(panel.queueFor(0).some(([kind, value]) => kind === "youtube_url" && value === LINK)).toBe(true);
    expect(panel.state.youtubeLinkError).toBe("");
  });

  it("replaces a link the look-up found", async () => {
    const found = {
      ok: true as const,
      data: {
        url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
        isMusicVideo: true,
        throttled: false,
        keyProblem: "" as const,
      },
    };
    const { panel } = await ready({ hosts: { youtube: true }, api: { lookupYoutube: () => Promise.resolve(found) } });
    expect(panel.state.session.results[0]?.song?.youtubeUrl).toContain("aaaaaaaaaaa");
    await panel.setYoutubeLink(0, LINK);
    expect(panel.state.session.results[0]?.song).toMatchObject({
      youtubeUrl: LINK,
      youtubeIsMv: false,
      youtubeByUser: true,
    });
  });

  it("is refused, with a message and no change, when it is not a link to one YouTube video", async () => {
    const { panel } = await ready();
    expect(await panel.setYoutubeLink(0, "https://example.com/watch?v=BY_XwvKogC8")).toBe(false);
    expect(panel.state.youtubeLinkError).toBe(MESSAGES.notAYoutubeLink);
    expect(panel.state.session.results[0]?.song?.youtubeUrl).toBe("");
    expect(await panel.setYoutubeLink(0, "   ")).toBe(false);
    expect(panel.state.youtubeLinkError).toBe(MESSAGES.pasteYoutubeLink);
  });

  it("can be taken off again", async () => {
    const { panel } = await ready();
    await panel.setYoutubeLink(0, LINK);
    await panel.clearYoutubeLink(0);
    expect(panel.state.session.results[0]?.song).toMatchObject({ youtubeUrl: "", youtubeIsMv: false });
    expect(panel.state.session.results[0]?.song?.youtubeByUser).toBeUndefined();
  });

  it("does nothing for a track whose credits are not in", async () => {
    const { panel } = await open();
    expect(await panel.setYoutubeLink(0, LINK)).toBe(false);
  });

  it("forgets the error when another track is shown", async () => {
    const { panel } = await ready();
    await panel.setYoutubeLink(0, "nope");
    await panel.showTrack(2);
    expect(panel.state.youtubeLinkError).toBe("");
  });

  it("survives the panel being closed and reopened, as part of the session", async () => {
    const { env, panel } = await ready();
    await panel.setYoutubeLink(0, LINK);
    const again = await PanelController.create(env);
    expect(again.state.session.results[0]?.song).toMatchObject({ youtubeUrl: LINK, youtubeByUser: true });
  });
});
