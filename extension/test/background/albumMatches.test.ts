import { describe, expect, it } from "vitest";
import { createSongMatches, type SongMatchTools } from "../../src/background/songMatches";
import type { GeniusAlbumInfo, Result, SearchRow, SongMatchesAnswer } from "../../src/shared/messages";
import { fakeBrowser } from "./fakePorts";

const TIMING = { loadMs: 200, askMs: 100, pollMs: 5 };
const TAB = 5;

const SOUR: GeniusAlbumInfo = {
  path: "/albums/Olivia-rodrigo/Sour",
  title: "SOUR",
  primary: ["Olivia Rodrigo"],
  year: "2021",
  tracks: 11,
  type: "album",
};

const itunesAlbum = (
  id: number,
  title: string,
  artist: string,
  tracks: number,
  date: string,
  explicitness = "notExplicit",
): unknown => ({
  wrapperType: "collection",
  collectionType: "Album",
  collectionId: id,
  collectionName: title,
  artistName: artist,
  trackCount: tracks,
  releaseDate: date,
  collectionExplicitness: explicitness,
});

const card = (id: string, title: string, artists: string[], year = "2021"): SearchRow => ({
  title,
  artists,
  album: "",
  year,
  href: `https://open.spotify.com/album/${id}`,
});

const ID_A = "6s84u2TUpR3wdUv4NgKA2j";
const ID_B = "7bYichzvtYHdjF8HF69dyA";
const ID_C = "1xJHno7SmdVtZAtXbdbDZp";

/** A browser with the Genius tab showing the album page of `info` (null: a page that is no album page). */
function setup(
  info: GeniusAlbumInfo | null,
  opts: {
    json?: (url: string) => unknown;
    cards?: () => Promise<Result<SearchRow[]>>;
    url?: string;
  } = {},
) {
  const browser = fakeBrowser({
    userTabs: {
      [TAB]: {
        status: "complete",
        url: opts.url ?? (info ? `https://genius.com${info.path}` : "https://genius.com/albums/A/B"),
      },
    },
    geniusAnswer: (_tab, notice) => ({ ok: true, data: notice.type === "genius/album-info" ? info : null }),
  });
  const fetched: string[] = [];
  const albumSearches: string[] = [];
  const getJson = (url: string): Promise<unknown> => {
    fetched.push(url);
    return Promise.resolve(opts.json ? opts.json(url) : null);
  };
  const tools: SongMatchTools = {
    spotifySearch: () => Promise.reject(new Error("an album page never searches for songs")),
    appleSearch: () => Promise.reject(new Error("an album page never opens Apple Music's search page")),
    spotifyAlbumSearch: (query) => {
      albumSearches.push(query);
      return opts.cards ? opts.cards() : Promise.resolve({ ok: true, data: [] });
    },
  };
  const matches = createSongMatches(browser.ports, getJson, TIMING);
  const resolve = async (): Promise<SongMatchesAnswer> => {
    const answer = await matches.resolve(TAB, tools);
    if (!answer.ok) throw new Error(answer.error.message);
    return answer.data;
  };
  return { browser, fetched, albumSearches, resolve };
}

const SOUR_JSON = {
  results: [
    itunesAlbum(1560734944, "SOUR", "Olivia Rodrigo", 11, "2021-05-21T07:00:00Z", "cleaned"),
    itunesAlbum(1736994853, "GUTS (spilled)", "Olivia Rodrigo", 20, "2023-09-08T07:00:00Z"),
  ],
};

describe("finding the pages of a Genius album", () => {
  it("lists the Apple Music and Spotify albums, found by search, with their year and size", async () => {
    const t = setup(SOUR, {
      json: () => SOUR_JSON,
      cards: () =>
        Promise.resolve({
          ok: true,
          data: [card(ID_A, "SOUR", ["Olivia Rodrigo"]), card(ID_C, "GUTS", ["Olivia Rodrigo"], "2023")],
        }),
    });
    expect(await t.resolve()).toEqual({
      status: "ready",
      kind: "album",
      path: SOUR.path,
      title: "SOUR",
      artists: ["Olivia Rodrigo"],
      apple: {
        status: "found",
        url: "https://music.apple.com/us/album/1560734944",
        name: "Olivia Rodrigo - SOUR",
        release: "2021 · 11 tracks",
        source: "search",
      },
      spotify: {
        status: "found",
        url: `https://open.spotify.com/album/${ID_A}`,
        name: "Olivia Rodrigo - SOUR",
        release: "2021",
        source: "search",
      },
    });
  });

  it("asks the page for its album, never its song, and searches by title and artist", async () => {
    const t = setup(SOUR, { json: () => SOUR_JSON });
    await t.resolve();
    expect(t.browser.log).toEqual([`ask:${String(TAB)}:genius/album-info`]);
    expect(t.albumSearches).toEqual(["SOUR Olivia Rodrigo"]);
    const search = new URL(t.fetched[0] ?? "");
    expect(search.origin + search.pathname).toBe("https://itunes.apple.com/search");
    expect(search.searchParams.get("entity")).toBe("album");
    expect(search.searchParams.get("term")).toBe("SOUR Olivia Rodrigo");
    // Nothing else is fetched: an album page names no id to look up.
    expect(t.fetched).toHaveLength(1);
  });

  it("searches on a Genius album that names no Apple id (none of them does)", async () => {
    // The info of an album carries no id field at all; the iTunes search is the only road, so it must run.
    const t = setup(SOUR, { json: () => SOUR_JSON });
    expect(await t.resolve()).toMatchObject({ apple: { status: "found", source: "search" } });
    expect(t.fetched.filter((url) => url.includes("/search"))).toHaveLength(1);
  });

  it("says none for both when the album is on neither service", async () => {
    const t = setup(SOUR, { json: () => ({ results: [] }) });
    expect(await t.resolve()).toMatchObject({ kind: "album", apple: { status: "none" }, spotify: { status: "none" } });
  });

  it("says none, never a guess, when the only results are other editions, other artists or singles", async () => {
    const t = setup(SOUR, {
      json: () => ({
        results: [
          itunesAlbum(1, "SOUR (Deluxe)", "Olivia Rodrigo", 11, "2021-05-21T07:00:00Z"),
          itunesAlbum(2, "SOUR", "Another Artist", 11, "2021-05-21T07:00:00Z"),
          itunesAlbum(3, "SOUR - Single", "Olivia Rodrigo", 1, "2021-05-21T07:00:00Z"),
          itunesAlbum(4, "SOUR", "Olivia Rodrigo", 11, "2011-05-21T07:00:00Z"),
          { wrapperType: "track", kind: "song", trackId: 5, trackName: "SOUR", artistName: "Olivia Rodrigo" },
        ],
      }),
      cards: () =>
        Promise.resolve({
          ok: true,
          data: [
            card(ID_A, "SOUR (Deluxe)", ["Olivia Rodrigo"]),
            card(ID_B, "SOUR", ["Olivia Rodrigo", "Someone"]),
            card(ID_C, "SOUR", ["Olivia Rodrigo"], "2015"),
          ],
        }),
    });
    expect(await t.resolve()).toMatchObject({ apple: { status: "none" }, spotify: { status: "none" } });
  });

  it("lists every album that is exactly this one when the service has several that differ (a reissue year)", async () => {
    const t = setup(SOUR, {
      json: () => ({
        results: [
          itunesAlbum(10, "SOUR", "Olivia Rodrigo", 11, "2021-05-21T07:00:00Z", "explicit"),
          itunesAlbum(11, "SOUR", "Olivia Rodrigo", 11, "2022-05-21T07:00:00Z", "explicit"),
        ],
      }),
      cards: () =>
        Promise.resolve({
          ok: true,
          data: [card(ID_A, "SOUR", ["Olivia Rodrigo"]), card(ID_B, "SOUR", ["Olivia Rodrigo"], "2022")],
        }),
    });
    const answer = await t.resolve();
    if (answer.status !== "ready") throw new Error("not ready");
    expect(answer.apple).toMatchObject({ status: "several" });
    expect(answer.spotify).toMatchObject({ status: "several" });
    expect(answer.spotify.status === "several" && answer.spotify.matches.map((m) => m.url)).toEqual([
      `https://open.spotify.com/album/${ID_A}`,
      `https://open.spotify.com/album/${ID_B}`,
    ]);
  });

  it("lists one album, not two, when the service lists its explicit and clean releases as cards that look alike", async () => {
    const t = setup(SOUR, {
      cards: () =>
        Promise.resolve({
          ok: true,
          data: [card(ID_A, "SOUR", ["Olivia Rodrigo"]), card(ID_B, "SOUR", ["Olivia Rodrigo"])],
        }),
    });
    const answer = await t.resolve();
    expect(answer.status === "ready" && answer.spotify).toMatchObject({
      status: "found",
      url: `https://open.spotify.com/album/${ID_A}`,
    });
  });

  it("lists at most three of many", async () => {
    const t = setup(
      { ...SOUR, tracks: 0 },
      {
        json: () => ({
          results: [10, 11, 12, 13].map((tracks, i) =>
            itunesAlbum(100 + i, "SOUR", "Olivia Rodrigo", tracks, "2021-05-21T07:00:00Z"),
          ),
        }),
      },
    );
    const answer = await t.resolve();
    expect(answer.status === "ready" && answer.apple.status === "several" && answer.apple.matches).toHaveLength(3);
  });

  it("matches a name written with & against and, with other accents and case", async () => {
    const info: GeniusAlbumInfo = {
      path: "/albums/Rosalia/Motomami",
      title: "Rock & Roll",
      primary: ["ROSALÍA", "Bad Bunny"],
      year: "2022",
      tracks: 0,
      type: "album",
    };
    const t = setup(info, {
      json: () => ({ results: [itunesAlbum(7, "rock and roll", "Rosalia & Bad Bunny", 12, "2022-03-18T08:00:00Z")] }),
      cards: () => Promise.resolve({ ok: true, data: [card(ID_A, "ROCK AND ROLL", ["Bad Bunny", "Rosalía"], "2022")] }),
    });
    expect(await t.resolve()).toMatchObject({ apple: { status: "found" }, spotify: { status: "found" } });
  });

  it("searches a compilation by Various Artists by its title alone", async () => {
    const info: GeniusAlbumInfo = {
      path: "/albums/Various-artists/Guardians",
      title: "Awesome Mix, Vol. 1",
      primary: ["Various Artists"],
      year: "2014",
      tracks: 12,
      type: "soundtrack",
    };
    const t = setup(info, {
      json: () => ({ results: [itunesAlbum(8, "Awesome Mix, Vol. 1", "Various Artists", 12, "2014-07-29T07:00:00Z")] }),
    });
    expect(await t.resolve()).toMatchObject({ apple: { status: "found" } });
    expect(t.albumSearches).toEqual(["Awesome Mix, Vol. 1"]);
    expect(new URL(t.fetched[0] ?? "").searchParams.get("term")).toBe("Awesome Mix, Vol. 1");
  });

  it("never takes a Spotify address that is not an album address from a row", async () => {
    const t = setup(SOUR, {
      cards: () =>
        Promise.resolve({
          ok: true,
          data: [
            { ...card(ID_A, "SOUR", ["Olivia Rodrigo"]), href: "https://evil.example/album/6s84u2TUpR3wdUv4NgKA2j" },
            { ...card(ID_A, "SOUR", ["Olivia Rodrigo"]), href: `https://open.spotify.com/track/${ID_A}` },
          ],
        }),
    });
    expect(await t.resolve()).toMatchObject({ spotify: { status: "none" } });
  });
});

describe("when a service cannot answer for an album", () => {
  it("reports a blocked Spotify as failed with its reason, and still lists the Apple album", async () => {
    const t = setup(SOUR, {
      json: () => SOUR_JSON,
      cards: () => Promise.resolve({ ok: false, error: { code: "blocked", message: "Spotify asked for a captcha." } }),
    });
    expect(await t.resolve()).toMatchObject({
      apple: { status: "found" },
      spotify: { status: "failed", message: expect.stringContaining("captcha") as string },
    });
  });

  it("reports iTunes not answering as failed, not none, and still lists the Spotify album", async () => {
    const t = setup(SOUR, {
      json: () => null,
      cards: () => Promise.resolve({ ok: true, data: [card(ID_A, "SOUR", ["Olivia Rodrigo"])] }),
    });
    expect(await t.resolve()).toMatchObject({
      apple: { status: "failed", message: expect.stringContaining("iTunes") as string },
      spotify: { status: "found" },
    });
  });

  it("turns a search that throws into that service's failure", async () => {
    const t = setup(SOUR, { json: () => SOUR_JSON, cards: () => Promise.reject(new Error("tab crashed")) });
    expect(await t.resolve()).toMatchObject({
      apple: { status: "found" },
      spotify: { status: "failed", message: expect.stringContaining("tab crashed") as string },
    });
  });

  it("treats an answer that is not an iTunes answer as could-not-ask", async () => {
    const t = setup(SOUR, { json: () => ({ unexpected: true }) });
    expect(await t.resolve()).toMatchObject({ apple: { status: "failed" } });
  });
});

describe("which Genius pages are albums", () => {
  it("answers not-song for an /albums/ page the page itself does not accept (a translation)", async () => {
    const t = setup(null, { url: "https://genius.com/albums/Genius-traducciones-al-espanol/Sour" });
    expect(await t.resolve()).toEqual({ status: "not-song" });
    expect(t.fetched).toEqual([]);
    expect(t.albumSearches).toEqual([]);
  });

  it("asks a song page about its song, as before", async () => {
    const browser = fakeBrowser({
      userTabs: { [TAB]: { status: "complete", url: "https://genius.com/Olivia-rodrigo-good-4-u-lyrics" } },
      geniusAnswer: () => ({ ok: true, data: null }),
    });
    const matches = createSongMatches(browser.ports, () => Promise.resolve(null), TIMING);
    await matches.resolve(TAB, {
      spotifySearch: () => Promise.reject(new Error("no")),
      appleSearch: () => Promise.reject(new Error("no")),
      spotifyAlbumSearch: () => Promise.reject(new Error("no")),
    });
    expect(browser.log).toEqual([`ask:${String(TAB)}:genius/song-info`]);
  });
});

describe("one look-up per album page", () => {
  it("asks once for the same album page asked about twice at the same time, and keeps a complete answer", async () => {
    const t = setup(SOUR, {
      json: () => SOUR_JSON,
      cards: () => Promise.resolve({ ok: true, data: [card(ID_A, "SOUR", ["Olivia Rodrigo"])] }),
    });
    const [first] = await Promise.all([t.resolve(), t.resolve()]);
    expect(await t.resolve()).toEqual(first);
    expect(t.albumSearches).toHaveLength(1);
    expect(t.fetched).toHaveLength(1);
  });

  it("does not keep an answer with a failed half, so a later try can fix it", async () => {
    let fail = true;
    const t = setup(SOUR, {
      json: () => SOUR_JSON,
      cards: () =>
        Promise.resolve(
          fail
            ? { ok: false, error: { code: "timeout", message: "slow" } }
            : { ok: true, data: [card(ID_A, "SOUR", ["Olivia Rodrigo"])] },
        ),
    });
    expect(await t.resolve()).toMatchObject({ spotify: { status: "failed" } });
    fail = false;
    expect(await t.resolve()).toMatchObject({ spotify: { status: "found" } });
    expect(t.albumSearches).toHaveLength(2);
  });
});
