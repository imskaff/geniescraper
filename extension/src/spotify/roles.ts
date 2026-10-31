// Spotify's role names as the credits dialog shows them in English, to the Genius role that means the same.
// This table belongs to Spotify alone: Apple's (data/roles.json) is generated from the desktop app and is not touched.
// Targets are the names Genius lists (the ones Apple's table produces too), so the queue and the role picker treat
// both sources alike; a test pins that every target is one of them.
import { roleMap } from "../core/roles";

const ALIASES: Readonly<Record<string, string>> = {
  // Composition & Lyrics: Genius has one field for all of them ("Writer").
  composer: "Songwriter",
  lyricist: "Songwriter",
  songwriter: "Songwriter",
  author: "Songwriter",
  writer: "Songwriter",
  "co-writer": "Songwriter",
  arranger: "Arranger",
  "recording arranger": "Arranger",
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
  "studio personnel": "Studio Personnel",
  // Performers
  vocalist: "Vocals",
  vocals: "Vocals",
  "lead vocals": "Lead Vocals",
  "background vocalist": "Background Vocals",
  "background vocals": "Background Vocals",
  "backing vocals": "Background Vocals",
  "bass vocalist": "Bass (Vocal)",
  "drum kit": "Drums",
  drums: "Drums",
  keyboard: "Keyboards",
  keyboards: "Keyboards",
};

/** Names Genius lists, lowercase to their spelling: a label that already is one is kept as is. */
const GENIUS_NAMES: ReadonlyMap<string, string> = new Map(
  Object.values(roleMap()).map((name) => [name.toLowerCase(), name]),
);

/** The key a label is looked up by: lowercase, no trailing colon, single spaces. */
function keyOf(raw: string): string {
  return raw.trim().replace(/:+$/, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Every Genius role the table can produce; the test that pins them to Genius's list reads this. */
export function spotifyRoleTargets(): string[] {
  return [...new Set(Object.values(ALIASES))];
}

/** Genius role for a Spotify role label, or null when the label is not one the table knows (kept out, not guessed). */
export function spotifyRole(raw: string): string | null {
  const key = keyOf(raw);
  return ALIASES[key] ?? GENIUS_NAMES.get(key) ?? null;
}

/** Interface form: an unknown label comes back as written, like Apple's. The credits mapping uses `spotifyRole`. */
export function normaliseSpotifyRole(raw: string): string {
  return spotifyRole(raw) ?? raw.trim().replace(/:+$/, "").trim();
}
