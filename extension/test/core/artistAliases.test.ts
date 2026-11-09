import { describe, expect, it } from "vitest";
import { acceptsHit, pickHit, searchName, type Hit, type SongRef } from "../../src/core/searchMatch";

const ghost = (primary: string[], featured: string[] = []): SongRef => ({ title: "ghost", primary, featured });
const by = (...artists: string[]): Hit => ({ title: "ghost", artists, album: "ghost" });

describe("a Genius name with the real name in a trailing parenthetical", () => {
  const song = ghost(["mike. (Mike Stud)"]);

  it("matches the display name alone, on Spotify and on Apple", () => {
    expect(acceptsHit("spotify", song, by("mike."))).toBe(true);
    expect(acceptsHit("apple", song, by("mike."))).toBe(true);
  });
  it("still matches a service that keeps the whole name", () => {
    expect(acceptsHit("spotify", song, by("mike. (Mike Stud)"))).toBe(true);
    expect(acceptsHit("apple", song, by("mike. (Mike Stud)"))).toBe(true);
  });
  it("matches a known real-name case among several artists", () => {
    const duet = ghost(["Kid Cudi (Scott Mescudi)", "Eminem"]);
    expect(acceptsHit("spotify", duet, by("Kid Cudi", "Eminem"))).toBe(true);
    expect(acceptsHit("apple", duet, by("Kid Cudi & Eminem"))).toBe(true);
  });
  it("matches a featured artist named that way, from Apple's title bracket", () => {
    const feat = ghost(["Bea Miller"], ["mike. (Mike Stud)"]);
    expect(acceptsHit("spotify", feat, by("Bea Miller", "mike."))).toBe(true);
    expect(acceptsHit("apple", feat, { ...by("Bea Miller"), title: "ghost (feat. mike.)" })).toBe(true);
  });
  it("matches a Latin name given beside a non-Latin one, either way round", () => {
    const rap = ghost(["ЭВСЭ (EVSE)"]);
    expect(acceptsHit("spotify", rap, by("EVSE"))).toBe(true);
    expect(acceptsHit("spotify", rap, by("ЭВСЭ"))).toBe(true);
  });
});

describe("wrong matches stay rejected", () => {
  const song = ghost(["mike. (Mike Stud)"]);

  it("rejects the same title by another artist", () => {
    expect(acceptsHit("spotify", song, by("Mike Ryan"))).toBe(false);
    expect(acceptsHit("apple", song, by("Mike Ryan"))).toBe(false);
  });
  it("rejects another song by the same artist", () => {
    expect(acceptsHit("spotify", song, { title: "ghost town", artists: ["mike."], album: "x" })).toBe(false);
  });
  it("rejects the real name read as a second artist, or an extra artist", () => {
    expect(acceptsHit("apple", song, by("mike. & Mike Stud"))).toBe(false);
    expect(acceptsHit("spotify", song, by("mike.", "Mike Stud"))).toBe(false);
    expect(acceptsHit("spotify", song, by("mike.", "Someone"))).toBe(false);
  });
  it("rejects a bare real name when Genius gives none", () => {
    expect(acceptsHit("spotify", ghost(["Mike Stud"]), by("mike."))).toBe(false);
  });
  it("does not turn a disambiguation suffix into an alias", () => {
    for (const name of ["MIKE (US)", "MIKE (UK)", "bôa (UK)", "Breeze (US rapper)", "Us (Rapper)", "Mike (Houston)"]) {
      const base = name.replace(/\s*\(.*\)$/, "");
      expect(acceptsHit("spotify", ghost([name]), by(base)), name).toBe(false);
      expect(acceptsHit("apple", ghost([name]), by(base)), name).toBe(false);
    }
  });
  it("does not let two different Genius artists collapse into one", () => {
    const two = ghost(["mike. (Mike Stud)", "MIKE (Michael Atkins)"]);
    expect(acceptsHit("spotify", two, by("mike."))).toBe(false);
    expect(acceptsHit("apple", two, by("mike."))).toBe(false);
    expect(acceptsHit("apple", two, by("mike. & MIKE"))).toBe(false);
  });
  it("takes nothing from a list with no exact result", () => {
    expect(pickHit("spotify", song, [by("Mike Ryan"), by("Pearl Jam"), by("mike. & Someone")])).toBeNull();
  });
});

describe("the search name", () => {
  it("drops a real-name parenthetical, which the services do not index", () => {
    expect(searchName("mike. (Mike Stud)")).toBe("mike.");
    expect(searchName("Kid Cudi (Scott Mescudi)")).toBe("Kid Cudi");
  });
  it("leaves every other name alone", () => {
    for (const name of ["Taylor Swift", "P!nk", "$uicideboy$", "MIKE (US)", "Us (Rapper)", "AC/DC"]) {
      expect(searchName(name)).toBe(name);
    }
  });
  it("searches the Latin spelling of a non-Latin name", () => {
    expect(searchName("ЭВСЭ (EVSE)")).toBe("EVSE");
  });
});
