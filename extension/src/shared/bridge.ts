// The companion link to the desktop app: message shapes and their validators (docs/extension-plan.md section 39).
// Everything arriving over the socket is data. It is parsed as JSON and checked field by field before anything
// acts on it; a title or a name in it is never read as an instruction.
import { appleTabEntries, type OpenTab } from "../core/appleTabs";
import type { PasteState } from "../core/paste";

export const BRIDGE_VERSION = 1;
export const BRIDGE_HOST = "127.0.0.1";
/** The desktop app listens on the first free one of these. */
export const BRIDGE_PORTS: readonly number[] = [47831, 47832, 47833, 47834, 47835];
export const MAX_FRAME_CHARS = 64 * 1024;
export const MAX_QUEUE_ITEMS = 500;
export const MAX_TEXT = 2000;
const MAX_STATUS_TEXT = 500;
/** The most open pages the desktop app is told about, and the longest address it is sent. */
export const MAX_PAGES = 20;
const MAX_PAGE_URL = 2048;

export const QUEUE_KINDS: ReadonlySet<string> = new Set([
  "written_by",
  "produced_by",
  "role",
  "artist",
  "copyright_role",
  "phonographic_copyright",
  "copyright_notice",
  "youtube_url",
  "cover_art",
  "release_month",
  "release_day",
  "release_year",
]);

export type SimpleCommand = "fill-next" | "back" | "skip" | "pause" | "resume" | "stop" | "get-status";
const SIMPLE: ReadonlySet<string> = new Set(["fill-next", "back", "skip", "pause", "resume", "stop", "get-status"]);

/** What the desktop app may ask for. Nothing here reads a page, opens a tab or touches a setting. */
export type BridgeCommand =
  | { type: "begin"; id: number; title: string; queue: [string, string][]; mode: "auto" | "manual" }
  | { type: SimpleCommand; id: number };

/** The paste session as the desktop app sees it. */
export interface BridgeStatus {
  active: boolean;
  auto: "off" | "running" | "paused";
  pauseReason: string;
  title: string;
  position: number;
  total: number;
  awaiting: boolean;
  busy: boolean;
  message: string;
  tone: "info" | "ok" | "attention";
}

/** An open Apple Music album or song page, as the desktop app is told of it (docs/extension-plan.md section 42). */
export interface BridgePage {
  url: string;
  title: string;
  kind: "album" | "song";
  current: boolean;
}

/**
 * The pages for the `pages` event: the same list the panel shows (same filtering, the page in view first, titles
 * cleaned and capped at 120 characters), at most MAX_PAGES, nothing but address, title, kind and whether it is in view.
 */
export function toBridgePages(tabs: readonly OpenTab[]): BridgePage[] {
  return appleTabEntries(tabs)
    .filter((entry) => entry.url.length <= MAX_PAGE_URL)
    .slice(0, MAX_PAGES)
    .map((entry) => ({ url: entry.url, title: entry.name, kind: entry.kind, current: entry.current }));
}

/** What an extension page may ask the worker about the link. */
export type BridgeRequest =
  { type: "bridge-pair"; code: string } | { type: "bridge-unpair" } | { type: "bridge-status" };

export interface BridgeLinkState {
  paired: boolean;
  connected: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 2 ** 31;
}

function isText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}

/** Parse one frame. Binary frames, oversized frames and anything that is not a JSON object with a `type` are null. */
export function parseFrame(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || raw.length > MAX_FRAME_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isRecord(parsed) && typeof parsed["type"] === "string" ? parsed : null;
}

export type CommandCheck = { ok: true; command: BridgeCommand } | { ok: false; id: number | null };

/** Check a command from the desktop app. A bad one keeps its id, when it has a usable one, so it can be refused by name. */
export function checkCommand(message: Record<string, unknown>): CommandCheck {
  const id = isId(message["id"]) ? message["id"] : null;
  if (id === null || message["v"] !== BRIDGE_VERSION) return { ok: false, id };
  const type = message["type"];
  if (typeof type === "string" && SIMPLE.has(type)) {
    return { ok: true, command: { type: type as SimpleCommand, id } };
  }
  if (type !== "begin") return { ok: false, id };
  const { title, queue, mode } = message;
  if (!isText(title, MAX_TEXT) || (mode !== "auto" && mode !== "manual") || !Array.isArray(queue)) {
    return { ok: false, id };
  }
  if (queue.length > MAX_QUEUE_ITEMS) return { ok: false, id };
  const items: [string, string][] = [];
  for (const pair of queue) {
    if (!Array.isArray(pair) || pair.length !== 2) return { ok: false, id };
    const [kind, text] = pair as unknown[];
    if (typeof kind !== "string" || !QUEUE_KINDS.has(kind) || !isText(text, MAX_TEXT)) return { ok: false, id };
    items.push([kind, text]);
  }
  return { ok: true, command: { type: "begin", id, title, queue: items, mode } };
}

export function isBridgeLinkState(value: unknown): value is BridgeLinkState {
  return isRecord(value) && typeof value["paired"] === "boolean" && typeof value["connected"] === "boolean";
}

export function isBridgeRequest(value: unknown): value is BridgeRequest {
  if (!isRecord(value)) return false;
  if (value["type"] === "bridge-unpair" || value["type"] === "bridge-status") return true;
  return value["type"] === "bridge-pair" && isText(value["code"], 32);
}

/** The state the desktop app is shown: the numbers and the worker's own plain message, never the queue's text. */
export function toBridgeStatus(state: PasteState): BridgeStatus {
  return {
    active: state.active,
    auto: state.auto,
    pauseReason: state.pauseReason,
    title: state.title.slice(0, MAX_STATUS_TEXT),
    position: state.position,
    total: state.queue.length,
    awaiting: state.awaiting,
    busy: state.busy,
    message: state.message.slice(0, MAX_STATUS_TEXT),
    tone: state.tone,
  };
}

/** The proof that goes with a challenge: HMAC-SHA-256 over `role|serverNonce|clientNonce`, in hex. */
export async function computeProof(
  secret: string,
  role: "client" | "server",
  serverNonce: string,
  clientNonce: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${role}|${serverNonce}|${clientNonce}`));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compare without stopping at the first difference. */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The pairing code as the user may type it: any case, with or without the dash. */
export function normaliseCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/.test(code) ? `${code.slice(0, 4)}-${code.slice(4)}` : null;
}
