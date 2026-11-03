import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { handleRequest } from "../../src/apple/handler";
import { appleSearchUrl, isAppleSearchUrl, readSearch, searchRows } from "../../src/apple/search";
import { REAL_TIMING } from "../../src/apple/driver";

const nodes = (markup: string): Node[] => [...new DOMParser().parseFromString(markup, "text/html").body.childNodes];
const setBody = (markup: string): void => {
  document.body.replaceChildren(...nodes(markup));
};
const FIXTURE = readFileSync(join(import.meta.dirname, "search-page.html"), "utf8");

beforeEach(() => {
  document.body.replaceChildren();
});

describe("the saved search page", () => {
  it("lists each song once with its artists and its album link", () => {
    setBody(FIXTURE);
    const rows = searchRows(document);
    expect(rows[0]).toEqual({
      title: "Fortnight (feat. Post Malone)",
      artists: ["Taylor Swift"],
      album: "",
      href: "https://music.apple.com/us/album/fortnight-feat-post-malone/1736268215?i=1736268216",
    });
    expect(rows.map((r) => r.title)).toContain("Fortnight (feat. Post Malone) [Acoustic Version]");
    expect(new Set(rows.map((r) => r.href)).size).toBe(rows.length);
  });

  it("keeps every artist a row names", () => {
    setBody(FIXTURE);
    const remix = searchRows(document).find((r) => r.title.includes("BLOND:ISH"));
    expect(remix?.artists).toEqual(["Taylor Swift", "BLOND:ISH"]);
  });
});

describe("searchRows", () => {
  it("drops a link that is not a song on Apple Music, and a repeated one", () => {
    const row = (href: string, title: string): string =>
      `<ul><li data-testid="track-lockup-title"><div><a href="${href}">${title}</a></div></li>` +
      '<li><span><a href="https://music.apple.com/us/artist/x/1"><span>X</span></a></span></li></ul>';
    setBody(
      row("https://evil.example/album/a/1?i=2", "Evil") +
        row("https://music.apple.com/us/album/a/1", "An album, no song picked") +
        row("https://music.apple.com/us/album/a/1?i=2", "Good") +
        row("https://music.apple.com/us/album/a/1?i=2", "Good"),
    );
    expect(searchRows(document).map((r) => r.title)).toEqual(["Good"]);
  });
});

describe("readSearch", () => {
  it("answers an empty list, not an error, for a search page that shows nothing", async () => {
    expect(await readSearch(document, 60, 10)).toEqual([]);
  });

  it("waits for rows that arrive later", async () => {
    setTimeout(() => {
      setBody(FIXTURE);
    }, 40);
    expect((await readSearch(document, 500, 10)).length).toBeGreaterThan(3);
  });
});

describe("the search address and the content request", () => {
  it("builds the US search page address, and accepts only that shape", () => {
    expect(appleSearchUrl("Fortnight  Taylor Swift")).toBe(
      "https://music.apple.com/us/search?term=Fortnight%20Taylor%20Swift",
    );
    expect(isAppleSearchUrl(appleSearchUrl("A$AP Rocky / Praise"))).toBe(true);
    expect(isAppleSearchUrl("https://music.apple.com/us/album/a/1?i=2")).toBe(false);
    expect(isAppleSearchUrl("https://music.apple.com/us/search?term=x&l=en")).toBe(false);
    expect(isAppleSearchUrl("https://evil.example/us/search?term=x")).toBe(false);
  });

  it("answers an apple/search request with the rows, and refuses another address", async () => {
    setBody(FIXTURE);
    const ok = await handleRequest({ type: "apple/search", url: appleSearchUrl("x") }, document, REAL_TIMING);
    expect(ok.ok).toBe(true);
    expect(ok.ok ? (ok.data as { title: string }[])[0]?.title : "").toBe("Fortnight (feat. Post Malone)");
    const refused = await handleRequest(
      { type: "apple/search", url: "https://music.apple.com/us/song/1" },
      document,
      REAL_TIMING,
    );
    expect(refused).toMatchObject({ ok: false, error: { code: "invalid-url" } });
  });
});
