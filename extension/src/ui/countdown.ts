// The two countdowns: the finished screen's return to the menu, and the start of the next track.
import { isFinished, type PanelState } from "./panelState";
import { type PanelHost } from "./panelHost";

/** What the countdowns can do when they run out. */
export interface CountdownActions {
  leaveToMenu(): Promise<void>;
  startPaste(index: number): Promise<void>;
  nextPastable(): number | null;
}

export class Countdown {
  constructor(
    private readonly host: PanelHost,
    private readonly actions: CountdownActions,
  ) {}

  private countdownTimer: ReturnType<typeof setTimeout> | undefined;
  private countdownPaused = false;

  startDone(): void {
    // The pause flag is left as the view last set it: the pointer may already be over the panel.
    // Only one countdown runs at a time: starting one takes the other away.
    this.host.update({ doneCountdown: this.host.state.settings.returnSeconds, nextCountdown: null });
    this.scheduleTick();
  }

  /** The same hold for the next track: a countdown that starts it unless the user gets there first. */
  startNext(): void {
    this.host.update({ nextCountdown: this.host.state.settings.nextTrackSeconds, doneCountdown: null });
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
    const done = this.host.state.doneCountdown;
    if (done !== null) {
      if (!isFinished(this.host.state.paste)) return;
      if (done <= 1) {
        this.cancel();
        void this.actions.leaveToMenu();
        return;
      }
      this.host.update({ doneCountdown: done - 1 });
      this.scheduleTick();
      return;
    }
    const left = this.host.state.nextCountdown;
    if (left === null) return;
    // The next track may have gone away meanwhile (the session ended, the credits changed): nothing to start then.
    const target = this.actions.nextPastable();
    if (target === null) return;
    if (left <= 1) {
      this.cancel();
      void this.actions.startPaste(target);
      return;
    }
    this.host.update({ nextCountdown: left - 1 });
    this.scheduleTick();
  }

  /** Stop the countdown for good (the user acted, left the screen, or turned the setting off). */
  cancel(): void {
    clearTimeout(this.countdownTimer);
    this.countdownTimer = undefined;
    const patch: Partial<PanelState> = {};
    if (this.host.state.doneCountdown !== null) patch.doneCountdown = null;
    if (this.host.state.nextCountdown !== null) patch.nextCountdown = null;
    if (patch.doneCountdown !== undefined || patch.nextCountdown !== undefined) this.host.update(patch);
  }

  /** Hold the countdown while the user is using the panel (pointer over it, a button focused); it carries on after. */
  pause(paused: boolean): void {
    this.countdownPaused = paused;
  }
}
