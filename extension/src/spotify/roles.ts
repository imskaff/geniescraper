// Spotify's role names as the credits dialog shows them in English, to the Genius role that means the same.
// This table belongs to Spotify alone: Apple's (data/roles.json) is generated from the desktop app and is not touched.
// Targets are the names Genius lists (the ones Apple's table produces too), so the queue and the role picker treat
// both sources alike; a test pins that every target is one of them.
import { roleMap } from "../core/roles";
import { ROLE_TABLES } from "./roleTables";

/**
 * Roles Genius lists under "Major Roles Removed". A label that spells one, or that any table would map to one (Apple's
 * names include "Performer" and "Studio Personnel"), is left out and listed under "About this read", never typed.
 */
const REMOVED_GENIUS_ROLES: ReadonlySet<string> = new Set(
  [
    "Studio Personnel",
    "Performer",
    "Associate Performer",
    "Manager",
    "Management",
    "Manager/Management",
    "Booking",
    "Licensing",
    "Performance Rights",
  ].map((name) => roleKey(name)),
);

const ALIASES: Readonly<Record<string, string>> = {
  // Composition & Lyrics: Genius has one field for all of them ("Writer").
  composer: "Songwriter",
  lyricist: "Songwriter",
  songwriter: "Songwriter",
  author: "Songwriter",
  writer: "Songwriter",
  "co-writer": "Songwriter",
  arranger: "Arranger",
  // Genius lists Recording Arranger as a role of its own next to Arranger.
  "recording arranger": "Recording Arranger",
  // Production & Engineering
  producer: "Producer",
  "co-producer": "Co-Producer",
  "executive producer": "Executive Producer",
  engineer: "Engineer",
  "recording engineer": "Recording Engineer",
  "mixing engineer": "Mixing Engineer",
  mixer: "Mixing Engineer",
  "mastering engineer": "Mastering Engineer",
  masterer: "Mastering Engineer",
  programmer: "Programmer",
  // Genius lists Recording Second Engineer nowhere. Its list names a bare "Second Engineer" Assistant Engineer, but Spotify
  // names the stage ("Recording"), exactly as in "Recording Engineer", so the stage-named Assistant Recording Engineer fits.
  "recording second engineer": "Assistant Recording Engineer",
  // Performers
  vocalist: "Vocals",
  vocals: "Vocals",
  "lead vocals": "Lead Vocals",
  "background vocalist": "Background Vocals",
  "background vocals": "Background Vocals",
  "backing vocals": "Background Vocals",
  "bass vocalist": "Bass Vocals",
  "drum kit": "Drums",
  drums: "Drums",
  keyboard: "Keyboards",
  keyboards: "Keyboards",
};

/** Names Genius lists, lowercase to their spelling: a label that already is one is kept as is. */
const GENIUS_NAMES: ReadonlyMap<string, string> = new Map(
  Object.values(roleMap()).map((name) => [roleKey(name), name]),
);

/**
 * The key a label is looked up by: no gender markers ("Komponist*in", "Produzent/-in", "Produzent(in)"), no accents,
 * lowercase, no trailing colon, single spaces. The language tables are written in this same form.
 */
export function roleKey(raw: string): string {
  return (
    raw
      .trim()
      // Only Latin-style accents go: a combining mark in Japanese or Korean is part of the letter.
      .normalize("NFD")
      .replace(/[̀-ͯ]+/g, "")
      .normalize("NFC")
      .replace(/\s*[*:_/·]-?\s*(?:in(?:nen)?|e)(?![\p{L}\p{M}])/giu, "")
      .replace(/\(\s*(?:in|innen|a|e)\s*\)/giu, "")
      .replace(/:+$/, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      // Turkish dotless i, so "YAZARI" and "yazarı" are one word.
      .replace(/ı/g, "i")
  );
}

/** Every Genius role the table can produce; the test that pins them to Genius's list reads this. */
export function spotifyRoleTargets(): string[] {
  return [...new Set(Object.values(ALIASES))];
}

/** Genius role for a Spotify role label, or null when the label is not one the table knows (kept out, not guessed). */
export function spotifyRole(raw: string, language = "en"): string | null {
  const key = roleKey(raw);
  if (REMOVED_GENIUS_ROLES.has(key)) return null;
  const role = ALIASES[key] ?? ROLE_TABLES[baseLanguage(language)]?.[key] ?? GENIUS_NAMES.get(key) ?? null;
  return role !== null && REMOVED_GENIUS_ROLES.has(roleKey(role)) ? null : role;
}

/** Interface form: an unknown label comes back as written, like Apple's. The credits mapping uses `spotifyRole`. */
export function normaliseSpotifyRole(raw: string): string {
  return spotifyRole(raw) ?? raw.trim().replace(/:+$/, "").trim();
}

/** "de-AT" is "de". */
export function baseLanguage(tag: string): string {
  return tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

/** Whether a language has a role table of its own (English is the built-in one). */
export function hasRoleTable(language: string): boolean {
  const base = baseLanguage(language);
  return base === "en" || base in ROLE_TABLES;
}
