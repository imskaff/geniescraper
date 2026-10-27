// The panel's side of the worker protocol: send one request, check the answer's shape.
import {
  isAlbumInfo,
  isPageScrape,
  isResult,
  type AlbumInfo,
  type PageScrape,
  type Result,
  type WorkerRequest,
} from "../shared/messages";

export interface WorkerApi {
  /** Read an album or song page; `tabId` reads the user's own tab instead of opening one. */
  detect(url: string, tabId?: number): Promise<Result<AlbumInfo>>;
  scrapeTrack(url: string, trackTitle: string): Promise<Result<PageScrape>>;
}

export type Send = (request: WorkerRequest) => Promise<unknown>;

async function ask<T>(send: Send, request: WorkerRequest, isData: (value: unknown) => value is T): Promise<Result<T>> {
  let response: unknown;
  try {
    response = await send(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The extension did not answer.";
    return { ok: false, error: { code: "tab-failed", message } };
  }
  if (!isResult(response)) {
    return { ok: false, error: { code: "tab-failed", message: "The extension returned an unexpected answer." } };
  }
  if (!response.ok) return response;
  if (!isData(response.data)) {
    return { ok: false, error: { code: "tab-failed", message: "The extension returned malformed data." } };
  }
  return { ok: true, data: response.data };
}

export function createWorkerApi(send: Send): WorkerApi {
  return {
    detect: (url, tabId) =>
      ask(send, tabId === undefined ? { type: "detect", url } : { type: "detect", url, tabId }, isAlbumInfo),
    scrapeTrack: (url, trackTitle) => ask(send, { type: "scrape-track", url, trackTitle }, isPageScrape),
  };
}

export const chromeSend: Send = (request) => chrome.runtime.sendMessage(request);
