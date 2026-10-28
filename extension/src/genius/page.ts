// The Genius page's side of a paste session: turn a hotkey press into one filled field.
// Pure with respect to the extension APIs (the worker is reached through `send`), so tests run the whole
// press, fill, report loop against the fake form and the real paste service.
import type { QueueItem, QueueKind } from "../core/models";
import type { Outcome } from "../core/paste";
import { isBeginReply, isResult, type GeniusRequest } from "../shared/messages";
import type { ComboboxTiming } from "./combobox";
import { fillStep } from "./fill";

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
]);

const GAVE_UP: Outcome = {
  status: "unavailable",
  message: "Something went wrong filling this step. Try again, or fill it in yourself.",
};

export class GeniusPage {
  private active = false;
  private busy = false;
  private inFlight: Promise<void> = Promise.resolve();
  private keys = { next: "F8", back: "F7" };

  constructor(private readonly env: PageEnv) {}

  setActive(active: boolean): void {
    this.active = active;
  }

  setHotkeys(next: string, back: string): void {
    this.keys = { next, back };
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

  /** Resolves when the work a key press started has finished. */
  whenIdle(): Promise<void> {
    return this.inFlight;
  }

  /** Fill the next step: ask the worker what it is, fill it, report what happened. */
  async next(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const answer = await this.env.send({ type: "paste-begin" }).catch(() => null);
      if (!isResult(answer) || !answer.ok || !isBeginReply(answer.data) || answer.data.action !== "fill") return;
      const { item, position, autoConfirm, settleMs } = answer.data;

      let outcome: Outcome = GAVE_UP;
      if (KINDS.has(item[0])) {
        try {
          outcome = await fillStep([item[0] as QueueKind, item[1]] satisfies QueueItem, {
            doc: this.env.doc,
            timing: { ...this.env.timing, settleMs },
            autoConfirm,
          });
        } catch {
          outcome = GAVE_UP;
        }
      }
      // Always report, even a failure: the worker is holding this step as in progress until it hears back.
      await this.env.send({ type: "paste-report", position, outcome }).catch(() => undefined);
    } finally {
      this.busy = false;
    }
  }

  async back(): Promise<void> {
    await this.env.send({ type: "paste-back" }).catch(() => undefined);
  }
}
