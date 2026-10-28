// Contracts between the extension's contexts. Everything crossing a context boundary is plain JSON
// and is validated on receipt: a message is data, never trusted to have the shape it claims.
import type { Credit } from "../core/models";
import type { AutoMode, Outcome } from "../core/paste";

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
  /** When the user's YouTube key could not be used: why. "" when no key was involved or it worked. */
  keyProblem: "" | "key" | "quota" | "not-enabled";
}

/** The outcome of trying a YouTube key. */
export type KeyCheck = "ok" | "key" | "quota" | "not-enabled" | "failed";

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
  /** Start automatic pasting, or resume it after a pause. */
  | { type: "paste-auto-start" }
  /** Pause automatic pasting; the user can resume it. */
  | { type: "paste-auto-pause" }
  /** Fill the next step now, as the hotkey would, in the Genius tab the user is looking at. */
  | { type: "paste-fill" };

/** Messages the extension's own pages send to the background worker. */
export type WorkerRequest =
  | { type: "detect"; url: string; tabId?: number }
  | { type: "scrape-track"; url: string; trackTitle: string }
  /** One track's YouTube link, looked up when the user is about to paste it, never for a whole album at once. */
  | { type: "youtube-lookup"; title: string; artist: string }
  /** Try a YouTube key the user typed, with one cheap call. The key is checked, not stored, by the worker. */
  | { type: "youtube-key-check"; key: string }
  | PasteCommand;

/** What the Genius content script asks the worker. The worker also checks that it really came from genius.com. */
export type GeniusRequest =
  /** `source: "auto"` is the automatic loop asking for its next step; without it, it is the user's Next key. */
  | { type: "paste-begin"; source?: "auto" }
  | { type: "paste-status" }
  | { type: "paste-back" }
  /** The user chose the awaited suggestion themselves; an automatic run counts the step as done. */
  | { type: "paste-confirm" }
  /** The page pauses a run: the user used the form or pressed Esc, or the page was reloaded under the run. */
  | { type: "paste-pause"; reason: PagePauseReason }
  | { type: "paste-report"; position: number; outcome: Outcome };

/** The pauses only the page can know about. */
export type PagePauseReason = "input" | "user" | "page-changed";

/** The worker's answer to paste-status. */
export interface PasteStatus {
  active: boolean;
  auto: AutoMode;
  awaiting: boolean;
  position: number;
}

/** The worker's answer to paste-begin: what the page should do for this press. */
export type BeginReply =
  | { action: "none" }
  | { action: "advanced" }
  /** An automatic run resumed while a step still awaits the user's choice: wait for it, do not fill again. */
  | { action: "await"; item: [string, string]; position: number; paceMs?: number }
  | {
      action: "fill";
      item: [string, string];
      position: number;
      autoConfirm: boolean;
      /** How long suggestions must hold still before they are trusted. */
      settleMs: number;
      /** The pause an automatic run makes after each field; absent for a key press. */
      paceMs?: number;
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
  | { type: "genius/paste-active"; active: boolean }
  /** An automatic run started, paused, resumed or ended, so the page loop knows whether to go on. */
  | { type: "genius/auto-state"; auto: AutoMode };

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

const PASTE_COMMANDS: ReadonlySet<unknown> = new Set([
  "paste-back",
  "paste-skip",
  "paste-stop",
  "paste-fill",
  "paste-auto-start",
  "paste-auto-pause",
]);
const PAGE_PAUSE_REASONS: ReadonlySet<unknown> = new Set(["input", "user", "page-changed"]);

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
  if (value["type"] === "youtube-key-check") return typeof value["key"] === "string" && value["key"].length < 200;
  if (!hasUrl(value)) return false;
  if (value["type"] === "detect") return value["tabId"] === undefined || Number.isInteger(value["tabId"]);
  return value["type"] === "scrape-track" && typeof value["trackTitle"] === "string";
}

export function isGeniusRequest(value: unknown): value is GeniusRequest {
  if (!isRecord(value)) return false;
  if (value["type"] === "paste-begin") return value["source"] === undefined || value["source"] === "auto";
  if (value["type"] === "paste-status" || value["type"] === "paste-back" || value["type"] === "paste-confirm") {
    return true;
  }
  if (value["type"] === "paste-pause") return PAGE_PAUSE_REASONS.has(value["reason"]);
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
  if (value["action"] === "await") {
    return (
      isPair(value["item"]) &&
      typeof value["position"] === "number" &&
      (value["paceMs"] === undefined || typeof value["paceMs"] === "number")
    );
  }
  return (
    value["action"] === "fill" &&
    Array.isArray(value["item"]) &&
    value["item"].length === 2 &&
    typeof value["item"][0] === "string" &&
    typeof value["item"][1] === "string" &&
    typeof value["position"] === "number" &&
    typeof value["autoConfirm"] === "boolean" &&
    typeof value["settleMs"] === "number" &&
    (value["paceMs"] === undefined || typeof value["paceMs"] === "number")
  );
}

const AUTO_MODES: ReadonlySet<unknown> = new Set(["off", "running", "paused"]);

export function isPasteStatus(value: unknown): value is PasteStatus {
  return (
    isRecord(value) &&
    typeof value["active"] === "boolean" &&
    AUTO_MODES.has(value["auto"]) &&
    typeof value["awaiting"] === "boolean" &&
    typeof value["position"] === "number"
  );
}

export function isGeniusNotice(value: unknown): value is GeniusNotice {
  if (!isRecord(value)) return false;
  if (value["type"] === "genius/fill-now") return true;
  if (value["type"] === "genius/auto-state") return AUTO_MODES.has(value["auto"]);
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
    typeof value["throttled"] === "boolean" &&
    ["", "key", "quota", "not-enabled"].includes(value["keyProblem"] as string)
  );
}

export function isKeyCheck(value: unknown): value is KeyCheck {
  return typeof value === "string" && ["ok", "key", "quota", "not-enabled", "failed"].includes(value);
}
