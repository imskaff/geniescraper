// Maps the extension pages' requests onto the Apple Music client and the paste session.
// Reads of Apple Music run one at a time; paste changes are serialised by the paste service itself.
import { isPasteCommand, isWorkerRequest, type AlbumInfo, type Result } from "../shared/messages";
import { detectAlbum, scrapeTrack, type ClientTiming } from "./appleClient";
import type { CoverService } from "./covers";
import type { PasteService } from "./paste";
import type { BrowserPorts } from "./ports";
import { Serial } from "./serial";

export type Router = (raw: unknown) => Promise<Result<unknown>>;

/**
 * Settle the album's cover. Apple's catalog lookup is exact and wins over the page header, which shows only motion
 * artwork for some albums; a title search is the last resort, since it can return another edition.
 */
async function withCover(album: AlbumInfo, exact: string, covers: CoverService): Promise<AlbumInfo> {
  let cover = exact || album.coverArtUrl;
  if (!cover && album.albumTitle && album.artist) cover = await covers.search(album.albumTitle, album.artist);
  return { ...album, coverArtUrl: cover };
}

export function createRouter(
  ports: BrowserPorts,
  timing: ClientTiming,
  paste: PasteService,
  covers: CoverService,
): Router {
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
        if (raw.type === "detect") {
          // The lookup runs while the page is read, as in the desktop app, so it adds no waiting.
          const exact = covers.exact(raw.url).catch(() => "");
          const result = await detectAlbum(ports, raw.url, raw.tabId, timing);
          const found = await exact;
          return result.ok ? { ok: true, data: await withCover(result.data, found, covers) } : result;
        }
        return await scrapeTrack(ports, raw.url, raw.trackTitle, timing);
      } finally {
        stopKeepAlive();
      }
    });
  };
}
