// Reads the rows of Spotify's search page (songs only): title, every artist, album and the track's link. The search
// page always fills its list, even for an invented title, so an empty list means the page did not load; whether any
// row is the wanted song is decided by core/searchMatch.ts, never here.
import type { SearchRow } from "../shared/messages";
import { BLOCKED_MESSAGE, SpotifyError } from "./driver";
import { until, type Timing } from "./page";

/** The page's words as a visitor sees them: scripts, styles and templates (a signed-in page ships a lot of config text) are not words. */
function visibleText(doc: Document): string {
  const body = doc.body.cloneNode(true) as HTMLElement;
  for (const node of body.querySelectorAll("script, style, noscript, template")) node.remove();
  return body.textContent;
}

/** A bot wall, judged on what the visitor sees and only once no list has appeared. */
const isWall = (doc: Document): boolean =>
  /captcha|unusual traffic|access denied|too many requests/i.test(visibleText(doc).slice(0, 2000));

const norm = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

const TRACK_ID = /\/track\/([A-Za-z0-9]{22})(?:[/?#]|$)/;

/** The rows the page shows now. A row with no track link or no title is not a song row and is skipped. */
export function searchRows(doc: Document): SearchRow[] {
  const rows: SearchRow[] = [];
  for (const row of doc.querySelectorAll("[data-testid='tracklist-row']")) {
    const link = row.querySelector("a[href*='/track/']");
    const id = TRACK_ID.exec(link?.getAttribute("href") ?? "")?.[1];
    const title = norm(link?.textContent);
    if (!id || !title) continue;
    const artists = [
      ...new Set([...row.querySelectorAll("a[href*='/artist/']")].map((a) => norm(a.textContent))),
    ].filter(Boolean);
    rows.push({
      title,
      artists,
      album: norm(row.querySelector("a[href*='/album/']")?.textContent),
      href: `https://open.spotify.com/track/${id}`,
    });
  }
  return rows;
}

const ALBUM_ID = /\/album\/([A-Za-z0-9]{22})(?:[/?#]|$)/;

/** The album cards of the albums tab: title, album artists, release year and the album's link. A card without a link or title is skipped. */
export function albumRows(doc: Document): SearchRow[] {
  const rows: SearchRow[] = [];
  for (const card of doc.querySelectorAll("[data-testid^='search-category-card-']")) {
    const link = card.querySelector("a[href*='/album/']");
    const id = ALBUM_ID.exec(link?.getAttribute("href") ?? "")?.[1];
    const title = norm(link?.textContent);
    if (!id || !title) continue;
    const artists = [
      ...new Set([...card.querySelectorAll("a[href*='/artist/']")].map((a) => norm(a.textContent))),
    ].filter(Boolean);
    rows.push({
      title,
      artists,
      album: "",
      year: /^\d{4}/.exec(card.querySelector("time")?.getAttribute("datetime") ?? "")?.[0] ?? "",
      href: `https://open.spotify.com/album/${id}`,
    });
  }
  return rows;
}

/**
 * Wait for the list, give it a moment to fill, and read it. Throws when the page is blocked or shows no list.
 * `read` picks what is read: the song rows (the default) or the album cards.
 */
export async function readSearch(
  doc: Document,
  timing: Timing,
  read: (doc: Document) => SearchRow[] = searchRows,
): Promise<SearchRow[]> {
  const first = await until(doc, () => (read(doc).length > 0 ? true : null), timing.rowsMs, timing.stepMs);
  if (!first && isWall(doc)) throw new SpotifyError("blocked", BLOCKED_MESSAGE);
  if (!first) {
    throw new SpotifyError(
      "tab-failed",
      `Spotify's search results did not load (the page said: "${visibleText(doc).replace(/\s+/g, " ").trim().slice(0, 80)}").`,
    );
  }
  // The rows come in together; a short pause lets a list that is still being drawn finish.
  await new Promise<void>((resolve) => setTimeout(resolve, Math.min(400, timing.settleMs)));
  return read(doc);
}
