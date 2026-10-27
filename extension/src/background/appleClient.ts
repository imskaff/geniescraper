// The worker's side of reading Apple Music: open a hidden tab on a validated URL, inject the content script,
// ask it one question, and always close the tab again. Failures come back as data, never as exceptions.
import { parseAppleMusicUrl } from "../apple/url";
import {
  isAlbumInfo,
  isPageScrape,
  isResult,
  type AlbumInfo,
  type ContentRequest,
  type ErrorCode,
  type PageScrape,
  type Result,
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

async function waitForLoad(
  ports: BrowserPorts,
  tabId: number,
  timing: ClientTiming,
): Promise<"loaded" | "gone" | "timeout"> {
  const deadline = Date.now() + timing.tabLoadMs;
  while (Date.now() < deadline) {
    const tab = await ports.getTab(tabId);
    if (!tab) return "gone";
    if (tab.status === "complete") return "loaded";
    await sleep(timing.pollMs);
  }
  return "timeout";
}

/** Ask the content script of `tabId` one question and check the shape of the answer. */
async function ask<T>(
  ports: BrowserPorts,
  tabId: number,
  request: ContentRequest,
  timing: ClientTiming,
  isData: (value: unknown) => value is T,
): Promise<Result<T>> {
  let response: unknown;
  try {
    response = await within(ports.sendMessage(tabId, request), timing.requestMs);
  } catch (error) {
    return fail("tab-failed", error instanceof Error ? error.message : "The page did not answer.");
  }
  if (response === "timeout") return fail("timeout", "Apple Music took too long to respond. Try again.");
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
  work: (tabId: number) => Promise<Result<T>>,
): Promise<Result<T>> {
  let tabId: number | undefined;
  try {
    tabId = await ports.createTab(url, false);
    const loaded = await waitForLoad(ports, tabId, timing);
    if (loaded === "gone") return fail("tab-failed", "The tab was closed before the page loaded.");
    if (loaded === "timeout") return fail("timeout", "The page did not finish loading. Check your connection.");
    await ports.injectContentScript(tabId);
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
  timing: ClientTiming,
): Promise<Result<AlbumInfo>> {
  if (!parseAppleMusicUrl(url)) return fail("invalid-url", "Not an Apple Music album or song link.");
  const request: ContentRequest = { type: "apple/detect", url };

  if (tabId === undefined) {
    return inBackgroundTab(ports, url, timing, (id) => ask(ports, id, request, timing, isAlbumInfo));
  }
  // The user's tab is only read, never navigated or closed, and only if it really shows this page.
  try {
    const tab = await ports.getTab(tabId);
    if (tab?.url !== url) return fail("invalid-url", "That tab is not showing this Apple Music page.");
    await ports.injectContentScript(tabId);
    return await ask(ports, tabId, request, timing, isAlbumInfo);
  } catch (error) {
    return fail("tab-failed", error instanceof Error ? error.message : "Could not read the tab.");
  }
}

/** Credits of one track, read from its own song page in a background tab. */
export async function scrapeTrack(
  ports: BrowserPorts,
  url: string,
  trackTitle: string,
  timing: ClientTiming,
): Promise<Result<PageScrape>> {
  if (parseAppleMusicUrl(url)?.kind !== "song") return fail("invalid-url", "Not an Apple Music song link.");
  const request: ContentRequest = { type: "apple/scrape", url, trackTitle };
  return inBackgroundTab(ports, url, timing, (id) => ask(ports, id, request, timing, isPageScrape));
}
