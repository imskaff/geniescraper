// The paste session's single writer. Every change to the stored state goes through here, one at a time:
// the panel's buttons arrive as extension-page requests, the page's hotkey as content-script requests, and
// neither can advance the position behind the other's back.
import {
  PASTE_KEY,
  back,
  begin,
  confirmChoice,
  normalisePaste,
  pauseAuto,
  report,
  skip,
  startAuto,
  startPaste,
  stop,
  type AutoMode,
  type PasteState,
  roleOfStep,
} from "../core/paste";
import type { QueueItem, QueueKind } from "../core/models";
import {
  isOutcome,
  type BeginReply,
  type ErrorCode,
  type GeniusNotice,
  type GeniusRequest,
  type PasteCommand,
  type PasteStatus,
  type Result,
} from "../shared/messages";
import { loadSettings, type Stores } from "../shared/storage";
import type { BrowserPorts } from "./ports";
import { Serial } from "./serial";

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

function fail(code: ErrorCode, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

export class PasteService {
  private readonly serial = new Serial();

  constructor(
    private readonly ports: BrowserPorts,
    private readonly stores: Stores,
    private readonly now: () => number = Date.now,
  ) {}

  private async load(): Promise<PasteState> {
    return normalisePaste(await this.stores.session.get(PASTE_KEY));
  }

  private async save(state: PasteState): Promise<void> {
    await this.stores.session.set(PASTE_KEY, state);
  }

  /** Tell every Genius tab whether a session is running, so the hotkeys are live only while one is. */
  private async announce(active: boolean): Promise<void> {
    const tabs = await this.ports.geniusTabIds().catch(() => []);
    await Promise.all(tabs.map((tab) => this.ports.notifyGenius(tab, { type: "genius/paste-active", active })));
  }

  /** Ask every Genius tab to take back what was typed for a skipped step. */
  private async clearTyped(item: [string, string], role: string | undefined): Promise<void> {
    const tabs = await this.ports.geniusTabIds().catch(() => []);
    const notice: GeniusNotice = { type: "genius/clear", item, ...(role === undefined ? {} : { role }) };
    await Promise.all(tabs.map((tab) => this.ports.notifyGenius(tab, notice)));
  }

  /** Tell every Genius tab how an automatic run stands, so the page loop knows whether to go on. */
  private async announceAuto(auto: AutoMode): Promise<number> {
    const tabs = await this.ports.geniusTabIds().catch(() => []);
    const heard = await Promise.all(
      tabs.map((tab) => this.ports.notifyGenius(tab, { type: "genius/auto-state", auto })),
    );
    return heard.filter(Boolean).length;
  }

  /** The panel was closed: a run pauses, since nobody is watching it. A step awaiting the user's choice stays awaited. */
  panelClosed(): Promise<void> {
    return this.serial.run(async () => {
      const state = await this.load();
      await this.apply(state, pauseAuto(state, "panel-closed"));
    });
  }

  /** A request from the panel. */
  command(request: PasteCommand): Promise<Result<PasteState>> {
    return this.serial.run(async () => {
      const state = await this.load();
      switch (request.type) {
        case "paste-start": {
          const queue: QueueItem[] = request.queue.filter((pair): pair is [QueueKind, string] => KINDS.has(pair[0]));
          const next = startPaste(request.title, queue);
          await this.save(next);
          await this.announce(next.active);
          if (state.auto !== "off") await this.announceAuto("off");
          return { ok: true, data: next };
        }
        case "paste-back":
          return this.apply(state, back(state));
        case "paste-skip": {
          const skipped = state.active ? state.queue[state.position] : undefined;
          const role = skipped ? roleOfStep(state.queue, state.position) : undefined;
          const result = await this.apply(state, skip(state));
          // The step's typed text must not stay in the field: every Genius tab is told which step it was.
          if (skipped) await this.clearTyped([skipped[0], skipped[1]], role);
          return result;
        }
        case "paste-auto-start": {
          const next = startAuto(state);
          if (next === state) return { ok: true, data: state };
          // The page loop starts when it hears of the run, and asks for its first step from the saved state: save
          // first, and take it back if no Genius page was there to hear.
          await this.save(next);
          const heard = await this.announceAuto("running");
          if (heard > 0) return { ok: true, data: next };
          await this.save(state);
          const open = (await this.ports.geniusTabIds().catch(() => [])).length > 0;
          return fail(
            "tab-failed",
            open
              ? "Reload the Genius page, then try again."
              : "Open the song's Edit Metadata form on Genius first, then start again.",
          );
        }
        case "paste-auto-pause":
          return this.apply(state, pauseAuto(state, "user"));
        case "paste-stop": {
          const next = stop(state);
          await this.save(next);
          await this.announce(false);
          if (state.auto !== "off") await this.announceAuto("off");
          return { ok: true, data: next };
        }
        case "paste-fill": {
          const tab = await this.ports.activeGeniusTab();
          if (tab === null) return fail("tab-failed", "Open the song's page on Genius and switch to its tab first.");
          const delivered = await this.ports.notifyGenius(tab, { type: "genius/fill-now" });
          return delivered ? { ok: true, data: state } : fail("tab-failed", "Reload the Genius page, then try again.");
        }
      }
    });
  }

  /** Save a change, and tell the Genius tabs when it changed how an automatic run stands. */
  private async apply(before: PasteState, next: PasteState): Promise<Result<PasteState>> {
    if (next !== before) await this.save(next);
    if (next.auto !== before.auto) await this.announceAuto(next.auto);
    return { ok: true, data: next };
  }

  /** A request from a Genius page (the caller has already checked that it really is one). */
  fromGenius(request: GeniusRequest): Promise<Result<unknown>> {
    return this.serial.run(async (): Promise<Result<unknown>> => {
      const state = await this.load();
      switch (request.type) {
        case "paste-status": {
          const status: PasteStatus = {
            active: state.active,
            auto: state.auto,
            awaiting: state.awaiting,
            position: state.position,
          };
          return { ok: true, data: status };
        }
        case "paste-back":
          return this.apply(state, back(state));
        case "paste-confirm":
          return this.apply(state, confirmChoice(state));
        case "paste-pause":
          return this.apply(state, pauseAuto(state, request.reason));
        case "paste-begin": {
          const settings = await loadSettings(this.stores);
          const { state: next, result } = begin(state, this.now(), request.source === "auto" ? "auto" : "key");
          if (next !== state) await this.save(next);
          // A key press can pause a run (it takes over from it): the page loop has to hear of that too.
          if (next.auto !== state.auto) await this.announceAuto(next.auto);
          const paceMs = request.source === "auto" ? { paceMs: Math.round(settings.autoPaceSeconds * 1000) } : {};
          const waiting = next.queue[next.position];
          let reply: BeginReply;
          if (result.action === "fill") {
            const role = roleOfStep(next.queue, result.position);
            reply = {
              action: "fill",
              item: [result.item[0], result.item[1]],
              position: result.position,
              autoConfirm: settings.autoConfirm,
              settleMs: Math.round(settings.autocompleteWaitSeconds * 1000),
              ...paceMs,
              ...(role === undefined ? {} : { role }),
            };
          } else if (request.source === "auto" && next.auto === "running" && next.awaiting && waiting) {
            // A run resumed while a step still waits for the user's choice: tell it what to wait for.
            const role = roleOfStep(next.queue, next.position);
            reply = {
              action: "await",
              item: [waiting[0], waiting[1]],
              position: next.position,
              ...paceMs,
              ...(role === undefined ? {} : { role }),
            };
          } else {
            reply = { action: result.action };
          }
          return { ok: true, data: reply };
        }
        case "paste-report": {
          if (!isOutcome(request.outcome)) return fail("bad-request", "Unrecognised outcome.");
          return this.apply(state, report(state, request.position, request.outcome));
        }
      }
    });
  }
}
