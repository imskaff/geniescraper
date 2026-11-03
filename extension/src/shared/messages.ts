// Contracts between the extension's contexts. Everything crossing a context boundary is plain JSON
// and is validated on receipt: a message is data, never trusted to have the shape it claims.
import { VIDEO_KINDS, type Credit, type VideoKind } from "../core/models";
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
  /** The album's release date ("YYYY-MM-DD"), from its footer; "" when the page shows none. */
  releaseDate: string;
  /** A remark about this read for the track list, for example that a long album was only partly listed. */
  note?: string;
}

/** What the in-page driver reads from one song page. */
export interface PageScrape {
  title: string;
  artist: string;
  credits: Credit[];
  coverArtUrl: string;
  /** The song's own release date ("YYYY-MM-DD"); "" when the page names none. */
  releaseDate: string;
  /** Non-fatal problems, for example that the page held no credits. */
  warnings: string[];
  /** Plain remarks for the user about what this source could not give, and which roles were left out. */
  notes?: string[];
  /** Milliseconds per stage of the read, for measuring; absent from sources that do not report it. */
  timings?: Record<string, number>;
}

/** The worker's answer to a YouTube look-up. */
export interface YoutubeAnswer {
  /** The link, or "" when none was found or YouTube may not be asked. */
  url: string;
  isMusicVideo: boolean;
  /** Which kind of video the link is, when there is one. */
  kind?: VideoKind;
  /** True when YouTube is limiting requests, so "no link" does not mean the song has none. */
  throttled: boolean;
  /** When the user's YouTube key could not be used: why. "" when no key was involved or it worked. */
  keyProblem: "" | "key" | "quota" | "not-enabled";
}

/** The outcome of trying a YouTube key. */
export type KeyCheck = "ok" | "key" | "quota" | "not-enabled" | "failed";

export type ErrorCode =
  | "bad-request"
  | "invalid-url"
  | "not-found"
  | "timeout"
  | "tab-failed"
  | "internal"
  /** The site has the page but not this track (removed, or not available in the user's country). */
  | "unavailable"
  /** The site is asking for a captcha or limiting requests: reading stops until the user has looked. */
  | "blocked";

export interface AppError {
  code: ErrorCode;
  message: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

/** Messages the background worker sends to a provider's content script; the prefix is the provider's id. */
export type ContentRequest =
  | { type: "apple/detect"; url: string }
  | { type: "apple/scrape"; url: string; trackTitle: string }
  /** Read the song rows of an Apple Music search page (`url` is that page's address). */
  | { type: "apple/search"; url: string }
  | { type: "spotify/detect"; url: string }
  | { type: "spotify/scrape"; url: string; trackTitle: string }
  /** Read the rows of a Spotify search page (`url` is that page's address): the songs it lists, for an exact match. */
  | { type: "spotify/search"; url: string };

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
  /** Find this track's song on Genius and open its Edit Metadata form; nothing is typed or saved. */
  | { type: "genius-open"; title: string; artist: string; tabId?: number; pageUrl?: string }
  /** The Apple Music and Spotify pages of the song on the Genius page in this tab (a read of that page, no credits). */
  | { type: "song-matches"; tabId: number }
  | PasteCommand;

/** How "Open on Genius" ended; only "opened" lets anything else go on. */
export type GeniusOpenStatus =
  /** The matching song's edit form is open. */
  | "opened"
  /** Genius has no song with exactly this title and artist (or its search did not show it). */
  | "none"
  /** More than one song matches exactly: the user chooses, nothing is picked for them. */
  | "several"
  /** The song page showed no Edit Metadata button, which is what a signed-out visitor sees. */
  | "sign-in"
  /** The song page opened but its form did not. */
  | "no-form"
  /** Genius could not be asked, or its page did not load. */
  | "failed"
  /** A paste is running: nothing is navigated meanwhile. */
  | "busy";

export interface GeniusSongLink {
  title: string;
  artists: string[];
  /** Always a genius.com song page the worker built itself. */
  url: string;
}

export interface GeniusOpenAnswer {
  status: GeniusOpenStatus;
  /** The matched song, for "opened", "sign-in" and "no-form". */
  song?: GeniusSongLink;
  /** Every exact candidate, for "several". */
  songs?: GeniusSongLink[];
}

/** What a Genius song page says about its own song (see genius/songState.ts). The ids are checked for their shape. */
export interface GeniusSongInfo {
  /** The song page's path, "/Artist-title-lyrics". */
  path: string;
  title: string;
  /** The artists in the page's header, one name each ("Tyler, The Creator" is one name). */
  primary: string[];
  /** The "Featuring" credit, one name each. */
  featured: string[];
  /** Apple Music's catalogue id of the song ("" when the page has none). */
  appleId: string;
  /** Spotify's track id ("" when the page has none). */
  spotifyId: string;
}

/** What a Genius album page says about its album (see genius/albumState.ts). It carries no Apple Music or Spotify id. */
export interface GeniusAlbumInfo {
  /** The album page's path, "/albums/<artist>/<album>". */
  path: string;
  title: string;
  /** The album's artists, one name each ("Various Artists" is one name). */
  primary: string[];
  /** The release year, "" when the page has none. */
  year: string;
  /** How many tracks the page's tracklist lists, 0 when it lists none. */
  tracks: number;
  /** Genius's own type of release ("album", "single", "compilation", "soundtrack"...), "" when the page gives none. */
  type: string;
}

/** Where a listed page came from: the Genius page's own ids, or an exact-match search. */
export type MatchSource = "genius" | "search";

/** How one service's page for the Genius song turned out. */
export type FoundMatch = {
  status: "found";
  /** An address the worker built itself from an id or a result, never one taken from a page's text. */
  url: string;
  /** "Artist - Title", as the open-pages list names a page. */
  name: string;
  /** The release the page is on ("Fortnight - Single", "SOUR"), or for an album its year and size; "" when not known. */
  release: string;
  source: MatchSource;
};

export type ServiceMatch =
  | FoundMatch
  /** Several albums are exactly the Genius album as far as the service says (a reissue, a twin): all are listed. */
  | { status: "several"; matches: FoundMatch[] }
  /** The service has no page for this song that is exactly it: never a guess. */
  | { status: "none" }
  /** The look-up could not be done (the service did not answer, or asked for a captcha). */
  | { status: "failed"; message: string };

/** The worker's answer to `song-matches`. */
export type SongMatchesAnswer =
  /** The tab is not a Genius song or album page the extension can read. */
  | { status: "not-song" }
  | {
      status: "ready";
      /** What the page is: a song (its ids and a search) or an album (a search only). */
      kind: "song" | "album";
      /** The song page's path: what the answer belongs to. */
      path: string;
      title: string;
      artists: string[];
      apple: ServiceMatch;
      spotify: ServiceMatch;
    };

/** What the worker asks of a Spotify search page. */
export interface SearchRow {
  title: string;
  artists: string[];
  album: string;
  /** The address on Spotify, "https://open.spotify.com/track/<id>" (or "/album/<id>" on the albums tab). */
  href: string;
  /** Albums tab only: the release year, "" when the card shows none. */
  year?: string;
}

/** What the Genius page says after being asked to open the edit form. */
export type OpenEditState = "opened" | "already-open" | "no-button" | "no-form";

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
  | { action: "await"; item: [string, string]; position: number; paceMs?: number; role?: string }
  | {
      action: "fill";
      item: [string, string];
      position: number;
      autoConfirm: boolean;
      /** How long suggestions must hold still before they are trusted. */
      settleMs: number;
      /** The pause an automatic run makes after each field; absent for a key press. */
      paceMs?: number;
      /** For an artist or label step: the additional role it goes under. */
      role?: string;
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
  /** Open the song's Edit Metadata form (press that one button); the page answers with an `OpenEditState`. */
  | { type: "genius/open-edit" }
  /** What the song page says about its song; the page answers with a `GeniusSongInfo`, or null when it is not one. */
  | { type: "genius/song-info" }
  /** What the album page says about its album; the page answers with a `GeniusAlbumInfo`, or null when it is not one. */
  | { type: "genius/album-info" }
  /** The paste session started or ended, so the page knows whether the hotkeys are live. */
  | { type: "genius/paste-active"; active: boolean }
  /** An automatic run started, paused, resumed or ended, so the page loop knows whether to go on. */
  | { type: "genius/auto-state"; auto: AutoMode }
  /** A step was skipped: whatever was typed for it and not chosen has to go from the field. */
  | { type: "genius/clear"; item: [string, string]; role?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasUrl(value: Record<string, unknown>): boolean {
  return typeof value["url"] === "string";
}

export function isContentRequest(value: unknown): value is ContentRequest {
  if (!isRecord(value) || !hasUrl(value)) return false;
  if (
    value["type"] === "apple/detect" ||
    value["type"] === "apple/search" ||
    value["type"] === "spotify/detect" ||
    value["type"] === "spotify/search"
  ) {
    return true;
  }
  return (
    (value["type"] === "apple/scrape" || value["type"] === "spotify/scrape") && typeof value["trackTitle"] === "string"
  );
}

const PASTE_COMMANDS: ReadonlySet<unknown> = new Set([
  "paste-back",
  "paste-skip",
  "paste-stop",
  "paste-fill",
  "paste-auto-start",
  "paste-auto-pause",
]);
/** Longest title or artist the worker will search for. */
const MAX_TEXT = 500;
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
  if (value["type"] === "genius-open") {
    return (
      typeof value["title"] === "string" &&
      typeof value["artist"] === "string" &&
      value["title"].length <= MAX_TEXT &&
      value["artist"].length <= MAX_TEXT &&
      (value["tabId"] === undefined || Number.isInteger(value["tabId"])) &&
      (value["pageUrl"] === undefined || (typeof value["pageUrl"] === "string" && value["pageUrl"].length <= 300))
    );
  }
  if (value["type"] === "song-matches") return Number.isInteger(value["tabId"]);
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
      (value["paceMs"] === undefined || typeof value["paceMs"] === "number") &&
      (value["role"] === undefined || typeof value["role"] === "string")
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
    (value["paceMs"] === undefined || typeof value["paceMs"] === "number") &&
    (value["role"] === undefined || typeof value["role"] === "string")
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
  if (
    value["type"] === "genius/fill-now" ||
    value["type"] === "genius/open-edit" ||
    value["type"] === "genius/song-info" ||
    value["type"] === "genius/album-info"
  ) {
    return true;
  }
  if (value["type"] === "genius/auto-state") return AUTO_MODES.has(value["auto"]);
  if (value["type"] === "genius/clear") {
    return isPair(value["item"]) && (value["role"] === undefined || typeof value["role"] === "string");
  }
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
    typeof value["coverArtUrl"] === "string" &&
    typeof value["releaseDate"] === "string" &&
    (value["note"] === undefined || typeof value["note"] === "string")
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
    typeof value["releaseDate"] === "string" &&
    isStringArray(value["warnings"]) &&
    (value["notes"] === undefined || isStringArray(value["notes"]))
  );
}

export function isYoutubeAnswer(value: unknown): value is YoutubeAnswer {
  return (
    isRecord(value) &&
    typeof value["url"] === "string" &&
    typeof value["isMusicVideo"] === "boolean" &&
    (value["kind"] === undefined || VIDEO_KINDS.includes(value["kind"] as VideoKind)) &&
    typeof value["throttled"] === "boolean" &&
    ["", "key", "quota", "not-enabled"].includes(value["keyProblem"] as string)
  );
}

export function isKeyCheck(value: unknown): value is KeyCheck {
  return typeof value === "string" && ["ok", "key", "quota", "not-enabled", "failed"].includes(value);
}

const OPEN_STATUSES: ReadonlySet<unknown> = new Set([
  "opened",
  "none",
  "several",
  "sign-in",
  "no-form",
  "failed",
  "busy",
]);
const OPEN_EDIT_STATES: ReadonlySet<unknown> = new Set(["opened", "already-open", "no-button", "no-form"]);

function isSongLink(value: unknown): value is GeniusSongLink {
  return (
    isRecord(value) &&
    typeof value["title"] === "string" &&
    isStringArray(value["artists"]) &&
    typeof value["url"] === "string" &&
    value["url"].startsWith("https://genius.com/")
  );
}

export function isGeniusOpenAnswer(value: unknown): value is GeniusOpenAnswer {
  return (
    isRecord(value) &&
    OPEN_STATUSES.has(value["status"]) &&
    (value["song"] === undefined || isSongLink(value["song"])) &&
    (value["songs"] === undefined || (Array.isArray(value["songs"]) && value["songs"].every(isSongLink)))
  );
}

export function isOpenEditState(value: unknown): value is OpenEditState {
  return OPEN_EDIT_STATES.has(value);
}

export function isGeniusSongInfo(value: unknown): value is GeniusSongInfo {
  return (
    isRecord(value) &&
    typeof value["path"] === "string" &&
    typeof value["title"] === "string" &&
    isStringArray(value["primary"]) &&
    isStringArray(value["featured"]) &&
    typeof value["appleId"] === "string" &&
    typeof value["spotifyId"] === "string"
  );
}

export function isGeniusAlbumInfo(value: unknown): value is GeniusAlbumInfo {
  return (
    isRecord(value) &&
    typeof value["path"] === "string" &&
    typeof value["title"] === "string" &&
    isStringArray(value["primary"]) &&
    typeof value["year"] === "string" &&
    typeof value["tracks"] === "number" &&
    typeof value["type"] === "string"
  );
}

function isServiceMatch(value: unknown): value is ServiceMatch {
  if (!isRecord(value)) return false;
  if (value["status"] === "none") return true;
  if (value["status"] === "failed") return typeof value["message"] === "string";
  if (value["status"] === "several") {
    return Array.isArray(value["matches"]) && value["matches"].length > 1 && value["matches"].every(isFoundMatch);
  }
  return isFoundMatch(value);
}

function isFoundMatch(value: unknown): value is FoundMatch {
  return (
    isRecord(value) &&
    value["status"] === "found" &&
    typeof value["url"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["release"] === "string" &&
    (value["source"] === "genius" || value["source"] === "search")
  );
}

export function isSongMatchesAnswer(value: unknown): value is SongMatchesAnswer {
  if (!isRecord(value)) return false;
  if (value["status"] === "not-song") return true;
  return (
    value["status"] === "ready" &&
    (value["kind"] === "song" || value["kind"] === "album") &&
    typeof value["path"] === "string" &&
    typeof value["title"] === "string" &&
    isStringArray(value["artists"]) &&
    isServiceMatch(value["apple"]) &&
    isServiceMatch(value["spotify"])
  );
}

export function isSearchRows(value: unknown): value is SearchRow[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        isRecord(row) &&
        typeof row["title"] === "string" &&
        isStringArray(row["artists"]) &&
        typeof row["album"] === "string" &&
        typeof row["href"] === "string" &&
        (row["year"] === undefined || typeof row["year"] === "string"),
    )
  );
}
