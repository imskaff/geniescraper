import { describe, expect, it } from "vitest";
import {
  NOT_FOUND_SELECTOR,
  READY_SELECTOR,
  isNotFound,
  readCopyright,
  readCoverUrl,
  readTitleArtist,
  readTrackTitle,
} from "../../src/apple/page";
import { extractTitleArtist } from "../../src/apple/title";
import { normaliseCoverUrl, pickCoverUrl } from "../../src/core/cover";
import vectors from "../vectors.json";
import { CASES, artworkKey, loadFixture, loadGolden } from "./fixtures";

const ALBUMS = CASES.filter((c) => c.url.includes("/album/"));
const SONGS = CASES.filter((c) => c.url.includes("/song/"));

// Albums whose page header shows only motion artwork and an editorial still, never the album artwork.
const HEADER_WITHOUT_ARTWORK = new Set(["rodrigo-sour-t6"]);

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
