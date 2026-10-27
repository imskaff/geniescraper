// The paste session's single writer. Every change to the stored state goes through here, one at a time:
// the panel's buttons arrive as extension-page requests, the page's hotkey as content-script requests, and
// neither can advance the position behind the other's back.
import { PASTE_KEY, back, begin, normalisePaste, report, skip, startPaste, stop, type PasteState } from "../core/paste";
import type { QueueItem, QueueKind } from "../core/models";
import {
  isOutcome,
  type BeginReply,
  type ErrorCode,
  type GeniusRequest,
  type PasteCommand,
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
          return { ok: true, data: next };
        }
        case "paste-back":
          return this.apply(back(state));
        case "paste-skip":
          return this.apply(skip(state));
        case "paste-stop": {
          const next = stop(state);
          await this.save(next);
          await this.announce(false);
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

  private async apply(next: PasteState): Promise<Result<PasteState>> {
    await this.save(next);
    return { ok: true, data: next };
  }

  /** A request from a Genius page (the caller has already checked that it really is one). */
  fromGenius(request: GeniusRequest): Promise<Result<unknown>> {
    return this.serial.run(async (): Promise<Result<unknown>> => {
      const state = await this.load();
      switch (request.type) {
        case "paste-status":
          return { ok: true, data: { active: state.active } };
        case "paste-back":
          return this.apply(back(state));
        case "paste-begin": {
          const settings = await loadSettings(this.stores);
          const { state: next, result } = begin(state, this.now());
          if (next !== state) await this.save(next);
          const reply: BeginReply =
            result.action === "fill"
              ? {
                  action: "fill",
                  item: [result.item[0], result.item[1]],
                  position: result.position,
                  autoConfirm: settings.autoConfirm,
                  settleMs: Math.round(settings.autocompleteWaitSeconds * 1000),
                }
              : { action: result.action };
          return { ok: true, data: reply };
        }
        case "paste-report": {
          if (!isOutcome(request.outcome)) return fail("bad-request", "Unrecognised outcome.");
          const next = report(state, request.position, request.outcome);
          if (next !== state) await this.save(next);
          return { ok: true, data: next };
        }
      }
    });
  }
}
