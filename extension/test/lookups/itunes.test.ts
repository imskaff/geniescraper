import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coreTitleWords } from "../../src/core/text";
import {
  catalogRef,
  fetchCover,
  isAppleArtwork,
  itunesPng,
  lookupCover,
  sameTrack,
  searchCover,
  type GetJson,
} from "../../src/lookups/itunes";
import { CASES, artworkKey, loadGolden } from "../apple/fixtures";
import vectors from "../vectors.json";

const COVERS = join(import.meta.dirname, "..", "..", "..", "tests", "fixtures", "lookups", "covers");

interface CoverFixture {
  itunes_lookup: Record<string, unknown>;
  itunes_search: Record<string, unknown>;
}

const EMPTY = { resultCount: 0, results: [] };

/** The saved iTunes responses, served as the live service answers: unknown ids and terms give no results. */
function fixtureServer(id: string): { getJson: GetJson; requests: string[] } {
  const fixture = JSON.parse(readFileSync(join(COVERS, `${id}.json`), "utf-8")) as CoverFixture;
  const requests: string[] = [];
  const getJson: GetJson = (url) => {
    requests.push(url);
    const target = new URL(url);
    if (target.hostname !== "itunes.apple.com") return Promise.resolve(null);
    if (target.pathname === "/lookup")
      return Promise.resolve(fixture.itunes_lookup[target.searchParams.get("id") ?? ""] ?? EMPTY);
    if (target.pathname === "/search")
      return Promise.resolve(fixture.itunes_search[target.searchParams.get("term") ?? ""] ?? EMPTY);
    return Promise.resolve(null);
  };
  return { getJson, requests };
}

const served =
  (data: unknown): GetJson =>
  () =>
    Promise.resolve(data);

const hit = (artworkUrl100: unknown, extra: Record<string, unknown> = {}) => ({
  resultCount: 1,
  results: [{ artworkUrl100, ...extra }],
});
const GOOD = "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/6b/x.rgb.jpg/100x100bb.jpg";
const GOOD_PNG = "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/6b/x.rgb.jpg/1000x1000bb.png";

describe("parity with scraper.deezer and scraper.text", () => {
  it.each(vectors.catalog_ref.map((c) => ({ ...c, label: c.input })))("catalogRef $label", ({ input, output }) => {
    expect(catalogRef(input)).toEqual(output);
  });

  it.each(vectors.itunes_png.map((c) => ({ ...c, label: c.input || "(empty)" })))(
    "itunesPng $label",
    ({ input, output }) => {
      expect(itunesPng(input)).toBe(output);
    },
  );

  it.each(vectors.same_track.map((c, i) => ({ ...c, label: `${c.result_title} / ${c.title} #${String(i)}` })))(
    "sameTrack $label",
    ({ result_title, result_artist, title, artist, output }) => {
      expect(sameTrack(result_title, result_artist, title, artist)).toBe(output);
    },
  );

  it.each(vectors.core_title_words.map((c) => ({ ...c, label: c.input || "(empty)" })))(
    "coreTitleWords $label",
    ({ input, output }) => {
      expect(coreTitleWords(input)).toEqual(output);
    },
  );
});

describe("against the saved iTunes responses and the golden artwork", () => {
  it.each(CASES)("$id: the lookup by catalog id returns the golden artwork, in one request", async ({ id, url }) => {
    const golden = loadGolden(id);
    const { getJson, requests } = fixtureServer(id);

    const cover = await fetchCover(getJson, url, golden.title, golden.artist);

    expect(cover.endsWith("/1000x1000bb.png")).toBe(true);
    expect(artworkKey(cover)).toBe(artworkKey(golden.cover_art_url));
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0] ?? "").pathname).toBe("/lookup");
  });

  it.each(CASES)("$id: without a catalog id it falls back to a title search in the same catalog", async ({ id }) => {
    const golden = loadGolden(id);
    const { getJson, requests } = fixtureServer(id);

    const cover = await fetchCover(getJson, "", golden.title, golden.artist);

    expect(cover.startsWith("https://is1-ssl.mzstatic.com/")).toBe(true);
    expect(cover.endsWith("/1000x1000bb.png")).toBe(true);
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0] ?? "").pathname).toBe("/search");
  });

  it("searches only when the lookup finds nothing, and then asks for the song", async () => {
    const { getJson, requests } = fixtureServer("swift-ttpd-t1");
    const golden = loadGolden("swift-ttpd-t1");
    const cover = await fetchCover(
      getJson,
      "https://music.apple.com/us/album/unknown/999",
      golden.title,
      golden.artist,
    );
    expect(cover).not.toBe("");
    const [lookup, search] = requests.map((r) => new URL(r));
    expect(lookup?.pathname).toBe("/lookup");
    expect(lookup?.search).toBe("?id=999&country=us");
    expect(search?.searchParams.get("entity")).toBe("song");
    expect(search?.searchParams.get("term")).toBe(`${golden.artist} ${golden.title}`);
  });
});

describe("lookupCover", () => {
  it("asks for the track when the album link names one", async () => {
    const seen: string[] = [];
    await lookupCover(
      (url) => (seen.push(url), Promise.resolve(EMPTY)),
      "https://music.apple.com/us/album/x/100?i=200",
    );
    expect(seen).toEqual(["https://itunes.apple.com/lookup?id=200&country=us"]);
  });

  it("makes no request for a link that is not an Apple Music album or song", async () => {
    const seen: string[] = [];
    expect(await lookupCover((url) => (seen.push(url), Promise.resolve(EMPTY)), "https://example.com/album/1")).toBe(
      "",
    );
    expect(seen).toEqual([]);
  });

  it("returns the first result that has artwork", async () => {
    const data = { results: [{ artistName: "x" }, { artworkUrl100: "" }, { artworkUrl100: GOOD }] };
    expect(await lookupCover(served(data), "https://music.apple.com/us/album/x/1")).toBe(GOOD_PNG);
  });
});

describe("failures never break a read", () => {
  it.each([
    ["a failed request", null],
    ["no results", EMPTY],
    ["a string", "nope"],
    ["an array", []],
    ["results that are not a list", { results: "x" }],
    ["results holding non-objects", { results: [1, "x", null] }],
    ["artwork that is not a string", hit(5)],
  ])("gives an empty cover for %s", async (_name, data) => {
    expect(await lookupCover(served(data), "https://music.apple.com/us/album/x/1")).toBe("");
    expect(await searchCover(served(data), "SOS", "SZA")).toBe("");
    expect(await fetchCover(served(data), "https://music.apple.com/us/album/x/1", "SOS", "SZA")).toBe("");
  });

  it("searches nothing without a title and an artist", async () => {
    const seen: string[] = [];
    const getJson: GetJson = (url) => (seen.push(url), Promise.resolve(EMPTY));
    expect(await searchCover(getJson, "", "SZA")).toBe("");
    expect(await searchCover(getJson, "SOS", "")).toBe("");
    expect(seen).toEqual([]);
  });
});

describe("what a response may make the extension use", () => {
  it.each([
    ["a plain http image", "http://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg"],
    ["another host", "https://evil.example/image/thumb/a/100x100bb.jpg"],
    ["a lookalike host", "https://mzstatic.com.evil.example/a/100x100bb.jpg"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:image/png;base64,AAAA"],
    ["a protocol-relative URL", "//is1-ssl.mzstatic.com/a/100x100bb.jpg"],
  ])("rejects artwork on %s", async (_name, url) => {
    expect(isAppleArtwork(itunesPng(url))).toBe(false);
    expect(await lookupCover(served(hit(url)), "https://music.apple.com/us/album/x/1")).toBe("");
  });

  it("accepts Apple's image CDN, including the bare domain", () => {
    expect(isAppleArtwork(GOOD_PNG)).toBe(true);
    expect(isAppleArtwork("https://mzstatic.com/a.png")).toBe(true);
  });

  it("skips a rejected result and uses a later good one", async () => {
    const data = { results: [{ artworkUrl100: "https://evil.example/100x100bb.jpg" }, { artworkUrl100: GOOD }] };
    expect(await lookupCover(served(data), "https://music.apple.com/us/album/x/1")).toBe(GOOD_PNG);
  });
});

describe("searchCover", () => {
  const search = (hits: { trackName: string; artistName: string }[]) =>
    served({ results: hits.map((h) => ({ ...h, artworkUrl100: GOOD })) });

  it("never takes another song by the artist: 'Kill Bill' is not 'SOS'", async () => {
    expect(await searchCover(search([{ trackName: "Kill Bill", artistName: "SZA" }]), "SOS", "SZA")).toBe("");
  });

  it("takes the same song whatever its featured-artist part says", async () => {
    const getJson = search([{ trackName: "Fortnight", artistName: "Taylor Swift" }]);
    expect(await searchCover(getJson, "Fortnight (feat. Post Malone)", "Taylor Swift")).toBe(GOOD_PNG);
  });

  it("never takes the same title by another artist", async () => {
    expect(
      await searchCover(
        search([{ trackName: "Fortnight", artistName: "The Lullabeats" }]),
        "Fortnight",
        "Taylor Swift",
      ),
    ).toBe("");
  });
});
