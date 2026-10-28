// The panel's side of the worker protocol: send one request, check the answer's shape.
import { normalisePaste, type PasteState } from "../core/paste";
import {
  isAlbumInfo,
  isPageScrape,
  isYoutubeAnswer,
  isResult,
  type AlbumInfo,
  type PageScrape,
  type PasteCommand,
  type Result,
  type WorkerRequest,
  type YoutubeAnswer,
} from "../shared/messages";

export interface WorkerApi {
  /** Read an album or song page; `tabId` reads the user's own tab instead of opening one. */
  detect(url: string, tabId?: number): Promise<Result<AlbumInfo>>;
  scrapeTrack(url: string, trackTitle: string): Promise<Result<PageScrape>>;
  /** The YouTube link of one song; the worker asks YouTube only while the user has allowed it. */
  lookupYoutube(title: string, artist: string): Promise<Result<YoutubeAnswer>>;
  /** Change the paste session. The worker is its only writer; the answer is the state afterwards. */
  paste(command: PasteCommand): Promise<Result<PasteState>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

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
    lookupYoutube: (title, artist) => ask(send, { type: "youtube-lookup", title, artist }, isYoutubeAnswer),
    async paste(command) {
      const answer = await ask(send, command, isRecord);
      return answer.ok ? { ok: true, data: normalisePaste(answer.data) } : answer;
    },
  };
}

export const chromeSend: Send = (request) => chrome.runtime.sendMessage(request);
