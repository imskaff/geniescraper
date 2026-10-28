import { describe, expect, it } from "vitest";
import { normaliseRole, roleKeys } from "../../src/core/roles";
import vectors from "../vectors.json";

describe("normaliseRole parity with scraper.apple_music._normalise_role", () => {
  it.each(vectors.normalise_role)("$input -> $output", ({ input, output }) => {
    expect(normaliseRole(input)).toBe(output);
  });
});

describe("roles.json", () => {
  it("holds the full Apple Music role list", () => {
    expect(roleKeys().length).toBeGreaterThan(900);
  });

  it("keys are lowercase and trimmed, as normaliseRole looks them up", () => {
    const bad = roleKeys().filter((key) => key !== key.trim().toLowerCase());
    expect(bad).toEqual([]);
  });
});
