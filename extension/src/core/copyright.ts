// Ports of scraper.models._extract_labels and scraper.apple_music.split_copyright / track_count_from_footer.
import { splitLines } from "./text";

const COPYRIGHT_CONNECTORS = new RegExp(
  ",?\\s+(?:" +
    "under\\s+(?:exclusive\\s+)?licen[sc]e\\s+(?:to|from)" +
    "|a\\s+division\\s+of" +
    "|an?\\s+(?:imprint|label)\\s+of" +
    "|distributed\\s+by" +
    "|released\\s+by" +
    "|marketed\\s+by" +
    ")\\s+",
  "i",
);

function trimCommas(text: string): string {
  return text
    .trim()
    .replace(/^,+|,+$/g, "")
    .trim();
}

/** Individual label names of a ℗/© line, without the year and the connector words. */
export function extractLabels(text: string): string[] {
  const clean = text.replace(/^[℗©]\s*\d{4}\s*/, "").trim();
  if (!clean) return [];
  return clean.split(COPYRIGHT_CONNECTORS).map(trimCommas).filter(Boolean);
}

function firstLine(text: string): string {
  return (splitLines(text)[0] ?? "").trim();
}

/** First ℗ line and first © line of a tracklist footer description; "" when absent. */
export function splitCopyright(raw: string): [phonographic: string, copyright: string] {
  let phonographic = "";
  let copyright = "";
  // Split at every ℗/© boundary so both are found even when they share a line.
  for (const part of raw.split(/(?=℗|©)/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("℗") && !phonographic) {
      phonographic = firstLine(trimmed);
    } else if (trimmed.startsWith("©") && !copyright) {
      copyright = firstLine(trimmed);
    }
    if (phonographic && copyright) break;
  }
  return [phonographic, copyright];
}

/** Track count from a "12 songs, 45 minutes" footer; 1 when it says nothing. */
export function trackCountFromFooter(raw: string): number {
  const match = /(\d+)\s+songs?/.exec(raw);
  return match?.[1] ? Number.parseInt(match[1], 10) : 1;
}
