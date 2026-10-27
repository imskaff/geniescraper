import { describe, expect, it } from "vitest";
import { words } from "../../src/core/text";
import vectors from "../vectors.json";

describe("words parity with scraper.text.words", () => {
  it.each(vectors.words)("$input", ({ input, output }) => {
    expect(words(input)).toEqual(output);
  });

  it("drops the symbols Genius adds to copyright roles", () => {
    expect(words("Phonographic Copyright ℗")).toEqual(["phonographic", "copyright"]);
    expect(words("Copyright ©")).toEqual(["copyright"]);
  });
});
