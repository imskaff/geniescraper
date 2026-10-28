// The panel's behaviour: one object holds the state, the actions change it, and the view only renders it.
// Everything that touches the outside (the worker, storage, the browser's tabs) is injected, so the whole flow
// runs in tests with fakes.
import { parseAppleMusicUrl } from "../apple/url";
import { geniusRole } from "../core/geniusRoles";
import { typedQueue, type QueueItem, type SongCredits } from "../core/models";
import type { PasteCommand } from "../shared/messages";
import { IDLE_PASTE, type PasteState } from "../core/paste";
import type { AlbumInfo, AppError, PageScrape } from "../shared/messages";
import { EMPTY_SESSION, type Session, type TrackResult } from "../shared/session";
import { normaliseSettings, queueOptions, type PasteMode, type Settings } from "../shared/settings";
import {
  loadPaste,
  loadSession,
  loadSettings,
  saveSession,
  saveSettings,
  type KeyValueStore,
  type Stores,
} from "../shared/storage";
import type { WorkerApi } from "./api";
import type { OptionalHost } from "../lookups/http";
import { parseYoutubeLink } from "../core/youtubeLink";
import { cleanKey, loadYoutubeKey, looksLikeApiKey, saveYoutubeKey } from "../shared/secrets";
import type { KeyCheck } from "../shared/messages";

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

export interface Env {
  api: WorkerApi;
  hosts: HostPermissions;
  stores: Stores;
  /** Where the user's YouTube key is kept: this browser only, never synced. */
  secrets: KeyValueStore;
  /** The tab the user is looking at, or null when there is none to read. */
  activeTab(): Promise<ActiveTab | null>;
}

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
  };
}

/** The longest Start pasting waits for a YouTube link before starting without it. */
export const YOUTUBE_WAIT_MS = 8000;

const NO_HOSTS: Record<OptionalHost, boolean> = { deezer: false, youtube: false, youtubeApi: false };

/** What the user is told when their YouTube key cannot be used, in their terms. */
const KEY_MESSAGES = {
  key: "Google did not accept your YouTube key, so the free search is used instead. Check the key in Settings.",
  quota:
    "Your free YouTube allowance for today is used up (it resets at midnight, Pacific time), so the free search is used instead.",
  "not-enabled":
    "Your key works, but the YouTube Data API is not switched on for it. Follow step 2 in Settings and press Enable.",
} as const;

const KEY_CHECK_MESSAGES: Record<KeyCheck, string> = {
  ok: "Key saved and working. YouTube links will now come from Google's official service.",
  key: "Google did not accept this key. Copy it again from the Credentials page, or create a new one. Nothing was saved.",
  quota:
    "Key saved. Your free YouTube allowance for today is used up, so it will start working after midnight (Pacific time).",
  "not-enabled":
    "Key saved, but the YouTube Data API is not switched on yet. Follow step 2 below and press Enable; it works a minute after that.",
  failed:
    "Could not reach Google to check the key. Check your internet connection and press Save again. Nothing was saved.",
};

const isFinished = (paste: PasteState): boolean =>
  paste.active && paste.queue.length > 0 && paste.position >= paste.queue.length;

type Listener = () => void;

export class PanelController {
  private current: PanelState;
  private readonly listeners = new Set<Listener>();
  /** Bumped whenever a scrape run is stopped or replaced, so a late answer from the old run is dropped. */
  private run = 0;

  constructor(
    private readonly env: Env,
    settings: Settings,
    session: Session,
    pageUrl: string,
    paste: PasteState = { ...IDLE_PASTE },
    hosts: Record<OptionalHost, boolean> = { ...NO_HOSTS },
    keySaved = false,
  ) {
    const pasteIndex = paste.active
      ? (session.results.find((r) => (r.song?.title || r.title) === paste.title)?.index ?? null)
      : null;
    this.current = {
      session,
      settings,
      paste,
      pasteIndex,
      hosts,
      youtubeKey: { saved: keySaved, message: "", tone: "", busy: false },
      youtubeNotes: {},
      youtubeLinkError: "",
      doneCountdown: null,
      nextCountdown: null,
      errorSeq: 0,
      settingsOpen: false,
      setup: { open: !settings.onboarded, step: 0 },
      busy: null,
      error: "",
      status: "",
      pageUrl,
    };
  }

  /** Load settings, the stored session and the active tab, and build the controller from them. */
  static async create(env: Env): Promise<PanelController> {
    const [settings, session, paste, tab, hosts, key] = await Promise.all([
      loadSettings(env.stores),
      loadSession(env.stores),
      loadPaste(env.stores),
      env.activeTab().catch(() => null),
      env.hosts.granted().catch(() => ({ ...NO_HOSTS })),
      loadYoutubeKey(env.secrets),
    ]);
    const pageUrl = tab && parseAppleMusicUrl(tab.url) ? tab.url : "";
    const controller = new PanelController(env, settings, session, pageUrl, paste, hosts, key !== "");
    // A permission taken back in chrome://extensions, or granted elsewhere, changes the Settings box at once.
    env.hosts.subscribe(() => void controller.refreshHosts());
    // Tracks that were mid-read when the panel closed were restored as pending: carry on with them.
    if (session.screen === "review" && session.results.some((r) => r.status === "pending")) {
      void controller.scrapePending();
    }
    return controller;
  }

  get state(): PanelState {
    return this.current;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(patch: Partial<PanelState>): void {
    const errorSeq = patch.error ? this.current.errorSeq + 1 : this.current.errorSeq;
    this.current = { ...this.current, ...patch, errorSeq };
    for (const listener of this.listeners) listener();
  }

  private async updateSession(patch: Partial<Session>): Promise<void> {
    const session = { ...this.current.session, ...patch };
    this.update({ session });
    try {
      await saveSession(this.env.stores, session);
    } catch {
      // A full or unavailable store must not break the panel; the session simply is not kept.
    }
  }

  /** Read the permissions again from Chrome, the only place that knows them. */
  async refreshHosts(): Promise<void> {
    const hosts = await this.env.hosts.granted().catch(() => this.current.hosts);
    const now = this.current.hosts;
    if (hosts.deezer !== now.deezer || hosts.youtube !== now.youtube || hosts.youtubeApi !== now.youtubeApi) {
      this.update({ hosts });
    }
  }

  /**
   * Turn an optional host on or off. The request to Chrome is the first thing done, before any wait, because Chrome
   * only shows its prompt for a call made straight from the user's click. A refusal leaves the host off.
   */
  async setHost(host: OptionalHost, on: boolean): Promise<void> {
    const asked = on ? this.env.hosts.request(host) : this.env.hosts.remove(host);
    let problem = "";
    let ok = false;
    try {
      ok = await asked;
    } catch (error) {
      // Typically a manifest that was not reloaded: Chrome rejects a host the loaded manifest does not list.
      const reason = error instanceof Error ? error.message : "";
      problem = `Chrome refused the permission request${reason ? ` (${reason})` : ""}. If you just updated the extension, reload it in chrome://extensions and try again.`;
    }
    if (on && !ok && !problem) problem = "Chrome did not grant access, so that look-up stays off.";
    await this.refreshHosts();
    // Redraw even when nothing changed, so a box the user ticked and Chrome refused goes back to unticked.
    this.update({ hosts: { ...this.current.hosts }, error: problem });
  }

  // ── the user's own YouTube key ──────────────────────────────────────

  /** The key that last checked out as saved and working. Kept here, never in the state the view renders from. */
  private workingKey = "";

  /** True when this text is the key already saved and working, so pressing Save again would change nothing. */
  keyIsCurrent(raw: string): boolean {
    return this.workingKey !== "" && cleanKey(raw) === this.workingKey;
  }

  private setKeyState(patch: Partial<PanelState["youtubeKey"]>): void {
    this.update({ youtubeKey: { ...this.current.youtubeKey, ...patch } });
  }

  /**
   * Check and keep a YouTube key. Chrome's permission prompt for Google's service needs the user's click, so it is asked
   * for first, before any wait (once the key has the right shape, which costs no request).
   */
  async saveYoutubeKey(raw: string): Promise<void> {
    const key = cleanKey(raw);
    if (this.current.youtubeKey.busy) return;
    if (!looksLikeApiKey(key)) {
      this.setKeyState({
        message: key
          ? "That does not look like a YouTube key. A key starts with AIza and is 39 letters, digits, dashes and underscores long. Copy it again from Google's page, using its copy button."
          : "Paste your key into the box first.",
        tone: "error",
      });
      return;
    }
    const asked = this.env.hosts.request("youtubeApi");
    this.setKeyState({ busy: true, message: "Checking your key with Google…", tone: "" });
    const granted = await asked.catch(() => false);
    await this.refreshHosts();
    if (!granted) {
      this.setKeyState({
        busy: false,
        tone: "error",
        message:
          "Chrome needs your OK before the extension can talk to Google's YouTube service. Press Save again and choose Allow.",
      });
      return;
    }
    const answer = await this.env.api.checkYoutubeKey(key);
    const outcome: KeyCheck = answer.ok ? answer.data : "failed";
    if (outcome === "ok" || outcome === "quota" || outcome === "not-enabled") {
      // A key that is right but not usable yet (service not switched on, allowance used up today) is still kept:
      // the user has done their part, and it starts working by itself.
      await saveYoutubeKey(this.env.secrets, key).catch(() => undefined);
    }
    const kept = outcome === "ok" || outcome === "quota" || outcome === "not-enabled";
    this.workingKey = outcome === "ok" ? key : "";
    this.setKeyState({
      saved: kept ? true : this.current.youtubeKey.saved,
      busy: false,
      message: KEY_CHECK_MESSAGES[outcome],
      // Only a key that is saved and working is a success; one kept for later (quota, service off) still needs action.
      tone: outcome === "ok" ? "ok" : "error",
    });
  }

  /** Show a message under the key box (the view uses it for things only it can know, such as a refused clipboard). */
  noteKeyMessage(message: string): void {
    this.setKeyState({ message, tone: "error" });
  }

  /** Forget the key and take back the permission for Google's service. */
  async removeYoutubeKey(): Promise<void> {
    await saveYoutubeKey(this.env.secrets, "").catch(() => undefined);
    this.workingKey = "";
    this.setKeyState({ saved: false, message: "Your key was removed from this browser.", tone: "" });
    await this.env.hosts.remove("youtubeApi").catch(() => false);
    await this.refreshHosts();
  }

  /** Re-read which Apple Music page the user is on, after they switch tabs or navigate. */
  async refreshPage(): Promise<void> {
    const tab = await this.env.activeTab().catch(() => null);
    const pageUrl = tab && parseAppleMusicUrl(tab.url) ? tab.url : "";
    if (pageUrl !== this.current.pageUrl) this.update({ pageUrl });
  }

  // ── link ────────────────────────────────────────────────────────────

  /** Read the album or song behind `rawUrl` and move to the track list. */
  async detect(rawUrl: string): Promise<void> {
    const url = rawUrl.trim();
    if (!parseAppleMusicUrl(url)) {
      this.update({ error: MESSAGES.invalidLink, status: "" });
      return;
    }
    this.run++;
    this.update({ busy: "detect", error: "", status: "Reading the page…" });
    const tab = await this.env.activeTab().catch(() => null);
    // The user's own tab is read in place when it shows this page: nothing opens, nothing flashes.
    const result = await this.env.api.detect(url, tab?.url === url ? tab.tabId : undefined);
    if (!result.ok) {
      this.update({ busy: null, error: describeError(result.error), status: "" });
      return;
    }
    const album = result.data;
    const available = album.trackUrls.map((link, index) => (link ? index : -1)).filter((index) => index >= 0);
    // Nothing is picked for the user on an album, so a click is always a choice. A single track has nothing to
    // choose from and goes straight on.
    const onlyTrack = album.trackCount === 1 && available.length === 1;
    await this.updateSession({
      screen: "tracks",
      album,
      selected: onlyTrack ? available : [],
      results: [],
      current: null,
    });
    // The track list names the album and its track count itself, and its heading takes focus, so nothing is announced twice.
    this.update({ busy: null, status: "" });
    // One track has nothing to choose from.
    if (onlyTrack) await this.getCredits();
    else if (available.length === 0) this.update({ error: MESSAGES.noPage });
  }

  // ── tracks ──────────────────────────────────────────────────────────

  async setTrackSelected(index: number, on: boolean): Promise<void> {
    const { album, selected } = this.current.session;
    if (!album?.trackUrls[index]) return;
    const next = on ? [...new Set([...selected, index])].sort((a, b) => a - b) : selected.filter((i) => i !== index);
    await this.updateSession({ selected: next });
  }

  async setAllSelected(on: boolean): Promise<void> {
    const { album } = this.current.session;
    if (!album) return;
    const available = album.trackUrls.map((link, index) => (link ? index : -1)).filter((index) => index >= 0);
    await this.updateSession({ selected: on ? available : [] });
  }

  /** Read the credits of every picked track, as many at once as the settings allow, showing each as it arrives. */
  async getCredits(): Promise<void> {
    const { album, selected } = this.current.session;
    if (!album || this.current.busy) return;
    if (selected.length === 0) {
      this.update({ error: MESSAGES.noTracks });
      return;
    }
    // Track numbers belong to this album: what was asked about another album's tracks must not carry over.
    this.forgetYoutube();
    this.pasted.clear();
    const results: TrackResult[] = selected.map((index) => ({
      index,
      title: album.trackTitles[index] ?? "",
      url: album.trackUrls[index] ?? "",
      status: "pending",
      song: null,
      error: "",
    }));
    this.update({ error: "" });
    await this.updateSession({ screen: "review", results, current: null });
    await this.scrapePending();
  }

  // ── review ──────────────────────────────────────────────────────────

  private async scrapePending(): Promise<void> {
    const myRun = ++this.run;
    this.update({ busy: "scrape", error: "" });
    const readers = this.current.settings.parallelReads || Number.POSITIVE_INFINITY;
    const count = Math.min(readers, this.current.session.results.length);
    // Each reader claims the next pending track before it first waits, so no track is read twice.
    const reader = async (): Promise<void> => {
      for (;;) {
        const next = this.current.session.results.find((result) => result.status === "pending");
        if (!next || myRun !== this.run) return;
        const claimed = this.setResult(next.index, { status: "loading", error: "" });
        const answer = await this.env.api.scrapeTrack(next.url, next.title);
        await claimed;
        if (myRun !== this.run) return; // stopped or replaced while waiting: drop the late answer
        const album = this.current.session.album;
        if (answer.ok && album) {
          await this.setResult(next.index, { status: "done", song: buildSong(album, next, answer.data), error: "" });
          this.queueYoutube(next.index);
        } else if (!answer.ok) {
          await this.setResult(next.index, { status: "error", error: describeError(answer.error) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, count) }, reader));
    if (myRun !== this.run) return;
    const { results } = this.current.session;
    const done = results.filter((r) => r.status === "done").length;
    const failed = results.filter((r) => r.status === "error").length;
    const status =
      failed === 0
        ? `Got credits for ${String(done)} ${done === 1 ? "track" : "tracks"}.`
        : `Got credits for ${String(done)} of ${String(results.length)} tracks; ${String(failed)} failed.`;
    // A problem with the user's YouTube key found while reading stays on screen, not lost under the summary.
    this.update({ busy: null, status: this.keyNote ? `${status} ${this.keyNote}` : status });
  }

  private async setResult(index: number, patch: Partial<TrackResult>): Promise<void> {
    const results = this.current.session.results.map((r) => (r.index === index ? { ...r, ...patch } : r));
    await this.updateSession({ results });
  }

  /** Stop reading further tracks; whatever was read stays. */
  async stop(): Promise<void> {
    this.run++;
    const results = this.current.session.results.map((r) =>
      r.status === "loading" ? { ...r, status: "pending" as const } : r,
    );
    await this.updateSession({ results });
    this.update({ busy: null, status: "Stopped." });
  }

  async retry(index: number): Promise<void> {
    if (this.current.busy) return;
    await this.setResult(index, { status: "pending", error: "" });
    await this.scrapePending();
  }

  /** Open a track's credits, or close them when they are already open. */
  async showTrack(index: number): Promise<void> {
    this.update({ youtubeLinkError: "" });
    const closing = this.current.session.current === index;
    await this.updateSession({ current: closing ? null : index });
    // Opened credits get their link looked up now, as the user is about to look at (and maybe fix) it.
    if (!closing) void this.ensureYoutube(index);
  }

  /** The first track, in album order, whose credits are in and give something to paste; Start pasting begins here. */
  firstPastable(): number | null {
    return (
      this.current.session.results.find((r) => r.song !== null && this.queueFor(r.index).length > 0)?.index ?? null
    );
  }

  async backToTracks(): Promise<void> {
    await this.updateSession({ screen: "tracks" });
    this.update({ error: "" });
  }

  /** Start over with another link. */
  async newAlbum(): Promise<void> {
    this.run++;
    this.forgetYoutube();
    this.pasted.clear();
    await this.updateSession({ ...EMPTY_SESSION });
    this.update({ busy: null, error: "", status: "" });
  }

  /** The paste queue of one track under the current settings; empty until its credits are in. */
  queueFor(index: number): QueueItem[] {
    const song = this.current.session.results.find((r) => r.index === index)?.song;
    if (!song) return [];
    // Roles are shown, and pasted, under the names Genius uses ("Programming" is "Programmer" there).
    return typedQueue(song, queueOptions(this.current.settings)).map(([kind, value]): QueueItem =>
      kind === "role" ? [kind, geniusRole(value)] : [kind, value],
    );
  }

  // ── settings ────────────────────────────────────────────────────────

  openSettings(): void {
    // The last job's progress message means nothing on the settings screen.
    this.update({ settingsOpen: true, status: "" });
  }

  closeSettings(): void {
    this.update({ settingsOpen: false });
  }

  // ── the first-time set-up ───────────────────────────────────────────

  setupNext(): void {
    const step = Math.min(SETUP_STEPS - 1, this.current.setup.step + 1);
    this.update({ setup: { open: true, step }, status: "", error: "" });
  }

  setupBack(): void {
    const step = Math.max(0, this.current.setup.step - 1);
    this.update({ setup: { open: true, step }, status: "", error: "" });
  }

  /** Close the set-up for good, once its last step is reached; it does not show by itself again. */
  async finishSetup(): Promise<void> {
    this.update({ setup: { open: false, step: 0 }, status: "", error: "" });
    await this.setSetting("onboarded", true);
  }

  async setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
    const settings = { ...this.current.settings, [key]: value };
    // One key cannot do two jobs: choosing the other one's key swaps them instead of silently resetting both.
    if (key === "nextHotkey" && value === this.current.settings.backHotkey) {
      settings.backHotkey = this.current.settings.nextHotkey;
    } else if (key === "backHotkey" && value === this.current.settings.nextHotkey) {
      settings.nextHotkey = this.current.settings.backHotkey;
    }
    const normalised = normaliseSettings(settings);
    // A new choice of how Start pasting works applies at once, ahead of however the last track was started.
    if (key === "pasteMode") this.lastMode = null;
    this.update({ settings: normalised });
    // Each countdown stops when its own setting says so; the other one is none of this change's business.
    if (
      (!normalised.autoReturn && this.current.doneCountdown !== null) ||
      (normalised.nextTrackSeconds === 0 && this.current.nextCountdown !== null)
    )
      this.cancelCountdown();
    try {
      await saveSettings(this.env.stores, normalised);
    } catch {
      // Changed settings still apply for this session if they cannot be saved.
    }
  }

  // ── pasting ─────────────────────────────────────────────────────────

  /** The worker changed the paste session (a hotkey press on Genius, or one of our own commands). */
  setPaste(paste: PasteState): void {
    const wasFinished = isFinished(this.current.paste);
    this.applyPaste(paste);
    if (!isFinished(paste)) this.cancelCountdown();
    // Only the last track left to paste ends the work: while another has not been pasted the user must not be moved
    // away (leaving wipes the credits). When it is not known which track was pasted, nothing is assumed.
    else if (!wasFinished && this.current.settings.autoReturn && this.finishedLastTrack()) this.startCountdown();
    // Another track with credits is waiting: press its button for the user after a short pause, once, on arrival.
    else if (!wasFinished && this.current.settings.nextTrackSeconds > 0 && this.nextPastable() !== null)
      this.startNextCountdown();
  }

  /** Tracks the user has started pasting in this album, so 'last track' does not depend on the order they chose. */
  private readonly pasted = new Set<number>();

  /** True when the track just finished was the last one with anything left to paste, in whatever order. */
  private finishedLastTrack(): boolean {
    const { pasteIndex, session } = this.current;
    if (pasteIndex === null) return false;
    return !session.results.some(
      (r) =>
        r.song !== null && r.index !== pasteIndex && !this.pasted.has(r.index) && this.queueFor(r.index).length > 0,
    );
  }

  private applyPaste(paste: PasteState): void {
    // An attention message needs the user to act, so it is announced assertively; progress is announced politely.
    if (isFinished(paste)) {
      this.update({ paste, error: "", status: MESSAGES.allDone });
      return;
    }
    this.update(
      paste.active
        ? {
            paste,
            error: paste.tone === "attention" ? paste.message : "",
            // Progress and information (a pause says why and how to carry on) are announced politely.
            status: paste.tone === "attention" ? "" : paste.message,
          }
        : { paste },
    );
  }

  private async pasteCommand(command: PasteCommand): Promise<void> {
    const answer = await this.env.api.paste(command);
    if (answer.ok) this.setPaste(answer.data);
    else this.update({ error: describeError(answer.error), status: "" });
  }

  // ── the YouTube link, one track at a time ───────────────────────────

  /** Each track is asked about once per panel session; a track in the map has been, or is being, looked up. */
  private readonly youtubeLookups = new Map<number, Promise<void>>();
  /** The last thing found wrong with the user's YouTube key, shown after a read finishes. */
  private keyNote = "";

  /** Starts at 0 and moves on whenever the lookups are forgotten, so a queue from another album stops itself. */
  private youtubeEpoch = 0;
  /** The tracks waiting for their turn, one after another: Google blocks a burst of searches. */
  private youtubeChain: Promise<void> = Promise.resolve();
  /** Set when Google refused a lookup: the rest of the queue is not sent, so it does not make things worse. */
  private youtubePaused = false;

  /** Whether the YouTube step is on and there is a way to ask: YouTube's pages (its permission) or the user's key. */
  youtubeAskable(): boolean {
    const { hosts, youtubeKey, settings } = this.current;
    return settings.scrapeYoutube && (hosts.youtube || (youtubeKey.saved && hosts.youtubeApi));
  }

  /**
   * Look up this track's YouTube link if it needs one and the user has allowed it. The answer is kept on the track,
   * so it is not asked again. Opening a track and Start pasting call this straight away.
   */
  ensureYoutube(index: number, announce = false): Promise<void> {
    const known = this.youtubeLookups.get(index);
    if (known) return known;
    const result = this.current.session.results.find((r) => r.index === index);
    const song = result?.song;
    if (!result || !song || song.youtubeUrl || !this.youtubeAskable()) return Promise.resolve();
    const lookup = this.lookupYoutube(index, song, announce);
    this.youtubeLookups.set(index, lookup);
    return lookup;
  }

  /**
   * A track whose credits just arrived gets its link without the user having to open it, so the list never claims
   * "All found" for a track whose link was never asked for. With the user's key the worker spreads the asks itself;
   * with YouTube's pages they go one after another, and stop at the first refusal (opening a track tries again).
   */
  private queueYoutube(index: number): void {
    if (!this.youtubeAskable()) return;
    const { hosts, youtubeKey } = this.current;
    if (youtubeKey.saved && hosts.youtubeApi) {
      void this.ensureYoutube(index);
      return;
    }
    const epoch = this.youtubeEpoch;
    if (!this.youtubeLookups.has(index)) this.note(index, MESSAGES.lookingForYoutubeShort);
    this.youtubeChain = this.youtubeChain.then(async () => {
      if (epoch !== this.youtubeEpoch) return;
      if (this.youtubePaused) {
        this.note(index, MESSAGES.youtubeNotChecked);
        return;
      }
      await this.ensureYoutube(index);
      if (epoch !== this.youtubeEpoch) return;
      const song = this.current.session.results.find((r) => r.index === index)?.song;
      if (song?.youtubeUrl) this.note(index, "");
      // A refused or failed lookup is forgotten so it can be asked again; that is the sign to stop sending more.
      else if (song && !this.youtubeLookups.has(index)) this.youtubePaused = true;
    });
  }

  private forgetYoutube(): void {
    this.youtubeEpoch++;
    this.youtubePaused = false;
    this.youtubeLookups.clear();
    if (this.current.youtubeLinkError) this.update({ youtubeLinkError: "" });
    this.keyNote = "";
    if (Object.keys(this.current.youtubeNotes).length > 0) this.update({ youtubeNotes: {} });
  }

  private note(index: number, text: string): void {
    const others = Object.entries(this.current.youtubeNotes).filter(([key]) => Number(key) !== index);
    const notes: Record<number, string> = Object.fromEntries(others);
    if (text) notes[index] = text;
    this.update({ youtubeNotes: notes });
  }

  /**
   * `announce` puts the outcome on the status line, which is for what the user just asked for (Start pasting). A
   * look-up started by reading an album only writes the track's own note, so it never overwrites the read's summary or
   * names an arbitrary track.
   */
  private async lookupYoutube(index: number, song: SongCredits, announce: boolean): Promise<void> {
    const artist = song.artist || this.current.session.album?.artist || "";
    const title = song.title;
    if (!title || !artist) return;
    this.note(index, MESSAGES.lookingForYoutubeShort);
    if (announce) this.update({ status: MESSAGES.lookingForYoutube });
    const answer = await this.env.api.lookupYoutube(title, artist);
    const current = this.current.session.results.find((r) => r.index === index);
    // The panel may have moved on (another album, the main menu) while YouTube was being asked.
    if (current?.song?.title !== title) return;
    const keyMessage = answer.ok && answer.data.keyProblem ? KEY_MESSAGES[answer.data.keyProblem] : "";
    if (keyMessage) this.keyNote = keyMessage;
    if (answer.ok && answer.data.url) {
      await this.setResult(index, {
        song: { ...current.song, youtubeUrl: answer.data.url, youtubeIsMv: answer.data.isMusicVideo },
      });
      this.note(index, "");
      if (announce) this.update({ status: keyMessage });
      return;
    }
    // A failed lookup may be tried again later; a clean "nothing found" is not asked twice.
    const throttled = answer.ok && answer.data.throttled;
    if (!answer.ok || throttled) this.youtubeLookups.delete(index);
    const [note, status] = !answer.ok
      ? [MESSAGES.youtubeFailedShort, ""]
      : throttled
        ? [MESSAGES.youtubeThrottled, MESSAGES.youtubeThrottled]
        : [MESSAGES.noYoutubeShort, MESSAGES.noYoutube];
    this.note(index, keyMessage || note);
    if (announce) this.update({ status: keyMessage || status });
  }

  /** Wait for a look-up, but not for ever: pasting starts with what there is when YouTube is slow. */
  private async waitForYoutube(index: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const patience = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, YOUTUBE_WAIT_MS);
    });
    try {
      await Promise.race([this.ensureYoutube(index, true), patience]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Use a YouTube link the user pasted for a track, in place of whatever the look-up found. Only a link to one
   * YouTube video is taken, in its canonical form; anything else is refused with a message and changes nothing.
   */
  async setYoutubeLink(index: number, raw: string): Promise<boolean> {
    const result = this.current.session.results.find((r) => r.index === index);
    if (!result?.song) return false;
    const link = parseYoutubeLink(raw);
    if (link === null) {
      this.update({ youtubeLinkError: raw.trim() ? MESSAGES.notAYoutubeLink : MESSAGES.pasteYoutubeLink });
      return false;
    }
    this.update({ youtubeLinkError: "" });
    this.note(index, "");
    await this.setResult(index, {
      song: { ...result.song, youtubeUrl: link, youtubeIsMv: false, youtubeByUser: true },
    });
    return true;
  }

  /** Take the link off a track, for the user to paste another or none. */
  async clearYoutubeLink(index: number): Promise<void> {
    const result = this.current.session.results.find((r) => r.index === index);
    if (!result?.song) return;
    const song = { ...result.song, youtubeUrl: "", youtubeIsMv: false };
    delete song.youtubeByUser;
    this.update({ youtubeLinkError: "" });
    await this.setResult(index, { song });
  }

  /**
   * How the last track was started, so the next one (the countdown, the next-track button) goes the same way. Until a
   * track has been started, and after the user changes the setting, the setting decides.
   */
  private lastMode: PasteMode | null = null;

  /**
   * Begin pasting one track's queue into Genius: by itself ("auto") or one key press per step ("manual"). Without
   * a mode it goes the way the last track did, or the way the settings say for the first one.
   */
  async startPaste(index: number, mode?: PasteMode): Promise<void> {
    await this.waitForYoutube(index);
    const result = this.current.session.results.find((r) => r.index === index);
    const queue = this.queueFor(index);
    if (!result?.song || queue.length === 0) return;
    const way = mode ?? this.lastMode ?? this.current.settings.pasteMode;
    this.lastMode = way;
    await this.pasteCommand({
      type: "paste-start",
      title: result.song.title || result.title,
      queue: queue.map(([kind, value]) => [kind, value]),
    });
    this.pasted.add(index);
    this.update({ pasteIndex: index });
    await this.updateSession({ current: index });
    // The session is running by now. If no Genius page can take the run, the error says what to open, and the
    // session stays as a step-by-step one that the user can start automatically from the paste screen.
    if (way === "auto") await this.autoPaste();
  }

  /** Start automatic pasting, or resume it after a pause, from the step the session is at. */
  autoPaste(): Promise<void> {
    return this.pasteCommand({ type: "paste-auto-start" });
  }

  /** Pause automatic pasting; the user can resume it, or take over with the Next key. */
  pauseAutoPaste(): Promise<void> {
    return this.pasteCommand({ type: "paste-auto-pause" });
  }

  /** The next track after the one being pasted whose credits are in and give something to paste, or null. */
  nextPastable(): number | null {
    const from = this.current.pasteIndex;
    if (from === null) return null;
    const later = this.current.session.results.filter((r) => r.index > from && r.song !== null);
    return later.find((r) => this.queueFor(r.index).length > 0)?.index ?? null;
  }

  // ── the finished screen's countdown ─────────────────────────────────

  private countdownTimer: ReturnType<typeof setTimeout> | undefined;
  private countdownPaused = false;

  private startCountdown(): void {
    // The pause flag is left as the view last set it: the pointer may already be over the panel.
    // Only one countdown runs at a time: starting one takes the other away.
    this.update({ doneCountdown: this.current.settings.returnSeconds, nextCountdown: null });
    this.scheduleTick();
  }

  /** The same hold for the next track: a countdown that starts it unless the user gets there first. */
  private startNextCountdown(): void {
    this.update({ nextCountdown: this.current.settings.nextTrackSeconds, doneCountdown: null });
    this.scheduleTick();
  }

  private scheduleTick(): void {
    clearTimeout(this.countdownTimer);
    this.countdownTimer = setTimeout(() => {
      this.tick();
    }, 1000);
  }

  private tick(): void {
    if (this.countdownPaused) {
      this.scheduleTick();
      return;
    }
    const done = this.current.doneCountdown;
    if (done !== null) {
      if (!isFinished(this.current.paste)) return;
      if (done <= 1) {
        this.cancelCountdown();
        void this.leavePasting("menu");
        return;
      }
      this.update({ doneCountdown: done - 1 });
      this.scheduleTick();
      return;
    }
    const left = this.current.nextCountdown;
    if (left === null) return;
    // The next track may have gone away meanwhile (the session ended, the credits changed): nothing to start then.
    const target = this.nextPastable();
    if (target === null) return;
    if (left <= 1) {
      this.cancelCountdown();
      void this.startPaste(target);
      return;
    }
    this.update({ nextCountdown: left - 1 });
    this.scheduleTick();
  }

  /** Stop the countdown for good (the user acted, left the screen, or turned the setting off). */
  cancelCountdown(): void {
    clearTimeout(this.countdownTimer);
    this.countdownTimer = undefined;
    const patch: Partial<PanelState> = {};
    if (this.current.doneCountdown !== null) patch.doneCountdown = null;
    if (this.current.nextCountdown !== null) patch.nextCountdown = null;
    if (patch.doneCountdown !== undefined || patch.nextCountdown !== undefined) this.update(patch);
  }

  /** Hold the countdown while the user is using the panel (pointer over it, a button focused); it carries on after. */
  pauseCountdown(paused: boolean): void {
    this.countdownPaused = paused;
  }

  /** Leave the finished paste: end the session quietly and go where the user chose. */
  async leavePasting(destination: "credits" | "tracks" | "menu"): Promise<void> {
    await this.pasteCommand({ type: "paste-stop" });
    this.update({ error: "", status: "", pasteIndex: null });
    if (destination === "tracks") await this.backToTracks();
    else if (destination === "menu") await this.newAlbum();
  }

  fillNext(): Promise<void> {
    return this.pasteCommand({ type: "paste-fill" });
  }

  pasteBack(): Promise<void> {
    return this.pasteCommand({ type: "paste-back" });
  }

  pasteSkip(): Promise<void> {
    return this.pasteCommand({ type: "paste-skip" });
  }

  async stopPaste(): Promise<void> {
    await this.pasteCommand({ type: "paste-stop" });
    this.update({ error: "", status: "Stopped pasting." });
  }
}
