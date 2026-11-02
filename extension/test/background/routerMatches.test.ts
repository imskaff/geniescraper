import { describe, expect, it } from "vitest";
import { PasteService } from "../../src/background/paste";
import { createRouter } from "../../src/background/router";
import type { SongMatches, SongMatchTools } from "../../src/background/songMatches";
import type { SearchRow, SongMatchesAnswer } from "../../src/shared/messages";
import { isContentRequest, isGeniusNotice, isSongMatchesAnswer, isWorkerRequest } from "../../src/shared/messages";
import { memoryStore } from "../ui/fakes";
import { FAST_CLIENT, fakeBrowser } from "./fakePorts";

const NO_COVERS = { exact: () => Promise.resolve(""), search: () => Promise.resolve("") };

function build(browser: ReturnType<typeof fakeBrowser>, matches: SongMatches) {
  const paste = new PasteService(browser.ports, { settings: memoryStore(), session: memoryStore() });
  return createRouter(
    browser.ports,
    FAST_CLIENT,
    paste,
    NO_COVERS,
    undefined,
    undefined,
    undefined,
    undefined,
    matches,
  );
}

const READY: SongMatchesAnswer = {
  status: "ready",
  path: "/x-lyrics",
  title: "X",
  artists: ["A"],
  apple: { status: "none" },
  spotify: { status: "none" },
};

const ROW: SearchRow = {
  title: "Fortnight",
  artists: ["Taylor Swift"],
  album: "TTPD",
  href: "https://open.spotify.com/track/1jX3nPWUbEQVGxMBb7NPXp",
};

describe("the song-matches request", () => {
  it.each([{ type: "song-matches" }, { type: "song-matches", tabId: "5" }, { type: "song-matches", tabId: 1.5 }])(
    "rejects the malformed request %j",
    async (raw) => {
      const browser = fakeBrowser();
      const route = build(browser, { resolve: () => Promise.reject(new Error("never")) });
      expect(await route(raw)).toMatchObject({ ok: false, error: { code: "bad-request" } });
    },
  );

  it("hands the tab to the resolver and keeps the worker awake meanwhile", async () => {
    const browser = fakeBrowser();
    const seen: string[] = [];
    const route = build(browser, {
      resolve: (tabId) => {
        seen.push(`${String(tabId)}|${String(browser.keepAliveActive())}`);
        return Promise.resolve({ ok: true, data: READY });
      },
    });
    expect(await route({ type: "song-matches", tabId: 5 })).toEqual({ ok: true, data: READY });
    expect(seen).toEqual(["5|1"]);
    expect(browser.keepAliveActive()).toBe(0);
  });

  it("answers with an internal error, never a rejection, when the resolver throws", async () => {
    const route = build(fakeBrowser(), { resolve: () => Promise.reject(new Error("boom")) });
    const answer = await route({ type: "song-matches", tabId: 5 });
    expect(answer).toMatchObject({ ok: false, error: { code: "internal" } });
    expect(JSON.stringify(answer)).not.toContain("boom");
  });

  /** The tools the router lends the resolver: capture them by resolving once. */
  async function toolsOf(route: ReturnType<typeof build>, grab: { tools?: SongMatchTools }): Promise<SongMatchTools> {
    await route({ type: "song-matches", tabId: 5 });
    if (!grab.tools) throw new Error("no tools");
    return grab.tools;
  }

  function withTools(browser: ReturnType<typeof fakeBrowser>) {
    const grab: { tools?: SongMatchTools } = {};
    const route = build(browser, {
      resolve: (_tabId, tools) => {
        grab.tools = tools;
        return Promise.resolve({ ok: true, data: READY });
      },
    });
    return { route, grab };
  }

  it("reads a Spotify search page in one hidden tab, marked as a reader tab, and closes it", async () => {
    const browser = fakeBrowser({ answer: () => Promise.resolve({ ok: true, data: [ROW] }) });
    const { route, grab } = withTools(browser);
    const tools = await toolsOf(route, grab);
    expect(await tools.spotifySearch("Fortnight Taylor Swift")).toEqual({ ok: true, data: [ROW] });
    expect(browser.log).toEqual([
      "guard:spotify/guard.js",
      "create:https://open.spotify.com/search/Fortnight%20Taylor%20Swift/tracks?locale=en&geniescraper=read:active=false",
      "inject:1000",
      "send:1000:spotify/search",
      "remove:1000",
    ]);
    expect(browser.openTabs.size).toBe(0);
  });

  it("closes the tab and answers with the failure when the page does not answer", async () => {
    const browser = fakeBrowser({ answer: () => new Promise(() => undefined) });
    const { route, grab } = withTools(browser);
    const tools = await toolsOf(route, grab);
    expect(await tools.spotifySearch("x")).toMatchObject({ ok: false, error: { code: "timeout" } });
    expect(browser.openTabs.size).toBe(0);
  });

  it("opens one search tab at a time", async () => {
    const browser = fakeBrowser({ answer: () => Promise.resolve({ ok: true, data: [ROW] }), loadingPolls: 3 });
    const { route, grab } = withTools(browser);
    const tools = await toolsOf(route, grab);
    await Promise.all([tools.spotifySearch("a"), tools.spotifySearch("b"), tools.spotifySearch("c")]);
    expect(browser.maxOpenTabs()).toBe(1);
  });

  it("stops searching Spotify for a while after it asks for a captcha", async () => {
    const browser = fakeBrowser({
      answer: () =>
        Promise.resolve({ ok: false, error: { code: "blocked", message: "Spotify is asking for a captcha." } }),
    });
    const { route, grab } = withTools(browser);
    const tools = await toolsOf(route, grab);
    expect(await tools.spotifySearch("a")).toMatchObject({ ok: false, error: { code: "blocked" } });
    const opened = browser.log.filter((line) => line.startsWith("create:")).length;
    expect(await tools.spotifySearch("b")).toMatchObject({ ok: false, error: { code: "blocked" } });
    expect(browser.log.filter((line) => line.startsWith("create:"))).toHaveLength(opened);
  });
});

describe("the messages of the feature", () => {
  it("accepts the new requests and notices, and nothing near them", () => {
    expect(isWorkerRequest({ type: "song-matches", tabId: 5 })).toBe(true);
    expect(isWorkerRequest({ type: "genius-open", title: "A", artist: "B", tabId: 5 })).toBe(true);
    expect(isWorkerRequest({ type: "genius-open", title: "A", artist: "B", tabId: "5" })).toBe(false);
    expect(isGeniusNotice({ type: "genius/song-info" })).toBe(true);
    expect(isContentRequest({ type: "spotify/search", url: "https://open.spotify.com/search/x/tracks" })).toBe(true);
  });

  it("checks the shape of an answer", () => {
    expect(isSongMatchesAnswer(READY)).toBe(true);
    expect(isSongMatchesAnswer({ status: "not-song" })).toBe(true);
    expect(isSongMatchesAnswer({ ...READY, apple: { status: "found", url: "u" } })).toBe(false);
    expect(isSongMatchesAnswer({ ...READY, spotify: { status: "failed" } })).toBe(false);
    expect(isSongMatchesAnswer({ status: "ready" })).toBe(false);
  });
});

describe("opening the form on the Genius page the read started from", () => {
  it("is asked of the navigator with the tab", async () => {
    const browser = fakeBrowser();
    const asked: (number | undefined)[] = [];
    const paste = new PasteService(browser.ports, { settings: memoryStore(), session: memoryStore() });
    const route = createRouter(browser.ports, FAST_CLIENT, paste, NO_COVERS, undefined, undefined, {
      open: (_title, _artist, tabId) => {
        asked.push(tabId);
        return Promise.resolve({ status: "opened" as const });
      },
    });
    await route({ type: "genius-open", title: "A", artist: "B", tabId: 9 });
    await route({ type: "genius-open", title: "A", artist: "B" });
    expect(asked).toEqual([9, undefined]);
  });
});
