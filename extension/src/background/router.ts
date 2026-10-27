// Maps the extension pages' requests onto the Apple Music client and the paste session.
// Reads of Apple Music run one at a time; paste changes are serialised by the paste service itself.
import { isPasteCommand, isWorkerRequest, type Result } from "../shared/messages";
import { detectAlbum, scrapeTrack, type ClientTiming } from "./appleClient";
import type { PasteService } from "./paste";
import type { BrowserPorts } from "./ports";
import { Serial } from "./serial";

export type Router = (raw: unknown) => Promise<Result<unknown>>;

export function createRouter(ports: BrowserPorts, timing: ClientTiming, paste: PasteService): Router {
  const serial = new Serial();

  return (raw) => {
    if (!isWorkerRequest(raw)) {
      return Promise.resolve({ ok: false, error: { code: "bad-request", message: "Unrecognised request." } });
    }
    // Pasting must stay responsive while an album is being read, so it does not wait in the reads' queue.
    if (isPasteCommand(raw)) return paste.command(raw);

    return serial.run(async () => {
      const stopKeepAlive = ports.keepAlive();
      try {
        if (raw.type === "detect") return await detectAlbum(ports, raw.url, raw.tabId, timing);
        return await scrapeTrack(ports, raw.url, raw.trackTitle, timing);
      } finally {
        stopKeepAlive();
      }
    });
  };
}
