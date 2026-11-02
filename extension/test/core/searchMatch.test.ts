import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acceptsHit,
  fold,
  normTitle,
  pickHit,
  type Hit,
  type SearchService,
  type SongRef,
} from "../../src/core/searchMatch";

interface Fixture {
  songs: (SongRef & { id: string })[];
  cases: { song: string; service: SearchService; hit: Hit; accept: boolean; why: string }[];
}

// The research's reviewed rows (docs/match-search-fallback.sample.json): live candidates plus a few hand cases.
const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "..", "docs", "match-search-fallback.sample.json"), "utf8"),
) as Fixture;
const songs = new Map(fixture.songs.map((song) => [song.id, song]));

describe("the research fixture", () => {
  it("has the 31 reviewed cases", () => {
    expect(fixture.cases).toHaveLength(31);
  });

  it.each(fixture.cases.map((c, i) => [i, c] as const))("case %i: %s", (_i, c) => {
    const song = songs.get(c.song);
    if (!song) throw new Error(`no song ${c.song}`);
    expect(acceptsHit(c.service, song, c.hit), c.why).toBe(c.accept);
  });
});

describe("normTitle", () => {
  it("keeps a bracket that is not a list of the song's artists", () => {
    expect(normTitle("Stay (With Me)", ["Rihanna"])).toBe("stay with me");
  });
  it("drops a with-bracket that names the artists", () => {
    expect(normTitle("STAY (with Justin Bieber)", ["The Kid LAROI", "Justin Bieber"])).toBe("stay");
  });
  it("drops edition words", () => {
    expect(normTitle("Hotel California - 2013 Remaster", [])).toBe("hotel california");
    expect(normTitle("Get Lucky (Radio Edit) [feat. Pharrell Williams]", [])).toBe("get lucky");
  });
  it("drops a non-Latin bracket", () => {
    expect(normTitle("Gangnam Style (강남스타일)", [])).toBe("gangnam style");
  });
  it("keeps the words that change the recording", () => {
    expect(normTitle("Despacito - Remix", [])).toBe("despacito remix");
    expect(normTitle("Despacito (feat. Justin Bieber) [Remix]", [])).toBe("despacito remix");
    expect(normTitle("Home (Live)", [])).not.toBe(normTitle("Home", []));
  });
});

describe("fold", () => {
  it("folds accents, case, quotes and ampersands", () => {
    expect(fold("JAŸ-Z")).toBe("jay z");
    expect(fold("Don’t Stop & Go")).toBe("dont stop and go");
  });
});

describe("pickHit", () => {
  const song: SongRef = { title: "Fortnight", primary: ["Taylor Swift"], featured: ["Post Malone"] };
  const exact: Hit = {
    title: "Fortnight (feat. Post Malone)",
    artists: ["Taylor Swift", "Post Malone"],
    album: "THE TORTURED POETS DEPARTMENT",
  };

  it("takes the first accepted result, not the first result", () => {
    const wrong: Hit = { title: "Fortnight (feat. Post Malone)", artists: ["Someone Else"], album: "X" };
    expect(pickHit("spotify", song, [wrong, exact])).toBe(exact);
  });
  it("answers null when nothing is accepted", () => {
    expect(pickHit("spotify", song, [{ title: "Kill Bill", artists: ["SZA"], album: "SOS" }])).toBeNull();
    expect(pickHit("spotify", song, [])).toBeNull();
  });
});
