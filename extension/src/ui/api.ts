// The panel's side of the worker protocol: send one request, check the answer's shape.
import { normalisePaste, type PasteState } from "../core/paste";
import type { OfferedUpdate } from "../core/updates";
import { isBridgeLinkState, type BridgeLinkState, type BridgeRequest } from "../shared/bridge";
import {
  isAlbumInfo,
  isKeyCheck,
  isOfferedUpdate,
  isPageScrape,
  isYoutubeAnswer,
  isResult,
  type AlbumInfo,
  type KeyCheck,
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
  /** Try a YouTube key with one cheap call to Google; the key is checked, not stored, by the worker. */
  checkYoutubeKey(key: string): Promise<Result<KeyCheck>>;
  /** The newer extension release to tell the user about, or null. Never rejects: any failure is "nothing to show". */
  checkForUpdate(force?: boolean): Promise<OfferedUpdate | null>;
  /** "Later" and "Skip this version" on the notice; the answer is the notice still to show, normally null. */
  snoozeUpdate(version: string): Promise<OfferedUpdate | null>;
  skipUpdate(version: string): Promise<OfferedUpdate | null>;
  /** Change the paste session. The worker is its only writer; the answer is the state afterwards. */
  paste(command: PasteCommand): Promise<Result<PasteState>>;
  /** The link to the desktop app: pair with a code, unpair, or ask how it stands. The answer is the link afterwards. */
  bridge(request: BridgeRequest): Promise<Result<BridgeLinkState>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export type Send = (request: WorkerRequest | BridgeRequest) => Promise<unknown>;

async function ask<T>(
  send: Send,
  request: WorkerRequest | BridgeRequest,
  isData: (value: unknown) => value is T,
): Promise<Result<T>> {
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
    checkYoutubeKey: (key) => ask(send, { type: "youtube-key-check", key }, isKeyCheck),
    lookupYoutube: (title, artist) => ask(send, { type: "youtube-lookup", title, artist }, isYoutubeAnswer),
    bridge: (request) => ask(send, request, isBridgeLinkState),
    checkForUpdate: async (force) => {
      const answer = await ask(
        send,
        force ? { type: "update-check", force } : { type: "update-check" },
        isOfferedUpdate,
      );
      return answer.ok ? answer.data : null;
    },
    snoozeUpdate: async (version) => {
      const answer = await ask(send, { type: "update-later", version }, isOfferedUpdate);
      return answer.ok ? answer.data : null;
    },
    skipUpdate: async (version) => {
      const answer = await ask(send, { type: "update-skip", version }, isOfferedUpdate);
      return answer.ok ? answer.data : null;
    },
    async paste(command) {
      const answer = await ask(send, command, isRecord);
      return answer.ok ? { ok: true, data: normalisePaste(answer.data) } : answer;
    },
  };
}

export const chromeSend: Send = (request) => chrome.runtime.sendMessage(request);
