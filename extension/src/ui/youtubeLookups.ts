// The YouTube link, one track at a time: when to ask, in what order, when to try again, and the user's own link.
import { type SongCredits } from "../core/models";
import { type TrackResult } from "../shared/session";
import { parseYoutubeLink } from "../core/youtubeLink";
import { KEY_MESSAGES, MESSAGES, YOUTUBE_RETRY_LIMIT, YOUTUBE_RETRY_MS, YOUTUBE_WAIT_MS } from "./panelState";
import { type PanelHost } from "./panelHost";

export class YoutubeLookups {
  constructor(
    private readonly host: PanelHost,
    private readonly setResult: (index: number, patch: Partial<TrackResult>) => Promise<void>,
  ) {}

  private readonly youtubeLookups = new Map<number, Promise<void>>();
  /** The last thing found wrong with the user's YouTube key, shown after a read finishes. */
  keyNote = "";

  /** Starts at 0 and moves on whenever the lookups are forgotten, so a queue from another album stops itself. */
  private youtubeEpoch = 0;
  /** The tracks waiting for their turn, one after another: Google blocks a burst of searches. */
  private youtubeChain: Promise<void> = Promise.resolve();
  /** Set when Google refused a lookup: the rest of the queue is not sent, so it does not make things worse. */
  private youtubePaused = false;

  /** Whether the YouTube step is on and there is a way to ask: YouTube's pages (its permission) or the user's key. */
  askable(): boolean {
    const { hosts, youtubeKey, settings } = this.host.state;
    return settings.scrapeYoutube && (hosts.youtube || (youtubeKey.saved && hosts.youtubeApi));
  }

  /**
   * Look up this track's YouTube link if it needs one and the user has allowed it. The answer is kept on the track,
   * so it is not asked again. Opening a track and Start pasting call this straight away.
   */
  ensure(index: number, announce = false): Promise<void> {
    const known = this.youtubeLookups.get(index);
    if (known) return known;
    const result = this.host.state.session.results.find((r) => r.index === index);
    const song = result?.song;
    if (!result || !song || song.youtubeUrl || !this.askable()) return Promise.resolve();
    const lookup = this.lookupYoutube(index, song, announce);
    this.youtubeLookups.set(index, lookup);
    return lookup;
  }

  /**
   * A track whose credits just arrived gets its link without the user having to open it, so the list never claims
   * "All found" for a track whose link was never asked for. With the user's key the worker spreads the asks itself;
   * with YouTube's pages they go one after another, and stop at the first refusal (opening a track tries again).
   */
  queue(index: number): void {
    if (!this.askable()) return;
    // Always one track at a time, with the user's key too: the key may be refused (its allowance used up) and each
    // lookup then reads YouTube's pages, so a whole album asked at once was a burst that got the album refused.
    const epoch = this.youtubeEpoch;
    if (!this.youtubeLookups.has(index)) this.note(index, MESSAGES.lookingForYoutubeShort);
    this.youtubeChain = this.youtubeChain.then(async () => {
      if (epoch !== this.youtubeEpoch) return;
      if (this.youtubePaused) {
        this.note(index, MESSAGES.youtubeNotChecked);
        this.lookAgainLater(index);
        return;
      }
      await this.ensure(index);
      if (epoch !== this.youtubeEpoch) return;
      const song = this.host.state.session.results.find((r) => r.index === index)?.song;
      if (song?.youtubeUrl) this.note(index, "");
      // A refused or failed lookup is forgotten so it can be asked again; that is the sign to stop sending more, and to
      // look again later by itself.
      else if (song && !this.youtubeLookups.has(index)) {
        this.youtubePaused = true;
        this.lookAgainLater(index);
      }
    });
  }

  /** Tracks whose lookup was refused or never made, to be asked again after a rest. */
  private readonly youtubeRetries = new Set<number>();
  private readonly youtubeAttempts = new Map<number, number>();
  /** Tracks whose empty answer has already been given the one more try that opening them brings. */
  private readonly youtubeReasked = new Set<number>();
  private youtubeRetryTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * A track whose link could not be looked up because YouTube was limiting requests is tried again after a rest, a few
   * times, so the user is not left to open each track to get it going. Past the limit it is left to them.
   */
  private lookAgainLater(index: number): void {
    if ((this.youtubeAttempts.get(index) ?? 0) >= YOUTUBE_RETRY_LIMIT) return;
    this.youtubeRetries.add(index);
    if (this.youtubeRetryTimer !== undefined) return;
    const epoch = this.youtubeEpoch;
    this.youtubeRetryTimer = setTimeout(() => {
      this.youtubeRetryTimer = undefined;
      if (epoch !== this.youtubeEpoch) return;
      const again = [...this.youtubeRetries].sort((a, b) => a - b);
      this.youtubeRetries.clear();
      // The rest is over: the chain may ask again.
      this.youtubePaused = false;
      for (const index of again) {
        const song = this.host.state.session.results.find((r) => r.index === index)?.song;
        if (!song || song.youtubeUrl || !this.askable()) continue;
        this.youtubeAttempts.set(index, (this.youtubeAttempts.get(index) ?? 0) + 1);
        this.queue(index);
      }
    }, YOUTUBE_RETRY_MS);
  }

  forget(): void {
    this.youtubeEpoch++;
    this.youtubePaused = false;
    clearTimeout(this.youtubeRetryTimer);
    this.youtubeRetryTimer = undefined;
    this.youtubeRetries.clear();
    this.youtubeAttempts.clear();
    this.youtubeReasked.clear();
    this.youtubeLookups.clear();
    if (this.host.state.youtubeLinkError) this.host.update({ youtubeLinkError: "" });
    this.keyNote = "";
    if (Object.keys(this.host.state.youtubeNotes).length > 0) this.host.update({ youtubeNotes: {} });
  }

  private note(index: number, text: string): void {
    const others = Object.entries(this.host.state.youtubeNotes).filter(([key]) => Number(key) !== index);
    const notes: Record<number, string> = Object.fromEntries(others);
    if (text) notes[index] = text;
    this.host.update({ youtubeNotes: notes });
  }

  /**
   * `announce` puts the outcome on the status line, which is for what the user just asked for (Start pasting). A
   * look-up started by reading an album only writes the track's own note, so it never overwrites the read's summary or
   * names an arbitrary track.
   */
  private async lookupYoutube(index: number, song: SongCredits, announce: boolean): Promise<void> {
    const artist = song.artist || this.host.state.session.album?.artist || "";
    const title = song.title;
    if (!title || !artist) return;
    this.note(index, MESSAGES.lookingForYoutubeShort);
    if (announce) this.host.update({ status: MESSAGES.lookingForYoutube });
    const answer = await this.host.env.api.lookupYoutube(title, artist);
    const current = this.host.state.session.results.find((r) => r.index === index);
    // The panel may have moved on (another album, the main menu) while YouTube was being asked.
    if (current?.song?.title !== title) return;
    const keyMessage = answer.ok && answer.data.keyProblem ? KEY_MESSAGES[answer.data.keyProblem] : "";
    if (keyMessage) this.keyNote = keyMessage;
    if (answer.ok && answer.data.url) {
      await this.setResult(index, {
        song: {
          ...current.song,
          youtubeUrl: answer.data.url,
          youtubeIsMv: answer.data.isMusicVideo,
          ...(answer.data.kind ? { youtubeKind: answer.data.kind } : {}),
        },
      });
      this.note(index, "");
      if (announce) this.host.update({ status: keyMessage });
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
    if (announce) this.host.update({ status: keyMessage || status });
  }

  /** Wait for a look-up, but not for ever: pasting starts with what there is when YouTube is slow. */
  async waitFor(index: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const patience = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, YOUTUBE_WAIT_MS);
    });
    try {
      await Promise.race([this.ensure(index, true), patience]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Use a YouTube link the user pasted for a track, in place of whatever the look-up found. Only a link to one
   * YouTube video is taken, in its canonical form; anything else is refused with a message and changes nothing.
   */
  async setLink(index: number, raw: string): Promise<boolean> {
    const result = this.host.state.session.results.find((r) => r.index === index);
    if (!result?.song) return false;
    const link = parseYoutubeLink(raw);
    if (link === null) {
      this.host.update({ youtubeLinkError: raw.trim() ? MESSAGES.notAYoutubeLink : MESSAGES.pasteYoutubeLink });
      return false;
    }
    this.host.update({ youtubeLinkError: "" });
    this.note(index, "");
    const song = { ...result.song, youtubeUrl: link, youtubeIsMv: false, youtubeByUser: true };
    delete song.youtubeKind;
    await this.setResult(index, { song });
    return true;
  }

  /** Take the link off a track, for the user to paste another or none. */
  async clearLink(index: number): Promise<void> {
    const result = this.host.state.session.results.find((r) => r.index === index);
    if (!result?.song) return;
    const song = { ...result.song, youtubeUrl: "", youtubeIsMv: false };
    delete song.youtubeByUser;
    delete song.youtubeKind;
    this.host.update({ youtubeLinkError: "" });
    await this.setResult(index, { song });
  }

  /**
   * A lookup that came back empty is asked once more when the user opens the track: the first answer may have come
   * from a thin search, and the user is now looking at exactly this link. One still running is left alone.
   */
  reaskIfEmpty(index: number): void {
    const song = this.host.state.session.results.find((r) => r.index === index)?.song;
    if (
      song &&
      !song.youtubeUrl &&
      this.host.state.youtubeNotes[index] === MESSAGES.noYoutubeShort &&
      !this.youtubeReasked.has(index)
    ) {
      this.youtubeReasked.add(index); // once: a track that truly has no video is not asked about at every opening
      this.youtubeLookups.delete(index);
    }
  }
}
