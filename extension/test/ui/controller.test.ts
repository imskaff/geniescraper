import { describe, expect, it } from "vitest";
import { PanelController, MESSAGES, describeError } from "../../src/ui/controller";
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
