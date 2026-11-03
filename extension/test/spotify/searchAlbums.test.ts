import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { handleRequest } from "../../src/spotify/handler";
import { REAL_TIMING, type Timing } from "../../src/spotify/page";
import { albumRows, readSearch } from "../../src/spotify/search";
import { isAlbumSearchUrl, isSpotifySearchUrl, spotifySearchUrl } from "../../src/spotify/url";

const FAST: Timing = { ...REAL_TIMING, rowsMs: 200, settleMs: 20, stepMs: 10 };

const setBody = (markup: string): void => {
  document.body.replaceChildren(...new DOMParser().parseFromString(markup, "text/html").body.childNodes);
};

const card = (id: string, title: string, year: string, artists: string[]): string =>
  `<div data-testid="search-category-card-0"><a href="/album/${id}"><p title="${title}"><span>${title}</span></p></a>` +
  `<time datetime="${year}">${year} • </time>` +
  artists.map((a) => `<a href="/artist/X">${a}</a>`).join("") +
  "</div>";

const ID = "6s84u2TUpR3wdUv4NgKA2j";

beforeEach(() => {
  document.body.replaceChildren();
});

describe("the saved albums search page", () => {
  it("reads the cards as Spotify serves them: title, album artists, year and the album link", () => {
    setBody(readFileSync(join(import.meta.dirname, "search-albums-page.html"), "utf8"));
    const rows = albumRows(document);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      title: "SOUR",
      artists: ["Olivia Rodrigo"],
      album: "",
      year: "2021",
      href: "https://open.spotify.com/album/6s84u2TUpR3wdUv4NgKA2j",
    });
    // Two albums of the same name are two cards: telling them apart is not this reader's job.
    expect(rows[1]?.title).toBe("SOUR");
    expect(rows[1]?.href).toBe("https://open.spotify.com/album/7bYichzvtYHdjF8HF69dyA");
    expect(rows[2]?.artists).toEqual(["Olivia Rodrigo", "Chappell Roan"]);
  });
});

describe("albumRows", () => {
  it("builds the link from the album id and reads the year from the time element", () => {
    setBody(card(ID, "SOUR", "2021", ["Olivia Rodrigo"]));
    expect(albumRows(document)).toEqual([
      {
        title: "SOUR",
        artists: ["Olivia Rodrigo"],
        album: "",
        year: "2021",
        href: `https://open.spotify.com/album/${ID}`,
      },
    ]);
  });

  it("reads a card with no year as a year of '' (never a guess)", () => {
    setBody(
      `<div data-testid="search-category-card-3"><a href="/album/${ID}">No year</a><a href="/artist/X">A</a></div>`,
    );
    expect(albumRows(document)[0]?.year).toBe("");
  });

  it("skips a card with no album id, no title, or that is not an album (an artist or a playlist card)", () => {
    setBody(
      '<div data-testid="search-category-card-0"><a href="/album/short">Bad id</a></div>' +
        '<div data-testid="search-category-card-1"><a href="/artist/X">An artist</a></div>' +
        `<div data-testid="search-category-card-2"><a href="/album/${ID}"></a></div>` +
        card(ID, "Good", "2020", ["A"]),
    );
    expect(albumRows(document).map((r) => r.title)).toEqual(["Good"]);
  });

  it("never takes a link target from the page's text: the address is built from the id alone", () => {
    setBody(
      `<div data-testid="search-category-card-0"><a href="/album/${ID}?next=https://evil.example">Song</a></div>`,
    );
    expect(albumRows(document)[0]?.href).toBe(`https://open.spotify.com/album/${ID}`);
  });
});

describe("readSearch for albums", () => {
  it("waits for cards that arrive later", async () => {
    setTimeout(() => {
      setBody(card(ID, "Late", "2020", ["A"]));
    }, 40);
    expect((await readSearch(document, FAST, albumRows)).map((r) => r.title)).toEqual(["Late"]);
  });

  it("does not take song rows for album cards, and fails when no cards come", async () => {
    setBody('<div data-testid="tracklist-row"><a href="/track/1jX3nPWUbEQVGxMBb7NPXp">Song</a></div>');
    await expect(readSearch(document, FAST, albumRows)).rejects.toMatchObject({ code: "tab-failed" });
  });

  it("reports a captcha page as blocked", async () => {
    setBody("<p>Please solve this captcha to continue</p>");
    await expect(readSearch(document, FAST, albumRows)).rejects.toMatchObject({ code: "blocked" });
  });
});

describe("the albums search address", () => {
  it("is the albums tab, English, marked as a reader tab", () => {
    expect(spotifySearchUrl("SOUR  Olivia Rodrigo", "albums")).toBe(
      "https://open.spotify.com/search/SOUR%20Olivia%20Rodrigo/albums?locale=en&geniescraper=read",
    );
    expect(isAlbumSearchUrl(spotifySearchUrl("SOUR", "albums"))).toBe(true);
    expect(isAlbumSearchUrl(spotifySearchUrl("SOUR"))).toBe(false);
  });

  it("is accepted like the songs address, and only when the worker built it", () => {
    expect(isSpotifySearchUrl(spotifySearchUrl("A$AP Rocky / Praise the Lord", "albums"))).toBe(true);
    expect(isSpotifySearchUrl("https://open.spotify.com/search/x/albums")).toBe(false);
    expect(isSpotifySearchUrl("https://open.spotify.com/search/x/playlists?locale=en&geniescraper=read")).toBe(false);
    expect(isSpotifySearchUrl("https://evil.example/search/x/albums?locale=en&geniescraper=read")).toBe(false);
  });
});

describe("the content request for albums", () => {
  it("answers an albums search with the cards", async () => {
    setBody(card(ID, "SOUR", "2021", ["Olivia Rodrigo"]));
    const answer = await handleRequest(
      { type: "spotify/search", url: spotifySearchUrl("SOUR Olivia Rodrigo", "albums") },
      document,
      FAST,
    );
    expect(answer).toMatchObject({ ok: true, data: [{ title: "SOUR", year: "2021" }] });
  });

  it("answers a songs search as before, with song rows", async () => {
    setBody(
      '<div data-testid="tracklist-row"><a href="/track/1jX3nPWUbEQVGxMBb7NPXp">Song</a><a href="/artist/X">A</a></div>',
    );
    const answer = await handleRequest({ type: "spotify/search", url: spotifySearchUrl("Song A") }, document, FAST);
    expect(answer).toMatchObject({ ok: true, data: [{ title: "Song" }] });
  });
});
