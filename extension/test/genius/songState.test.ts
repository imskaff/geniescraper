import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeStringLiteral, readSongInfo } from "../../src/genius/songState";

const page = (name: string): Document =>
  new DOMParser().parseFromString(
    readFileSync(join(import.meta.dirname, "pages", `${name}.html`), "utf8"),
    "text/html",
  );

/** A document with the og:type meta tag, as Genius sends it. */
function documentOf(ogType: string): Document {
  const doc = document.implementation.createHTMLDocument("");
  const meta = doc.createElement("meta");
  meta.setAttribute("property", "og:type");
  meta.setAttribute("content", ogType);
  doc.head.append(meta);
  return doc;
}

/** Escape text the way a single-quoted JavaScript string literal needs it. */
const literal = (text: string): string => text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** A song page of our own making, to try what the saved pages do not show. */
function pageWith(state: unknown, opts: { ogType?: string; after?: string } = {}): Document {
  const doc = documentOf(opts.ogType ?? "music.song");
  const script = doc.createElement("script");
  script.textContent = `window.__PRELOADED_STATE__ = JSON.parse('${literal(JSON.stringify(state))}');${opts.after ?? ""}`;
  doc.body.append(script);
  return doc;
}

const song = (over: Record<string, unknown> = {}): unknown => ({
  currentPage: "songPage",
  songPage: { song: 7 },
  entities: {
    songs: {
      "7": {
        title: "Don't Stop",
        path: "/Artist-dont-stop-lyrics",
        appleMusicId: "123456",
        spotifyUuid: null,
        primaryArtists: [1],
        featuredArtists: [],
        ...over,
      },
    },
    artists: { "1": { name: "Artist" }, "2": { name: "Guest" } },
  },
});

const PATH = "/Artist-dont-stop-lyrics";

describe("readSongInfo on saved Genius song pages", () => {
  it("reads a song with both ids", () => {
    expect(readSongInfo(page("good-4-u"), "/Olivia-rodrigo-good-4-u-lyrics")).toEqual({
      path: "/Olivia-rodrigo-good-4-u-lyrics",
      title: "good 4 u",
      primary: ["Olivia Rodrigo"],
      featured: [],
      appleId: "1560735551",
      spotifyId: "6PERP62TejQjgHu81OHxgM",
    });
  });

  it("reads a song with only an Apple id and a featured artist, kept apart from the primary one", () => {
    expect(readSongInfo(page("fortnight"), "/Taylor-swift-fortnight-lyrics")).toEqual({
      path: "/Taylor-swift-fortnight-lyrics",
      title: "Fortnight",
      primary: ["Taylor Swift"],
      featured: ["Post Malone"],
      appleId: "1736268216",
      spotifyId: "",
    });
  });

  it("keeps a comma inside one artist's name", () => {
    const info = readSongInfo(page("see-you-again"), "/Tyler-the-creator-see-you-again-lyrics");
    expect(info?.primary).toEqual(["Tyler, The Creator"]);
    expect(info?.featured).toEqual(["Kali Uchis"]);
  });

  it("lists two primary artists as two names", () => {
    expect(readSongInfo(page("luther"), "/Kendrick-lamar-and-sza-luther-lyrics")?.primary).toEqual([
      "Kendrick Lamar",
      "SZA",
    ]);
  });

  it("says nothing for a page that is not a song", () => {
    expect(readSongInfo(page("artist"), "/artists/Olivia-rodrigo")).toBeNull();
  });
});

describe("readSongInfo on pages of our own", () => {
  it("decodes quotes and non-ASCII text in the title", () => {
    const info = readSongInfo(pageWith(song({ title: "Don't Ça plane ’" })), PATH);
    expect(info?.title).toBe("Don't Ça plane ’");
  });

  it("stops at the end of its own literal, not at the last quote in the script", () => {
    const doc = pageWith(song(), { after: "\nwindow.other = JSON.parse('{}'); var q = 'x';" });
    expect(readSongInfo(doc, PATH)?.title).toBe("Don't Stop");
  });

  it("refuses a page whose state describes another song than the address now showing", () => {
    expect(readSongInfo(pageWith(song()), "/Other-song-lyrics")).toBeNull();
  });

  it("accepts the same path percent-encoded", () => {
    expect(readSongInfo(pageWith(song({ path: "/Zé-lyrics" })), "/Z%C3%A9-lyrics")).not.toBeNull();
  });

  it("needs og:type music.song", () => {
    expect(readSongInfo(pageWith(song(), { ogType: "website" }), PATH)).toBeNull();
  });

  it("needs currentPage songPage", () => {
    const state = { ...(song() as object), currentPage: "islands" };
    expect(readSongInfo(pageWith(state), PATH)).toBeNull();
  });

  it("drops ids of the wrong shape", () => {
    const info = readSongInfo(pageWith(song({ appleMusicId: "12a", spotifyUuid: "short" })), PATH);
    expect(info?.appleId).toBe("");
    expect(info?.spotifyId).toBe("");
  });

  it("falls back to the Spotify media link when spotifyUuid is empty", () => {
    const media = [{ provider: "spotify", url: "https://open.spotify.com/track/4Jle0Cjj88YkM7jbAjiFjf" }];
    expect(readSongInfo(pageWith(song({ media })), PATH)?.spotifyId).toBe("4Jle0Cjj88YkM7jbAjiFjf");
  });

  it("gives null rather than a partial artist list", () => {
    expect(readSongInfo(pageWith(song({ primaryArtists: [1, 99] })), PATH)).toBeNull();
    expect(readSongInfo(pageWith(song({ primaryArtists: [] })), PATH)).toBeNull();
  });

  it("gives null for a state that is not JSON or not there", () => {
    const doc = documentOf("music.song");
    const script = doc.createElement("script");
    script.textContent = "window.__PRELOADED_STATE__ = JSON.parse('{nope');";
    doc.body.append(script);
    expect(readSongInfo(doc, "/x-lyrics")).toBeNull();
    expect(readSongInfo(document.implementation.createHTMLDocument(""), "/x-lyrics")).toBeNull();
  });
});

describe("decodeStringLiteral", () => {
  it("decodes quotes, backslashes, newlines, slashes and unicode escapes", () => {
    expect(decodeStringLiteral(String.raw`a\"b\\c\'d\neé\x41\/`)).toBe(`a"b\\c'd\neéA/`);
  });
});
