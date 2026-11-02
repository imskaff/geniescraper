import { beforeEach, describe, expect, it } from "vitest";
import { handleRequest } from "../../src/spotify/handler";
import { REAL_TIMING, type Timing } from "../../src/spotify/page";
import { readSearch, searchRows } from "../../src/spotify/search";
import { isSpotifySearchUrl, spotifySearchUrl } from "../../src/spotify/url";

const FAST: Timing = { ...REAL_TIMING, rowsMs: 200, settleMs: 20, stepMs: 10 };

const row = (id: string, title: string, artists: string[], album: string): string =>
  `<div data-testid="tracklist-row"><a href="/track/${id}">${title}</a>` +
  artists.map((a) => `<a href="/artist/X">${a}</a>`).join("") +
  `<a href="/album/Y">${album}</a></div>`;

const setBody = (markup: string): void => {
  document.body.replaceChildren(...new DOMParser().parseFromString(markup, "text/html").body.childNodes);
};

const ID = "1jX3nPWUbEQVGxMBb7NPXp";

beforeEach(() => {
  document.body.replaceChildren();
});

describe("searchRows", () => {
  it("reads title, every artist, album and a link built from the track id", () => {
    setBody(row(ID, "Fortnight (feat. Post Malone)", ["Taylor Swift", "Post Malone"], "THE TORTURED POETS DEPARTMENT"));
    expect(searchRows(document)).toEqual([
      {
        title: "Fortnight (feat. Post Malone)",
        artists: ["Taylor Swift", "Post Malone"],
        album: "THE TORTURED POETS DEPARTMENT",
        href: `https://open.spotify.com/track/${ID}`,
      },
    ]);
  });

  it("skips a row with no track id or no title", () => {
    setBody(
      '<div data-testid="tracklist-row"><a href="/track/short">Bad</a></div>' +
        '<div data-testid="tracklist-row"><a href="/artist/X">No song</a></div>' +
        row(ID, "Good", ["A"], "B"),
    );
    expect(searchRows(document).map((r) => r.title)).toEqual(["Good"]);
  });
});

describe("readSearch", () => {
  it("waits for rows that arrive later", async () => {
    setTimeout(() => {
      setBody(row(ID, "Late", ["A"], "B"));
    }, 40);
    expect((await readSearch(document, FAST)).map((r) => r.title)).toEqual(["Late"]);
  });

  it("fails when the page shows no list, instead of reading it as 'no match'", async () => {
    await expect(readSearch(document, FAST)).rejects.toMatchObject({ code: "tab-failed" });
  });

  it("reports a captcha page as blocked", async () => {
    setBody("<p>Please solve this captcha to continue</p>");
    await expect(readSearch(document, FAST)).rejects.toMatchObject({ code: "blocked" });
  });
});

describe("the search address", () => {
  it("is English, marked as a reader tab, and carries the text in the path", () => {
    expect(spotifySearchUrl("Fortnight  Taylor Swift")).toBe(
      "https://open.spotify.com/search/Fortnight%20Taylor%20Swift/tracks?locale=en&geniescraper=read",
    );
  });

  it("accepts only an address the worker built", () => {
    expect(isSpotifySearchUrl(spotifySearchUrl("A$AP Rocky / Praise the Lord"))).toBe(true);
    expect(isSpotifySearchUrl("https://open.spotify.com/search/x/tracks")).toBe(false);
    expect(isSpotifySearchUrl("https://evil.example/search/x/tracks?locale=en&geniescraper=read")).toBe(false);
    expect(isSpotifySearchUrl("https://open.spotify.com/track/1jX3nPWUbEQVGxMBb7NPXp")).toBe(false);
  });
});

describe("the content request", () => {
  it("answers a search request with the rows", async () => {
    setBody(row(ID, "Song", ["A"], "B"));
    const answer = await handleRequest({ type: "spotify/search", url: spotifySearchUrl("Song A") }, document, FAST);
    expect(answer).toMatchObject({ ok: true, data: [{ title: "Song" }] });
  });

  it("refuses an address that is not a search the worker built", async () => {
    const answer = await handleRequest(
      { type: "spotify/search", url: "https://open.spotify.com/track/1jX3nPWUbEQVGxMBb7NPXp" },
      document,
      FAST,
    );
    expect(answer).toMatchObject({ ok: false, error: { code: "invalid-url" } });
  });
});
