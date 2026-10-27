// Contracts between the extension's contexts. Everything crossing a context boundary is plain JSON
// and is validated on receipt: a message is data, never trusted to have the shape it claims.
import type { Credit } from "../core/models";

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

export type ErrorCode = "bad-request" | "invalid-url" | "not-found" | "timeout" | "tab-failed" | "internal";

export interface AppError {
  code: ErrorCode;
  message: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

/** Messages the background worker sends to the Apple Music content script. */
export type ContentRequest =
  { type: "apple/detect"; url: string } | { type: "apple/scrape"; url: string; trackTitle: string };

/** Messages the extension's own pages send to the background worker. */
export type WorkerRequest =
  { type: "detect"; url: string; tabId?: number } | { type: "scrape-track"; url: string; trackTitle: string };

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

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!isRecord(value) || !hasUrl(value)) return false;
  if (value["type"] === "detect") return value["tabId"] === undefined || Number.isInteger(value["tabId"]);
  return value["type"] === "scrape-track" && typeof value["trackTitle"] === "string";
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
