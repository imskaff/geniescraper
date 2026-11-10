import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSongMatches, type SongMatchTools } from "../../src/background/songMatches";
import type { GeniusSongInfo, Result, SearchRow, SongMatchesAnswer } from "../../src/shared/messages";
import { readSongInfo } from "../../src/genius/songState";
import { fakeBrowser } from "./fakePorts";

const TIMING = { loadMs: 200, askMs: 100, pollMs: 5 };
const PAGE = "https://genius.com/Taylor-swift-fortnight-lyrics";
const TAB = 5;

const FORTNIGHT: GeniusSongInfo = {
  path: "/Taylor-swift-fortnight-lyrics",
  title: "Fortnight",
  primary: ["Taylor Swift"],
  featured: ["Post Malone"],
  appleId: "1736268216",
  spotifyId: "",
};
const GOOD4U: GeniusSongInfo = {
  path: "/Olivia-rodrigo-good-4-u-lyrics",
  title: "good 4 u",
  primary: ["Olivia Rodrigo"],
  featured: [],
  appleId: "1560735551",
  spotifyId: "6PERP62TejQjgHu81OHxgM",
};

const itunesSong = (id: number, title: string, artist: string, release: string): unknown => ({
  wrapperType: "track",
  kind: "song",
  trackId: id,
  trackName: title,
  artistName: artist,
  collectionName: release,
});

/** A browser with the Genius tab showing `info`'s page (null: a page that is no song page). */
function setup(
  info: GeniusSongInfo | null,
  opts: {
    json?: (url: string) => unknown;
    search?: () => Promise<Result<SearchRow[]>>;
    appleSearch?: () => Promise<Result<SearchRow[]>>;
    deafAsks?: number;
  } = {},
) {
  const browser = fakeBrowser({
    userTabs: { [TAB]: { status: "complete", url: info ? `https://genius.com${info.path}` : "https://genius.com/" } },
    geniusAnswer: () => ({ ok: true, data: info }),
    ...(opts.deafAsks === undefined ? {} : { deafAsks: opts.deafAsks }),
  });
  const fetched: string[] = [];
  const searches: string[] = [];
  const appleSearches: string[] = [];
  const getJson = (url: string): Promise<unknown> => {
    fetched.push(url);
    return Promise.resolve(opts.json ? opts.json(url) : null);
  };
  const tools: SongMatchTools = {
    spotifySearch: (query) => {
      searches.push(query);
      return opts.search ? opts.search() : Promise.resolve({ ok: true, data: [] });
    },
    appleSearch: (query) => {
      appleSearches.push(query);
      return opts.appleSearch ? opts.appleSearch() : Promise.resolve({ ok: true, data: [] });
    },
    spotifyAlbumSearch: () => Promise.reject(new Error("a song page never searches for albums")),
  };
  const matches = createSongMatches(browser.ports, getJson, TIMING);
  const resolve = async (): Promise<SongMatchesAnswer> => {
    const answer = await matches.resolve(TAB, tools);
    if (!answer.ok) throw new Error(answer.error.message);
    return answer.data;
  };
  return { browser, fetched, searches, appleSearches, resolve, matches, tools };
}

const NO_TOOLS: SongMatchTools = {
  spotifySearch: () => Promise.reject(new Error("no")),
  appleSearch: () => Promise.reject(new Error("no")),
  spotifyAlbumSearch: () => Promise.reject(new Error("no")),
};

const lookupOf = (url: string): boolean => url.startsWith("https://itunes.apple.com/lookup");
const searchOf = (url: string): boolean => url.startsWith("https://itunes.apple.com/search");
const oembedOf = (url: string): boolean => url.startsWith("https://open.spotify.com/oembed");

describe("finding the pages of a Genius song", () => {
  it("lists both pages from Genius's own ids, with no search", async () => {
    const t = setup(GOOD4U, {
      json: (url) => {
        if (lookupOf(url)) return { results: [itunesSong(1560735551, "good 4 u", "Olivia Rodrigo", "SOUR")] };
        if (oembedOf(url)) return { title: "good 4 u" };
        return null;
      },
    });
    expect(await t.resolve()).toEqual({
      status: "ready",
      kind: "song",
      path: GOOD4U.path,
      title: "good 4 u",
      artists: ["Olivia Rodrigo"],
      apple: {
        status: "found",
        url: "https://music.apple.com/us/song/1560735551",
        name: "Olivia Rodrigo - good 4 u",
        release: "SOUR",
        source: "genius",
      },
      spotify: {
        status: "found",
        url: "https://open.spotify.com/track/6PERP62TejQjgHu81OHxgM",
        name: "Olivia Rodrigo - good 4 u",
        release: "",
        source: "genius",
      },
    });
    expect(t.searches).toEqual([]);
    expect(t.fetched.some(searchOf)).toBe(false);
  });

  it("searches Spotify for a song Genius gives no Spotify id, and takes only an exact match", async () => {
    const rows: SearchRow[] = [
      {
        title: "Fortnight (feat. Post Malone)",
        artists: ["Taylor Swift", "Post Malone"],
        album: "Fortnight (Acoustic Version)",
        href: "https://open.spotify.com/track/AAAAAAAAAAAAAAAAAAAAAA",
      },
      {
        title: "Fortnight (feat. Post Malone)",
        artists: ["Taylor Swift", "Post Malone"],
        album: "THE TORTURED POETS DEPARTMENT",
        href: "https://open.spotify.com/track/1jX3nPWUbEQVGxMBb7NPXp",
      },
    ];
    const t = setup(FORTNIGHT, {
      json: (url) =>
        lookupOf(url)
          ? {
              results: [
                itunesSong(
                  1736268216,
                  "Fortnight (feat. Post Malone)",
                  "Taylor Swift",
                  "THE TORTURED POETS DEPARTMENT",
                ),
              ],
            }
          : null,
      search: () => Promise.resolve({ ok: true, data: rows }),
    });
    const answer = await t.resolve();
    expect(t.searches).toEqual(["Fortnight Taylor Swift"]);
    expect(answer).toMatchObject({
      status: "ready",
      apple: { status: "found", source: "genius", release: "THE TORTURED POETS DEPARTMENT" },
      spotify: {
        status: "found",
        source: "search",
        url: "https://open.spotify.com/track/1jX3nPWUbEQVGxMBb7NPXp",
        release: "THE TORTURED POETS DEPARTMENT",
      },
    });
  });

  it("says none, never a guess, when no search row is exactly the song", async () => {
    const t = setup(FORTNIGHT, {
      json: (url) =>
        lookupOf(url) ? { results: [itunesSong(1736268216, "Fortnight", "Taylor Swift", "TTPD")] } : null,
      search: () =>
        Promise.resolve({
          ok: true,
          data: [
            {
              title: "Fortnight",
              artists: ["Someone Else"],
              album: "X",
              href: "https://open.spotify.com/track/AAAAAAAAAAAAAAAAAAAAAA",
            },
          ],
        }),
    });
    expect(await t.resolve()).toMatchObject({ spotify: { status: "none" } });
  });

  it("does not trust a Spotify id whose title is another song's, and searches instead", async () => {
    const t = setup(GOOD4U, {
      json: (url) => {
        if (lookupOf(url)) return { results: [itunesSong(1560735551, "good 4 u", "Olivia Rodrigo", "SOUR")] };
        if (oembedOf(url)) return { title: "drivers license" };
        return null;
      },
    });
    expect(await t.resolve()).toMatchObject({ spotify: { status: "none" } });
    expect(t.searches).toHaveLength(1);
  });

  it("lets Genius's Spotify id stand when Spotify cannot be asked", async () => {
    const t = setup(GOOD4U, {
      json: (url) =>
        lookupOf(url) ? { results: [itunesSong(1560735551, "good 4 u", "Olivia Rodrigo", "SOUR")] } : null,
    });
    expect(await t.resolve()).toMatchObject({
      spotify: { status: "found", source: "genius", name: "Olivia Rodrigo - good 4 u" },
    });
    expect(t.searches).toEqual([]);
  });

  it("falls back to iTunes's search when the Apple id is retired, and labels the result as found by search", async () => {
    const t = setup(FORTNIGHT, {
      json: (url) => {
        if (lookupOf(url)) return { resultCount: 0, results: [] };
        if (searchOf(url)) {
          return {
            results: [
              itunesSong(7, "Fortnight (feat. Post Malone)", "Taylor Swift", "Fortnight (Acoustic Version)"),
              itunesSong(8, "Fortnight (feat. Post Malone)", "Taylor Swift", "THE TORTURED POETS DEPARTMENT"),
            ],
          };
        }
        return null;
      },
    });
    expect(await t.resolve()).toMatchObject({
      apple: { status: "found", source: "search", url: "https://music.apple.com/us/song/8" },
    });
  });

  it("says none for Apple when the id is retired and neither search finds anything exact", async () => {
    const t = setup(FORTNIGHT, { json: (url) => (lookupOf(url) || searchOf(url) ? { results: [] } : null) });
    expect(await t.resolve()).toMatchObject({ apple: { status: "none" } });
    expect(t.appleSearches).toEqual(["Fortnight Taylor Swift"]);
  });

  it("opens Apple Music's search page only after the iTunes search missed, and takes an exact row from it", async () => {
    const t = setup(FORTNIGHT, {
      json: (url) => (lookupOf(url) || searchOf(url) ? { results: [] } : null),
      appleSearch: () =>
        Promise.resolve({
          ok: true,
          data: [
            {
              title: "Fortnight (feat. Post Malone)",
              artists: ["Taylor Swift"],
              album: "",
              href: "https://music.apple.com/us/album/fortnight-acoustic-version/1?i=2",
            },
            {
              title: "Fortnight (feat. Post Malone)",
              artists: ["Taylor Swift"],
              album: "",
              href: "https://music.apple.com/us/album/the-tortured-poets-department/1736268215?i=1736268216",
            },
          ],
        }),
    });
    expect(await t.resolve()).toMatchObject({
      apple: { status: "found", source: "search", url: "https://music.apple.com/us/song/1736268216" },
    });
  });

  it("does not open Apple Music's search page when the iTunes search found the song", async () => {
    const t = setup(FORTNIGHT, {
      json: (url) => {
        if (lookupOf(url)) return { results: [] };
        if (searchOf(url)) return { results: [itunesSong(8, "Fortnight (feat. Post Malone)", "Taylor Swift", "TTPD")] };
        return null;
      },
    });
    expect(await t.resolve()).toMatchObject({ apple: { status: "found", source: "search" } });
    expect(t.appleSearches).toEqual([]);
  });

  it("does not open Apple Music's search page when Genius's id resolved", async () => {
    const t = setup(FORTNIGHT, {
      json: (url) =>
        lookupOf(url) ? { results: [itunesSong(1736268216, "Fortnight", "Taylor Swift", "TTPD")] } : null,
    });
    await t.resolve();
    expect(t.appleSearches).toEqual([]);
  });

  it("reports a failed Apple search page as failed, not none", async () => {
    const t = setup(FORTNIGHT, {
      json: (url) => (lookupOf(url) || searchOf(url) ? { results: [] } : null),
      appleSearch: () => Promise.resolve({ ok: false, error: { code: "timeout", message: "slow" } }),
    });
    expect(await t.resolve()).toMatchObject({ apple: { status: "failed", message: "Apple Music: slow (timeout)" } });
  });

  it("reports a look-up that could not be done as failed, not as none", async () => {
    const t = setup(FORTNIGHT, {
      json: () => null,
      search: () =>
        Promise.resolve({
          ok: false,
          error: { code: "blocked", message: "Spotify asked for a captcha a moment ago." },
        }),
    });
    expect(await t.resolve()).toMatchObject({
      apple: { status: "failed" },
      spotify: {
        status: "failed",
        message: expect.stringContaining("Spotify asked for a captcha a moment ago.") as string,
      },
    });
  });

  it("keeps one service's failure from hiding the other's page", async () => {
    const t = setup(FORTNIGHT, {
      json: (url) =>
        lookupOf(url) ? { results: [itunesSong(1736268216, "Fortnight", "Taylor Swift", "TTPD")] } : null,
      search: () => Promise.reject(new Error("tab exploded")),
    });
    expect(await t.resolve()).toMatchObject({ apple: { status: "found" }, spotify: { status: "failed" } });
  });
});

describe("reading the Genius tab", () => {
  it("answers not-song for a tab that is not on genius.com, without asking it anything", async () => {
    const browser = fakeBrowser({ userTabs: { [TAB]: { status: "complete", url: "https://example.com/x-lyrics" } } });
    const matches = createSongMatches(browser.ports, () => Promise.resolve(null), TIMING);
    const answer = await matches.resolve(TAB, NO_TOOLS);
    expect(answer).toEqual({ ok: true, data: { status: "not-song" } });
    expect(browser.log).toEqual([]);
  });

  it("answers not-song for a Genius page that is not a song page", async () => {
    const t = setup(null);
    expect(await t.resolve()).toEqual({ status: "not-song" });
    expect(t.fetched).toEqual([]);
  });

  it("injects the content script into a tab that has none, then asks again", async () => {
    const t = setup(GOOD4U, { deafAsks: 1, json: () => null });
    expect(await t.resolve()).toMatchObject({ status: "ready" });
    expect(t.browser.log).toEqual([
      `ask:${String(TAB)}:genius/song-info`,
      `inject:${String(TAB)}`,
      `ask:${String(TAB)}:genius/song-info`,
    ]);
  });

  it("gives an error, not a hang, when the page never answers", async () => {
    const browser = fakeBrowser({
      userTabs: { [TAB]: { status: "complete", url: PAGE } },
      deaf: [TAB],
    });
    const matches = createSongMatches(browser.ports, () => Promise.resolve(null), TIMING);
    expect(await matches.resolve(TAB, NO_TOOLS)).toMatchObject({
      ok: false,
      error: { code: "tab-failed" },
    });
  });

  it("gives an error when the page does not finish loading", async () => {
    const browser = fakeBrowser({ userTabs: { [TAB]: { status: "loading", url: PAGE } } });
    const matches = createSongMatches(browser.ports, () => Promise.resolve(null), TIMING);
    expect(await matches.resolve(TAB, NO_TOOLS)).toMatchObject({
      ok: false,
      error: { code: "timeout" },
    });
  });
});

describe("one look-up per song page", () => {
  it("asks once for the same song page asked about twice at the same time", async () => {
    const t = setup(FORTNIGHT, {
      json: (url) =>
        lookupOf(url) ? { results: [itunesSong(1736268216, "Fortnight", "Taylor Swift", "TTPD")] } : null,
    });
    await Promise.all([t.resolve(), t.resolve()]);
    expect(t.searches).toHaveLength(1);
    expect(t.fetched.filter(lookupOf)).toHaveLength(1);
  });

  it("keeps a complete answer for the session", async () => {
    const t = setup(FORTNIGHT, {
      json: (url) =>
        lookupOf(url) ? { results: [itunesSong(1736268216, "Fortnight", "Taylor Swift", "TTPD")] } : null,
    });
    const first = await t.resolve();
    const again = await t.resolve();
    expect(again).toEqual(first);
    expect(t.searches).toHaveLength(1);
  });

  it("does not keep an answer with a failed half, so a later try can fix it", async () => {
    let fail = true;
    const t = setup(FORTNIGHT, {
      json: (url) =>
        lookupOf(url) ? { results: [itunesSong(1736268216, "Fortnight", "Taylor Swift", "TTPD")] } : null,
      search: () =>
        Promise.resolve(fail ? { ok: false, error: { code: "timeout", message: "slow" } } : { ok: true, data: [] }),
    });
    expect(await t.resolve()).toMatchObject({ spotify: { status: "failed" } });
    fail = false;
    expect(await t.resolve()).toMatchObject({ spotify: { status: "none" } });
    expect(t.searches).toHaveLength(2);
  });
});

describe("a Genius artist named with the real name in a parenthetical", () => {
  // The real saved Genius page of https://genius.com/Mike-mike-stud-ghost-lyrics: no Apple Music or Spotify id, the
  // artist "mike. (Mike Stud)". The answers below are real, cut to their first rows.
  const GHOST = readSongInfo(
    new DOMParser().parseFromString(
      readFileSync(join(import.meta.dirname, "..", "genius", "pages", "ghost-mike-stud.html"), "utf8"),
      "text/html",
    ),
    "/Mike-mike-stud-ghost-lyrics",
  );
  if (GHOST === null) throw new Error("the saved page must read");
  const ITUNES_FULL_NAME = {
    resultCount: 2,
    results: [
      itunesSong(1444856071, "to the grave (feat. Mike Stud)", "Bea Miller", "chapter three: yellow - Single"),
      itunesSong(1391263864, "To the Grave (feat. Mike Stud)", "Bea Miller", "Cloak & Dagger"),
    ],
  };
  const ITUNES_DISPLAY_NAME = {
    resultCount: 4,
    results: [
      itunesSong(6813641826, "ghost", "mike.", "ghost - Single"),
      itunesSong(1512133117, "Ghost Town", "Mike Ryan", "Ghost Town - Single"),
      itunesSong(193239047, "Ghost", "Pearl Jam", "Riot Act"),
      itunesSong(992313701, "Ghost", "Mike Dunn & The Kings of New England", "Hard Luck Soft Rock"),
    ],
  };
  const SPOTIFY_ROWS: SearchRow[] = [
    {
      title: "ghost",
      artists: ["mike."],
      album: "ghost",
      href: "https://open.spotify.com/track/0dIip4WO8ugZYMvitt4vcW",
    },
    {
      title: "Ghost",
      artists: ["Michael Williams"],
      album: "x",
      href: "https://open.spotify.com/track/1aMbgp8fbQ4rr1eKDbNYcn",
    },
  ];

  it("reads as display name plus real name, with no ids", () => {
    expect(GHOST).toMatchObject({ primary: ["mike. (Mike Stud)"], featured: [], appleId: "", spotifyId: "" });
  });

  it("finds the song on both services by searching the display name", async () => {
    const t = setup(GHOST, {
      // iTunes answers the way it really did: junk for the whole name, the song for the display name.
      json: (url) =>
        searchOf(url)
          ? new URL(url).searchParams.get("term") === "ghost mike."
            ? ITUNES_DISPLAY_NAME
            : ITUNES_FULL_NAME
          : null,
      search: () => Promise.resolve({ ok: true, data: SPOTIFY_ROWS }),
    });
    const answer = await t.resolve();
    if (answer.status !== "ready") throw new Error("not ready");
    expect(answer.apple).toMatchObject({ status: "found", url: "https://music.apple.com/us/song/6813641826" });
    expect(answer.spotify).toMatchObject({
      status: "found",
      url: "https://open.spotify.com/track/0dIip4WO8ugZYMvitt4vcW",
    });
    expect(t.searches).toEqual(["ghost mike."]);
  });

  it("lists nothing when the display name's results are other artists' songs", async () => {
    const t = setup(GHOST, {
      json: (url) => (searchOf(url) ? { resultCount: 3, results: ITUNES_DISPLAY_NAME.results.slice(1) } : null),
      search: () => Promise.resolve({ ok: true, data: SPOTIFY_ROWS.slice(1) }),
    });
    const answer = await t.resolve();
    if (answer.status !== "ready") throw new Error("not ready");
    expect(answer.apple).toEqual({ status: "none" });
    expect(answer.spotify).toEqual({ status: "none" });
  });
});
