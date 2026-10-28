// The in-page flow, ported from scraper.apple_music: wait for the page and read it. It takes a Document and a
// Timing so tests drive it on saved pages with tiny waits; the content script runs it with REAL_TIMING.
//
// Credits are read from the track's own song page, not through the album's MORE then View Credits menu.
// View Credits only navigates to that song page, and the menu cannot be opened in a hidden tab (measured on
// real Chromium: the album hydrates but the hover-armed menu never opens), while a song page renders its
// credit cards at once, hidden or not.
import type { AlbumInfo, PageScrape } from "../shared/messages";
import { CARD_NAME_SELECTOR, parseCreditsDocument } from "./credits";
import { AppleError, NOT_FOUND_MESSAGE, TIMEOUT_MESSAGE } from "./errors";
import {
  NOT_FOUND_SELECTOR,
  READY_SELECTOR,
  isNotFound,
  readCopyright,
  readCoverUrl,
  readTitleArtist,
  readTrackCount,
  readTrackTitle,
  readTrackTitles,
  readTrackUrls,
} from "./page";
import { sleep, waitFor } from "./wait";

export interface Timing {
  /** Longest wait for the tracklist or song header (or the not-found view) to render. */
  readyMs: number;
  /** Longest wait for the credit cards of a song page. */
  creditsMs: number;
  /** Pause between card-count checks while the cards finish rendering. */
  settleMs: number;
  /** Poll interval backing the mutation observer; hidden tabs throttle timers, so the observer leads. */
  pollMs: number;
}

export const REAL_TIMING: Timing = { readyMs: 15_000, creditsMs: 10_000, settleMs: 150, pollMs: 100 };

const SETTLE_CHECKS = 10;

/**
 * Wait for the hydrated page. Throws "not-found" as soon as Apple renders its error view, and "timeout" when
 * neither the page nor the error view appeared: a page that never rendered has nothing to read, and reading it
 * anyway would report an empty album as if it were the answer.
 */
export async function waitForPage(doc: Document, timing: Timing): Promise<void> {
  const marker = () => doc.querySelector(READY_SELECTOR) ?? doc.querySelector(NOT_FOUND_SELECTOR);
  const found = await waitFor(doc, marker, timing.readyMs, timing.pollMs);
  if (isNotFound(doc)) throw new AppleError("not-found", NOT_FOUND_MESSAGE);
  if (!found) throw new AppleError("timeout", TIMEOUT_MESSAGE);
}

/**
 * Album or song summary for the track picker, including each track's song page and the album's ℗ and ©
 * lines (song pages carry no footer, so the copyright has to be read here).
 */
export async function detectAlbum(doc: Document, url: string, timing: Timing): Promise<AlbumInfo> {
  await waitForPage(doc, timing);
  const [albumTitle, artist] = readTitleArtist(doc);
  const trackCount = readTrackCount(doc);
  const [phonographicCopyright, copyrightNotice] = readCopyright(doc);
  const isSongPage = url.includes("/song/");
  return {
    url,
    albumTitle,
    artist,
    trackCount,
    // Python leaves a single's titles empty and lets the UI fall back to the album title; here every
    // track is listed, so the picker and the scrape request treat singles, songs and albums alike.
    trackTitles: trackCount > 1 ? readTrackTitles(doc, trackCount) : [readTrackTitle(doc, 1) || albumTitle],
    // A song URL is its own only track page.
    trackUrls: isSongPage ? [url] : readTrackUrls(doc, trackCount),
    phonographicCopyright,
    copyrightNotice,
    coverArtUrl: readCoverUrl(doc),
  };
}

/** Wait for the credit cards, then for their count to stop changing (all cards render in one batch). */
export async function waitForCredits(doc: Document, timing: Timing): Promise<void> {
  const first = await waitFor(doc, () => doc.querySelector(CARD_NAME_SELECTOR), timing.creditsMs, timing.pollMs);
  if (!first) return;
  let count = doc.querySelectorAll(CARD_NAME_SELECTOR).length;
  for (let i = 0; i < SETTLE_CHECKS; i++) {
    await sleep(timing.settleMs);
    const next = doc.querySelectorAll(CARD_NAME_SELECTOR).length;
    if (next === count) return;
    count = next;
  }
}

export interface ScrapeRequest {
  /** The track's song page. */
  url: string;
  /** Title already known from the album's track list; "" to read it from the page. */
  trackTitle: string;
}

/** Title, artist, credits and header cover of one song page. */
export async function scrapeTrack(doc: Document, request: ScrapeRequest, timing: Timing): Promise<PageScrape> {
  await waitForPage(doc, timing);
  const [pageTitle, artist] = readTitleArtist(doc);
  const coverArtUrl = readCoverUrl(doc);
  await waitForCredits(doc, timing);
  // The text walk would misparse the lyrics and navigation that fill a song page, so cards only.
  const credits = parseCreditsDocument(doc, { cardsOnly: true });
  const warnings = credits.length === 0 ? ["No credits were found on this track's page."] : [];
  return { title: request.trackTitle || pageTitle, artist, credits, coverArtUrl, warnings };
}
