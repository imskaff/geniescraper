// The two things the worker asks of a Spotify page: a summary (one track, or an album's track list) and the credits
// of one track. Failures are thrown as SpotifyError and returned as data by the handler.
import type { AlbumInfo, AppError, ErrorCode, PageScrape } from "../shared/messages";
import { creditsFromDialog, languageNote, skippedNote } from "./dialog";
import {
  isBlocked,
  readAlbumReleaseDate,
  readAlbumRows,
  readCopyright,
  readCredits,
  readHeader,
  until,
  type Timing,
} from "./page";
import { parseSpotifyUrl, spotifyTrackUrl } from "./url";

export { REAL_TIMING, type Timing } from "./page";

export class SpotifyError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "SpotifyError";
    this.code = code;
  }

  toJSON(): AppError {
    return { code: this.code, message: this.message };
  }
}

/** What a Spotify track page cannot give, said next to the credits instead of leaving fields silently empty. */
export const NOT_PROVIDED_NOTE =
  "Spotify does not show the ISRC. A track's own page shows only the year of its release, so the release date comes from the album page when you read an album, and is empty otherwise.";

export const UNAVAILABLE_MESSAGE =
  "Spotify has no playable page for this track here. It may be removed or not available in your country.";
export const BLOCKED_MESSAGE =
  "Spotify is asking for a captcha or limiting requests, so reading from Spotify has stopped. Open open.spotify.com in a tab, check that it works, and try again in a while.";

/** Wait for the page's header; a page that never gets one is unavailable (or blocked). */
async function waitForHeader(doc: Document, timing: Timing): Promise<void> {
  const ready = await until(
    doc,
    () => doc.querySelector("[data-testid='entityTitle']") ?? (isBlocked(doc) ? doc.body : null),
    timing.buttonMs,
    timing.stepMs,
  );
  if (!ready || isBlocked(doc)) {
    throw isBlocked(doc)
      ? new SpotifyError("blocked", BLOCKED_MESSAGE)
      : new SpotifyError("unavailable", UNAVAILABLE_MESSAGE);
  }
}

/** A track page is a one-track "album"; an album page lists what its page shows and says what it does not. */
export async function detectAlbum(doc: Document, url: string, timing: Timing): Promise<AlbumInfo> {
  const target = parseSpotifyUrl(url);
  if (!target) throw new SpotifyError("invalid-url", "Not a Spotify link this request can read.");
  await waitForHeader(doc, timing);
  const header = readHeader(doc);

  if (target.kind === "song") {
    const copyright = readCopyright(doc);
    return {
      url,
      albumTitle: header.title,
      artist: header.artists.join(", "),
      trackCount: 1,
      trackTitles: [header.title],
      trackUrls: [spotifyTrackUrl(target.id)],
      phonographicCopyright: copyright.phonographic,
      copyrightNotice: copyright.copyright,
      coverArtUrl: "",
      releaseDate: "",
    };
  }

  const { rows, expected } = await readAlbumRows(doc, timing);
  if (rows.length === 0) throw new SpotifyError("tab-failed", "The album's track list did not load.");
  const count = Math.max(expected ?? rows.length, rows.length);
  const copyright = readCopyright(doc);
  const album: AlbumInfo = {
    url,
    albumTitle: header.title,
    artist: header.artists.join(", "),
    trackCount: count,
    trackTitles: Array.from({ length: count }, (_, i) => rows[i]?.title ?? `Track ${String(i + 1)}`),
    // A track the page did not list has no address here; the panel shows it as unavailable instead of hiding it.
    trackUrls: Array.from({ length: count }, (_, i) => {
      const row = rows[i];
      return row ? spotifyTrackUrl(row.id) : "";
    }),
    phonographicCopyright: copyright.phonographic,
    copyrightNotice: copyright.copyright,
    coverArtUrl: "",
    releaseDate: readAlbumReleaseDate(doc),
  };
  if (rows.length < count) {
    album.note = `Spotify's page lists ${String(rows.length)} of ${String(count)} tracks. Open any other track on its own page to read it.`;
  }
  return album;
}

/** Credits of the track whose page this is. */
export async function scrapeTrack(
  doc: Document,
  request: { url: string; trackTitle: string },
  timing: Timing,
): Promise<PageScrape> {
  await waitForHeader(doc, timing);
  const header = readHeader(doc);
  const read = await readCredits(doc, timing);
  switch (read.status) {
    case "blocked":
      throw new SpotifyError("blocked", BLOCKED_MESSAGE);
    case "no-button":
      throw new SpotifyError("unavailable", UNAVAILABLE_MESSAGE);
    case "no-menu":
    case "no-item":
    case "no-dialog":
      throw new SpotifyError(
        "tab-failed",
        `Spotify's credits would not open (${read.status}). Try this track again; if it keeps failing, Spotify's page may have changed.`,
      );
    case "ok":
    case "no-credits":
      break;
  }
  // Spotify writes role words in the page's language, which the page declares.
  const language = doc.documentElement.lang || "en";
  const mapped = read.dialog ? creditsFromDialog(read.dialog, language) : { artists: [], credits: [], skipped: [] };
  const notes = [skippedNote(mapped.skipped), languageNote(language), NOT_PROVIDED_NOTE].filter(Boolean);
  return {
    title: request.trackTitle || header.title || read.dialog?.title || "",
    artist: header.artists.join(", ") || mapped.artists.join(", "),
    credits: mapped.credits,
    coverArtUrl: "",
    releaseDate: "",
    warnings: mapped.credits.length === 0 ? ["No credits were found on this track's page."] : [],
    notes,
  };
}
