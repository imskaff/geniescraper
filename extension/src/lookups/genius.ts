// Genius's own song search, the one the genius.com web app uses: no token and no sign-in. It is asked only when the
// user presses "Open on Genius" (or has it switched on for pasting), with the track's title and artist as the query.
// Best-effort like every lookup: any failure is null, so the caller can tell "Genius could not be asked" from "no match".
import { parseHits, searchQuery, type GeniusHit } from "../core/geniusMatch";
import type { GetJson } from "./itunes";

const SEARCH_URL = "https://genius.com/api/search/song";

/** The songs Genius finds for a track (first page only), or null when it could not be asked or answered oddly. */
export async function searchGenius(getJson: GetJson, title: string, artist: string): Promise<GeniusHit[] | null> {
  const query = searchQuery(title, artist);
  if (query === "") return null;
  const data = await getJson(`${SEARCH_URL}?${new URLSearchParams({ q: query }).toString()}`);
  if (data === null || data === undefined) return null;
  const response = typeof data === "object" ? (data as Record<string, unknown>)["response"] : undefined;
  // A page that is not a search answer (a challenge page, an error) must not read as "no song on Genius".
  if (typeof response !== "object" || response === null || !("sections" in response)) return null;
  return parseHits(data);
}
