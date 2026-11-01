// Turns one request into one Result. Pure with respect to the extension APIs, so tests call it with a saved page;
// content.ts only wires it to chrome.runtime.
import type { Result } from "../shared/messages";
import { isContentRequest } from "../shared/messages";
import { detectAlbum, scrapeTrack, SpotifyError, type Timing } from "./driver";
import { parseSpotifyUrl } from "./url";

export async function handleRequest(raw: unknown, doc: Document, timing: Timing): Promise<Result<unknown>> {
  // Only this provider's own requests: the other provider's content script answers theirs.
  if (!isContentRequest(raw) || !raw.type.startsWith("spotify/")) {
    return { ok: false, error: { code: "bad-request", message: "Unrecognised request." } };
  }
  const target = parseSpotifyUrl(raw.url);
  // Credits are read from one track's own page; an album link here would need the album's per-row menus.
  if (!target || (raw.type === "spotify/scrape" && target.kind !== "song")) {
    return { ok: false, error: { code: "invalid-url", message: "Not a Spotify link this request can read." } };
  }
  try {
    if (raw.type === "spotify/detect") return { ok: true, data: await detectAlbum(doc, raw.url, timing) };
    if (raw.type === "spotify/scrape") {
      return { ok: true, data: await scrapeTrack(doc, { url: raw.url, trackTitle: raw.trackTitle }, timing) };
    }
    return { ok: false, error: { code: "bad-request", message: "Unrecognised request." } };
  } catch (error) {
    if (error instanceof SpotifyError) return { ok: false, error: error.toJSON() };
    return {
      ok: false,
      error: { code: "internal", message: error instanceof Error ? error.message : "Unexpected error." },
    };
  }
}
