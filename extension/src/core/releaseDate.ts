// Port of scraper.release_date: release dates as read from Apple Music pages, ISO 'YYYY-MM-DD' or "" when unknown.
// Sources, best first: the music:release_date meta tag (the song's own date), the song page's visible date line, the
// album footer (the album's date, which a track may not share). Visible text is English; text in another language or
// a date that is not on the calendar gives "" instead of a guess.

export const MONTHS: readonly string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Lower-case names and the usual abbreviations, to the month number.
const MONTH_NUMBER = new Map<string, number>([["sept", 9]]);
MONTHS.forEach((name, index) => {
  MONTH_NUMBER.set(name.toLowerCase(), index + 1);
  MONTH_NUMBER.set(name.slice(0, 3).toLowerCase(), index + 1);
});

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?![0-9])/;
const MONTH_FIRST = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?![0-9])/g;
const DAY_FIRST = /(?<![0-9])(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})(?![0-9])/g;

/** "YYYY-MM-DD" for a real calendar date, else "". */
function iso(year: number, month: number, day: number): string {
  const probe = new Date(Date.UTC(2000, 0, 1));
  probe.setUTCFullYear(year, month - 1, day);
  const real = probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
  if (!real || month < 1 || day < 1 || year < 1) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The date of a music:release_date value such as "2024-05-17T00:00:00.000Z" ("" if it is not a real date). */
export function dateFromMeta(content: string): string {
  const m = ISO.exec(content.trim());
  return m ? iso(Number(m[1]), Number(m[2]), Number(m[3])) : "";
}

/** The first English date in a text, "May 17, 2024" or "17 May 2024" style ("" if none, or not a real date). */
export function dateFromText(text: string): string {
  for (const m of text.matchAll(MONTH_FIRST)) {
    const month = MONTH_NUMBER.get((m[1] ?? "").toLowerCase());
    if (month) return iso(Number(m[3]), month, Number(m[2]));
  }
  for (const m of text.matchAll(DAY_FIRST)) {
    const month = MONTH_NUMBER.get((m[2] ?? "").toLowerCase());
    if (month) return iso(Number(m[3]), month, Number(m[1]));
  }
  return "";
}

/** The best date among the meta tag, the song page's release-date line and the album footer text. */
export function pickReleaseDate(meta: string, subtitle: string, footer: string): string {
  return dateFromMeta(meta) || dateFromText(subtitle) || dateFromText(footer);
}

/** [year, month, day] of a stored "YYYY-MM-DD", or null when it is empty or not a real date. */
export function splitReleaseDate(value: string): [year: number, month: number, day: number] | null {
  const m = ISO.exec(value);
  if (!m || value.length !== 10) return null;
  const parts: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return iso(...parts) ? parts : null;
}

/** "May 17, 2024" for a stored date; "" when there is none. */
export function formatReleaseDate(value: string): string {
  const parts = splitReleaseDate(value);
  if (!parts) return "";
  const [year, month, day] = parts;
  return `${MONTHS[month - 1] ?? ""} ${String(day)}, ${String(year)}`;
}
