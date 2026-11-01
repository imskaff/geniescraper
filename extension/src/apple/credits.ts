// Credits parsing, ported from scraper.apple_music. The pure functions take plain strings; the document
// reader below takes any Document, so it runs on the live page and on saved HTML alike.
import type { Credit } from "../core/models";
import { normaliseRole, roleKeys, roleMap } from "../core/roles";
import { codePointLength, splitLines, trimColon } from "../core/text";

// Roles that exist on Apple Music credits pages but are not accepted on Genius.
const SKIP_ROLES: ReadonlySet<string> = new Set(["Performer", "Mixed Artist", "Studio Personnel"]);

const NOISE_PREFIXES = ["more by", "© ", "℗ ", "all rights", "℗©", "apple music"];

const SECTION_HEADERS: ReadonlySet<string> = new Set([
  "composition, lyrics",
  "production, engineering",
  "performance",
  "audio",
  "arranging",
  "management",
  "visual",
  "liner notes",
  "additional credits",
  "credits",
  "performers",
  "personnel",
  "recording information",
]);

const MAX_ARTIST_NAME_LENGTH = 80;

/** Selectors of one credit card: the artist's name and the comma-separated roles they hold. */
export const CARD_NAME_SELECTOR = ".artist-name";
export const CARD_ROLES_SELECTOR = ".artist-roles";

function isNoise(line: string): boolean {
  const lower = line.toLowerCase();
  if (SECTION_HEADERS.has(lower)) return true;
  if (NOISE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  // Lines longer than 80 characters are almost certainly not an artist name.
  return codePointLength(line) > MAX_ARTIST_NAME_LENGTH;
}

function parseArtists(raw: string): string[] {
  return raw
    .split(/\s*[,&•]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Strategy 0: pair each artist name with its comma-separated roles. */
export function creditsFromCards(names: readonly string[], rolesTexts: readonly string[]): Credit[] {
  if (names.length === 0 || rolesTexts.length === 0 || names.length !== rolesTexts.length) return [];
  const roleArtists = new Map<string, string[]>();
  names.forEach((rawName, index) => {
    const artist = rawName.trim();
    if (!artist) return;
    for (const rawRole of (rolesTexts[index] ?? "").split(",")) {
      const role = normaliseRole(rawRole);
      if (!role) continue;
      const artists = roleArtists.get(role) ?? [];
      if (!artists.includes(artist)) artists.push(artist);
      roleArtists.set(role, artists);
    }
  });
  return [...roleArtists].filter(([role]) => !SKIP_ROLES.has(role)).map(([role, artists]) => ({ role, artists }));
}

/** Strategy 1: walk the page text line by line; a known role line starts a new credit. */
export function creditsFromText(bodyText: string): Credit[] {
  const knownRoles = new Set(roleKeys());
  const map = roleMap();
  const credits: Credit[] = [];
  let currentRole: string | null = null;
  let currentArtists: string[] = [];

  const flush = (): void => {
    if (currentRole && currentArtists.length > 0) credits.push({ role: currentRole, artists: currentArtists });
  };

  for (const rawLine of splitLines(bodyText)) {
    const line = rawLine.trim();
    if (!line) continue;
    const key = trimColon(line.toLowerCase());
    if (knownRoles.has(key)) {
      flush();
      currentRole = map[key] ?? trimColon(line);
      currentArtists = [];
    } else if (currentRole) {
      if (isNoise(line)) continue;
      currentArtists.push(...parseArtists(line));
    }
  }
  flush();
  return credits.filter((credit) => !SKIP_ROLES.has(credit.role));
}

export interface ParseOptions {
  /** Song pages hold lyrics and navigation that the text walk would misparse as credits. */
  cardsOnly?: boolean;
}

/** Credits of an Apple Music page: the credit cards, else (album pages only) the text walk. */
export function parseCreditsDocument(doc: Document, options: ParseOptions = {}): Credit[] {
  const names = [...doc.querySelectorAll(CARD_NAME_SELECTOR)].map((el) => el.textContent);
  const roles = [...doc.querySelectorAll(CARD_ROLES_SELECTOR)].map((el) => el.textContent);
  const credits = creditsFromCards(names, roles);
  if (credits.length > 0 || options.cardsOnly) return credits;
  return creditsFromText(doc.body.innerText);
}
