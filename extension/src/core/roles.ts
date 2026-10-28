import roleData from "../../data/roles.json";

// Generated from scraper/roles.py by tools/export_roles.py; never edit the JSON by hand.
const ROLE_MAP: Readonly<Record<string, string>> = roleData;

/**
 * Canonical Genius role name for a raw Apple Music role label.
 * Unknown roles are kept as written, minus the colon and surrounding spaces.
 * Mirrors scraper.apple_music._normalise_role.
 */
export function normaliseRole(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/:+$/, "").trim();
  return ROLE_MAP[key] ?? raw.trim().replace(/:+$/, "").trim();
}

export function roleMap(): Readonly<Record<string, string>> {
  return ROLE_MAP;
}

export function roleKeys(): string[] {
  return Object.keys(ROLE_MAP);
}
