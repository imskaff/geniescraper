// Reads the song rows of Apple Music's search page: title, artists and the song's link (an album address with `?i=`,
// whose album name the matcher checks for editions such as "Live"). Used only as the last resort for a Genius song
// that iTunes's search API did not find; whether any row is the wanted song is decided by core/searchMatch.ts.
// The page lists its first rows twice (once as "Top Results"), so a link is kept once.
import type { SearchRow } from "../shared/messages";
import { waitFor } from "./wait";

const HOST = "https://music.apple.com";
const MAX_QUERY = 200;

/** The address of Apple Music's US search page for a query; only a title and artist ever go into it. */
export function appleSearchUrl(query: string): string {
  const text = query.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
  return `${HOST}/us/search?term=${encodeURIComponent(text)}`;
}

/** Whether `url` is a search page address built by `appleSearchUrl`; anything else is refused before it is read. */
export function isAppleSearchUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const { origin, pathname, searchParams, hash } = new URL(url);
  return (
    origin === HOST &&
    pathname === "/us/search" &&
    searchParams.has("term") &&
    [...searchParams].length === 1 &&
    hash === ""
  );
}

const norm = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

/** A song link: an album page address with the song picked ("?i=<track id>"), on Apple Music only. */
const SONG_LINK = /^https:\/\/music\.apple\.com\/[a-z]{2}\/album\/[^/?#]+\/\d+\?i=\d+$/;

/** The song rows the page shows now. A row with no song link or no title is skipped. */
export function searchRows(doc: Document): SearchRow[] {
  const rows: SearchRow[] = [];
  const seen = new Set<string>();
  for (const cell of doc.querySelectorAll("[data-testid='track-lockup-title']")) {
    const link = cell.querySelector("a[href]");
    const href = link?.getAttribute("href") ?? "";
    const title = norm(link?.textContent);
    if (!title || !SONG_LINK.test(href) || seen.has(href)) continue;
    seen.add(href);
    // The artists sit in the same list as the title, in a sibling item.
    const artists = [...(cell.parentElement?.querySelectorAll("a[href*='/artist/']") ?? [])]
      .map((a) => norm(a.textContent))
      .filter(Boolean);
    rows.push({ title, artists: [...new Set(artists)], album: "", href });
  }
  return rows;
}

/**
 * Wait for the rows (a search with no result shows an empty page, so the wait is bounded and an empty list is an
 * honest "nothing"), give the list a moment to fill, and read it.
 */
export async function readSearch(doc: Document, waitMs: number, pollMs: number): Promise<SearchRow[]> {
  const first = await waitFor(doc, () => searchRows(doc).length > 0 || null, waitMs, pollMs);
  if (!first) return [];
  await new Promise<void>((resolve) => setTimeout(resolve, 400));
  return searchRows(doc);
}
