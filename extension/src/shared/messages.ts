// Contracts between the extension's contexts. Everything crossing a context boundary is plain JSON
// and is validated on receipt: a message is data, never trusted to have the shape it claims.
import type { Credit } from "../core/models";
import type { Outcome } from "../core/paste";

export interface AlbumInfo {
  url: string;
  albumTitle: string;
  artist: string;
  trackCount: number;
  trackTitles: string[];
  /** Song page of each track, aligned with `trackTitles`; "" for a track Apple gives no page. */
  trackUrls: string[];
  /** The album's ℗ and © lines, which song pages do not carry. */
  phonographicCopyright: string;
  copyrightNotice: string;
  /** Artwork from the page header ("" when the header shows only motion artwork). */
  coverArtUrl: string;
}

/** What the in-page driver reads from one song page. */
export interface PageScrape {
  title: string;
  artist: string;
  credits: Credit[];
  coverArtUrl: string;
  /** Non-fatal problems, for example that the page held no credits. */
  warnings: string[];
}

/** The worker's answer to a YouTube look-up. */
export interface YoutubeAnswer {
  /** The link, or "" when none was found or YouTube may not be asked. */
  url: string;
  isMusicVideo: boolean;
  /** True when YouTube is limiting requests, so "no link" does not mean the song has none. */
  throttled: boolean;
}

export type ErrorCode = "bad-request" | "invalid-url" | "not-found" | "timeout" | "tab-failed" | "internal";

export interface AppError {
  code: ErrorCode;
  message: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

/** Messages the background worker sends to the Apple Music content script. */
export type ContentRequest =
  { type: "apple/detect"; url: string } | { type: "apple/scrape"; url: string; trackTitle: string };

/** The pieces of the paste session an extension page can ask the worker to change. */
export type PasteCommand =
  | { type: "paste-start"; title: string; queue: [string, string][] }
  | { type: "paste-back" }
  | { type: "paste-skip" }
  | { type: "paste-stop" }
  /** Fill the next step now, as the hotkey would, in the Genius tab the user is looking at. */
  | { type: "paste-fill" };

/** Messages the extension's own pages send to the background worker. */
export type WorkerRequest =
  | { type: "detect"; url: string; tabId?: number }
  | { type: "scrape-track"; url: string; trackTitle: string }
  /** One track's YouTube link, looked up when the user is about to paste it, never for a whole album at once. */
  | { type: "youtube-lookup"; title: string; artist: string }
  | PasteCommand;

/** What the Genius content script asks the worker. The worker also checks that it really came from genius.com. */
export type GeniusRequest =
  | { type: "paste-begin" }
  | { type: "paste-status" }
  | { type: "paste-back" }
  | { type: "paste-report"; position: number; outcome: Outcome };

/** The worker's answer to paste-begin: what the page should do for this press. */
export type BeginReply =
  | { action: "none" }
  | { action: "advanced" }
  | {
      action: "fill";
      item: [string, string];
      position: number;
      autoConfirm: boolean;
      /** How long suggestions must hold still before they are trusted. */
      settleMs: number;
    };

export function isOutcome(value: unknown): value is Outcome {
  return (
    isRecord(value) &&
    (value["status"] === "filled" || value["status"] === "needs-choice" || value["status"] === "unavailable") &&
    typeof value["message"] === "string"
  );
}

/** What the worker tells a Genius tab. */
export type GeniusNotice =
  | { type: "genius/fill-now" }
  /** The paste session started or ended, so the page knows whether the hotkeys are live. */
  | { type: "genius/paste-active"; active: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasUrl(value: Record<string, unknown>): boolean {
  return typeof value["url"] === "string";
}

export function isContentRequest(value: unknown): value is ContentRequest {
  if (!isRecord(value) || !hasUrl(value)) return false;
  if (value["type"] === "apple/detect") return true;
  return value["type"] === "apple/scrape" && typeof value["trackTitle"] === "string";
}

const PASTE_COMMANDS: ReadonlySet<unknown> = new Set(["paste-back", "paste-skip", "paste-stop", "paste-fill"]);

function isPair(value: unknown): value is [string, string] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string";
}

export function isPasteCommand(value: unknown): value is PasteCommand {
  if (!isRecord(value)) return false;
  if (PASTE_COMMANDS.has(value["type"])) return true;
  return (
    value["type"] === "paste-start" &&
    typeof value["title"] === "string" &&
    Array.isArray(value["queue"]) &&
    value["queue"].every(isPair)
  );
}

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (isPasteCommand(value)) return true;
  if (!isRecord(value)) return false;
  if (value["type"] === "youtube-lookup")
    return typeof value["title"] === "string" && typeof value["artist"] === "string";
  if (!hasUrl(value)) return false;
  if (value["type"] === "detect") return value["tabId"] === undefined || Number.isInteger(value["tabId"]);
  return value["type"] === "scrape-track" && typeof value["trackTitle"] === "string";
}

export function isGeniusRequest(value: unknown): value is GeniusRequest {
  if (!isRecord(value)) return false;
  if (value["type"] === "paste-begin" || value["type"] === "paste-status" || value["type"] === "paste-back")
    return true;
  return (
    value["type"] === "paste-report" &&
    typeof value["position"] === "number" &&
    Number.isInteger(value["position"]) &&
    isOutcome(value["outcome"])
  );
}

export function isBeginReply(value: unknown): value is BeginReply {
  if (!isRecord(value)) return false;
  if (value["action"] === "none" || value["action"] === "advanced") return true;
  return (
    value["action"] === "fill" &&
    Array.isArray(value["item"]) &&
    value["item"].length === 2 &&
    typeof value["item"][0] === "string" &&
    typeof value["item"][1] === "string" &&
    typeof value["position"] === "number" &&
    typeof value["autoConfirm"] === "boolean" &&
    typeof value["settleMs"] === "number"
  );
}

export function isGeniusNotice(value: unknown): value is GeniusNotice {
  if (!isRecord(value)) return false;
  if (value["type"] === "genius/fill-now") return true;
  return value["type"] === "genius/paste-active" && typeof value["active"] === "boolean";
}

export function isResult(value: unknown): value is Result<unknown> {
  if (!isRecord(value)) return false;
  if (value["ok"] === true) return "data" in value;
  return value["ok"] === false && isRecord(value["error"]) && typeof value["error"]["message"] === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isAlbumInfo(value: unknown): value is AlbumInfo {
  return (
    isRecord(value) &&
    typeof value["url"] === "string" &&
    typeof value["albumTitle"] === "string" &&
    typeof value["artist"] === "string" &&
    typeof value["trackCount"] === "number" &&
    isStringArray(value["trackTitles"]) &&
    isStringArray(value["trackUrls"]) &&
    typeof value["phonographicCopyright"] === "string" &&
    typeof value["copyrightNotice"] === "string" &&
    typeof value["coverArtUrl"] === "string"
  );
}

function isCredit(value: unknown): value is Credit {
  return isRecord(value) && typeof value["role"] === "string" && isStringArray(value["artists"]);
}

export function isPageScrape(value: unknown): value is PageScrape {
  return (
    isRecord(value) &&
    typeof value["title"] === "string" &&
    typeof value["artist"] === "string" &&
    Array.isArray(value["credits"]) &&
    value["credits"].every(isCredit) &&
    typeof value["coverArtUrl"] === "string" &&
    isStringArray(value["warnings"])
  );
}

export function isYoutubeAnswer(value: unknown): value is YoutubeAnswer {
  return (
    isRecord(value) &&
    typeof value["url"] === "string" &&
    typeof value["isMusicVideo"] === "boolean" &&
    typeof value["throttled"] === "boolean"
  );
}
