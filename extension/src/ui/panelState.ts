// The panel's state, the environment it runs in and the fixed texts it shows.
import { type AppleTabEntry, type OpenTab } from "../core/appleTabs";
import { type SongCredits } from "../core/models";
import { type PasteState } from "../core/paste";
import {
  type AlbumInfo,
  type AppError,
  type GeniusOpenStatus,
  type GeniusSongLink,
  type KeyCheck,
  type PageScrape,
} from "../shared/messages";
import { type Session, type TrackResult } from "../shared/session";
import { type Settings } from "../shared/settings";
import { type KeyValueStore, type Stores } from "../shared/storage";
import { BRIDGE_PORTS } from "../shared/bridge";
import { type WorkerApi } from "./api";
import { type OptionalHost } from "../lookups/http";

export interface ActiveTab {
  tabId: number;
  url: string;
}

/** The optional hosts' permissions, as Chrome has them: the permission is the setting, so nothing is stored twice. */
export interface HostPermissions {
  granted(): Promise<Record<OptionalHost, boolean>>;
  /** Ask Chrome. Must be called straight from the user's click: Chrome refuses it after any wait. */
  request(host: OptionalHost): Promise<boolean>;
  remove(host: OptionalHost): Promise<boolean>;
  /** Called whenever any permission is added or removed, including from chrome://extensions. */
  subscribe(listener: () => void): void;
}

/** The steps of the first-time set-up: welcome, what to paste, speed, look-ups, summary. */
export const SETUP_STEPS = 5;

/** How often the Desktop app card re-asks the worker while Settings is open. */
export const BRIDGE_POLL_MS = 2500;

const PORT_RANGE = `${String(BRIDGE_PORTS[0])}-${String(BRIDGE_PORTS[BRIDGE_PORTS.length - 1])}`;

export const BRIDGE_MESSAGES = {
  empty: "Type the code the desktop app shows. It looks like ABCD-EFGH.",
  badShape: "That is not a pairing code. It looks like ABCD-EFGH: eight letters and digits, and no 0, 1, I, L or O.",
  paired: "Paired. The desktop app can now send credits to this panel.",
  unpaired: "Unpaired. The desktop app can no longer reach this browser. You can pair again with a new code.",
  notAccepted: `The desktop app did not accept the code. Check that: the desktop app is open and showing a pairing code (it listens on ports ${PORT_RANGE} of this computer); the code is the one on screen now (a code expires after a short time and works once); and you have not typed it wrongly 5 times (then the app locks that code, so show a new code in the desktop app and try again).`,
} as const;

export interface Env {
  api: WorkerApi;
  hosts: HostPermissions;
  stores: Stores;
  /** Where the user's YouTube key is kept: this browser only, never synced. */
  secrets: KeyValueStore;
  /** The tab the user is looking at, or null when there is none to read. */
  activeTab(): Promise<ActiveTab | null>;
  /** Every tab of the browser that shows Apple Music, in the browser's order, with the one in view marked. */
  appleTabs(): Promise<OpenTab[]>;
}

/** How "Open on Genius" stands for one track; "idle" until it is pressed. The statuses are the worker's answers. */
export type GeniusPhase = "idle" | "working" | GeniusOpenStatus;

export interface GeniusOpenState {
  /** The track it is about; the notice shows only while that track is the one on screen. */
  index: number | null;
  phase: GeniusPhase;
  /** The track's title as the messages name it. */
  title: string;
  /** The matched song, when the worker found one. */
  song: GeniusSongLink | null;
  /** Every exact candidate, for "several". */
  songs: GeniusSongLink[];
}

export const NO_GENIUS: GeniusOpenState = { index: null, phase: "idle", title: "", song: null, songs: [] };

export interface PanelState {
  session: Session;
  settings: Settings;
  settingsOpen: boolean;
  /** The first-time set-up: whether it is showing (it opens by itself until finished or skipped) and which step. */
  setup: { open: boolean; step: number };
  /** The paste session, as the worker stores it. */
  paste: PasteState;
  /** Which track is being pasted (null when unknown, for example after a restart with no match). */
  pasteIndex: number | null;
  /** Which optional hosts the user has granted, as Chrome reports it. */
  hosts: Record<OptionalHost, boolean>;
  /** The user's own YouTube key: whether one is saved (never the key itself), and how the last attempt went. */
  youtubeKey: { saved: boolean; message: string; tone: "" | "ok" | "error"; busy: boolean };
  /** The link to the desktop app: how it stands, and how the last pair or unpair attempt went. */
  bridge: {
    known: boolean;
    paired: boolean;
    connected: boolean;
    busy: boolean;
    message: string;
    tone: "" | "ok" | "error";
  };
  /** Opening the current track's song on Genius. */
  genius: GeniusOpenState;
  /** What became of each track's YouTube look-up, shown in its credits so a missing link is never a mystery. */
  youtubeNotes: Record<number, string>;
  /** What was wrong with the YouTube link the user last pasted, or "". */
  youtubeLinkError: string;
  /** Seconds left before the finished screen returns to the main menu, or null when no countdown runs. */
  doneCountdown: number | null;
  /** Seconds left before the finished screen starts the next track by itself, or null when no countdown runs. */
  nextCountdown: number | null;
  /** Counts every error shown, so the same message appearing again (a repeated attempt) can still be told apart. */
  errorSeq: number;
  /** What the panel is waiting for; the buttons that would start another job are disabled meanwhile. */
  busy: "detect" | "scrape" | null;
  /** A problem the user has to act on; announced assertively. */
  error: string;
  /** Progress and results; announced politely. */
  status: string;
  /** The Apple Music page the user is on, offered as the default link ("" when there is none). */
  pageUrl: string;
  /** The album and song pages already open in the browser, offered on the link screen; the page in view first. */
  appleTabs: AppleTabEntry[];
}

export const MESSAGES = {
  invalidLink: "That is not an Apple Music album or song link.",
  noTracks: "Pick at least one track.",
  noPage: "Apple Music has no page for this track, so its credits cannot be read.",
  lookingForYoutube: "Looking for the YouTube link…",
  lookingForYoutubeShort: "Looking for it…",
  noYoutubeShort: "No link found for this track.",
  youtubeFailedShort: "The look-up did not finish.",
  youtubeNotChecked: "Not checked: YouTube is limiting requests. Open this track to try again.",
  noYoutube: "No YouTube link was found for this track.",
  youtubeThrottled: "YouTube is limiting requests right now, so this track has no YouTube link. Try again in a minute.",
  notAYoutubeLink:
    "That is not a link to one YouTube video. Open the video on YouTube and copy the address from the address bar, or use its Share button.",
  pasteYoutubeLink: "Paste the YouTube link into the box first.",
  workerOutOfDate:
    "The extension's background part is older than this panel, so it does not know that command. Open chrome://extensions, press Reload on Géniescraper, then try again. Step by step still works.",
  allDone: "All credits entered. Check the Genius page, then press Save there.",
} as const;

/** What to tell the user about a failure; the codes are stable, the wording is for people. */
export function describeError(error: AppError): string {
  switch (error.code) {
    case "invalid-url":
      return MESSAGES.invalidLink;
    case "not-found":
      return "Apple Music could not find that page. Check the link and try again.";
    case "timeout":
      return "Apple Music took too long to respond. Try again.";
    case "tab-failed":
      return `Could not read the page: ${error.message}`;
    case "bad-request":
    case "internal":
      return `Something went wrong while reading the page: ${error.message}`;
  }
}

/** The song the extension holds for a track: the page's credits, with the album's copyright lines added. */
export function buildSong(album: AlbumInfo, result: Pick<TrackResult, "url">, scrape: PageScrape): SongCredits {
  return {
    title: scrape.title,
    artist: scrape.artist,
    appleMusicUrl: result.url,
    credits: scrape.credits,
    // Song pages carry no ℗/© footer, so these come from the album page read at detection time.
    phonographicCopyright: album.phonographicCopyright,
    copyrightNotice: album.copyrightNotice,
    // The album's cover comes from Apple's catalog lookup, which is exact; the song page header is only a fallback.
    coverArtUrl: album.coverArtUrl || scrape.coverArtUrl,
    youtubeUrl: "",
    youtubeIsMv: false,
    // The song page names the song's own date; the album's footer is the fallback.
    releaseDate: scrape.releaseDate || album.releaseDate,
  };
}

/** How long the lookups rest before a track YouTube refused is asked about again, and how many times that happens. */
export const YOUTUBE_RETRY_MS = 45_000;
export const YOUTUBE_RETRY_LIMIT = 3;

/** The longest Start pasting waits for a YouTube link before starting without it. */
export const YOUTUBE_WAIT_MS = 8000;

export const NO_HOSTS: Record<OptionalHost, boolean> = { deezer: false, youtube: false, youtubeApi: false };

/** What the user is told when their YouTube key cannot be used, in their terms. */
export const KEY_MESSAGES = {
  key: "Google did not accept your YouTube key, so the free search is used instead. Check the key in Settings.",
  quota:
    "Your free YouTube allowance for today is used up (it resets at midnight, Pacific time), so the free search is used instead.",
  "not-enabled":
    "Your key works, but the YouTube Data API is not switched on for it. Follow step 2 in Settings and press Enable.",
} as const;

export const KEY_CHECK_MESSAGES: Record<KeyCheck, string> = {
  ok: "Key saved and working. YouTube links will now come from Google's official service.",
  key: "Google did not accept this key. Copy it again from the Credentials page, or create a new one. Nothing was saved.",
  quota:
    "Key saved. Your free YouTube allowance for today is used up, so it will start working after midnight (Pacific time).",
  "not-enabled":
    "Key saved, but the YouTube Data API is not switched on yet. Follow step 2 below and press Enable; it works a minute after that.",
  failed:
    "Could not reach Google to check the key. Check your internet connection and press Save again. Nothing was saved.",
};

export const isFinished = (paste: PasteState): boolean =>
  paste.active && paste.queue.length > 0 && paste.position >= paste.queue.length;
