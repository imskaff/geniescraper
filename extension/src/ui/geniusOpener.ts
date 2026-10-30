// The behaviour of "Open on Genius" in the panel: ask the worker to find the track's song on Genius and open its
// edit form, and keep how far it got in the state for the view. Nothing here pastes: the caller decides what an
// "opened" form leads to (the button stops there; the setting goes on to start pasting).
import { type PanelHost } from "./panelHost";
import { geniusMessage } from "./geniusText";
import { MESSAGES, NO_GENIUS, type GeniusOpenState } from "./panelState";

export interface GeniusTrack {
  index: number;
  title: string;
  artist: string;
}

export class GeniusOpener {
  /** Bumped by every new attempt and every reset, so a late answer for an old one is dropped. */
  private attempt = 0;

  constructor(
    private readonly host: PanelHost,
    private readonly track: (index: number) => GeniusTrack | null,
  ) {}

  /** Change the state and say it in the live regions: a problem assertively, progress politely. */
  private set(genius: GeniusOpenState): void {
    const message = geniusMessage(genius);
    this.host.update({
      genius,
      ...(message
        ? { error: message.tone === "problem" ? message.text : "", status: message.tone === "info" ? message.text : "" }
        : {}),
    });
  }

  /** True while the worker is looking for, or opening, a song. */
  busy(): boolean {
    return this.host.state.genius.phase === "working";
  }

  /** Forget how the last attempt went. */
  clear(): void {
    this.attempt++;
    const { genius, error, status } = this.host.state;
    if (genius.phase === "idle") return;
    // Only what this feature said goes with it: a message about something else stays.
    const said = geniusMessage(genius)?.text;
    this.host.update({
      genius: NO_GENIUS,
      ...(error === said ? { error: "" } : {}),
      ...(status === said ? { status: "" } : {}),
    });
  }

  /** Open the track's song on Genius. Resolves true only when its edit form is open; every other end stops there. */
  async open(index: number): Promise<boolean> {
    const track = this.track(index);
    if (!track || this.busy()) return false;
    const mine = ++this.attempt;
    const title = track.title;
    this.set({ index, phase: "working", title, song: null, songs: [] });
    const answer = await this.host.env.api.openOnGenius(track.title, track.artist);
    // The user moved on (another attempt, or the state was cleared) while Genius was being asked.
    if (mine !== this.attempt) return false;
    if (!answer.ok) {
      this.set({ index, phase: "failed", title, song: null, songs: [] });
      // An old background part does not know the request: reloading the extension is the fix, not trying again.
      if (answer.error.code === "bad-request") this.host.update({ error: MESSAGES.workerOutOfDate, status: "" });
      return false;
    }
    const { status, song, songs } = answer.data;
    this.set({ index, phase: status, title, song: song ?? null, songs: songs ?? [] });
    return status === "opened";
  }
}
