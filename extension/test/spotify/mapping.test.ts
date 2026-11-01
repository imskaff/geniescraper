import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OBSERVED } from "./observedRoles";
import { ROLE_TABLES } from "../../src/spotify/roleTables";
import { roleMap } from "../../src/core/roles";
import {
  creditsFromDialog,
  languageNote,
  pageLanguage,
  skippedNote,
  splitRoles,
  type DialogRow,
} from "../../src/spotify/dialog";
import { parseDialog } from "../../src/spotify/page";
import { hasRoleTable, normaliseSpotifyRole, roleKey, spotifyRole, spotifyRoleTargets } from "../../src/spotify/roles";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): Element => {
  const markup = readFileSync(join(here, name), "utf-8").trim();
  document.body.replaceChildren(...new DOMParser().parseFromString(markup, "text/html").body.childNodes);
  const dialog = document.querySelector("dialog");
  if (!dialog) throw new Error(`${name} has no dialog`);
  return dialog;
};

const row = (name: string, roles: string[], sectionIndex = 1, artistId: string | null = null): DialogRow => ({
  section: "",
  sectionIndex,
  name,
  roles,
  artistId,
});

describe("spotifyRole", () => {
  it("maps the writing roles to Songwriter and mixers to Mixing Engineer", () => {
    for (const raw of ["Composer", "Lyricist", "Songwriter", "Author"]) expect(spotifyRole(raw)).toBe("Songwriter");
    expect(spotifyRole("Mixer")).toBe("Mixing Engineer");
    expect(spotifyRole("Masterer")).toBe("Mastering Engineer");
    expect(spotifyRole("Vocalist")).toBe("Vocals");
    expect(spotifyRole("Background Vocalist")).toBe("Background Vocals");
    expect(spotifyRole("Drum Kit")).toBe("Drums");
    expect(spotifyRole("Recording Arranger")).toBe("Arranger");
  });

  it("types the second engineer as Assistant Engineer, the name Genius's list gives it", () => {
    expect(spotifyRole("Recording Second Engineer")).toBe("Assistant Engineer");
  });

  it("types the bass voice as Bass Vocals and leaves out Studio Personnel, which Genius removed", () => {
    expect(spotifyRole("Bass Vocalist")).toBe("Bass Vocals");
    expect(spotifyRole("Studio Personnel")).toBeNull();
    expect(spotifyRole("studio personnel", "de")).toBeNull();
  });

  it("ignores case, spacing and a trailing colon", () => {
    expect(spotifyRole("  mixing   ENGINEER: ")).toBe("Mixing Engineer");
  });

  it("keeps a label that already is a Genius role, in Genius's spelling", () => {
    expect(spotifyRole("electric guitar")).toBe("Electric Guitar");
    expect(spotifyRole("Cello")).toBe("Cello");
    expect(spotifyRole("Choir")).toBe("Choir");
  });

  it("does not know labels in other languages or roles Genius lacks", () => {
    for (const raw of ["Komponist*in", "作曲家", "Kompozytor", "Director", "Studio Personnel", ""]) {
      expect(spotifyRole(raw), raw).toBeNull();
    }
  });

  it("gives an unknown label back as written through the interface form", () => {
    expect(normaliseSpotifyRole(" Director: ")).toBe("Director");
    expect(normaliseSpotifyRole("Composer")).toBe("Songwriter");
  });

  it("only produces role names Genius lists", () => {
    const genius = new Set(Object.values(roleMap()));
    for (const target of spotifyRoleTargets()) expect(genius.has(target), target).toBe(true);
  });
});

describe("splitRoles", () => {
  it("splits on the bullet the dialog joins roles with", () => {
    expect(splitRoles("Composer • Lyricist")).toEqual(["Composer", "Lyricist"]);
    expect(splitRoles(" Producer ·  Mixer ")).toEqual(["Producer", "Mixer"]);
    expect(splitRoles("Producer")).toEqual(["Producer"]);
    expect(splitRoles("")).toEqual([]);
  });
});

describe("creditsFromDialog", () => {
  it("separates the artists from the credits and merges people under each Genius role in first-seen order", () => {
    const result = creditsFromDialog({
      rows: [
        row("Main One", ["Main Artist"], 0, "a1"),
        row("Writer A", ["Composer", "Lyricist"]),
        row("Writer B", ["Lyricist"]),
        row("Maker", ["Producer", "Mixer"], 2),
        row("Maker", ["Producer"], 2),
      ],
    });
    expect(result.artists).toEqual(["Main One"]);
    expect(result.credits).toEqual([
      { role: "Songwriter", artists: ["Writer A", "Writer B"] },
      { role: "Producer", artists: ["Maker"] },
      { role: "Mixing Engineer", artists: ["Maker"] },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("lists unknown roles with their people and keeps the rest", () => {
    const result = creditsFromDialog({
      rows: [row("Person 1", ["Director", "Composer"], 3), row("Person 2", ["Director"], 3), row("P3", ["Flux Capacitor"], 3)],
    });
    expect(result.credits).toEqual([{ role: "Songwriter", artists: ["Person 1"] }]);
    expect(result.skipped).toEqual([
      { role: "Director", names: ["Person 1", "Person 2"] },
      { role: "Flux Capacitor", names: ["P3"] },
    ]);
    expect(skippedNote(result.skipped)).toBe(
      "Left out because Genius has no matching role: Director (Person 1, Person 2); Flux Capacitor (P3).",
    );
    expect(skippedNote([])).toBe("");
  });

  it("has no credits for an artist-only dialog", () => {
    const result = creditsFromDialog({
      rows: [row("Solo", ["Main Artist"], 0, "a1"), row("Duo", ["Main Artist"], 0, "a2")],
    });
    expect(result.credits).toEqual([]);
    expect(result.artists).toEqual(["Solo", "Duo"]);
  });

  it("treats a person with an artist id outside the Artist section as a credit", () => {
    expect(creditsFromDialog({ rows: [row("Guest", ["Vocalist"], 3, "a9")] }).credits).toEqual([
      { role: "Vocals", artists: ["Guest"] },
    ]);
  });

  it("copes with very long names and many credits", () => {
    const longName = "N".repeat(400);
    const rows = [
      row(longName, ["Producer"]),
      ...Array.from({ length: 60 }, (_, i) => row(`W ${String(i)}`, ["Composer"])),
    ];
    const result = creditsFromDialog({ rows });
    expect(result.credits[0]?.artists).toEqual([longName]);
    expect(result.credits[1]?.artists).toHaveLength(60);
  });
});

describe("credits from the saved dialogs", () => {
  it("reads a credit-heavy track: songwriters, producers, and every other role is a credit or listed as left out", () => {
    const parsed = parseDialog(fixture("credits-many-roles.html"));
    const result = creditsFromDialog(parsed);
    const roles = result.credits.map((c) => c.role);
    expect(roles).toContain("Songwriter");
    expect(roles).toContain("Producer");
    expect(result.artists.length).toBeGreaterThan(0);
    const left = new Set(result.skipped.map((s) => s.role));
    for (const raw of parsed.rows.filter((r) => r.artistId === null).flatMap((r) => r.roles)) {
      expect(spotifyRole(raw) !== null || left.has(raw), raw).toBe(true);
    }
  });

  it("lists German role text as left out instead of guessing", () => {
    const result = creditsFromDialog(parseDialog(fixture("credits-de.html")));
    expect(result.skipped.length).toBeGreaterThan(0);
  });

  it("gives no credits for a track with only artists", () => {
    const result = creditsFromDialog(parseDialog(fixture("credits-artist-only.html")));
    expect(result.credits).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

describe("roleKey and languages", () => {
  it("drops gender markers, accents and parentheses so one table entry covers every spelling", () => {
    for (const raw of ["Komponist*in", "Komponist:in", "Komponist/-in", "Komponist(in)", "Komponist_in", "KOMPONIST"]) {
      expect(roleKey(raw), raw).toBe("komponist");
    }
    expect(roleKey("Compositeur / Compositrice")).toBe("compositeur / compositrice");
    expect(roleKey("Réalisateur")).toBe("realisateur");
    expect(roleKey("Bass (Vocal)")).toBe("bass (vocal)");
    expect(roleKey("Mixing/Engineer")).toBe("mixing/engineer");
  });

  it("falls back to the English table for any language, and to nothing for an unknown word", () => {
    expect(spotifyRole("Composer", "xx")).toBe("Songwriter");
    expect(spotifyRole("Composer", "de-AT")).toBe("Songwriter");
  });

  it("knows English and any language that has a table", () => {
    expect(hasRoleTable("en-GB")).toBe(true);
    expect(hasRoleTable("de-AT")).toBe(true);
    expect(hasRoleTable("xx")).toBe(false);
  });

  it("says nothing for English and names the language otherwise", () => {
    expect(languageNote("en")).toBe("");
    expect(languageNote("")).toBe("");
    expect(languageNote("de-DE")).toContain("German");
    expect(languageNote("xx")).toContain("no role words");
  });
});

describe("role words in each language Spotify was read in", () => {
  const languages = Object.keys(OBSERVED);

  it("covers the thirteen languages asked for besides English", () => {
    expect(languages.sort()).toEqual(["de", "es", "fr", "it", "ja", "ko", "nl", "pl", "pt", "ru", "sv", "tr"]);
    expect(Object.keys(ROLE_TABLES).sort()).toEqual(languages);
  });

  it.each(Object.entries(OBSERVED))("%s: every observed word maps to what its English word maps to", (language, pairs) => {
    for (const [local, english] of pairs) {
      expect(spotifyRole(local, language), `${language}: ${local} (${english})`).toBe(spotifyRole(english));
    }
  });

  it.each(Object.entries(OBSERVED))("%s: gender and accent variants of an observed word give the same role", (language, pairs) => {
    for (const [local] of pairs) {
      const role = spotifyRole(local, language);
      expect(spotifyRole(local.toUpperCase(), language), local).toBe(role);
      expect(spotifyRole(` ${local}: `, language), local).toBe(role);
    }
  });

  it("only maps to role names Genius lists, in every table", () => {
    const genius = new Set(Object.values(roleMap()));
    for (const table of Object.values(ROLE_TABLES)) for (const role of Object.values(table)) expect(genius.has(role), role).toBe(true);
  });

  it("keeps every table key in the normalised form it is looked up by", () => {
    for (const [language, table] of Object.entries(ROLE_TABLES)) {
      for (const key of Object.keys(table)) expect(roleKey(key), `${language}: ${key}`).toBe(key);
    }
  });

  it("does not take a word from another language's table", () => {
    expect(spotifyRole("Komponist", "de")).toBe("Songwriter");
    expect(spotifyRole("Komponist", "fr")).toBeNull();
    expect(spotifyRole("Komponist", "en")).toBeNull();
  });

  it("reads French inclusive spelling with a middle dot, and keeps it in one role", () => {
    expect(splitRoles("Ingénieur·e • Chant")).toEqual(["Ingénieur·e", "Chant"]);
    expect(spotifyRole("Ingénieur·e", "fr")).toBe("Engineer");
  });

  it("keeps Japanese and Korean letters whole (no accent stripping of their combining marks)", () => {
    expect(roleKey("ミキシングエンジニア")).toBe("ミキシングエンジニア");
    expect(spotifyRole("ミキシングエンジニア", "ja")).toBe("Mixing Engineer");
    expect(spotifyRole("믹싱 엔지니어", "ko")).toBe("Mixing Engineer");
  });

  it("names the language for a read in a language with a table, and for one without", () => {
    expect(languageNote("de")).toMatch(/German and not in English.*only some role words/);
    expect(languageNote("ar")).toMatch(/Arabic.*no role words/);
  });
});

describe("pageLanguage", () => {
  it("is English for an English page with the English heading, or with no dialog read", () => {
    expect(pageLanguage("en", "Credits")).toBe("en");
    expect(pageLanguage("en-US", " Credits ")).toBe("en");
    expect(pageLanguage("en", "")).toBe("en");
    expect(pageLanguage("", "")).toBe("en");
  });

  it("is the page's own language when it is not English, whatever the heading", () => {
    expect(pageLanguage("de", "Songinfos")).toBe("de");
    expect(pageLanguage("pl-PL", "Autorzy treści")).toBe("pl");
    expect(pageLanguage("ja", "楽曲クレジット")).toBe("ja");
  });

  it("does not take an English page with another heading as English", () => {
    expect(pageLanguage("en", "Songinfos")).toBe("und");
    expect(languageNote("und")).toMatch(/did not show this page in English as asked/);
  });
});
