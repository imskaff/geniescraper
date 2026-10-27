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
import { normaliseSettings, queueOptions, type Settings } from "../shared/settings";
import { loadPaste, loadSession, loadSettings, saveSession, saveSettings, type Stores } from "../shared/storage";
import type { WorkerApi } from "./api";
import type { OptionalHost } from "../lookups/http";

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

export interface Env {
  api: WorkerApi;
  hosts: HostPermissions;
  stores: Stores;
  /** The tab the user is looking at, or null when there is none to read. */
  activeTab(): Promise<ActiveTab | null>;
}

export interface PanelState {
  session: Session;
  settings: Settings;
  settingsOpen: boolean;
  /** The paste session, as the worker stores it. */
  paste: PasteState;
  /** Which track is being pasted (null when unknown, for example after a restart with no match). */
  pasteIndex: number | null;
  /** Which optional hosts the user has granted, as Chrome reports it. */
  hosts: Record<OptionalHost, boolean>;
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
    youtubeUrl: scrape.youtubeUrl ?? "",
    youtubeIsMv: scrape.youtubeIsMv ?? false,
  };
}

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
    hosts: Record<OptionalHost, boolean> = { deezer: false, youtube: false },
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
      errorSeq: 0,
      settingsOpen: false,
      busy: null,
      error: "",
      status: "",
      pageUrl,
    };
  }

  /** Load settings, the stored session and the active tab, and build the controller from them. */
  static async create(env: Env): Promise<PanelController> {
    const [settings, session, paste, tab, hosts] = await Promise.all([
      loadSettings(env.stores),
      loadSession(env.stores),
      loadPaste(env.stores),
      env.activeTab().catch(() => null),
      env.hosts.granted().catch(() => ({ deezer: false, youtube: false })),
    ]);
    const pageUrl = tab && parseAppleMusicUrl(tab.url) ? tab.url : "";
    const controller = new PanelController(env, settings, session, pageUrl, paste, hosts);
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
    if (hosts.deezer !== this.current.hosts.deezer || hosts.youtube !== this.current.hosts.youtube) {
      this.update({ hosts });
    }
  }

  /**
   * Turn an optional host on or off. The request to Chrome is the first thing done, before any wait, because Chrome
   * only shows its prompt for a call made straight from the user's click. A refusal leaves the host off.
   */
  async setHost(host: OptionalHost, on: boolean): Promise<void> {
    const asked = on ? this.env.hosts.request(host) : this.env.hosts.remove(host);
    const ok = await asked.catch(() => false);
    await this.refreshHosts();
    // Redraw even when nothing changed, so a box the user ticked and Chrome refused goes back to unticked.
    this.update({
      hosts: { ...this.current.hosts },
      status: ok ? "" : on ? "Chrome did not grant access, so that look-up stays off." : "",
    });
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
      current: 0,
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
    const results: TrackResult[] = selected.map((index) => ({
      index,
      title: album.trackTitles[index] ?? "",
      url: album.trackUrls[index] ?? "",
      status: "pending",
      song: null,
      error: "",
    }));
    this.update({ error: "" });
    await this.updateSession({ screen: "review", results, current: selected[0] ?? 0 });
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
        const answer = await this.env.api.scrapeTrack(next.url, next.title, this.current.session.album?.artist);
        await claimed;
        if (myRun !== this.run) return; // stopped or replaced while waiting: drop the late answer
        const album = this.current.session.album;
        if (answer.ok && album) {
          await this.setResult(next.index, { status: "done", song: buildSong(album, next, answer.data), error: "" });
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
    this.update({ busy: null, status });
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

  async showTrack(index: number): Promise<void> {
    await this.updateSession({ current: index });
  }

  async backToTracks(): Promise<void> {
    await this.updateSession({ screen: "tracks" });
    this.update({ error: "" });
  }

  /** Start over with another link. */
  async newAlbum(): Promise<void> {
    this.run++;
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

  async setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
    const settings = { ...this.current.settings, [key]: value };
    // One key cannot do two jobs: choosing the other one's key swaps them instead of silently resetting both.
    if (key === "nextHotkey" && value === this.current.settings.backHotkey) {
      settings.backHotkey = this.current.settings.nextHotkey;
    } else if (key === "backHotkey" && value === this.current.settings.nextHotkey) {
      settings.nextHotkey = this.current.settings.backHotkey;
    }
    const normalised = normaliseSettings(settings);
    this.update({ settings: normalised });
    try {
      await saveSettings(this.env.stores, normalised);
    } catch {
      // Changed settings still apply for this session if they cannot be saved.
    }
  }

  // ── pasting ─────────────────────────────────────────────────────────

  /** The worker changed the paste session (a hotkey press on Genius, or one of our own commands). */
  setPaste(paste: PasteState): void {
    // An attention message needs the user to act, so it is announced assertively; progress is announced politely.
    if (paste.active && paste.queue.length > 0 && paste.position >= paste.queue.length) {
      this.update({ paste, error: "", status: MESSAGES.allDone });
      return;
    }
    this.update(
      paste.active
        ? {
            paste,
            error: paste.tone === "attention" ? paste.message : "",
            status: paste.tone === "ok" ? paste.message : "",
          }
        : { paste },
    );
  }

  private async pasteCommand(command: PasteCommand): Promise<void> {
    const answer = await this.env.api.paste(command);
    if (answer.ok) this.setPaste(answer.data);
    else this.update({ error: describeError(answer.error), status: "" });
  }

  /** Begin pasting one track's queue into Genius. */
  async startPaste(index: number): Promise<void> {
    const result = this.current.session.results.find((r) => r.index === index);
    const queue = this.queueFor(index);
    if (!result?.song || queue.length === 0) return;
    await this.pasteCommand({
      type: "paste-start",
      title: result.song.title || result.title,
      queue: queue.map(([kind, value]) => [kind, value]),
    });
    this.update({ pasteIndex: index });
    await this.updateSession({ current: index });
  }

  /** The next track after the one being pasted whose credits are in and give something to paste, or null. */
  nextPastable(): number | null {
    const from = this.current.pasteIndex;
    if (from === null) return null;
    const later = this.current.session.results.filter((r) => r.index > from && r.song !== null);
    return later.find((r) => this.queueFor(r.index).length > 0)?.index ?? null;
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
