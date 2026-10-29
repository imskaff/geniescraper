// Album and song page readers, ported from scraper.apple_music. Everything takes a Document and only reads it.
import { trackCountFromFooter, splitCopyright } from "../core/copyright";
import { pickCoverUrl } from "../core/cover";
import { pickReleaseDate } from "../core/releaseDate";
import { extractTitleArtist } from "./title";
import { parseAppleMusicUrl } from "./url";

/** The page is usable once the hydrated tracklist (album) or the song header (song) is there. */
export const READY_SELECTOR = '[data-testid="track-list-item"], .song-header-page';
/** Apple Music has used both markers for its "Page Not Found" view. */
export const NOT_FOUND_SELECTOR = '[data-testid="not-found-heading"], [data-testid="page-error-title"]';

/** One row per track of an album tracklist. */
export const TRACK_ROW_SELECTOR = '[data-testid="track-list-item"]';

const RELEASE_META_SELECTOR = 'meta[property="music:release_date"]';
const RELEASE_LINE_SELECTOR = '[data-testid="song-subtitle-release-date"]';
const FOOTER_SELECTOR = '[data-testid="tracklist-footer-description"]';
const TRACK_TITLE_SELECTORS = [
  '[data-testid="track-list-item"] [data-testid="track-title"]',
  ".songs-list-row__song-name",
];
const TITLE_SELECTORS = ['[data-testid="album-title"]', '[data-testid="song-name-value"]', "h1"];
const ARTIST_SELECTORS = ['[data-testid="artist-name"]', ".product-creator a", ".song-name-row__artist-name"];

// Only the header is searched: shelves further down hold other albums and editorial banners.
const HEADER_SELECTORS = [
  '[data-testid="container-detail-header"]',
  ".song-header-page",
  '[data-testid="section-content"]',
];
const ARTWORK_SELECTOR = '[data-testid="artwork-component"] source, [data-testid="artwork-component"] img';
const META_IMAGE_SELECTORS = ['meta[property="og:image"]', 'meta[name="twitter:image"]'];

/** Rendered text of an element; innerText keeps line breaks between blocks, textContent covers engines without it. */
function visibleText(el: Element): string {
  return (el as HTMLElement).innerText || el.textContent;
}

function texts(doc: Document, selector: string): string[] {
  return [...doc.querySelectorAll(selector)].map((el) => el.textContent);
}

function firstText(doc: Document, selectors: readonly string[]): string {
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    const value = el ? visibleText(el).trim() : "";
    if (value) return value;
  }
  return "";
}

/** True when Apple Music rendered its "Page Not Found" view. */
export function isNotFound(doc: Document): boolean {
  return doc.querySelector(NOT_FOUND_SELECTOR) !== null;
}

/** Page title and artist: from the document title, else from the page content. */
export function readTitleArtist(doc: Document): [title: string, artist: string] {
  const [title, artist] = extractTitleArtist(doc.title);
  if (title && artist) return [title, artist];
  return [title || firstText(doc, TITLE_SELECTORS), artist || firstText(doc, ARTIST_SELECTORS)];
}

/**
 * The first ℗ and © lines of an album page footer ("", "" on song pages, which have no footer). The footer is a plain
 * paragraph, so its own text is read: a computed innerText can run its lines together in a DOM without layout.
 */
export function readCopyright(doc: Document): [phonographic: string, copyright: string] {
  const footer = doc.querySelector(FOOTER_SELECTOR);
  return splitCopyright(footer ? footer.textContent : "");
}

/**
 * The release date the page shows as "YYYY-MM-DD" ("" if it names none). A song page gives the song's own date (its
 * meta tag, else its visible date line); an album page gives only the album's, from the footer.
 */
export function readReleaseDate(doc: Document): string {
  const meta = doc.querySelector(RELEASE_META_SELECTOR)?.getAttribute("content") ?? "";
  const line = doc.querySelector(RELEASE_LINE_SELECTOR)?.textContent ?? "";
  const footer = doc.querySelector(FOOTER_SELECTOR)?.textContent ?? "";
  return pickReleaseDate(meta, line, footer);
}

/** Title of the 1-based `trackIndex` row of an album tracklist ("" when there is no such row). */
export function readTrackTitle(doc: Document, trackIndex: number): string {
  for (const selector of TRACK_TITLE_SELECTORS) {
    const titles = texts(doc, selector);
    if (titles.length >= trackIndex) return (titles[trackIndex - 1] ?? "").trim();
  }
  return "";
}

/**
 * Titles of every track of an album page, one per row so each stays level with its song link (readTrackUrls counts
 * rows too). A blank title is named by its position, and "Track N" also pads when Apple rendered fewer rows than songs.
 */
export function readTrackTitles(doc: Document, trackCount: number): string[] {
  if (trackCount <= 1) return [];
  let titles = texts(doc, ".songs-list-row__song-name");
  if (titles.length === 0) titles = texts(doc, '[data-testid="song-name-value"]');
  const named = titles.map((title, index) => title.trim() || `Track ${String(index + 1)}`);
  while (named.length < trackCount) named.push(`Track ${String(named.length + 1)}`);
  return named.slice(0, trackCount);
}

/**
 * Song page of each of the first `trackCount` tracks, aligned with the rows ("" for a row without a valid
 * song link: Apple renders unavailable tracks as plain rows, and those have no page to read credits from).
 */
export function readTrackUrls(doc: Document, trackCount: number): string[] {
  const rows = [...doc.querySelectorAll(TRACK_ROW_SELECTOR)];
  return Array.from({ length: trackCount }, (_, index) => {
    const href = rows[index]?.querySelector('a[href*="/song/"]')?.getAttribute("href") ?? "";
    // Only absolute Apple Music song links are kept: a link is data, never a place to send the worker blindly.
    return URL.canParse(href) && parseAppleMusicUrl(href)?.kind === "song" ? href : "";
  });
}

/** Number of songs in the album footer ("12 songs, 45 minutes"); 1 for songs and singles without one. */
export function readTrackCount(doc: Document): number {
  const footer = doc.querySelector(FOOTER_SELECTOR);
  return footer ? trackCountFromFooter(footer.textContent) : 1;
}

/** The header artwork URLs in DOM order, then the legacy meta image tags. */
function headerArtworkUrls(doc: Document): string[] {
  const urls: string[] = [];
  const header = HEADER_SELECTORS.map((selector) => doc.querySelector(selector)).find((el) => el !== null);
  for (const el of header?.querySelectorAll(ARTWORK_SELECTOR) ?? []) {
    const raw = el.getAttribute("srcset") || el.getAttribute("src") || "";
    const url = raw.trim().split(/\s+/)[0];
    if (url) urls.push(url);
  }
  for (const selector of META_IMAGE_SELECTORS) {
    const content = doc.querySelector(selector)?.getAttribute("content");
    if (content) urls.push(content);
  }
  return urls;
}

/** The album cover from the page header as a 1000x1000 PNG URL ("" when the header shows none). */
export function readCoverUrl(doc: Document): string {
  return pickCoverUrl(headerArtworkUrls(doc));
}
