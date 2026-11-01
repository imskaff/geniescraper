import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { roleMap } from "../../src/core/roles";
import { ROLE_TABLES } from "../../src/spotify/roleTables";
import { spotifyRoleTargets } from "../../src/spotify/roles";

// Pins every role name the extension can type to Genius's own list. The fixtures are shared with the Python tests
// (tests/unit/test_genius_role_names.py): genius-standardized-roles.json is the "Standardized Additional Roles" page,
// genius-unlisted-role-targets.json the reviewed set of names Genius does not list, which are left for the user.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures");

interface Official {
  sections: { section: string; roles: { name: string }[] }[];
}
interface Reviewed {
  unlisted: string[];
  nearMissProposals: Record<string, string>;
}

const official = JSON.parse(readFileSync(join(FIXTURES, "genius-standardized-roles.json"), "utf-8")) as Official;
const reviewed = JSON.parse(readFileSync(join(FIXTURES, "genius-unlisted-role-targets.json"), "utf-8")) as Reviewed;

const REMOVED_SECTION = "Major Roles Removed";
const names = (removed: boolean) =>
  official.sections
    .filter((s) => (s.section === REMOVED_SECTION) === removed)
    .flatMap((s) => s.roles.map((r) => r.name));
const LISTED = new Set(names(false));
const REMOVED = new Set(names(true));
const UNLISTED = new Set(reviewed.unlisted);

const appleTargets = [...new Set(Object.values(roleMap()))];
const tableTargets = Object.values(ROLE_TABLES).flatMap((table) => Object.values(table));

describe("role names against Genius's standardized list", () => {
  it("reads the official page", () => {
    expect(LISTED.size).toBeGreaterThan(1500);
    for (const name of ["Bass Vocals", "Assistant Engineer", "Programmer", "Zills"])
      expect(LISTED.has(name), name).toBe(true);
  });

  it("types only listed roles or reviewed unlisted ones (Apple's table)", () => {
    const unknown = appleTargets.filter((t) => !LISTED.has(t) && !UNLISTED.has(t) && !REMOVED.has(t));
    expect(unknown).toEqual([]);
  });

  it("types only listed roles or reviewed unlisted ones (Spotify's tables)", () => {
    const unknown = [...spotifyRoleTargets(), ...tableTargets].filter((t) => !LISTED.has(t) && !UNLISTED.has(t));
    expect([...new Set(unknown)]).toEqual([]);
  });

  it("types the Arranger family only as roles Genius lists", () => {
    const arrangers = [...spotifyRoleTargets(), ...tableTargets].filter((t) => /arranger/i.test(t));
    expect([...new Set(arrangers)].sort()).toEqual(["Arranger", "Recording Arranger"]);
    for (const target of arrangers) expect(LISTED.has(target), target).toBe(true);
  });

  it("never offers a role Genius removed, as the Spotify tables map it", () => {
    for (const target of [...spotifyRoleTargets(), ...tableTargets]) expect(REMOVED.has(target), target).toBe(false);
  });

  it("keeps the reviewed set free of stale entries", () => {
    expect([...UNLISTED].filter((t) => LISTED.has(t))).toEqual([]);
    expect([...UNLISTED].filter((t) => !appleTargets.includes(t))).toEqual([]);
  });
});
