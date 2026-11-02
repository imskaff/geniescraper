import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAlbumInfo } from "../../src/genius/albumState";
import { readSongInfo } from "../../src/genius/songState";

const page = (name: string): Document =>
  new DOMParser().parseFromString(
    readFileSync(join(import.meta.dirname, "pages", `${name}.html`), "utf8"),
    "text/html",
  );

/** Escape text the way a single-quoted JavaScript string literal needs it. */
const literal = (text: string): string => text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** An album page of our own making, to try what the saved pages do not show. */
function pageWith(state: unknown, after = ""): Document {
  const doc = document.implementation.createHTMLDocument("");
  const script = doc.createElement("script");
  script.textContent = `window.__PRELOADED_STATE__ = JSON.parse('${literal(JSON.stringify(state))}');${after}`;
  doc.body.append(script);
  return doc;
}

const PATH = "/albums/Artist/Album";

const albumState = (over: Record<string, unknown> = {}, islands: Record<string, unknown> = {}): unknown => ({
  currentPage: "islands",
  islands: {
    pageType: "album",
    album: {
      url: `https://genius.com${PATH}`,
      name: "Album",
      primaryArtists: [{ name: "Artist" }],
      releaseDate: "2020-02-03",
      albumType: "album",
      translationOf: null,
      ...over,
    },
    albumAppearances: [{ song: { title: "One" } }, { song: { title: "Two" } }],
    ...islands,
  },
});

describe("readAlbumInfo on saved Genius album pages (real pages, cut down)", () => {
  it.each([
    ["album-sour", "/albums/Olivia-rodrigo/Sour", "SOUR", ["Olivia Rodrigo"], "2021", 11, "album"],
    ["album-gnx", "/albums/Kendrick-lamar/Gnx", "GNX", ["Kendrick Lamar"], "2024", 12, "album"],
    [
      "album-dont-smile-at-me",
      "/albums/Billie-eilish/Dont-smile-at-me",
      "dont smile at me",
      ["Billie Eilish"],
      "2017",
      9,
      "album",
    ],
    [
      "album-essential-mj",
      "/albums/Michael-jackson/The-essential-michael-jackson",
      "The Essential Michael Jackson",
      ["Michael Jackson"],
      "2005",
      38,
      "compilation",
    ],
    [
      "album-guardians",
      "/albums/Various-artists/Guardians-of-the-galaxy-awesome-mix-vol-1-original-motion-picture-soundtrack",
      "Guardians of the Galaxy: Awesome Mix, Vol. 1 (Original Motion Picture Soundtrack)",
      ["Various Artists"],
      "2014",
      12,
      "soundtrack",
    ],
    [
      "album-nadie-sabe",
      "/albums/Bad-bunny/Nadie-sabe-lo-que-va-a-pasar-manana",
      "nadie sabe lo que va a pasar mañana",
      ["Bad Bunny"],
      "2023",
      23,
      "album",
    ],
    [
      "album-divide-deluxe",
      "/albums/Ed-sheeran/Divide-deluxe-edition",
      "÷ (Divide) [Deluxe Edition]",
      ["Ed Sheeran"],
      "2017",
      16,
      "album",
    ],
    ["album-the-book", "/albums/Yoasobi/The-book", "THE BOOK", ["YOASOBI"], "2021", 9, "album"],
    [
      "album-espresso-single",
      "/albums/Sabrina-carpenter/Espresso",
      "Espresso",
      ["Sabrina Carpenter"],
      "2024",
      2,
      "single",
    ],
    [
      "album-flower-boy",
      "/albums/Tyler-the-creator/Flower-boy",
      "Flower Boy",
      ["Tyler, The Creator"],
      "2017",
      14,
      "album",
    ],
    ["album-motomami", "/albums/Rosalia/Motomami", "MOTOMAMI", ["ROSALÍA"], "2022", 16, "album"],
    [
      "album-ttpd-anthology",
      "/albums/Taylor-swift/The-tortured-poets-department-the-anthology",
      "THE TORTURED POETS DEPARTMENT: THE ANTHOLOGY",
      ["Taylor Swift"],
      "2024",
      31,
      "album",
    ],
    [
      "album-1989-tv-deluxe",
      "/albums/Taylor-swift/1989-taylors-version-deluxe",
      "1989 (Taylor’s Version) [Deluxe]",
      ["Taylor Swift"],
      "2023",
      23,
      "album",
    ],
  ] as const)("reads %s", (file, path, title, primary, year, tracks, type) => {
    expect(readAlbumInfo(page(file), path)).toEqual({ path, title, primary, year, tracks, type });
  });

  it("reads nothing from a translation of an album (it is not the album)", () => {
    expect(
      readAlbumInfo(
        page("album-translation"),
        "/albums/Genius-traducciones-al-espanol/Olivia-rodrigo-sour-traduccion-al-espanol",
      ),
    ).toBeNull();
  });

  it("reads nothing from a song page, an artist page or a page with no state", () => {
    expect(readAlbumInfo(page("good-4-u"), "/Olivia-rodrigo-good-4-u-lyrics")).toBeNull();
    expect(readAlbumInfo(page("artist"), "/artists/Taylor-swift")).toBeNull();
    expect(readAlbumInfo(document.implementation.createHTMLDocument(""), PATH)).toBeNull();
  });

  it("is not fooled the other way: the song reader reads nothing from an album page", () => {
    expect(readSongInfo(page("album-sour"), "/albums/Olivia-rodrigo/Sour")).toBeNull();
  });

  it("reads nothing once the address is another page than the one the state describes", () => {
    expect(readAlbumInfo(page("album-sour"), "/albums/Kendrick-lamar/Gnx")).toBeNull();
    expect(readAlbumInfo(page("album-sour"), "/Olivia-rodrigo-good-4-u-lyrics")).toBeNull();
  });

  it("matches the address with or without percent-encoding", () => {
    const doc = pageWith(albumState({ url: "https://genius.com/albums/Bad-bunny/Un-verano-sin-ti" }));
    expect(readAlbumInfo(doc, "/albums/Bad-bunny/Un-verano-sin-ti")?.title).toBe("Album");
    const encoded = pageWith(albumState({ url: "https://genius.com/albums/Beyonc%C3%A9/Cowboy-carter" }));
    expect(readAlbumInfo(encoded, "/albums/Beyoncé/Cowboy-carter")?.path).toBe("/albums/Beyonc%C3%A9/Cowboy-carter");
  });
});

describe("readAlbumInfo on pages of its own making", () => {
  it("reads a minimal album", () => {
    expect(readAlbumInfo(pageWith(albumState()), PATH)).toEqual({
      path: PATH,
      title: "Album",
      primary: ["Artist"],
      year: "2020",
      tracks: 2,
      type: "album",
    });
  });

  it("reads several album artists, each as one name", () => {
    const doc = pageWith(albumState({ primaryArtists: [{ name: " Drake " }, { name: "21 Savage" }] }));
    expect(readAlbumInfo(doc, PATH)?.primary).toEqual(["Drake", "21 Savage"]);
  });

  it("says a year or size or type is unknown rather than guessing", () => {
    const doc = pageWith(albumState({ releaseDate: null, albumType: null }, { albumAppearances: undefined }));
    expect(readAlbumInfo(doc, PATH)).toMatchObject({ year: "", tracks: 0, type: "" });
  });

  it.each([
    ["no artists", albumState({ primaryArtists: [] })],
    ["a nameless artist", albumState({ primaryArtists: [{ name: "Artist" }, { name: " " }] })],
    ["an artist that is not an object", albumState({ primaryArtists: ["Artist"] })],
    ["no title", albumState({ name: "  " })],
    ["a title that is not text", albumState({ name: 7 })],
    ["no address", albumState({ url: undefined })],
    ["an address that is not one", albumState({ url: "not a url" })],
    ["an address outside /albums/", albumState({ url: "https://genius.com/artists/Artist" })],
    ["a translation", albumState({ translationOf: { id: 1 } })],
    ["another page type", albumState({}, { pageType: "generic" })],
    ["no album object", albumState({}, { album: undefined })],
    ["another current page", { ...(albumState() as object), currentPage: "songPage" }],
  ])("reads nothing from a page with %s", (_name, state) => {
    expect(readAlbumInfo(pageWith(state), PATH)).toBeNull();
  });

  it("reads nothing, and runs nothing, when the state script is not a plain literal", () => {
    const doc = document.implementation.createHTMLDocument("");
    const script = doc.createElement("script");
    script.textContent = "window.__PRELOADED_STATE__ = JSON.parse('{not json}');";
    doc.body.append(script);
    expect(readAlbumInfo(doc, PATH)).toBeNull();
    const eval_ = document.implementation.createHTMLDocument("");
    const evil = eval_.createElement("script");
    evil.textContent = "window.__PRELOADED_STATE__ = (globalThis.hacked = 1, {});";
    eval_.body.append(evil);
    expect(readAlbumInfo(eval_, PATH)).toBeNull();
    expect((globalThis as Record<string, unknown>)["hacked"]).toBeUndefined();
  });

  it("is not thrown by code after the state literal", () => {
    expect(readAlbumInfo(pageWith(albumState(), "window.x = JSON.parse('1');"), PATH)?.title).toBe("Album");
  });
});
