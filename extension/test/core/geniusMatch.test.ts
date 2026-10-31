import { describe, expect, it } from "vitest";
import { geniusSongUrl, matchSong, parseHits, searchQuery, type GeniusHit } from "../../src/core/geniusMatch";

let nextId = 1;
function hit(title: string, primary: string[], extra: Partial<GeniusHit> = {}): GeniusHit {
  const id = extra.id ?? nextId++;
  return {
    id,
    title,
    primary,
    featured: [],
    path: `/song-${String(id)}-lyrics`,
    ...extra,
  };
}

const kindOf = (title: string, artist: string, hits: GeniusHit[]): string => matchSong(title, artist, hits).kind;

describe("searchQuery", () => {
  it("joins the artist and the title without the featured-artist part", () => {
    expect(searchQuery("Fortnight (feat. Post Malone)", "Taylor Swift")).toBe("Taylor Swift Fortnight");
    expect(searchQuery("  Hello   World ", " Adele ")).toBe("Adele Hello World");
  });
});

describe("geniusSongUrl", () => {
  it("builds the address from a plain song path", () => {
    expect(geniusSongUrl("/Taylor-swift-fortnight-lyrics")).toBe("https://genius.com/Taylor-swift-fortnight-lyrics");
    expect(geniusSongUrl("/Beyonc%C3%A9-halo-lyrics")).toBe("https://genius.com/Beyonc%C3%A9-halo-lyrics");
  });

  it.each([
    "https://evil.example/x",
    "//evil.example/x",
    "/a/b",
    "/a?x=1",
    "/a#frag",
    "/",
    "",
    "/ a",
    "/a\\b",
    "/../etc",
    `/${"a".repeat(400)}`,
  ])("refuses %j", (path) => {
    expect(geniusSongUrl(path)).toBeNull();
  });

  it("refuses anything that is not a string", () => {
    expect(geniusSongUrl(undefined)).toBeNull();
    expect(geniusSongUrl(42)).toBeNull();
    expect(geniusSongUrl({})).toBeNull();
  });
});

describe("parseHits", () => {
  const response = (hits: unknown[]): unknown => ({ response: { sections: [{ type: "song", hits }] } });
  const song = (result: Record<string, unknown>, type = "song"): unknown => ({ type, result });

  it("reads songs and their artists", () => {
    const parsed = parseHits(
      response([
        song({
          id: 10024009,
          title: "Fortnight",
          path: "/Taylor-swift-fortnight-lyrics",
          primary_artists: [{ name: "Taylor Swift" }],
          featured_artists: [{ name: "Post Malone" }],
          url: "https://evil.example/ignored",
        }),
      ]),
    );
    expect(parsed).toEqual([
      {
        id: 10024009,
        title: "Fortnight",
        primary: ["Taylor Swift"],
        featured: ["Post Malone"],
        path: "/Taylor-swift-fortnight-lyrics",
      },
    ]);
  });

  it("skips what is not a song with the expected shape", () => {
    const parsed = parseHits(
      response([
        song({ id: 1, title: "A", path: "/a-lyrics" }, "album"),
        song({ id: "2", title: "B", path: "/b-lyrics" }),
        song({ id: 3, title: 7, path: "/c-lyrics" }),
        song({ id: 4, title: "D", path: "https://evil.example/d" }),
        song({ id: 5, title: "E", path: "/e/f" }),
        "nonsense",
        null,
        song({ id: 6, title: "F", path: "/f-lyrics" }),
      ]),
    );
    expect(parsed.map((entry) => entry.id)).toEqual([6]);
    expect(parsed[0]?.primary).toEqual([]);
  });

  it("returns nothing for a response of the wrong shape", () => {
    expect(parseHits(null)).toEqual([]);
    expect(parseHits("<html>")).toEqual([]);
    expect(parseHits({ response: {} })).toEqual([]);
    expect(parseHits({ response: { sections: [{ hits: "x" }] } })).toEqual([]);
  });
});

describe("matchSong: one exact match", () => {
  it("matches a plain title and artist", () => {
    const fortnight = hit("Fortnight", ["Taylor Swift"], { id: 10 });
    const result = matchSong("Fortnight", "Taylor Swift", [hit("Other", ["Taylor Swift"]), fortnight]);
    expect(result).toEqual({
      kind: "match",
      song: { id: 10, title: "Fortnight", artists: ["Taylor Swift"], url: `https://genius.com${fortnight.path}` },
    });
  });

  it("ignores the featured-artist part of the Apple title", () => {
    expect(kindOf("Fortnight (feat. Post Malone)", "Taylor Swift", [hit("Fortnight", ["Taylor Swift"])])).toBe("match");
    expect(kindOf("Fortnight [ft. Post Malone]", "Taylor Swift", [hit("Fortnight", ["Taylor Swift"])])).toBe("match");
    expect(kindOf("Fortnight (with Post Malone)", "Taylor Swift", [hit("Fortnight", ["Taylor Swift"])])).toBe("match");
  });

  it("folds accents and case on both sides", () => {
    expect(kindOf("Déjà Vu", "BEYONCÉ", [hit("Deja Vu", ["Beyoncé"])])).toBe("match");
    expect(kindOf("deja vu", "beyonce", [hit("Déjà Vu", ["Beyoncé"])])).toBe("match");
  });

  it("treats curly and straight apostrophes and punctuation alike", () => {
    expect(kindOf("Don’t Stop Believin’", "Journey", [hit("Don't Stop Believin'", ["Journey"])])).toBe("match");
    expect(kindOf("Mr. Brightside", "The Killers", [hit("Mr Brightside", ["The Killers"])])).toBe("match");
  });

  it("treats & and and as the same word, in titles and artists", () => {
    expect(kindOf("Tom & Jerry", "Duo", [hit("Tom and Jerry", ["Duo"])])).toBe("match");
    expect(kindOf("Tom and Jerry", "Duo", [hit("Tom & Jerry", ["Duo"])])).toBe("match");
    expect(kindOf("Song", "Post Malone & Swae Lee", [hit("Song", ["Post Malone", "Swae Lee"])])).toBe("match");
    expect(kindOf("Song", "Post Malone and Swae Lee", [hit("Song", ["Post Malone & Swae Lee"])])).toBe("match");
  });

  it("does not depend on the order of the artists, or on splitting commas", () => {
    expect(kindOf("Song", "Swae Lee, Post Malone", [hit("Song", ["Post Malone", "Swae Lee"])])).toBe("match");
    expect(kindOf("Yeah", "Tyler, The Creator", [hit("Yeah", ["Tyler, The Creator"])])).toBe("match");
  });

  it("accepts an Apple artist line that lists the featured artists too", () => {
    const song = hit("Fortnight", ["Taylor Swift"], { featured: ["Post Malone"] });
    expect(kindOf("Fortnight", "Taylor Swift, Post Malone", [song])).toBe("match");
    expect(kindOf("Fortnight", "Taylor Swift feat. Post Malone", [song])).toBe("match");
    expect(kindOf("Fortnight", "Taylor Swift", [song])).toBe("match");
  });

  it("keeps non-latin titles", () => {
    expect(kindOf("夜に駆ける", "YOASOBI", [hit("夜に駆ける", ["YOASOBI"])])).toBe("match");
    expect(kindOf("夜に駆ける", "YOASOBI", [hit("夜に", ["YOASOBI"])])).toBe("none");
  });

  it("matches a title made only of digits and symbols by its digits", () => {
    expect(kindOf("1999", "Prince", [hit("1999", ["Prince"])])).toBe("match");
    expect(kindOf("1999", "Prince", [hit("2000", ["Prince"])])).toBe("none");
  });
});

describe("matchSong: no match", () => {
  it("does not match a remix, live or other version of the song", () => {
    for (const other of [
      "Fortnight (Remix)",
      "Fortnight (Live)",
      "Fortnight (Acoustic)",
      "Fortnight (Sped Up)",
      "Fortnight (Remastered 2011)",
      "Fortnight (Taylor's Version)",
      "Fortnight - Radio Edit",
      "Fortnight Demo",
    ]) {
      expect(kindOf("Fortnight", "Taylor Swift", [hit(other, ["Taylor Swift"])]), other).toBe("none");
    }
  });

  it("does not match the original when the track is the remix", () => {
    expect(kindOf("Fortnight (Remix)", "Taylor Swift", [hit("Fortnight", ["Taylor Swift"])])).toBe("none");
  });

  it("matches a remix exactly when Genius spells it the same way", () => {
    expect(kindOf("Levitating (Remix)", "Dua Lipa", [hit("Levitating (Remix)", ["Dua Lipa"])])).toBe("match");
  });

  it("does not match a longer or shorter title", () => {
    expect(kindOf("Love", "Artist", [hit("Love Story", ["Artist"])])).toBe("none");
    expect(kindOf("Love Story", "Artist", [hit("Love", ["Artist"])])).toBe("none");
    expect(kindOf("Part 2", "Artist", [hit("Part II", ["Artist"])])).toBe("none");
  });

  it("does not match another artist, or one shared word of an artist", () => {
    expect(kindOf("Hello", "Adele", [hit("Hello", ["Lionel Richie"])])).toBe("none");
    expect(kindOf("Hello", "Taylor Swift", [hit("Hello", ["Taylor Hicks"])])).toBe("none");
    expect(kindOf("Hello", "The Weeknd", [hit("Hello", ["The Weeknd & Daft Punk"])])).toBe("none");
  });

  it("rejects translation pages that carry the song name", () => {
    const translations = [
      hit("Taylor Swift - Fortnight ft. Post Malone (Traducción al Español)", ["Genius Traducciones al Español"]),
      hit("Taylor Swift - Fortnight (Deutsche Übersetzung)", ["Genius Deutsche Übersetzungen"]),
    ];
    expect(kindOf("Fortnight", "Taylor Swift", translations)).toBe("none");
  });

  it("finds the song among translations", () => {
    const original = hit("Fortnight", ["Taylor Swift"], { id: 7 });
    const result = matchSong("Fortnight", "Taylor Swift", [
      hit("Taylor Swift - Fortnight (Türkçe Çeviri)", ["Genius Türkçe Çeviriler"]),
      original,
    ]);
    expect(result.kind).toBe("match");
  });

  it("is none for no hits, an empty title or an empty artist", () => {
    expect(kindOf("Fortnight", "Taylor Swift", [])).toBe("none");
    expect(kindOf("", "Taylor Swift", [hit("", ["Taylor Swift"])])).toBe("none");
    expect(kindOf("Fortnight", "", [hit("Fortnight", [])])).toBe("none");
    expect(kindOf("(feat. X)", "Taylor Swift", [hit("(feat. X)", ["Taylor Swift"])])).toBe("none");
  });

  it("drops a hit whose path is not a plain song page", () => {
    const bad = hit("Fortnight", ["Taylor Swift"], { path: "https://evil.example/x" });
    expect(kindOf("Fortnight", "Taylor Swift", [bad])).toBe("none");
  });
});

describe("matchSong: several matches", () => {
  it("reports every exact candidate and picks none", () => {
    const a = hit("Fortnight", ["Taylor Swift"], { id: 1 });
    const b = hit("Fortnight", ["Taylor Swift"], { id: 2 });
    const result = matchSong("Fortnight", "Taylor Swift", [a, b, hit("Other", ["Taylor Swift"])]);
    expect(result.kind).toBe("several");
    if (result.kind === "several") expect(result.songs.map((song) => song.id)).toEqual([1, 2]);
  });

  it("counts the same song twice in the results once", () => {
    const a = hit("Fortnight", ["Taylor Swift"], { id: 1 });
    expect(matchSong("Fortnight", "Taylor Swift", [a, { ...a }]).kind).toBe("match");
  });
});
