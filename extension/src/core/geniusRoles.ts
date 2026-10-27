// Apple Music and Genius do not always name a role the same way. Genius only accepts a role from its own list,
// and the paste step needs an exact match, so a role Apple spells differently would always be left for the user.
//
// Measured on the live Genius form (the roles the golden credits use): Genius has "Programmer",
// "Drum Programmer", "Additional Production" and "Vocal Engineer", and no "Programming", "Drum Programming",
// "Additional Producer" or "Vocal Recording Engineer". It has nothing close to "Editing Engineer", so that role is
// left as it is and the user decides.
//
// This is a mapping of the extension's paste queue only. scraper/roles.py is the Apple-side vocabulary shared with
// the desktop app and its golden files, so it is not changed here.

/** Apple role (lowercase) to the Genius role that means the same thing. */
const EXPLICIT: Readonly<Record<string, string>> = {
  "additional producer": "Additional Production",
  "vocal recording engineer": "Vocal Engineer",
};

/** "Programming" and "<Instrument> Programming" are "Programmer" and "<Instrument> Programmer" on Genius. */
const PROGRAMMING = /^(?:(.*\S)\s+)?programming$/i;

/** The role as Genius names it, or the role unchanged when Genius uses Apple's name (or has no equivalent). */
export function geniusRole(appleRole: string): string {
  const explicit = EXPLICIT[appleRole.trim().toLowerCase()];
  if (explicit) return explicit;
  const match = PROGRAMMING.exec(appleRole.trim());
  if (match) return match[1] ? `${match[1]} Programmer` : "Programmer";
  return appleRole;
}
