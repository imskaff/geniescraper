// Turns one request into one Result. Pure with respect to the extension APIs, so tests call it with a
// saved page; content.ts only wires it to chrome.runtime.
import type { Result } from "../shared/messages";
import { isContentRequest } from "../shared/messages";
import { detectAlbum, scrapeTrack, type Timing } from "./driver";
import { AppleError } from "./errors";
import { parseAppleMusicUrl } from "./url";

export async function handleRequest(raw: unknown, doc: Document, timing: Timing): Promise<Result<unknown>> {
  if (!isContentRequest(raw)) return { ok: false, error: { code: "bad-request", message: "Unrecognised request." } };
  const target = parseAppleMusicUrl(raw.url);
  // Scraping reads one track's own song page; an album link here would need the menu path, which does not exist.
  if (!target || (raw.type === "apple/scrape" && target.kind !== "song")) {
    return { ok: false, error: { code: "invalid-url", message: "Not an Apple Music link this request can read." } };
  }
  try {
    if (raw.type === "apple/detect") return { ok: true, data: await detectAlbum(doc, raw.url, timing) };
    return { ok: true, data: await scrapeTrack(doc, { url: raw.url, trackTitle: raw.trackTitle }, timing) };
  } catch (error) {
    if (error instanceof AppleError) return { ok: false, error: error.toJSON() };
    return {
      ok: false,
      error: { code: "timeout", message: error instanceof Error ? error.message : "Unexpected error." },
    };
  }
}
