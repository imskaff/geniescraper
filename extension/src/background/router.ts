// Maps the extension pages' requests onto the Apple Music client. Requests run one at a time.
import { isWorkerRequest, type Result } from "../shared/messages";
import { detectAlbum, scrapeTrack, type ClientTiming } from "./appleClient";
import type { BrowserPorts } from "./ports";
import { Serial } from "./serial";

export type Router = (raw: unknown) => Promise<Result<unknown>>;

export function createRouter(ports: BrowserPorts, timing: ClientTiming): Router {
  const serial = new Serial();

  return (raw) => {
    if (!isWorkerRequest(raw)) {
      return Promise.resolve({ ok: false, error: { code: "bad-request", message: "Unrecognised request." } });
    }
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
