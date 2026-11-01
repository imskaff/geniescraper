// The Spotify credits dialog as the in-page reader parses it, and the rules that turn it into shared credits.
// Pure data in, pure data out: the reader (page.ts) and the tests both feed it.
import type { Credit } from "../core/models";
import { baseLanguage, hasRoleTable, spotifyRole } from "./roles";

export interface DialogRow {
  /** Heading of the section the row sits in (localised). */
  section: string;
  sectionIndex: number;
  name: string;
  roles: string[];
  /** Set on the rows of the Artist section only, which is how that section is told apart in any language. */
  artistId: string | null;
}

export interface ParsedDialog {
  heading: string;
  title: string;
  rows: DialogRow[];
  /** The "Sources" value: a label or the ℗ owner. Never a distributor. */
  source: string;
}

export interface SpotifyCredits {
  /** The track's artists, from the Artist section. */
  artists: string[];
  credits: Credit[];
  /** Roles the table does not know, with who holds them, so the user can see what was left out. */
  skipped: { role: string; names: string[] }[];
}

/** Split "Composer • Lyricist" (the dialog joins one person's roles with a bullet; a middle dot inside a word, as in French "ingénieur·e", is not a separator) into its roles. */
export function splitRoles(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/\s*•\s*|\s+·\s+/)
    .map((role) => role.trim())
    .filter(Boolean);
}

/** Rows of the Artist section are not credits: they name the track's artists ("Main Artist", "Featured Artist"). */
const isArtistRow = (row: DialogRow): boolean => row.artistId !== null && row.sectionIndex === 0;

export function creditsFromDialog(dialog: Pick<ParsedDialog, "rows">, language = "en"): SpotifyCredits {
  const artists: string[] = [];
  const byRole = new Map<string, Credit>();
  const skipped = new Map<string, string[]>();
  for (const row of dialog.rows) {
    if (isArtistRow(row)) {
      if (row.name && !artists.includes(row.name)) artists.push(row.name);
      continue;
    }
    if (!row.name) continue;
    for (const raw of row.roles) {
      const role = spotifyRole(raw, language);
      if (role === null) {
        const names = skipped.get(raw) ?? [];
        if (!names.includes(row.name)) names.push(row.name);
        skipped.set(raw, names);
        continue;
      }
      const credit = byRole.get(role) ?? { role, artists: [] };
      if (!credit.artists.includes(row.name)) credit.artists.push(row.name);
      byRole.set(role, credit);
    }
  }
  return {
    artists,
    credits: [...byRole.values()],
    skipped: [...skipped].map(([role, names]) => ({ role, names })),
  };
}

/** One sentence naming the roles that were left out, or "" when nothing was. */
export function skippedNote(skipped: SpotifyCredits["skipped"]): string {
  if (skipped.length === 0) return "";
  const list = skipped.map(({ role, names }) => `${role} (${names.join(", ")})`).join("; ");
  return `Left out because Genius has no matching role: ${list}.`;
}

/** The language's English name ("German"), or the tag itself when the runtime does not know it. */
function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** The dialog heading in English; Spotify's other languages write it differently ("Songinfos", "Autorzy treści"). */
const ENGLISH_HEADING = "Credits";

/** Marks a page that says it is English but whose dialog is not (see `pageLanguage`). */
export const UNKNOWN_LANGUAGE = "und";

/**
 * The language to read role words in. The worker asks Spotify for English (`?locale=en`), which is an undocumented
 * parameter, so what came back is checked rather than trusted: the page declares its language, and an English page
 * must also show the English dialog heading. A page in another language, or one that claims English but shows a
 * different heading, is a fallback to the role tables ("und" has none: only English words are mapped then).
 * `heading` is empty when no dialog was read; the declared language decides alone then.
 */
export function pageLanguage(htmlLang: string, heading: string): string {
  const base = baseLanguage(htmlLang) || "en";
  if (base === "en" && heading.trim() !== "" && heading.trim() !== ENGLISH_HEADING) return UNKNOWN_LANGUAGE;
  return base;
}

/**
 * What to tell the user about the language Spotify showed the page in: nothing for English, which is what the worker
 * asks for. Only when the fallback was used the language is named, and the user is told that roles may be missing,
 * because the role words come from a list that is limited to what was seen in real reads.
 */
export function languageNote(language: string): string {
  const base = baseLanguage(language);
  if (base === "" || base === "en") return "";
  if (base === UNKNOWN_LANGUAGE) {
    return "Spotify did not show this page in English as asked, and the extension could not tell which language it used, so roles are left out unless Spotify wrote them in English.";
  }
  const name = languageName(base);
  return hasRoleTable(base)
    ? `Spotify showed this page in ${name} and not in English. The extension knows only some role words in ${name}, so a role it does not know is left out and listed above.`
    : `Spotify showed this page in ${name} and not in English, and the extension has no role words for ${name}, so roles are left out unless Spotify wrote them in English.`;
}
