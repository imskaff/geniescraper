import { describe, expect, it } from "vitest";
import { deezerCover, deezerPng, isDeezerArtwork } from "../../src/lookups/deezer";
import type { GetJson } from "../../src/lookups/itunes";

const CDN = "https://cdn-images.dzcdn.net/images/cover/abc123/1000x1000-000000-80-0-0.jpg";
const PNG = "https://cdn-images.dzcdn.net/images/cover/abc123/1000x1000-000000-80-0-0.png";

const hit = (title: string, artist: string, cover: unknown) => ({
  title,
  artist: { name: artist },
  album: { cover_xl: cover },
});
const serve =
  (...data: unknown[]): GetJson =>
  () =>
    Promise.resolve({ data });

describe("deezerPng", () => {
  it("swaps the file extension for png, as the desktop app does", () => {
    expect(deezerPng(CDN)).toBe(PNG);
    expect(deezerPng("https://e-cdns-images.dzcdn.net/images/cover/x/1000x1000.webp")).toBe(
      "https://e-cdns-images.dzcdn.net/images/cover/x/1000x1000.png",
    );
  });
});

describe("isDeezerArtwork", () => {
  it.each([PNG, "https://e-cdns-images.dzcdn.net/images/cover/x/1000x1000.png"])("accepts %s", (url) => {
    expect(isDeezerArtwork(url)).toBe(true);
  });

  it.each([
    "http://cdn-images.dzcdn.net/x.png",
    "https://dzcdn.net.evil.example/x.png",
    "https://evildzcdn.net/x.png",
    "https://example.com/x.png",
    "javascript:alert(1)",
    "not a url",
    "",
  ])("rejects %j", (url) => {
    expect(isDeezerArtwork(url)).toBe(false);
  });
});

describe("deezerCover", () => {
  it("asks for the artist and title together, ten hits, and returns the matching cover as a png", async () => {
    const seen: string[] = [];
    const getJson: GetJson = (url) => {
      seen.push(url);
      return Promise.resolve({ data: [hit("SOS", "SZA", CDN)] });
    };
    expect(await deezerCover(getJson, "SOS", "SZA")).toBe(PNG);
    const url = new URL(seen[0] ?? "");
    expect(url.origin + url.pathname).toBe("https://api.deezer.com/search");
    expect(url.searchParams.get("q")).toBe("SZA SOS");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("skips another song by the same artist and takes the next hit that is the track", async () => {
    const other = "https://cdn-images.dzcdn.net/images/cover/other/1000x1000.jpg";
    expect(await deezerCover(serve(hit("Kill Bill", "SZA", other), hit("SOS", "SZA", CDN)), "SOS", "SZA")).toBe(PNG);
  });

  it("matches ignoring a feat. part and accents", async () => {
    expect(await deezerCover(serve(hit("Beyoncé (feat. Jay)", "Beyoncé", CDN)), "Beyonce", "Beyonce")).toBe(PNG);
  });

  it("rejects a hit by a different artist", async () => {
    expect(await deezerCover(serve(hit("SOS", "Rihanna", CDN)), "SOS", "SZA")).toBe("");
  });

  it("skips a hit with no cover or a cover that is not on Deezer's CDN over https", async () => {
    const hits = [
      hit("SOS", "SZA", ""),
      hit("SOS", "SZA", undefined),
      hit("SOS", "SZA", "https://evil.example/x.jpg"),
      hit("SOS", "SZA", "http://cdn-images.dzcdn.net/x.jpg"),
    ];
    expect(await deezerCover(serve(...hits), "SOS", "SZA")).toBe("");
    expect(await deezerCover(serve(...hits, hit("SOS", "SZA", CDN)), "SOS", "SZA")).toBe(PNG);
  });

  it.each([null, undefined, 5, "x", {}, { data: "x" }, { data: [null, 3, "x", {}, { title: 4 }] }])(
    "gives nothing for the malformed answer %j",
    async (answer) => {
      expect(await deezerCover(() => Promise.resolve(answer), "SOS", "SZA")).toBe("");
    },
  );

  it("makes no request without a title and an artist", async () => {
    let called = false;
    const getJson: GetJson = () => {
      called = true;
      return Promise.resolve(null);
    };
    expect(await deezerCover(getJson, "", "SZA")).toBe("");
    expect(await deezerCover(getJson, "SOS", "")).toBe("");
    expect(called).toBe(false);
  });
});
