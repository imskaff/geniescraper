import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_SCRIPT_FILE } from "../../src/background/ports";
import { isAlbumInfo, isContentRequest, isPageScrape, isResult, isWorkerRequest } from "../../src/shared/messages";
import { ALBUM_INFO, PAGE_SCRAPE } from "../background/fakePorts";

const URL_ = "https://music.apple.com/us/song/x/1";

describe("request validators", () => {
  it("accept the shapes the extension sends", () => {
    expect(isContentRequest({ type: "apple/detect", url: URL_ })).toBe(true);
    expect(isContentRequest({ type: "apple/scrape", url: URL_, trackTitle: "" })).toBe(true);
    expect(isWorkerRequest({ type: "detect", url: URL_ })).toBe(true);
    expect(isWorkerRequest({ type: "detect", url: URL_, tabId: 3 })).toBe(true);
    expect(isWorkerRequest({ type: "scrape-track", url: URL_, trackTitle: "T" })).toBe(true);
  });

  it.each([
    null,
    undefined,
    5,
    "x",
    [],
    {},
    { type: "apple/scrape", url: URL_ },
    { type: "apple/scrape", url: 1, trackTitle: "" },
  ])("reject %j as a content request", (value) => {
    expect(isContentRequest(value)).toBe(false);
  });

  it.each([
    null,
    {},
    { type: "detect" },
    { type: "detect", url: URL_, tabId: "3" },
    { type: "detect", url: URL_, tabId: 1.5 },
    { type: "scrape-track", url: URL_ },
  ])("reject %j as a worker request", (value) => {
    expect(isWorkerRequest(value)).toBe(false);
  });
});

describe("response validators", () => {
  it("accept well-formed results and data", () => {
    expect(isResult({ ok: true, data: 1 })).toBe(true);
    expect(isResult({ ok: false, error: { code: "timeout", message: "m" } })).toBe(true);
    expect(isAlbumInfo(ALBUM_INFO)).toBe(true);
    expect(isPageScrape(PAGE_SCRAPE)).toBe(true);
  });

  it.each([null, "x", {}, { ok: true }, { ok: false }, { ok: false, error: "x" }, { ok: "yes", data: 1 }])(
    "reject the result %j",
    (value) => {
      expect(isResult(value)).toBe(false);
    },
  );

  it("reject album info with a missing or mistyped field", () => {
    for (const key of Object.keys(ALBUM_INFO)) {
      expect(isAlbumInfo({ ...ALBUM_INFO, [key]: undefined }), key).toBe(false);
    }
    expect(isAlbumInfo({ ...ALBUM_INFO, trackUrls: [1] })).toBe(false);
  });

  it("reject a page scrape with malformed credits", () => {
    expect(isPageScrape({ ...PAGE_SCRAPE, credits: [{ role: "x", artists: [1] }] })).toBe(false);
    expect(isPageScrape({ ...PAGE_SCRAPE, credits: "x" })).toBe(false);
  });
});

describe("build wiring", () => {
  it("builds the script the worker injects", () => {
    const build = readFileSync(join(import.meta.dirname, "..", "..", "scripts", "build.mjs"), "utf-8");
    expect(CONTENT_SCRIPT_FILE).toBe("apple/content.js");
    expect(build).toContain('"apple/content": "src/apple/content.ts"');
  });
});

describe("Spotify requests and results", () => {
  const URL_ = "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT";

  it("accepts a Spotify content request and rejects a malformed one", () => {
    expect(isContentRequest({ type: "spotify/detect", url: URL_ })).toBe(true);
    expect(isContentRequest({ type: "spotify/scrape", url: URL_, trackTitle: "" })).toBe(true);
    expect(isContentRequest({ type: "spotify/scrape", url: URL_ })).toBe(false);
    expect(isContentRequest({ type: "deezer/detect", url: URL_ })).toBe(false);
  });

  it("checks the optional notes and album note", () => {
    const scrape = { title: "", artist: "", credits: [], coverArtUrl: "", releaseDate: "", warnings: [] };
    expect(isPageScrape(scrape)).toBe(true);
    expect(isPageScrape({ ...scrape, notes: ["a"] })).toBe(true);
    expect(isPageScrape({ ...scrape, notes: [1] })).toBe(false);
    const album = {
      url: URL_,
      albumTitle: "",
      artist: "",
      trackCount: 0,
      trackTitles: [],
      trackUrls: [],
      phonographicCopyright: "",
      copyrightNotice: "",
      coverArtUrl: "",
      releaseDate: "",
    };
    expect(isAlbumInfo({ ...album, note: "n" })).toBe(true);
    expect(isAlbumInfo({ ...album, note: 5 })).toBe(false);
  });
});
