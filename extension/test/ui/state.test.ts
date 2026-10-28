import { describe, expect, it } from "vitest";
import { normaliseSession, EMPTY_SESSION } from "../../src/shared/session";
import { DEFAULT_SETTINGS, normaliseSettings, queueOptions } from "../../src/shared/settings";
import { loadSession, loadSettings } from "../../src/shared/storage";
import { ALBUM, fakeEnv, memoryStore } from "./fakes";

describe("normaliseSettings", () => {
  it.each([undefined, null, 5, "x", [], {}])("gives the defaults for %j", (raw) => {
    expect(normaliseSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });

  it("takes booleans and ignores everything else, field by field", () => {
    expect(normaliseSettings({ scrapeCore: false, scrapeYoutube: "no", scrapeCoverArt: 0, extra: true })).toEqual({
      ...DEFAULT_SETTINGS,
      scrapeCore: false,
      onboarded: true,
    });
  });

  it("maps onto the queue options", () => {
    expect(queueOptions({ ...DEFAULT_SETTINGS, scrapeAdditional: false })).toEqual({
      includeCore: true,
      includeAdditional: false,
      includeCopyright: true,
      includeYoutube: true,
      includeCoverArt: true,
    });
  });

  it("falls back to the defaults when storage throws", async () => {
    const throwing = { get: () => Promise.reject(new Error("gone")), set: () => Promise.resolve() };
    expect(await loadSettings({ settings: throwing, session: memoryStore() })).toEqual(DEFAULT_SETTINGS);
    expect(await loadSession({ settings: memoryStore(), session: throwing })).toEqual(EMPTY_SESSION);
  });
});

const TRACK = { index: 0, title: "One", url: ALBUM.trackUrls[0], status: "pending", song: null, error: "" };

describe("normaliseSession", () => {
  it.each([undefined, null, 5, "x", {}, { album: {} }, { album: { ...ALBUM, trackCount: "3" } }])(
    "is empty for %j",
    (raw) => {
      expect(normaliseSession(raw)).toEqual(EMPTY_SESSION);
    },
  );

  it("restores a valid session", () => {
    const stored = { screen: "review", album: ALBUM, selected: [0, 2], results: [TRACK], current: 0 };
    expect(normaliseSession(stored)).toEqual({ ...stored, results: [TRACK] });
  });

  it("restores a track that was loading as pending", () => {
    const session = normaliseSession({
      screen: "review",
      album: ALBUM,
      selected: [0],
      results: [{ ...TRACK, status: "loading" }],
      current: 0,
    });
    expect(session.results[0]?.status).toBe("pending");
  });

  it("drops out-of-range and duplicate selections", () => {
    const session = normaliseSession({
      screen: "tracks",
      album: ALBUM,
      selected: [0, 0, 2, 9, -1, 1.5, "x"],
      results: [],
      current: 0,
    });
    expect(session.selected).toEqual([0, 2]);
  });

  it("rejects a session with a malformed track", () => {
    for (const bad of [
      { ...TRACK, index: -1 },
      { ...TRACK, status: "weird" },
      { ...TRACK, status: "done", song: null },
      { ...TRACK, song: { title: "x" } },
      "nope",
    ]) {
      expect(normaliseSession({ screen: "review", album: ALBUM, selected: [], results: [bad], current: 0 })).toEqual(
        EMPTY_SESSION,
      );
    }
  });

  it("does not open the review screen when there is nothing to review", () => {
    expect(normaliseSession({ screen: "review", album: ALBUM, selected: [], results: [], current: 0 }).screen).toBe(
      "tracks",
    );
  });

  it("ignores an unknown screen name", () => {
    expect(normaliseSession({ screen: "admin", album: ALBUM, selected: [], results: [], current: 0 }).screen).toBe(
      "tracks",
    );
  });

  it("survives a round trip through the store", async () => {
    const env = fakeEnv();
    const session = { screen: "tracks", album: ALBUM, selected: [0], results: [], current: 0 } as const;
    await env.sessionStore.set("session", session);
    expect(await loadSession({ settings: env.settingsStore, session: env.sessionStore })).toEqual(session);
  });
});

describe("parallelReads setting", () => {
  it.each([1, 2, 3, 5, 0])("accepts %i", (value) => {
    expect(normaliseSettings({ parallelReads: value }).parallelReads).toBe(value);
  });

  it.each([4, -1, 100, 1.5, "3", null, undefined, Number.NaN])("falls back to three at a time for %j", (value) => {
    expect(normaliseSettings({ parallelReads: value }).parallelReads).toBe(3);
  });
});

describe("the automatic pasting pace", () => {
  it("defaults to 0.6 seconds between fields", () => {
    expect(DEFAULT_SETTINGS.autoPaceSeconds).toBe(0.6);
  });

  it.each([
    [0.2, 0.2],
    [1.5, 1.5],
    [5, 5],
    [0, 0.2],
    [99, 5],
  ])("keeps %j inside the range as %j", (value, expected) => {
    expect(normaliseSettings({ autoPaceSeconds: value }).autoPaceSeconds).toBe(expected);
  });

  it.each(["1", null, undefined, Number.NaN, Number.POSITIVE_INFINITY])("falls back to the default for %j", (value) => {
    expect(normaliseSettings({ autoPaceSeconds: value }).autoPaceSeconds).toBe(0.6);
  });
});

describe("the countdown settings", () => {
  it("default to 30 seconds back to the menu and 15 to the next track", () => {
    expect(DEFAULT_SETTINGS.returnSeconds).toBe(30);
    expect(DEFAULT_SETTINGS.nextTrackSeconds).toBe(15);
  });

  it.each([5, 20, 120])("accepts %i seconds for both", (value) => {
    const settings = normaliseSettings({ returnSeconds: value, nextTrackSeconds: value });
    expect([settings.returnSeconds, settings.nextTrackSeconds]).toEqual([value, value]);
  });

  it.each([
    [1, 5],
    [4, 5],
    [500, 120],
    [12.6, 13],
  ])("keeps %j inside the range as %i", (value, expected) => {
    expect(normaliseSettings({ returnSeconds: value }).returnSeconds).toBe(expected);
    expect(normaliseSettings({ nextTrackSeconds: value }).nextTrackSeconds).toBe(expected);
  });

  it("lets the next track wait for the user with zero, but never the menu countdown", () => {
    expect(normaliseSettings({ nextTrackSeconds: 0 }).nextTrackSeconds).toBe(0);
    expect(normaliseSettings({ returnSeconds: 0 }).returnSeconds).toBe(5);
  });

  it.each(["20", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}])(
    "falls back to the defaults for %j",
    (value) => {
      const settings = normaliseSettings({ returnSeconds: value, nextTrackSeconds: value });
      expect([settings.returnSeconds, settings.nextTrackSeconds]).toEqual([30, 15]);
    },
  );
});
