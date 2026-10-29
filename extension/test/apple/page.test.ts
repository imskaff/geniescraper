import { describe, expect, it } from "vitest";
import {
  NOT_FOUND_SELECTOR,
  READY_SELECTOR,
  isNotFound,
  readCopyright,
  readCoverUrl,
  readReleaseDate,
  readTitleArtist,
  readTrackCount,
  readTrackTitle,
  readTrackTitles,
} from "../../src/apple/page";
import { extractTitleArtist } from "../../src/apple/title";
import { normaliseCoverUrl, pickCoverUrl } from "../../src/core/cover";
import vectors from "../vectors.json";
import { CASES, artworkKey, loadFixture, loadGolden } from "./fixtures";

const ALBUMS = CASES.filter((c) => c.url.includes("/album/"));
const SONGS = CASES.filter((c) => c.url.includes("/song/"));

// Albums whose page header shows only motion artwork and an editorial still, never the album artwork.
const HEADER_WITHOUT_ARTWORK = new Set(["rodrigo-sour-t6"]);

// What each saved album page's footer says: the album's date, which a track need not share (Good 4 U is
// May 14 on a May 21 album).
const ALBUM_FOOTER_DATE: Record<string, string> = {
  "eilish-hmhas-t3": "2024-05-17",
  "kendrick-nlu-single": "2024-05-04",
  "rodrigo-sour-t6": "2021-05-21",
  "rosalia-con-altura": "2019-03-28",
  "swift-ttpd-t1": "2024-04-19",
  "sza-sos-t1": "2022-12-09",
};

describe("the release date on the saved pages", () => {
  it.each(CASES)("$id: the song page gives the song's own date, as the golden file says", ({ id }) => {
    expect(readReleaseDate(loadFixture(id, "credits"))).toBe(loadGolden(id).release_date);
  });

  it.each(ALBUMS)("$id: the album page gives the album's date from its footer", ({ id }) => {
    expect(readReleaseDate(loadFixture(id, "page"))).toBe(ALBUM_FOOTER_DATE[id]);
  });

  it.each(SONGS)("$id: a song page without the meta tag falls back to its visible date line", ({ id }) => {
    const doc = loadFixture(id, "page");
    expect(doc.querySelector('meta[property="music:release_date"]')).toBeNull();
    expect(readReleaseDate(doc)).toBe(loadGolden(id).release_date);
  });

  it("reads nothing from a page without a date, or with a date that is not on the calendar", () => {
    const parse = (markup: string): Document => new DOMParser().parseFromString(markup, "text/html");
    expect(readReleaseDate(parse("<body><p>no date</p></body>"))).toBe("");
    expect(
      readReleaseDate(
        parse('<head><meta property="music:release_date" content="2024-02-31T00:00:00.000Z"></head><body></body>'),
      ),
    ).toBe("");
    expect(
      readReleaseDate(parse('<body><span data-testid="song-subtitle-release-date">17 mai 2024</span></body>')),
    ).toBe("");
  });
});

describe("the album footer, whatever the line endings of the saved page", () => {
  // The footer's lines are separated by a newline in the markup. A DOM that computes innerText can drop a lone
  // LF there ("2022" and "23 songs" run together into a count of 202223), which is what CI's Linux checkout did.
  const footer = (eol: string): Document =>
    new DOMParser().parseFromString(
      `<body><p data-testid="tracklist-footer-description">December 9, 2022${eol}23 songs, 1 hour 8 minutes${eol}℗ 2022 Top Dawg Entertainment</p></body>`,
      "text/html",
    );

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("reads the track count and the copyright with %s line endings", (_name, eol) => {
    expect(readTrackCount(footer(eol))).toBe(23);
    expect(readCopyright(footer(eol))[0]).toBe("℗ 2022 Top Dawg Entertainment");
  });
});

describe("readTrackTitles", () => {
  const rows = (...names: string[]): Document =>
    new DOMParser().parseFromString(
      `<body>${names.map((n) => `<div data-testid="track-list-item"><span class="songs-list-row__song-name">${n}</span></div>`).join("")}</body>`,
      "text/html",
    );

  it("keeps one title per row, so a blank title in the middle does not shift the later ones", () => {
    expect(readTrackTitles(rows("One", "  ", "Three"), 3)).toEqual(["One", "Track 2", "Three"]);
  });

  it("names a blank first or last row by its position too", () => {
    expect(readTrackTitles(rows("", "Two", ""), 3)).toEqual(["Track 1", "Two", "Track 3"]);
  });

  it("pads with Track N when fewer rows rendered than songs, and drops any extra rows", () => {
    expect(readTrackTitles(rows("One", "Two"), 3)).toEqual(["One", "Two", "Track 3"]);
    expect(readTrackTitles(rows("One", "Two", "Three"), 2)).toEqual(["One", "Two"]);
  });
});

describe("album pages against the golden files", () => {
  it.each(ALBUMS)("$id copyright", ({ id }) => {
    const golden = loadGolden(id);
    expect(readCopyright(loadFixture(id, "page"))).toEqual([golden.phonographic_copyright, golden.copyright_notice]);
  });

  it.each(ALBUMS)("$id artist from the page title", ({ id }) => {
    expect(readTitleArtist(loadFixture(id, "page"))[1]).toBe(loadGolden(id).artist);
  });

  it.each(ALBUMS)("$id track title", ({ id, track_index }) => {
    expect(readTrackTitle(loadFixture(id, "page"), track_index)).toBe(loadGolden(id).title);
  });
});

describe("song pages against the golden files", () => {
  it.each(SONGS)("$id title and artist from the page title", ({ id }) => {
    const golden = loadGolden(id);
    expect(readTitleArtist(loadFixture(id, "page"))).toEqual([golden.title, golden.artist]);
  });
});

describe("every page", () => {
  it.each(CASES)("$id cover is the header album artwork, never motion or editorial images", ({ id }) => {
    const url = readCoverUrl(loadFixture(id, "page"));
    if (HEADER_WITHOUT_ARTWORK.has(id)) {
      expect(url).toBe("");
    } else {
      expect(url.endsWith("/1000x1000bb.png")).toBe(true);
      expect(artworkKey(url)).toBe(artworkKey(loadGolden(id).cover_art_url));
    }
  });

  it.each(CASES)("$id has the page-ready marker and no not-found view", ({ id }) => {
    const doc = loadFixture(id, "page");
    expect(doc.querySelector(READY_SELECTOR)).not.toBeNull();
    expect(isNotFound(doc)).toBe(false);
  });
});

describe("not-found view", () => {
  it.each(["not-found-heading", "page-error-title"])("is detected by data-testid=%s", (testid) => {
    const doc = new DOMParser().parseFromString(`<h1 data-testid="${testid}">Page Not Found</h1>`, "text/html");
    expect(doc.querySelector(NOT_FOUND_SELECTOR)).not.toBeNull();
    expect(isNotFound(doc)).toBe(true);
  });
});

describe("extractTitleArtist parity with scraper.apple_music._extract_title_artist", () => {
  it.each(vectors.extract_title_artist)("$input", ({ input, output }) => {
    expect(extractTitleArtist(input)).toEqual(output);
  });
});

describe("cover URL parity with scraper.apple_music", () => {
  it.each(vectors.normalise_cover_url)("normalise $input", ({ input, output }) => {
    expect(normaliseCoverUrl(input)).toBe(output);
  });

  const picks = vectors.pick_cover_url.map((c, i) => ({ ...c, label: `case ${String(i)}` }));

  it.each(picks)("pick $label", ({ input, output }) => {
    expect(pickCoverUrl(input)).toBe(output);
  });
});
