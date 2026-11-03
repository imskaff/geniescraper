import { describe, expect, it } from "vitest";
import {
  MAX_SHOWN,
  acceptsAlbum,
  normAlbumTitle,
  pickAlbumHits,
  yearOf,
  type AlbumHit,
  type AlbumRef,
} from "../../src/core/albumMatch";

const ref = (over: Partial<AlbumRef> = {}): AlbumRef => ({
  title: "SOUR",
  primary: ["Olivia Rodrigo"],
  year: "2021",
  tracks: 11,
  type: "album",
  ...over,
});

const hit = (over: Partial<AlbumHit> = {}): AlbumHit => ({
  title: "SOUR",
  artists: ["Olivia Rodrigo"],
  year: "2021",
  tracks: 11,
  href: "https://music.apple.com/us/album/1560734944",
  ...over,
});

describe("normAlbumTitle", () => {
  it("ignores case, accents, apostrophes and punctuation, and reads & as and", () => {
    expect(normAlbumTitle("Rock & Roll")).toBe(normAlbumTitle("rock and roll"));
    expect(normAlbumTitle("Café Tacvba: Re")).toBe(normAlbumTitle("cafe tacvba re"));
    expect(normAlbumTitle("1989 (Taylor’s Version)")).toBe(normAlbumTitle("1989 (Taylor's Version)"));
    expect(normAlbumTitle("good kid, m.A.A.d city")).toBe(normAlbumTitle("GOOD KID M A A D CITY"));
  });

  it("drops the type suffix, (Explicit) and (Standard Edition), which do not make another album", () => {
    expect(normAlbumTitle("dont smile at me - EP")).toBe(normAlbumTitle("dont smile at me"));
    expect(normAlbumTitle("Espresso - Single")).toBe(normAlbumTitle("Espresso"));
    expect(normAlbumTitle("Her Loss [Explicit]")).toBe(normAlbumTitle("Her Loss"));
    expect(normAlbumTitle("Divide (Standard Edition)")).toBe(normAlbumTitle("Divide"));
  });

  it("keeps a plus sign and a symbol-only title, which are not punctuation", () => {
    expect(normAlbumTitle("MOTOMAMI +")).not.toBe(normAlbumTitle("MOTOMAMI"));
    expect(normAlbumTitle("MOTOMAMI +")).toBe(normAlbumTitle("Motomami plus"));
    expect(normAlbumTitle("÷")).not.toBe(normAlbumTitle("×"));
    expect(normAlbumTitle("÷")).not.toBe("");
    expect(normAlbumTitle("+")).not.toBe(normAlbumTitle("="));
  });

  it("keeps edition words, so a deluxe, a live album and a version stay different albums", () => {
    expect(normAlbumTitle("SOUR (Deluxe)")).not.toBe(normAlbumTitle("SOUR"));
    expect(normAlbumTitle("Folklore (Live)")).not.toBe(normAlbumTitle("Folklore"));
    expect(normAlbumTitle("1989 (Taylor's Version)")).not.toBe(normAlbumTitle("1989"));
    expect(normAlbumTitle("Thriller 25 Super Deluxe")).not.toBe(normAlbumTitle("Thriller 25"));
  });

  it("reads Deluxe and Deluxe Edition, and Remaster and Remastered, as the same word", () => {
    expect(normAlbumTitle("÷ (Deluxe Edition)")).toBe(normAlbumTitle("÷ (Deluxe)"));
    expect(normAlbumTitle("Abbey Road (Remastered)")).toBe(normAlbumTitle("Abbey Road (Remaster)"));
    expect(normAlbumTitle("Abbey Road (Remastered 2019)")).not.toBe(normAlbumTitle("Abbey Road"));
  });
});

describe("yearOf", () => {
  it("takes the four digits at the start", () => {
    expect(yearOf("2021-05-21T07:00:00Z")).toBe("2021");
    expect(yearOf(" 2021 ")).toBe("2021");
    expect(yearOf("May 2021")).toBe("");
    expect(yearOf("")).toBe("");
  });
});

describe("acceptsAlbum", () => {
  it("accepts the same album on both services", () => {
    expect(acceptsAlbum("apple", ref(), hit())).toBe(true);
    expect(acceptsAlbum("spotify", ref(), hit({ tracks: 0 }))).toBe(true);
  });

  it("accepts a different case, accents and punctuation", () => {
    const rosalia = ref({ title: "MOTOMAMI", primary: ["ROSALÍA"], year: "2022", tracks: 16 });
    expect(acceptsAlbum("apple", rosalia, hit({ title: "Motomami", artists: ["Rosalia"], year: "2022" }))).toBe(true);
    expect(
      acceptsAlbum("spotify", rosalia, hit({ title: "MOTOMAMI", artists: ["ROSALÍA"], year: "2022", tracks: 0 })),
    ).toBe(true);
  });

  it("reads & and and alike, in a title and in the artists", () => {
    const her = ref({ title: "Rock & Roll", primary: ["Drake", "21 Savage"], tracks: 0 });
    expect(acceptsAlbum("apple", her, hit({ title: "Rock and Roll", artists: ["Drake & 21 Savage"], tracks: 0 }))).toBe(
      true,
    );
    expect(
      acceptsAlbum("apple", her, hit({ title: "Rock and Roll", artists: ["Drake and 21 Savage"], tracks: 0 })),
    ).toBe(true);
    expect(
      acceptsAlbum("spotify", her, hit({ title: "Rock and Roll", artists: ["21 Savage", "Drake"], tracks: 0 })),
    ).toBe(true);
  });

  it("rejects the other edition: a deluxe is not the album, and the album is not the deluxe", () => {
    expect(acceptsAlbum("apple", ref(), hit({ title: "SOUR (Deluxe)" }))).toBe(false);
    expect(acceptsAlbum("apple", ref({ title: "SOUR (Deluxe)" }), hit())).toBe(false);
    expect(acceptsAlbum("spotify", ref(), hit({ title: "SOUR (Super Deluxe Edition)", tracks: 0 }))).toBe(false);
  });

  it("accepts the same edition under its other spelling", () => {
    const divide = ref({ title: "÷ (Divide) [Deluxe Edition]", primary: ["Ed Sheeran"], year: "2017", tracks: 16 });
    // Apple names it "÷ (Deluxe)": a different word set, so it is no match, never a guess.
    expect(
      acceptsAlbum("apple", divide, hit({ title: "÷ (Deluxe)", artists: ["Ed Sheeran"], year: "2017", tracks: 16 })),
    ).toBe(false);
    expect(
      acceptsAlbum(
        "apple",
        divide,
        hit({ title: "÷ (Divide) [Deluxe]", artists: ["Ed Sheeran"], year: "2017", tracks: 16 }),
      ),
    ).toBe(true);
  });

  it("rejects the expanded edition marked with a plus (live: Spotify's MOTOMAMI +)", () => {
    const motomami = ref({ title: "MOTOMAMI", primary: ["ROSALÍA"], year: "2022", tracks: 16 });
    expect(
      acceptsAlbum("spotify", motomami, hit({ title: "MOTOMAMI +", artists: ["ROSALÍA"], year: "2022", tracks: 0 })),
    ).toBe(false);
    expect(
      acceptsAlbum("spotify", motomami, hit({ title: "MOTOMAMI", artists: ["ROSALÍA"], year: "2022", tracks: 0 })),
    ).toBe(true);
  });

  it("rejects a live album, a version and a remaster the Genius title does not name", () => {
    expect(acceptsAlbum("apple", ref(), hit({ title: "SOUR (Live)" }))).toBe(false);
    expect(acceptsAlbum("apple", ref({ title: "1989" }), hit({ title: "1989 (Taylor's Version)" }))).toBe(false);
    expect(acceptsAlbum("apple", ref({ title: "Abbey Road" }), hit({ title: "Abbey Road (Remastered 2019)" }))).toBe(
      false,
    );
  });

  it("rejects the same title by other artists, and a differing set of artists", () => {
    const legend = ref({ title: "Legend", primary: ["Bob Marley & The Wailers"], year: "1984", tracks: 0 });
    expect(
      acceptsAlbum("apple", legend, hit({ title: "Legend", artists: ["John Legend"], year: "1984", tracks: 0 })),
    ).toBe(false);
    const drake = ref({ title: "Her Loss", primary: ["Drake"], tracks: 0 });
    expect(acceptsAlbum("apple", drake, hit({ title: "Her Loss", artists: ["Drake & 21 Savage"], tracks: 0 }))).toBe(
      false,
    );
    expect(acceptsAlbum("spotify", drake, hit({ title: "Her Loss", artists: ["Drake", "21 Savage"], tracks: 0 }))).toBe(
      false,
    );
    const both = ref({ title: "Her Loss", primary: ["Drake", "21 Savage"], tracks: 0 });
    expect(acceptsAlbum("apple", both, hit({ title: "Her Loss", artists: ["Drake"], tracks: 0 }))).toBe(false);
    // Apple's joined string must hold nothing but the artists and their connectors.
    expect(acceptsAlbum("apple", drake, hit({ title: "Her Loss", artists: ["Drake & Friends"], tracks: 0 }))).toBe(
      false,
    );
  });

  it("matches a compilation by Various Artists on both services", () => {
    const guardians = ref({
      title: "Awesome Mix, Vol. 1",
      primary: ["Various Artists"],
      year: "2014",
      tracks: 12,
      type: "soundtrack",
    });
    expect(
      acceptsAlbum(
        "apple",
        guardians,
        hit({ title: "Awesome Mix, Vol. 1", artists: ["Various Artists"], year: "2014", tracks: 12 }),
      ),
    ).toBe(true);
    expect(
      acceptsAlbum(
        "spotify",
        guardians,
        hit({ title: "Awesome Mix, Vol. 1", artists: ["Various Artists"], year: "2014", tracks: 0 }),
      ),
    ).toBe(true);
    expect(
      acceptsAlbum(
        "spotify",
        guardians,
        hit({ title: "Awesome Mix, Vol. 1", artists: ["Marvel"], year: "2014", tracks: 0 }),
      ),
    ).toBe(false);
  });

  it("accepts a year one off (dates differ by region) and rejects further, and an unknown year is not a reason to reject", () => {
    expect(acceptsAlbum("apple", ref(), hit({ year: "2020" }))).toBe(true);
    expect(acceptsAlbum("apple", ref(), hit({ year: "2022" }))).toBe(true);
    expect(acceptsAlbum("apple", ref(), hit({ year: "2023" }))).toBe(false);
    expect(acceptsAlbum("apple", ref({ year: "" }), hit({ year: "2023" }))).toBe(true);
    expect(acceptsAlbum("spotify", ref(), hit({ year: "", tracks: 0 }))).toBe(true);
  });

  it("takes an EP suffix for the album only when the tracklists are as long as one another", () => {
    const ep = ref({ title: "dont smile at me", primary: ["Billie Eilish"], year: "2017", tracks: 9 });
    expect(
      acceptsAlbum(
        "apple",
        ep,
        hit({ title: "dont smile at me - EP", artists: ["Billie Eilish"], year: "2017", tracks: 9 }),
      ),
    ).toBe(true);
    expect(
      acceptsAlbum(
        "apple",
        ep,
        hit({ title: "dont smile at me - EP", artists: ["Billie Eilish"], year: "2017", tracks: 8 }),
      ),
    ).toBe(false);
  });

  it("does not take a single of the same name for the album", () => {
    const brat = ref({ title: "BRAT", primary: ["Charli xcx"], year: "2024", tracks: 15 });
    expect(
      acceptsAlbum("apple", brat, hit({ title: "Brat - Single", artists: ["Charli xcx"], year: "2024", tracks: 1 })),
    ).toBe(false);
    // The album itself, with its own name, is still the album.
    expect(acceptsAlbum("apple", brat, hit({ title: "BRAT", artists: ["Charli xcx"], year: "2024", tracks: 15 }))).toBe(
      true,
    );
  });

  it("takes a single titled like the song for Genius's single, whatever its length", () => {
    const espresso = ref({
      title: "Espresso",
      primary: ["Sabrina Carpenter"],
      year: "2024",
      tracks: 2,
      type: "single",
    });
    expect(
      acceptsAlbum(
        "apple",
        espresso,
        hit({ title: "Espresso - Single", artists: ["Sabrina Carpenter"], year: "2024", tracks: 1 }),
      ),
    ).toBe(true);
    // An EP suffix is never excused by Genius calling it a single.
    expect(
      acceptsAlbum(
        "apple",
        espresso,
        hit({ title: "Espresso - EP", artists: ["Sabrina Carpenter"], year: "2024", tracks: 5 }),
      ),
    ).toBe(false);
  });

  it("rejects a different title that only contains this one", () => {
    expect(acceptsAlbum("apple", ref(), hit({ title: "SOUR Prom" }))).toBe(false);
    expect(acceptsAlbum("apple", ref({ title: "Guts" }), hit({ title: "GUTS (spilled)" }))).toBe(false);
  });
});

describe("pickAlbumHits", () => {
  it("lists nothing when nothing is exactly the album", () => {
    expect(pickAlbumHits("apple", ref(), [hit({ title: "GUTS" }), hit({ artists: ["Someone Else"] })])).toEqual([]);
    expect(pickAlbumHits("apple", ref(), [])).toEqual([]);
  });

  it("keeps the service's order and drops a result listed twice", () => {
    const a = hit({ href: "https://music.apple.com/us/album/1" });
    const b = hit({ href: "https://music.apple.com/us/album/2", tracks: 11, year: "2022" });
    expect(pickAlbumHits("apple", ref(), [a, hit({ title: "GUTS" }), a, b]).map((h) => h.href)).toEqual([
      a.href,
      b.href,
    ]);
  });

  it("drops the censored twin of an explicit album", () => {
    const explicit = hit({ href: "https://music.apple.com/us/album/1", explicitness: "explicit" });
    const cleaned = hit({ href: "https://music.apple.com/us/album/2", explicitness: "cleaned" });
    expect(pickAlbumHits("apple", ref(), [cleaned, explicit]).map((h) => h.href)).toEqual([explicit.href]);
    // Alone, a cleaned album is the album (SOUR has no explicit twin on iTunes).
    expect(pickAlbumHits("apple", ref(), [cleaned]).map((h) => h.href)).toEqual([cleaned.href]);
  });

  it("prefers the results that have the tracklist's length, when there are some", () => {
    const right = hit({ href: "https://music.apple.com/us/album/1", tracks: 11 });
    const bigger = hit({ href: "https://music.apple.com/us/album/2", tracks: 13 });
    expect(pickAlbumHits("apple", ref(), [bigger, right]).map((h) => h.href)).toEqual([right.href]);
    // Nothing has the length: the exact-title results are all kept (Genius's list may be short).
    expect(pickAlbumHits("apple", ref({ tracks: 12 }), [bigger, right]).map((h) => h.href)).toHaveLength(2);
  });

  it("lists results of the same name that differ in what a list shows (here the year), in order", () => {
    const first = hit({ href: "https://open.spotify.com/album/6s84u2TUpR3wdUv4NgKA2j", tracks: 0 });
    const second = hit({ href: "https://open.spotify.com/album/7bYichzvtYHdjF8HF69dyA", tracks: 0, year: "2022" });
    expect(pickAlbumHits("spotify", ref(), [first, second]).map((h) => h.href)).toEqual([first.href, second.href]);
  });

  it("lists results that look the same in every way a list can show as one, the first (explicit and clean cards)", () => {
    const first = hit({ href: "https://open.spotify.com/album/6s84u2TUpR3wdUv4NgKA2j", tracks: 0 });
    const twin = hit({
      href: "https://open.spotify.com/album/7bYichzvtYHdjF8HF69dyA",
      tracks: 0,
      title: "sour",
      artists: ["OLIVIA RODRIGO"],
    });
    expect(pickAlbumHits("spotify", ref(), [first, twin]).map((h) => h.href)).toEqual([first.href]);
    // Another artist order or another size is a difference, not a twin.
    const two = ref({ primary: ["A", "B"], tracks: 0 });
    const a = hit({ artists: ["A", "B"], href: "https://open.spotify.com/album/1", tracks: 0 });
    const b = hit({ artists: ["B", "A"], href: "https://open.spotify.com/album/2", tracks: 0 });
    expect(pickAlbumHits("spotify", two, [a, b]).map((h) => h.href)).toEqual([a.href]);
    const eleven = hit({ href: "https://music.apple.com/us/album/1", tracks: 11 });
    const twelve = hit({ href: "https://music.apple.com/us/album/2", tracks: 12 });
    expect(pickAlbumHits("apple", ref({ tracks: 0 }), [eleven, twelve]).map((h) => h.href)).toEqual([
      eleven.href,
      twelve.href,
    ]);
  });

  it("never returns a wrong album from a crowded result list", () => {
    const hits: AlbumHit[] = [
      hit({ title: "SOUR (Deluxe)", href: "https://music.apple.com/us/album/10" }),
      hit({ title: "SOUR (Video Version)", href: "https://music.apple.com/us/album/11", tracks: 15 }),
      hit({ title: "GUTS", href: "https://music.apple.com/us/album/12", tracks: 12 }),
      hit({
        title: "SOUR",
        artists: ["Olivia Rodrigo, Joshua Bassett & Cast"],
        href: "https://music.apple.com/us/album/13",
      }),
      hit({ title: "SOUR", artists: ["Another Olivia"], href: "https://music.apple.com/us/album/14" }),
      hit({ title: "SOUR - Single", href: "https://music.apple.com/us/album/15", tracks: 1 }),
      hit({ title: "SOUR", year: "2012", href: "https://music.apple.com/us/album/16" }),
      hit({ title: "SOUR", href: "https://music.apple.com/us/album/17" }),
    ];
    expect(pickAlbumHits("apple", ref(), hits).map((h) => h.href)).toEqual(["https://music.apple.com/us/album/17"]);
  });

  it("exports the most results a card lists", () => {
    expect(MAX_SHOWN).toBe(3);
  });
});
