// The worker's side of reading a music site: open a hidden tab on a validated URL, inject the provider's content
// script, ask it one question, and always close the tab again. Failures come back as data, never as exceptions.
import { recogniseUrl, unsupportedLinkMessage } from "../providers/registry";
import { SPOTIFY_PROVIDER } from "../providers/spotify";
import { spotifySearchUrl } from "../spotify/url";
import { appleSearchUrl } from "../apple/search";
import { APPLE_PROVIDER } from "../providers/apple";
import type { CreditsProvider } from "../providers/types";
import {
  isAlbumInfo,
  isPageScrape,
  isResult,
  isSearchRows,
  type AlbumInfo,
  type ContentRequest,
  type ErrorCode,
  type PageScrape,
  type Result,
  type SearchRow,
} from "../shared/messages";
import type { BrowserPorts } from "./ports";
import { sleep } from "../apple/wait";

export interface ClientTiming {
  /** Longest wait for a tab to finish loading. */
  tabLoadMs: number;
  /** Longest wait for the content script's answer; above its own waits (15 s ready + 10 s credits). */
  requestMs: number;
  pollMs: number;
}

export const REAL_CLIENT_TIMING: ClientTiming = { tabLoadMs: 20_000, requestMs: 40_000, pollMs: 100 };

function withOverrides(timing: ClientTiming, provider: CreditsProvider): ClientTiming {
  return provider.timing ? { ...timing, ...provider.timing } : timing;
}

function fail(code: ErrorCode, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

/** Resolves with the promise's value, or with `"timeout"` once `ms` have passed; the loser is ignored. */
async function within<T>(work: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      resolve("timeout");
    }, ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wait until the tab can take the content script: the page has committed (the tab shows an address on the site)
 * or finished loading. The reader waits for the page's content by itself, so there is no need to sit through
 * the rest of the load, which saves the time scripts, fonts and images take.
 */
async function waitForLoad(
  ports: BrowserPorts,
  tabId: number,
  url: string,
  timing: ClientTiming,
): Promise<"loaded" | "gone" | "timeout"> {
  const origin = new URL(url).origin;
  const deadline = Date.now() + timing.tabLoadMs;
  while (Date.now() < deadline) {
    const tab = await ports.getTab(tabId);
    if (!tab) return "gone";
    if (tab.status === "complete" || tab.url.startsWith(`${origin}/`)) return "loaded";
    await sleep(timing.pollMs);
  }
  return "timeout";
}

/** The content request for this provider; each provider's script answers only its own prefix. */
function request(
  provider: CreditsProvider,
  kind: "detect" | "scrape",
  url: string,
  trackTitle: string,
): ContentRequest {
  if (provider.id === "spotify") {
    return kind === "detect" ? { type: "spotify/detect", url } : { type: "spotify/scrape", url, trackTitle };
  }
  return kind === "detect" ? { type: "apple/detect", url } : { type: "apple/scrape", url, trackTitle };
}

/** Ask the content script of `tabId` one question and check the shape of the answer. */
async function ask<T>(
  ports: BrowserPorts,
  tabId: number,
  request: ContentRequest,
  timing: ClientTiming,
  provider: CreditsProvider,
  isData: (value: unknown) => value is T,
): Promise<Result<T>> {
  let response: unknown;
  try {
    response = await within(ports.sendMessage(tabId, request), timing.requestMs);
  } catch (error) {
    return fail("tab-failed", error instanceof Error ? error.message : "The page did not answer.");
  }
  if (response === "timeout") return fail("timeout", provider.messages.slowResponse);
  if (!isResult(response)) return fail("tab-failed", "The page returned an unexpected answer.");
  if (!response.ok) return response;
  return isData(response.data)
    ? { ok: true, data: response.data }
    : fail("tab-failed", "The page returned malformed data.");
}

/** Open `url` in a background tab, run `work` on it, and close the tab whatever happens. */
async function inBackgroundTab<T>(
  ports: BrowserPorts,
  url: string,
  timing: ClientTiming,
  provider: CreditsProvider,
  work: (tabId: number) => Promise<Result<T>>,
): Promise<Result<T>> {
  let tabId: number | undefined;
  try {
    // Fail closed: a page that may play must not load before its guard is in place.
    if (provider.readerGuard) await ports.armReaderGuard(provider.readerGuard, provider.origins);
    tabId = await ports.createTab(url, !provider.worksHidden);
    const loaded = await waitForLoad(ports, tabId, url, timing);
    if (loaded === "gone") return fail("tab-failed", "The tab was closed before the page loaded.");
    if (loaded === "timeout") return fail("timeout", "The page did not finish loading. Check your connection.");
    await ports.injectContentScript(tabId, provider.contentScript);
    return await work(tabId);
  } catch (error) {
    return fail("tab-failed", error instanceof Error ? error.message : "Could not open the page.");
  } finally {
    if (tabId !== undefined) await ports.removeTab(tabId).catch(() => undefined);
  }
}

/** Album or song summary. With `tabId` it reads the user's own open tab instead of opening one. */
export async function detectAlbum(
  ports: BrowserPorts,
  url: string,
  tabId: number | undefined,
  baseTiming: ClientTiming,
): Promise<Result<AlbumInfo>> {
  const recognised = recogniseUrl(url);
  if (!recognised) return fail("invalid-url", unsupportedLinkMessage("album-or-song"));
  const { provider } = recognised;
  const timing = withOverrides(baseTiming, provider);
  const message = request(provider, "detect", url, "");

  if (tabId === undefined) {
    return inBackgroundTab(ports, provider.openUrl(url), timing, provider, (id) =>
      ask(ports, id, message, timing, provider, isAlbumInfo),
    );
  }
  // The user's tab is only read, never navigated or closed, and only if it really shows this page.
  try {
    const tab = await ports.getTab(tabId);
    if (tab?.url !== url) return fail("invalid-url", provider.messages.tabNotShowing);
    await ports.injectContentScript(tabId, provider.contentScript);
    return await ask(ports, tabId, message, timing, provider, isAlbumInfo);
  } catch (error) {
    return fail("tab-failed", error instanceof Error ? error.message : "Could not read the tab.");
  }
}

/** Credits of one track, read from its own song page in a background tab. */
export async function scrapeTrack(
  ports: BrowserPorts,
  url: string,
  trackTitle: string,
  baseTiming: ClientTiming,
): Promise<Result<PageScrape>> {
  const recognised = recogniseUrl(url);
  if (!recognised) return fail("invalid-url", unsupportedLinkMessage("song"));
  const { provider } = recognised;
  if (recognised.url.kind !== "song") return fail("invalid-url", provider.messages.notSong);
  const timing = withOverrides(baseTiming, provider);
  const message = request(provider, "scrape", url, trackTitle);
  return inBackgroundTab(ports, provider.openUrl(url), timing, provider, (id) =>
    ask(ports, id, message, timing, provider, isPageScrape),
  );
}

/** The browser's error when the page navigated, reloaded or closed while the reader was still answering. */
const CHANNEL_CLOSED = /message channel closed|Receiving end does not exist|context invalidated|back\/forward cache/i;

/** Wait until the tab has settled (finished loading) so a page that redirected or reloaded can be read once more. */
async function waitSettled(ports: BrowserPorts, tabId: number, timing: ClientTiming): Promise<void> {
  const deadline = Date.now() + timing.tabLoadMs;
  while (Date.now() < deadline) {
    const tab = await ports.getTab(tabId);
    if (!tab || tab.status === "complete") return;
    await sleep(timing.pollMs);
  }
}

/**
 * One search page read in a background tab. A signed-in page may redirect or reload once after it opens, which closes
 * the channel to a reader that is still answering: then the tab is let to settle, the reader is injected again and
 * asked once more. Any other failure, and a second closed channel, is returned as it is, with its reason.
 */
function searchPage(
  ports: BrowserPorts,
  provider: CreditsProvider,
  url: string,
  message: ContentRequest,
  baseTiming: ClientTiming,
): Promise<Result<SearchRow[]>> {
  const timing = withOverrides(baseTiming, provider);
  return inBackgroundTab(ports, url, timing, provider, async (id) => {
    const first = await ask(ports, id, message, timing, provider, isSearchRows);
    if (first.ok || !CHANNEL_CLOSED.test(first.error.message)) return first;
    await waitSettled(ports, id, timing);
    await ports.injectContentScript(id, provider.contentScript);
    return ask(ports, id, message, timing, provider, isSearchRows);
  });
}

/**
 * The songs (or, for `tab` "albums", the albums) Spotify's search lists for `query`, read from a search page in a background tab (one page load, closed
 * afterwards like every read). Only a title and artist ever go into the query; the caller decides which row, if any,
 * is the wanted song.
 */
export function searchSpotify(
  ports: BrowserPorts,
  query: string,
  timing: ClientTiming,
  tab: "tracks" | "albums" = "tracks",
): Promise<Result<SearchRow[]>> {
  const url = spotifySearchUrl(query, tab);
  return searchPage(ports, SPOTIFY_PROVIDER, url, { type: "spotify/search", url }, timing);
}

/** The songs Apple Music's search page lists for `query`, read in a background tab, as for `searchSpotify`. */
export function searchApple(ports: BrowserPorts, query: string, timing: ClientTiming): Promise<Result<SearchRow[]>> {
  const url = appleSearchUrl(query);
  return searchPage(ports, APPLE_PROVIDER, url, { type: "apple/search", url }, timing);
}
