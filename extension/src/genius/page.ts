// The Genius page's side of a paste session: turn a hotkey press into one filled field, or run a whole track by
// itself when the user started automatic pasting.
// Pure with respect to the extension APIs (the worker is reached through `send`), so tests run the whole
// press, fill, report loop against the fake form and the real paste service.
import { sleep } from "../apple/wait";
import type { QueueItem, QueueKind } from "../core/models";
import { normalisePaste, type AutoMode, type Outcome, type PasteState } from "../core/paste";
import {
  isBeginReply,
  isPasteStatus,
  isResult,
  type BeginReply,
  type GeniusRequest,
  type PagePauseReason,
  type PasteStatus,
} from "../shared/messages";
import type { ComboboxTiming } from "./combobox";
import { clearTyped, fillStep, isStepDone, stepSnapshot } from "./fill";
import { findForm } from "./selectors";

export interface PageEnv {
  doc: Document;
  /** Ask the worker; resolves with its raw answer. */
  send(request: GeniusRequest): Promise<unknown>;
  /** Waits for the page; the settle time is replaced by the one the worker hands out with each step. */
  timing: ComboboxTiming;
}

const KINDS: ReadonlySet<string> = new Set([
  "written_by",
  "produced_by",
  "role",
  "artist",
  "copyright_role",
  "phonographic_copyright",
  "copyright_notice",
  "youtube_url",
  "cover_art",
  "release_month",
  "release_day",
  "release_year",
]);

const GAVE_UP: Outcome = {
  status: "unavailable",
  message: "Something went wrong filling this step. Try again, or fill it in yourself.",
};

/** The pause between fields when the worker does not say. */
const DEFAULT_PACE_MS = 600;

/** The worker is asked how a waiting run stands every this many polls of the form, so a Skip from the panel is noticed. */
const STATUS_EVERY_POLLS = 10;

/** A run asked for a step and got none this many times in a row while it still counts as running: it gives up. */
const MAX_IDLE_ASKS = 5;

/** While a run waits for the form it looks this many times as slowly as the form is polled for a choice. */
const FORM_POLL_FACTOR = 10;

/** Keys that change nothing on their own; holding one is not the user editing the form. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph"]);

type FillReply = Extract<BeginReply, { action: "fill" }>;

export class GeniusPage {
  private active = false;
  private busy = false;
  private inFlight: Promise<void> = Promise.resolve();
  private keys = { next: "F8", back: "F7" };

  /** How an automatic run stands, as the worker last said. */
  private auto: AutoMode = "off";
  private looping = false;
  private loop: Promise<void> = Promise.resolve();
  private pausing: Promise<void> = Promise.resolve();
  /** True while a run waits for the user to choose a suggestion: then the user acting on the form is expected. */
  private awaitingChoice = false;
  /** What each step awaiting a choice held when the wait began, by position, for as long as the choice is awaited. */
  private readonly baselines = new Map<number, string[]>();

  constructor(private readonly env: PageEnv) {}

  setActive(active: boolean): void {
    this.active = active;
    // A new or ended session: positions start again from the first step, so no old baseline may be reused.
    this.baselines.clear();
  }

  setHotkeys(next: string, back: string): void {
    this.keys = { next, back };
  }

  /**
   * An automatic run started, paused, resumed or ended. Running starts the loop (once); anything else lets a loop in
   * progress finish the step it is on and stop.
   */
  setAuto(mode: AutoMode): void {
    this.auto = mode;
    if (mode === "off") this.baselines.clear();
    if (mode !== "running" || this.looping) return;
    this.looping = true;
    this.loop = this.runAuto().finally(() => {
      this.looping = false;
    });
  }

  /**
   * Handle a key press on the page. Returns true when the press was ours: it is then suppressed, so the browser's
   * own use of the key (F7 toggles caret browsing in Chrome) never fires while pasting.
   */
  onKeyDown(event: KeyboardEvent): boolean {
    if (!this.active) return false;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    const isNext = event.key.toUpperCase() === this.keys.next.toUpperCase();
    const isBack = event.key.toUpperCase() === this.keys.back.toUpperCase();
    if (!isNext && !isBack) return false;

    event.preventDefault();
    event.stopPropagation();
    // A held key repeats; only the first press does anything.
    if (!event.repeat) this.inFlight = isNext ? this.next() : this.back();
    return true;
  }

  /**
   * The user clicking or typing in the form pauses a run, except while it waits for their choice (acting on the form
   * is what it is waiting for). Esc always pauses it. Only real input counts: the extension's own events are
   * synthetic, which is how its typing never pauses its own run.
   */
  onUserActivity(event: Event): void {
    if (!event.isTrusted || !this.active || this.auto !== "running") return;
    if (event instanceof KeyboardEvent) {
      if (event.key === "Escape") {
        this.pauseFromPage("user");
        return;
      }
      const key = event.key.toUpperCase();
      // The Next and Back keys are handled by onKeyDown; a modifier alone is not editing.
      if (key === this.keys.next.toUpperCase() || key === this.keys.back.toUpperCase()) return;
      if (MODIFIER_KEYS.has(event.key)) return;
    }
    if (this.awaitingChoice) return;
    const form = findForm(this.env.doc);
    if (!form || !(event.target instanceof Node) || !form.contains(event.target)) return;
    this.pauseFromPage("input");
  }

  /** Pause the run on the worker; its answer is the truth (it ignores the user's input while a choice is awaited). */
  pauseFromPage(reason: PagePauseReason): void {
    this.pausing = this.env
      .send({ type: "paste-pause", reason })
      .then((answer) => {
        const state = this.stateOf(answer);
        if (state) this.setAuto(state.auto);
      })
      .catch(() => undefined);
  }

  /** Resolves when the work a key press started has finished. */
  whenIdle(): Promise<void> {
    return this.inFlight;
  }

  /** Resolves when the automatic loop, and any pause it was sent, has finished. */
  whenAutoIdle(): Promise<void> {
    return Promise.all([this.loop, this.pausing]).then(() => undefined);
  }

  /** Fill the next step: ask the worker what it is, fill it, report what happened. */
  async next(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const answer = await this.env.send({ type: "paste-begin" }).catch(() => null);
      if (!isResult(answer) || !answer.ok || !isBeginReply(answer.data) || answer.data.action !== "fill") return;
      const outcome = await this.fill(answer.data, false);
      // Always report, even a failure: the worker is holding this step as in progress until it hears back.
      await this.env.send({ type: "paste-report", position: answer.data.position, outcome }).catch(() => undefined);
    } finally {
      this.busy = false;
    }
  }

  /** The user skipped a step: take back what was typed for it and left unchosen. */
  clearStep(item: [string, string], role?: string): void {
    if (!KINDS.has(item[0])) return;
    clearTyped(this.env.doc, [item[0] as QueueKind, item[1]], role);
  }

  async back(): Promise<void> {
    await this.env.send({ type: "paste-back" }).catch(() => undefined);
  }

  // ── automatic pasting ───────────────────────────────────────────────

  private async fill(reply: FillReply, auto: boolean): Promise<Outcome> {
    const { item, settleMs, autoConfirm, role } = reply;
    if (!KINDS.has(item[0])) return GAVE_UP;
    try {
      return await fillStep([item[0] as QueueKind, item[1]] satisfies QueueItem, {
        doc: this.env.doc,
        timing: { ...this.env.timing, settleMs },
        autoConfirm,
        auto,
        ...(role === undefined ? {} : { role }),
      });
    } catch {
      return GAVE_UP;
    }
  }

  private stateOf(answer: unknown): PasteState | null {
    return isResult(answer) && answer.ok ? normalisePaste(answer.data) : null;
  }

  private async status(): Promise<PasteStatus | null> {
    const answer = await this.env.send({ type: "paste-status" }).catch(() => null);
    return isResult(answer) && answer.ok && isPasteStatus(answer.data) ? answer.data : null;
  }

  /**
   * Fill step after step until the track is done, the run is paused or ended, or something goes wrong. Every move
   * of the position still goes through the worker, so a key press, a panel button and this loop cannot race.
   */
  private async runAuto(): Promise<void> {
    let idleAsks = 0;
    while (this.auto === "running") {
      // The next song has its own edit page: a run waits for its form to be open instead of failing without one.
      if (!(await this.waitForForm())) return;
      const answer = await this.env.send({ type: "paste-begin", source: "auto" }).catch(() => null);
      if (!isResult(answer) || !answer.ok || !isBeginReply(answer.data)) return;
      const reply = answer.data;

      if (reply.action === "fill") {
        idleAsks = 0;
        const outcome = await this.fill(reply, true);
        // Always report, even a failure: the worker holds the step as in progress until it hears back.
        const state = this.stateOf(
          await this.env.send({ type: "paste-report", position: reply.position, outcome }).catch(() => null),
        );
        if (!state) return;
        this.auto = state.auto;
        if (state.auto !== "running") return;
        if (state.awaiting && !(await this.waitForChoice(reply.item, reply.position, reply.role))) return;
        await sleep(reply.paceMs ?? DEFAULT_PACE_MS);
      } else if (reply.action === "await") {
        idleAsks = 0;
        if (!(await this.waitForChoice(reply.item, reply.position, reply.role))) return;
        await sleep(reply.paceMs ?? DEFAULT_PACE_MS);
      } else {
        // Nothing to fill: the track is done, the run was paused, or a fill is still in progress for a moment.
        const status = await this.status();
        if (!status) return;
        this.auto = status.auto;
        if (status.auto !== "running" || ++idleAsks > MAX_IDLE_ASKS) return;
        await sleep(DEFAULT_PACE_MS);
      }
    }
  }

  /** Wait for the song's Edit Metadata form; false when the run stopped or was paused meanwhile. */
  private async waitForForm(): Promise<boolean> {
    while (this.auto === "running") {
      if (findForm(this.env.doc)) return true;
      await sleep(this.env.timing.pollMs * FORM_POLL_FACTOR);
    }
    return false;
  }

  /**
   * Wait for the user to put the step's value on the form themselves, then count the step as done. False when the run
   * stopped meanwhile. A step skipped from the panel ends the wait too, and the loop carries on with the next one.
   */
  private async waitForChoice(item: [string, string], position: number, role?: string): Promise<boolean> {
    if (!KINDS.has(item[0])) return false;
    const step = [item[0] as QueueKind, item[1]] satisfies QueueItem;
    // What the field held when the wait began. It is kept across a pause, so a choice made while paused still counts
    // when the user turns the run back on; a page loaded fresh has none and takes it as it finds the field.
    const before = this.baselines.get(position) ?? stepSnapshot(this.env.doc, step, role);
    this.baselines.set(position, before);
    this.awaitingChoice = true;
    try {
      let polls = 0;
      while (this.auto === "running") {
        if (isStepDone(this.env.doc, step, before, role)) {
          this.baselines.delete(position);
          const state = this.stateOf(await this.env.send({ type: "paste-confirm" }).catch(() => null));
          if (!state) return false;
          this.auto = state.auto;
          return state.auto === "running";
        }
        await sleep(this.env.timing.pollMs);
        if (++polls % STATUS_EVERY_POLLS !== 0) continue;
        const status = await this.status();
        if (!status) return false;
        this.auto = status.auto;
        if (status.auto !== "running") return false;
        if (!status.awaiting || status.position !== position) {
          this.baselines.delete(position); // skipped from the panel: that choice is no longer waited for
          return true;
        }
      }
      return false;
    } finally {
      this.awaitingChoice = false;
    }
  }
}
