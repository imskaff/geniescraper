import { describe, expect, it } from "vitest";
import { creditsFromCards, creditsFromText, parseCreditsDocument } from "../../src/apple/credits";
import vectors from "../vectors.json";
import { CASES, creditMap, loadFixture, loadGolden } from "./fixtures";

function html(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

describe("credits parser against the saved credits pages and the golden files", () => {
  it.each(CASES)("$id", ({ id, url }) => {
    const credits = parseCreditsDocument(loadFixture(id, "credits"), { cardsOnly: url.includes("/song/") });
    expect(creditMap(credits)).toEqual(creditMap(loadGolden(id).credits));
  });

  it("finds credits on every fixture, so the comparison is not trivially empty", () => {
    for (const { id } of CASES) {
      expect(parseCreditsDocument(loadFixture(id, "credits")).length, id).toBeGreaterThan(3);
    }
  });
});

describe("parseCreditsDocument", () => {
  it("returns nothing for a page without credit cards when cardsOnly is set", () => {
    expect(parseCreditsDocument(html("<p>no credits here</p>"), { cardsOnly: true })).toEqual([]);
  });

  it("falls back to the text walk when there are no credit cards", () => {
    const doc = html("<div>Songwriter</div><div>A, B</div><div>Producer</div><div>C</div>");
    expect(parseCreditsDocument(doc)).toEqual([
      { role: "Songwriter", artists: ["A", "B"] },
      { role: "Producer", artists: ["C"] },
    ]);
  });
});

describe("creditsFromCards parity with scraper.apple_music.credits_from_cards", () => {
  const cases = vectors.credits_from_cards.map((c, i) => ({ ...c, label: `case ${String(i)}` }));

  it.each(cases)("$label", ({ names, roles, output }) => {
    expect(creditsFromCards(names, roles)).toEqual(output);
  });
});

describe("creditsFromText parity with scraper.apple_music.credits_from_text", () => {
  const cases = vectors.credits_from_text.map((c, i) => ({ ...c, label: `case ${String(i)}` }));

  it.each(cases)("$label", ({ input, output }) => {
    expect(creditsFromText(input)).toEqual(output);
  });
});
