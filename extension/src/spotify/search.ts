// Reads the rows of Spotify's search page (songs only): title, every artist, album and the track's link. The search
// page always fills its list, even for an invented title, so an empty list means the page did not load; whether any
// row is the wanted song is decided by core/searchMatch.ts, never here.
import type { SearchRow } from "../shared/messages";
import { BLOCKED_MESSAGE, SpotifyError } from "./driver";
import { isBlocked, until, type Timing } from "./page";

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

/** Wait for the list, give it a moment to fill, and read it. Throws when the page is blocked or shows no list. */
export async function readSearch(doc: Document, timing: Timing): Promise<SearchRow[]> {
  const first = await until(
    doc,
    () => (searchRows(doc).length > 0 || isBlocked(doc) ? true : null),
    timing.rowsMs,
    timing.stepMs,
  );
  if (isBlocked(doc)) throw new SpotifyError("blocked", BLOCKED_MESSAGE);
  if (!first) throw new SpotifyError("tab-failed", "Spotify's search results did not load.");
  // The rows come in together; a short pause lets a list that is still being drawn finish.
  await new Promise<void>((resolve) => setTimeout(resolve, Math.min(400, timing.settleMs)));
  return searchRows(doc);
}
