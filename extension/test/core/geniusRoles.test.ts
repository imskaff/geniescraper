import { describe, expect, it } from "vitest";
import { geniusRole } from "../../src/core/geniusRoles";

describe("geniusRole", () => {
  it.each([
    ["Programming", "Programmer"],
    ["programming", "Programmer"],
    ["  Programming ", "Programmer"],
    ["Drum Programming", "Drum Programmer"],
    ["Synthesizer Programming", "Synthesizer Programmer"],
    ["Percussion Programming", "Percussion Programmer"],
    ["Additional Producer", "Additional Production"],
    ["additional producer", "Additional Production"],
    ["Vocal Recording Engineer", "Vocal Engineer"],
  ])("names %j %j on Genius", (apple, genius) => {
    expect(geniusRole(apple)).toBe(genius);
  });

  it.each([
    "Mixing Engineer",
    "Mastering Engineer",
    "Lead Vocals",
    "Background Vocals",
    "Synthesizer",
    "Guitar",
    "Recording Engineer",
    "Assistant Mixing Engineer",
    "Phonographic Copyright",
    "Copyright",
    // No Genius equivalent was found: left as it is, for the user to decide.
    "Editing Engineer",
    // Not a role that ends in the word.
    "Programming Assistant",
    "Programmer",
  ])("leaves %j as it is", (role) => {
    expect(geniusRole(role)).toBe(role);
  });

  it("is idempotent", () => {
    for (const role of ["Programming", "Drum Programming", "Additional Producer", "Vocal Recording Engineer"]) {
      expect(geniusRole(geniusRole(role))).toBe(geniusRole(role));
    }
  });
});
