// The extension's end of the companion link to the desktop app (docs/extension-plan.md section 39).
// It connects to 127.0.0.1 only, proves it knows the pairing secret without sending it, and then drives the
// existing paste session with the commands it receives. It never presses Save, and it forwards nothing to the
// router: the desktop app can reach the paste commands and nothing else.
import type { OpenTab } from "../core/musicTabs";
import { PASTE_KEY, normalisePaste, type PasteState } from "../core/paste";
import {
  BRIDGE_HOST,
  BRIDGE_PORTS,
  BRIDGE_VERSION,
  checkCommand,
  computeProof,
  normaliseCode,
  parseFrame,
  sameSecret,
  toBridgePages,
  toBridgeStatus,
  type BridgeCommand,
  type BridgeLinkState,
} from "../shared/bridge";
import type { PasteCommand, Result } from "../shared/messages";
import type { KeyValueStore } from "../shared/storage";

export const PAIRING_KEY = "bridgePairing";
export const DRIVEN_KEY = "bridgeDriven";
const CONNECT_TIMEOUT_MS = 3000;
/** A burst of tab changes (a page loading, a tab dragged) becomes one `pages` event. */
export const PAGES_DEBOUNCE_MS = 300;
const BACKOFF_MS = [1000, 2000, 5000, 15000, 30000] as const;

/** The slice of WebSocket the client uses. */
export interface SocketLike {
  send(data: string): void;
  close(code?: number): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface PasteDriver {
  command(request: PasteCommand): Promise<Result<PasteState>>;
  bridgeLost(): Promise<void>;
}

export interface BridgeDeps {
  openSocket(url: string): SocketLike;
  paste: PasteDriver;
  /** Where the pairing secret lives: this browser's local storage, never the synced area. */
  local: KeyValueStore;
  session: KeyValueStore;
  /** The tabs showing Apple Music (addresses and titles only; the extension's host permission already covers them). */
  openTabs(): Promise<OpenTab[]>;
  randomHex(bytes: number): string;
  setTimer(fn: () => void, ms: number): number;
  clearTimer(id: number): void;
}

function storedSecret(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const secret = (value as Record<string, unknown>)["secret"];
  return typeof secret === "string" && /^[0-9a-f]{64}$/.test(secret) ? secret : null;
}

type Attempt = { kind: "hello"; secret: string } | { kind: "pair"; code: string };

export class BridgeClient {
  private socket: SocketLike | null = null;
  private ready = false;
  private wanted = false;
  private attemptNo = 0;
  private timer: number | null = null;
  private lastStatus = "";
  private lastPages = "";
  private pagesTimer: number | null = null;
  private loopId = 0;
  private reconciling: Promise<void> = Promise.resolve();
  private lost: Promise<void> = Promise.resolve();
  private markLost: () => void = () => undefined;

  constructor(private readonly deps: BridgeDeps) {}

  /** Connect with the stored pairing, if there is one, and keep trying. Safe to call at every worker wake-up. */
  async start(): Promise<void> {
    await this.reconcile();
    if (this.wanted) return;
    const secret = storedSecret(await this.deps.local.get(PAIRING_KEY));
    if (secret === null || this.isWanted()) return;
    this.wanted = true;
    void this.loop(secret, ++this.loopId);
  }

  async link(): Promise<BridgeLinkState> {
    return { paired: storedSecret(await this.deps.local.get(PAIRING_KEY)) !== null, connected: this.ready };
  }

  /** Pair with the code on the desktop app's screen. Resolves when the desktop app accepts it or every port refused. */
  async pair(input: string): Promise<Result<BridgeLinkState>> {
    const code = normaliseCode(input);
    if (code === null) {
      return {
        ok: false,
        error: { code: "bad-request", message: "That is not a pairing code. It looks like ABCD-EFGH." },
      };
    }
    this.stop();
    for (const port of BRIDGE_PORTS) {
      const secret = await this.attempt(port, { kind: "pair", code });
      if (secret !== null) {
        await this.deps.local.set(PAIRING_KEY, { secret });
        this.wanted = true;
        void this.loop(secret, ++this.loopId, true);
        return { ok: true, data: { paired: true, connected: this.ready } };
      }
    }
    return {
      ok: false,
      error: {
        code: "tab-failed",
        message: "The desktop app did not accept the code. Check that it is open, then show a new code and try again.",
      },
    };
  }

  async unpair(): Promise<void> {
    this.stop();
    await this.deps.local.set(PAIRING_KEY, null);
    await this.deps.session.set(DRIVEN_KEY, false);
  }

  /** The paste state changed: tell the desktop app, once per distinct state. */
  pushStatus(state: PasteState): void {
    if (!this.ready || !this.socket) return;
    const status = JSON.stringify({ type: "status", v: BRIDGE_VERSION, state: toBridgeStatus(state) });
    if (status === this.lastStatus) return;
    this.lastStatus = status;
    this.socket.send(status);
  }

  /** The browser's tabs changed: tell the desktop app which Apple Music pages are open, once the changes settle. */
  refreshPages(): void {
    if (!this.ready || !this.socket) return;
    this.clearPagesTimer();
    this.pagesTimer = this.deps.setTimer(() => {
      this.pagesTimer = null;
      void this.sendPages();
    }, PAGES_DEBOUNCE_MS);
  }

  /** Send the open pages when they differ from the last list sent on this connection. */
  private async sendPages(): Promise<void> {
    if (!this.linked()) return;
    let tabs: OpenTab[];
    try {
      tabs = await this.deps.openTabs();
    } catch {
      return;
    }
    // The link may have dropped or been replaced while the tabs were read.
    const socket = this.linked();
    if (!socket) return;
    const message = JSON.stringify({ type: "pages", v: BRIDGE_VERSION, pages: toBridgePages(tabs) });
    if (message === this.lastPages) return;
    this.lastPages = message;
    socket.send(message);
  }

  /** The open connection, once authenticated; null otherwise. */
  private linked(): SocketLike | null {
    return this.ready ? this.socket : null;
  }

  private clearPagesTimer(): void {
    if (this.pagesTimer !== null) this.deps.clearTimer(this.pagesTimer);
    this.pagesTimer = null;
  }

  /** Still wanted: not unpaired, and (when `id` is given) not superseded by a newer loop. */
  private isWanted(id?: number): boolean {
    return this.wanted && (id === undefined || this.loopId === id);
  }

  private stop(): void {
    this.wanted = false;
    this.loopId++;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.clearPagesTimer();
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    socket?.close(1000);
    this.markLost();
  }

  /** A run the desktop app drove must not be left running with nobody steering it, e.g. after the worker restarted. */
  private reconcile(): Promise<void> {
    const run = this.reconciling.then(() => this.reconcileOnce());
    this.reconciling = run.catch(() => undefined);
    return run;
  }

  private async reconcileOnce(): Promise<void> {
    if (this.ready || (await this.deps.session.get(DRIVEN_KEY)) !== true) return;
    // Forget the flag first: the socket's close and the reconnect loop both come here, and the run pauses once.
    await this.deps.session.set(DRIVEN_KEY, false);
    const state = normalisePaste(await this.deps.session.get(PASTE_KEY));
    if (state.auto === "running") await this.deps.paste.bridgeLost();
  }

  /** Keep a connection up: try each port, hold the connection while it lasts, and back off between failures. */
  private async loop(secret: string, id: number, connectedAlready = false): Promise<void> {
    let held = connectedAlready;
    while (this.wanted && this.loopId === id) {
      if (!held) {
        for (const port of BRIDGE_PORTS) {
          if (!this.isWanted(id)) return;
          if ((await this.attempt(port, { kind: "hello", secret })) !== null) {
            held = true;
            break;
          }
        }
      }
      if (held) {
        this.attemptNo = 0;
        await this.lost;
        held = false;
        if (!this.isWanted(id)) return;
        await this.reconcile();
      }
      const delay = BACKOFF_MS[Math.min(this.attemptNo++, BACKOFF_MS.length - 1)] ?? 30000;
      await new Promise<void>((resolve) => {
        this.timer = this.deps.setTimer(resolve, delay);
      });
    }
  }

  /**
   * One connection attempt. Resolves with the secret once the handshake succeeded (the connection then stays open
   * and serves commands until it ends), or null when this port did not work.
   */
  private attempt(port: number, how: Attempt): Promise<string | null> {
    return new Promise((resolve) => {
      let socket: SocketLike;
      try {
        socket = this.deps.openSocket(`ws://${BRIDGE_HOST}:${String(port)}/`);
      } catch {
        resolve(null);
        return;
      }
      let settled = false;
      let authed = false;
      let secret = how.kind === "hello" ? how.secret : "";
      let serverNonce = "";
      let clientNonce = "";
      let connectTimer: number | null = null;
      const settle = (value: string | null): void => {
        if (settled) return;
        settled = true;
        if (connectTimer !== null) this.deps.clearTimer(connectTimer);
        resolve(value);
      };
      connectTimer = this.deps.setTimer(() => {
        if (!authed) {
          socket.close(1000);
          settle(null);
        }
      }, CONNECT_TIMEOUT_MS);

      const fail = (): void => {
        socket.close(1000);
        settle(null);
      };

      const authenticated = (): void => {
        authed = true;
        this.socket = socket;
        this.ready = true;
        this.lastStatus = "";
        this.lastPages = "";
        this.lost = new Promise<void>((done) => {
          this.markLost = done;
        });
        settle(secret);
        void this.deps.session.get(PASTE_KEY).then((raw) => {
          this.pushStatus(normalisePaste(raw));
        });
        void this.sendPages();
      };

      const handshake = async (message: Record<string, unknown>): Promise<void> => {
        if (message["type"] === "challenge" && serverNonce === "" && typeof message["nonce"] === "string") {
          serverNonce = message["nonce"];
          clientNonce = this.deps.randomHex(16);
          if (how.kind === "pair") {
            socket.send(JSON.stringify({ type: "pair", v: BRIDGE_VERSION, code: how.code, nonce: clientNonce }));
          } else {
            const proof = await computeProof(how.secret, "client", serverNonce, clientNonce);
            socket.send(JSON.stringify({ type: "hello", v: BRIDGE_VERSION, nonce: clientNonce, proof }));
          }
        } else if (message["type"] === "welcome" && how.kind === "hello" && serverNonce !== "") {
          const expected = await computeProof(how.secret, "server", serverNonce, clientNonce);
          if (typeof message["proof"] === "string" && sameSecret(expected, message["proof"])) authenticated();
          else fail();
        } else if (message["type"] === "paired" && how.kind === "pair" && storedSecret(message) !== null) {
          secret = storedSecret(message) ?? "";
          authenticated();
        } else {
          fail();
        }
      };

      socket.onmessage = (event): void => {
        const message = parseFrame(event.data);
        if (message === null) {
          socket.close(1008);
          return;
        }
        const handled = authed ? this.onMessage(socket, message) : handshake(message);
        handled.catch(() => {
          socket.close(1011);
        });
      };
      socket.onerror = (): void => {
        if (!authed) settle(null);
      };
      socket.onclose = (): void => {
        if (!authed) {
          settle(null);
          return;
        }
        if (this.socket === socket) {
          this.socket = null;
          this.ready = false;
          this.clearPagesTimer();
          this.markLost();
          void this.reconcile();
        }
      };
    });
  }

  private async onMessage(socket: SocketLike, message: Record<string, unknown>): Promise<void> {
    if (message["type"] === "ping") {
      socket.send(JSON.stringify({ type: "pong", v: BRIDGE_VERSION }));
      return;
    }
    const checked = checkCommand(message);
    if (!checked.ok) {
      // A command the extension does not know is refused by name, never acted on.
      if (checked.id !== null) {
        this.ack(socket, checked.id, { ok: false, error: { code: "bad-request", message: "Unrecognised command." } });
      }
      return;
    }
    const result = await this.run(checked.command);
    this.ack(socket, checked.command.id, result);
    this.pushStatus(result.ok ? result.data : normalisePaste(await this.deps.session.get(PASTE_KEY)));
  }

  private ack(socket: SocketLike, id: number, result: Result<unknown>): void {
    const body = result.ok
      ? { ok: true }
      : { ok: false, error: { code: result.error.code, message: result.error.message.slice(0, 500) } };
    socket.send(JSON.stringify({ type: "ack", v: BRIDGE_VERSION, id, ...body }));
  }

  private async run(command: BridgeCommand): Promise<Result<PasteState>> {
    const { paste, session } = this.deps;
    switch (command.type) {
      case "begin": {
        const started = await paste.command({ type: "paste-start", title: command.title, queue: command.queue });
        if (!started.ok) return started;
        await session.set(DRIVEN_KEY, started.data.active);
        return command.mode === "auto" && started.data.active ? paste.command({ type: "paste-auto-start" }) : started;
      }
      case "fill-next":
        return paste.command({ type: "paste-fill" });
      case "back":
        return paste.command({ type: "paste-back" });
      case "skip":
        return paste.command({ type: "paste-skip" });
      case "pause":
        return paste.command({ type: "paste-auto-pause" });
      case "resume":
        return paste.command({ type: "paste-auto-start" });
      case "stop":
        await session.set(DRIVEN_KEY, false);
        return paste.command({ type: "paste-stop" });
      case "get-status":
        return { ok: true, data: normalisePaste(await session.get(PASTE_KEY)) };
    }
  }
}
