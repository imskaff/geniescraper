// The link to the desktop app: polling its state while Settings is open, pairing and unpairing.
import { normaliseCode } from "../shared/bridge";
import { BRIDGE_MESSAGES, BRIDGE_POLL_MS, type PanelState } from "./panelState";
import { type PanelHost } from "./panelHost";

export class DesktopLink {
  constructor(private readonly host: PanelHost) {}

  private bridgeTimer: ReturnType<typeof setInterval> | undefined;

  watch(): void {
    this.unwatch();
    void this.refresh();
    this.bridgeTimer = setInterval(() => void this.refresh(), BRIDGE_POLL_MS);
  }

  unwatch(): void {
    if (this.bridgeTimer !== undefined) clearInterval(this.bridgeTimer);
    this.bridgeTimer = undefined;
  }

  /** Show a message under the pairing code box (the view uses it when the browser refuses to read the clipboard). */
  noteMessage(message: string): void {
    this.set({ message, tone: "error" });
  }

  private set(patch: Partial<PanelState["bridge"]>): void {
    this.host.update({ bridge: { ...this.host.state.bridge, ...patch } });
  }

  /** Read afresh each time: the state may have changed while a request was out. */
  private busy(): boolean {
    return this.host.state.bridge.busy;
  }

  /** Ask the worker how the link stands. A failed check keeps what was last known, so a blip does not flip the card. */
  async refresh(): Promise<void> {
    if (this.host.state.bridge.busy) return;
    const answer = await this.host.env.api.bridge({ type: "bridge-status" });
    if (!answer.ok || this.busy()) return;
    const { paired, connected } = answer.data;
    const now = this.host.state.bridge;
    if (now.known && now.paired === paired && now.connected === connected) return;
    this.set({ known: true, paired, connected });
  }

  /** Pair with the code the desktop app shows; the worker tries each of its ports. */
  async pair(raw: string): Promise<void> {
    if (this.host.state.bridge.busy) return;
    if (!raw.trim()) {
      this.set({ message: BRIDGE_MESSAGES.empty, tone: "error" });
      return;
    }
    const code = normaliseCode(raw);
    if (code === null) {
      this.set({ message: BRIDGE_MESSAGES.badShape, tone: "error" });
      return;
    }
    this.set({ busy: true, message: "Pairing with the desktop app…", tone: "" });
    const answer = await this.host.env.api.bridge({ type: "bridge-pair", code });
    if (answer.ok) {
      this.set({ ...answer.data, known: true, busy: false, message: BRIDGE_MESSAGES.paired, tone: "ok" });
    } else {
      this.set({
        busy: false,
        tone: "error",
        message: answer.error.code === "bad-request" ? answer.error.message : BRIDGE_MESSAGES.notAccepted,
      });
    }
  }

  async unpair(): Promise<void> {
    if (this.host.state.bridge.busy) return;
    this.set({ busy: true, message: "", tone: "" });
    const answer = await this.host.env.api.bridge({ type: "bridge-unpair" });
    if (answer.ok) {
      this.set({ ...answer.data, known: true, busy: false, message: BRIDGE_MESSAGES.unpaired, tone: "ok" });
    } else {
      this.set({
        busy: false,
        tone: "error",
        message: "The extension did not answer, so the pairing may still be in place. Try again.",
      });
    }
  }
}
