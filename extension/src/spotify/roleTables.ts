// Role words of Spotify's credits dialog in each language it can show, to the Genius role names the English table in
// roles.ts produces. Data only. Every entry must come from a real read of that language (the English word paired by
// position with the localised one on the same track), never from a guess; a word that was not seen stays out, and an
// uncertain one carries a comment. Keys are in the normalised form `roleKey` makes (lowercase, no accents, no gender
// markers). The language is the base of the page's `<html lang>`.
export const ROLE_TABLES: Readonly<Record<string, Readonly<Record<string, string>>>> = {};
