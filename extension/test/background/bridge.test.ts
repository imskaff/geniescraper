import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  DRIVEN_KEY,
  PAGES_DEBOUNCE_MS,
  PAIRING_KEY,
  type BridgeDeps,
  type SocketLike,
} from "../../src/background/bridge";
import type { OpenTab } from "../../src/core/musicTabs";
import { PASTE_KEY, IDLE_PASTE, startPaste, normalisePaste, type PasteState } from "../../src/core/paste";
import { BRIDGE_PORTS, computeProof } from "../../src/shared/bridge";
import type { PasteCommand, Result } from "../../src/shared/messages";
import { memoryStore } from "../ui/fakes";

const SECRET = "ab".repeat(32);
const SERVER_NONCE = "s".repeat(32);
const CLIENT_NONCE = "c".repeat(32);

class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = [];
  closedWith: number | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code?: number): void {
    this.closedWith = code ?? 1000;
    queueMicrotask(() => this.onclose?.());
  }
  /** The desktop app says something. */
  say(message: unknown): void {
    this.onmessage?.({ data: typeof message === "string" ? message : JSON.stringify(message) });
  }
  hang(): void {
    this.onclose?.();
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

function setup(over: { secret?: string | null } = {}) {
  const sockets: FakeSocket[] = [];
  const pasteLog: PasteCommand[] = [];
  const local = memoryStore(over.secret === null ? {} : { [PAIRING_KEY]: { secret: over.secret ?? SECRET } });
  const session = memoryStore();
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let lostCalls = 0;
  let state: PasteState = { ...IDLE_PASTE };
  const tabs: { open: OpenTab[]; reads: number } = { open: [], reads: 0 };
  const paste = {
    command(request: PasteCommand): Promise<Result<PasteState>> {
      pasteLog.push(request);
      if (request.type === "paste-start") state = startPaste(request.title, request.queue as never);
      if (request.type === "paste-auto-start") state = { ...state, auto: "running" };
      if (request.type === "paste-stop") state = { ...IDLE_PASTE };
      session.data.set(PASTE_KEY, state);
      return Promise.resolve({ ok: true, data: state });
    },
    bridgeLost(): Promise<void> {
      lostCalls++;
      state = { ...state, auto: "paused", pauseReason: "bridge-lost" };
      session.data.set(PASTE_KEY, state);
      return Promise.resolve();
    },
  };
  const deps: BridgeDeps = {
    openSocket(url) {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    paste,
    local,
    session,
    openTabs() {
      tabs.reads++;
      return Promise.resolve(tabs.open);
    },
    randomHex: () => CLIENT_NONCE,
    setTimer(fn, ms) {
      const id = timers.length + 1;
      timers.push({ fn, ms, id });
      return id;
    },
    clearTimer(id) {
      const t = timers.find((x) => x.id === id);
      if (t) t.fn = () => undefined;
    },
  };
  const client = new BridgeClient(deps);
  return {
    client,
    sockets,
    pasteLog,
    local,
    session,
    timers,
    tabs,
    lost: () => lostCalls,
    setState(next: PasteState) {
      state = next;
      session.data.set(PASTE_KEY, next);
    },
  };
}

/** Walk a connection through the handshake as the real desktop app would. */
async function welcome(socket: FakeSocket, secret = SECRET, serverProof?: string): Promise<void> {
  socket.say({ type: "challenge", v: 1, nonce: SERVER_NONCE });
  await flush();
  socket.say({
    type: "welcome",
    v: 1,
    proof: serverProof ?? (await computeProof(secret, "server", SERVER_NONCE, CLIENT_NONCE)),
  });
  await flush();
}

async function connected(over: { secret?: string | null } = {}) {
  const env = setup(over);
  await env.client.start();
  await flush();
  const socket = env.sockets[0];
  if (!socket) throw new Error("no socket");
  await welcome(socket);
  return { ...env, socket };
}

describe("cross-language proof", () => {
  it("matches the Python side's HMAC", async () => {
    expect(await computeProof(SECRET, "client", "n1", "n2")).toBe(
      "fa030e3211d026656600dbefb6d7d17fd01f85294662cea9907b89f885e204a6",
    );
    expect(await computeProof(SECRET, "server", "n1", "n2")).toBe(
      "deaa4e3bc5095a3156967b593814b7640c1ce3fc5798942295771113711e357c",
    );
  });
});

describe("connecting", () => {
  it("does nothing until the user has paired", async () => {
    const { client, sockets } = setup({ secret: null });
    await client.start();
    expect(sockets).toHaveLength(0);
    expect(await client.link()).toEqual({ paired: false, connected: false });
  });

  it("opens only ws://127.0.0.1 sockets, on the agreed ports", async () => {
    const { client, sockets, timers } = setup();
    await client.start();
    await flush();
    expect(sockets[0]?.url).toBe(`ws://127.0.0.1:${String(BRIDGE_PORTS[0])}/`);
    sockets[0]?.hang();
    await flush();
    for (const t of timers.splice(0)) t.fn();
    await flush();
    for (const socket of sockets) expect(socket.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it("tries the next port when one refuses", async () => {
    const { client, sockets } = setup();
    await client.start();
    await flush();
    sockets[0]?.hang();
    await flush();
    expect(sockets[1]?.url).toBe(`ws://127.0.0.1:${String(BRIDGE_PORTS[1])}/`);
  });

  it("answers the challenge with a proof and never sends the secret", async () => {
    const { client, sockets } = setup();
    await client.start();
    await flush();
    const socket = sockets[0];
    socket?.say({ type: "challenge", v: 1, nonce: SERVER_NONCE });
    await flush();
    expect(socket?.sent).toEqual([
      {
        type: "hello",
        v: 1,
        nonce: CLIENT_NONCE,
        proof: await computeProof(SECRET, "client", SERVER_NONCE, CLIENT_NONCE),
      },
    ]);
    expect(JSON.stringify(socket?.sent)).not.toContain(SECRET);
  });

  it("drops a server that cannot prove it knows the secret, and sends it nothing", async () => {
    const { client, sockets } = setup();
    await client.start();
    await flush();
    const socket = sockets[0];
    if (!socket) throw new Error("no socket");
    await welcome(socket, SECRET, "0".repeat(64));
    expect(socket.closedWith).toBe(1000);
    expect(socket.sent).toHaveLength(1); // only the hello
    expect((await client.link()).connected).toBe(false);
  });

  it("drops a connection whose first message is not a challenge", async () => {
    const { client, sockets } = setup();
    await client.start();
    await flush();
    sockets[0]?.say({ type: "begin", id: 1, v: 1 });
    await flush();
    expect(sockets[0]?.closedWith).not.toBeNull();
    expect(sockets[0]?.sent).toEqual([]);
  });

  it("sends the current status once the handshake is done", async () => {
    const { socket } = await connected();
    expect(socket.sent.filter((m) => m["type"] === "status").at(-1)).toMatchObject({
      type: "status",
      state: { active: false, total: 0 },
    });
  });

  it("answers a ping with a pong, and gives up cleanly on a binary or oversized frame", async () => {
    const { socket } = await connected();
    socket.say({ type: "ping", v: 1 });
    await flush();
    expect(socket.sent.at(-1)).toEqual({ type: "pong", v: 1 });
    socket.onmessage?.({ data: new ArrayBuffer(4) });
    expect(socket.closedWith).toBe(1008);
  });

  it("rejects an oversized frame", async () => {
    const { socket } = await connected();
    socket.say("x".repeat(70_000));
    expect(socket.closedWith).toBe(1008);
  });
});

describe("pairing", () => {
  it("sends the code, stores the secret it is given, and then holds the connection", async () => {
    const env = setup({ secret: null });
    const done = env.client.pair("abcd-efgh");
    await flush();
    const socket = env.sockets[0];
    socket?.say({ type: "challenge", v: 1, nonce: SERVER_NONCE });
    await flush();
    expect(socket?.sent[0]).toMatchObject({ type: "pair", v: 1, code: "ABCD-EFGH" });
    socket?.say({ type: "paired", v: 1, secret: SECRET });
    const result = await done;
    expect(result.ok).toBe(true);
    expect(await env.local.get(PAIRING_KEY)).toEqual({ secret: SECRET });
    expect(env.sockets).toHaveLength(1);
  });

  it("refuses a malformed code without opening a socket", async () => {
    const env = setup({ secret: null });
    const result = await env.client.pair("hello");
    expect(result.ok).toBe(false);
    expect(env.sockets).toHaveLength(0);
  });

  it("stores nothing when every port refuses", async () => {
    const env = setup({ secret: null });
    const done = env.client.pair("ABCD-EFGH");
    for (let i = 0; i < BRIDGE_PORTS.length; i++) {
      await flush();
      env.sockets[i]?.hang();
    }
    const result = await done;
    expect(result.ok).toBe(false);
    expect(await env.local.get(PAIRING_KEY)).toBeUndefined();
  });

  it("refuses a secret of the wrong shape", async () => {
    const env = setup({ secret: null });
    const done = env.client.pair("ABCD-EFGH");
    await flush();
    env.sockets[0]?.say({ type: "challenge", v: 1, nonce: SERVER_NONCE });
    await flush();
    env.sockets[0]?.say({ type: "paired", v: 1, secret: "short" });
    await flush();
    expect(env.sockets[0]?.closedWith).toBe(1000);
    for (let i = 1; i < BRIDGE_PORTS.length; i++) {
      env.sockets[i]?.hang();
      await flush();
    }
    expect((await done).ok).toBe(false);
  });

  it("unpairing forgets the secret and closes the link", async () => {
    const { client, local, socket } = await connected();
    await client.unpair();
    expect(await local.get(PAIRING_KEY)).toBeNull();
    expect(socket.closedWith).toBe(1000);
    expect(await client.link()).toEqual({ paired: false, connected: false });
  });
});

describe("commands", () => {
  const QUEUE = [
    ["written_by", "Writer One"],
    ["role", "Mixing Engineer"],
    ["artist", "Mixer One"],
  ];

  it("begin in auto mode starts the session and the run, and acknowledges once", async () => {
    const { socket, pasteLog } = await connected();
    socket.say({ type: "begin", v: 1, id: 4, title: "Song", queue: QUEUE, mode: "auto" });
    await flush();
    expect(pasteLog.map((c) => c.type)).toEqual(["paste-start", "paste-auto-start"]);
    expect(socket.sent.filter((m) => m["type"] === "ack")).toEqual([{ type: "ack", v: 1, id: 4, ok: true }]);
    expect(socket.sent.filter((m) => m["type"] === "status").at(-1)).toMatchObject({
      type: "status",
      state: { auto: "running", total: 3 },
    });
  });

  it("begin in manual mode only starts the session", async () => {
    const { socket, pasteLog } = await connected();
    socket.say({ type: "begin", v: 1, id: 1, title: "Song", queue: QUEUE, mode: "manual" });
    await flush();
    expect(pasteLog.map((c) => c.type)).toEqual(["paste-start"]);
  });

  it.each([
    ["fill-next", "paste-fill"],
    ["back", "paste-back"],
    ["skip", "paste-skip"],
    ["pause", "paste-auto-pause"],
    ["resume", "paste-auto-start"],
    ["stop", "paste-stop"],
  ])("%s becomes %s", async (name, expected) => {
    const { socket, pasteLog } = await connected();
    socket.say({ type: name, v: 1, id: 9 });
    await flush();
    expect(pasteLog.map((c) => c.type)).toEqual([expected]);
    expect(socket.sent.some((m) => m["type"] === "ack" && m["id"] === 9 && m["ok"] === true)).toBe(true);
  });

  it("get-status acknowledges and sends the state", async () => {
    const { socket, pasteLog } = await connected();
    socket.say({ type: "get-status", v: 1, id: 2 });
    await flush();
    expect(pasteLog).toEqual([]);
    expect(socket.sent.some((m) => m["type"] === "ack" && m["id"] === 2)).toBe(true);
  });

  it.each([
    ["a worker command", { type: "detect", v: 1, id: 1, url: "https://music.apple.com/us/album/x/1" }],
    ["a scrape", { type: "scrape-track", v: 1, id: 1, url: "https://evil.example/" }],
    ["a key check", { type: "youtube-key-check", v: 1, id: 1, key: "k" }],
    ["a panel command spelled as it is inside", { type: "paste-stop", v: 1, id: 1 }],
    ["a begin with an unknown kind", { type: "begin", v: 1, id: 1, title: "t", queue: [["save", "x"]], mode: "auto" }],
    ["a begin with a bad mode", { type: "begin", v: 1, id: 1, title: "t", queue: [], mode: "turbo" }],
    [
      "a begin with a non-string text",
      { type: "begin", v: 1, id: 1, title: "t", queue: [["artist", 5]], mode: "auto" },
    ],
    [
      "a begin with a long queue",
      { type: "begin", v: 1, id: 1, title: "t", queue: Array(501).fill(["artist", "x"]), mode: "auto" },
    ],
    ["a wrong protocol version", { type: "skip", v: 2, id: 1 }],
    ["a fractional id", { type: "skip", v: 1, id: 1.5 }],
  ])("refuses %s and never reaches the paste session", async (_name, message) => {
    const { socket, pasteLog } = await connected();
    const before = socket.sent.length;
    socket.say(message);
    await flush();
    expect(pasteLog).toEqual([]);
    const reply = socket.sent.slice(before);
    for (const r of reply) expect(r).toMatchObject({ type: "ack", ok: false, error: { code: "bad-request" } });
  });

  it("treats text that looks like a command as plain text", async () => {
    const { socket, pasteLog } = await connected();
    const title = '{"type":"stop","v":1,"id":3}';
    socket.say({ type: "begin", v: 1, id: 1, title, queue: [["artist", title]], mode: "manual" });
    await flush();
    expect(pasteLog.map((c) => c.type)).toEqual(["paste-start"]);
    expect(pasteLog[0]).toMatchObject({ title, queue: [["artist", title]] });
  });
});

describe("status", () => {
  it("is pushed once per distinct state", async () => {
    const { client, socket } = await connected();
    const state = startPaste("Song", [["artist", "A"]]);
    client.pushStatus(state);
    client.pushStatus(state);
    const statuses = socket.sent.filter((m) => m["type"] === "status");
    expect(statuses).toHaveLength(2); // the one at connect, and this one
  });

  it("carries the position, never the queue's text", async () => {
    const { client, socket } = await connected();
    client.pushStatus(startPaste("Song", [["artist", "Secret Name"]]));
    expect(JSON.stringify(socket.sent.at(-1))).not.toContain("Secret Name");
  });
});

describe("losing the desktop app", () => {
  it("pauses a run the desktop app started", async () => {
    const env = await connected();
    env.socket.say({ type: "begin", v: 1, id: 1, title: "S", queue: [["artist", "A"]], mode: "auto" });
    await flush();
    expect(await env.session.get(DRIVEN_KEY)).toBe(true);
    env.socket.hang();
    await flush();
    expect(env.lost()).toBe(1);
    expect(normalisePaste(env.session.data.get(PASTE_KEY)).pauseReason).toBe("bridge-lost");
  });

  it("leaves a run the user started in the panel alone", async () => {
    const env = await connected();
    env.setState({ ...startPaste("S", [["artist", "A"]]), auto: "running" });
    env.socket.hang();
    await flush();
    expect(env.lost()).toBe(0);
  });

  it("pauses a driven run at the next wake-up if the worker died with the socket", async () => {
    const env = setup();
    await env.session.set(DRIVEN_KEY, true);
    env.setState({ ...startPaste("S", [["artist", "A"]]), auto: "running" });
    await env.client.start();
    expect(env.lost()).toBe(1);
    expect(await env.session.get(DRIVEN_KEY)).toBe(false);
  });

  it("reconnects after a back-off", async () => {
    const env = await connected();
    env.socket.hang();
    await flush();
    const before = env.sockets.length;
    for (const t of env.timers.splice(0)) t.fn();
    await flush();
    expect(env.sockets.length).toBeGreaterThan(before);
  });
});

const ALBUM = "https://music.apple.com/us/album/hit-me-hard-and-soft/1739659134";
const SONG = "https://music.apple.com/us/song/chihiro/1739659140";
const tab = (url: string, title: string, current = false, tabId = 1): OpenTab => ({ tabId, url, title, current });

/** The `pages` messages the desktop app has received. */
const pagesSent = (socket: FakeSocket): { pages: unknown[]; v: number }[] =>
  socket.sent.filter((m) => m["type"] === "pages") as never;

/** Run the debounce timer that is waiting, as the clock would. */
async function settle(env: { timers: { fn: () => void; ms: number }[] }): Promise<void> {
  const due = env.timers.splice(0).filter((t) => t.ms === PAGES_DEBOUNCE_MS);
  due.forEach((t) => {
    t.fn();
  });
  await flush();
}

describe("open Apple Music pages", () => {
  it("are sent right after the link authenticates, even when there are none", async () => {
    const env = setup();
    env.tabs.open = [
      tab(ALBUM, "Hit Me Hard And Soft by Billie Eilish on Apple Music", true),
      tab(SONG, "Chihiro", false, 2),
    ];
    await env.client.start();
    await flush();
    const socket = env.sockets[0];
    if (!socket) throw new Error("no socket");
    await welcome(socket);
    expect(pagesSent(socket)).toEqual([
      {
        type: "pages",
        v: 1,
        pages: [
          { url: ALBUM, title: "Billie Eilish - Hit Me Hard And Soft", kind: "album", current: true },
          { url: SONG, title: "Chihiro", kind: "song", current: false },
        ],
      },
    ]);
    const empty = await connected();
    expect(pagesSent(empty.socket)).toEqual([{ type: "pages", v: 1, pages: [] }]);
  });

  it("are not sent, and no tab is read, while nothing is paired", async () => {
    const env = setup({ secret: null });
    env.tabs.open = [tab(ALBUM, "A", true)];
    await env.client.start();
    env.client.refreshPages();
    await settle(env);
    expect(env.sockets).toHaveLength(0);
    expect(env.tabs.reads).toBe(0);
  });

  it("are not sent before the handshake is done", async () => {
    const env = setup();
    await env.client.start();
    await flush();
    const socket = env.sockets[0];
    if (!socket) throw new Error("no socket");
    env.client.refreshPages();
    await settle(env);
    expect(pagesSent(socket)).toHaveLength(0);
    expect(env.tabs.reads).toBe(0);
  });

  it("follow a burst of tab changes as one event, a moment after the last", async () => {
    const env = await connected();
    env.timers.length = 0;
    env.tabs.open = [tab(ALBUM, "A", true)];
    env.client.refreshPages();
    env.client.refreshPages();
    env.client.refreshPages();
    const waiting = env.timers.filter((t) => t.ms === PAGES_DEBOUNCE_MS);
    expect(waiting).toHaveLength(3);
    await settle(env);
    expect(pagesSent(env.socket)).toHaveLength(2);
    expect(pagesSent(env.socket)[1]?.pages).toHaveLength(1);
  });

  it("are not sent again when the list has not changed", async () => {
    const env = await connected();
    env.tabs.open = [tab(ALBUM, "A", true)];
    env.client.refreshPages();
    await settle(env);
    env.client.refreshPages();
    await settle(env);
    expect(pagesSent(env.socket)).toHaveLength(2);
    env.tabs.open = [tab(ALBUM, "A", false), tab(SONG, "B", true, 2)];
    env.client.refreshPages();
    await settle(env);
    expect(pagesSent(env.socket)).toHaveLength(3);
  });

  it("send only what the panel lists, at most twenty, with long titles cut", async () => {
    const env = await connected();
    env.tabs.open = [
      tab("https://music.apple.com/us/playlist/x/pl.1", "Not a page we list"),
      tab("https://example.com/us/album/x/1", "Elsewhere"),
      tab(`https://music.apple.com/us/album/long/1?q=${"x".repeat(3000)}`, "Address too long"),
      tab("https://music.apple.com/us/album/long-title/2", `${"t".repeat(300)} - Apple Music`),
      ...Array.from({ length: 30 }, (_, i) =>
        tab(`https://music.apple.com/us/song/s${String(i)}/${String(100 + i)}`, `S${String(i)}`, false, 10 + i),
      ),
    ];
    env.client.refreshPages();
    await settle(env);
    const pages = pagesSent(env.socket)[1]?.pages as { title: string; url: string }[];
    expect(pages).toHaveLength(20);
    expect(pages[0]?.title).toHaveLength(120);
    expect(pages.some((p) => p.url.includes("example.com") || p.url.includes("playlist"))).toBe(false);
    expect(pages.every((p) => p.url.length <= 2048)).toBe(true);
    for (const page of pages) expect(Object.keys(page).sort()).toEqual(["current", "kind", "title", "url"]);
  });

  it("stop with the link: nothing is sent after it drops or the user unpairs", async () => {
    const env = await connected();
    env.tabs.open = [tab(ALBUM, "A", true)];
    env.client.refreshPages();
    env.socket.hang();
    await settle(env);
    expect(pagesSent(env.socket)).toHaveLength(1);

    const second = await connected();
    second.tabs.open = [tab(ALBUM, "A", true)];
    second.client.refreshPages();
    await second.client.unpair();
    await settle(second);
    expect(pagesSent(second.socket)).toHaveLength(1);
  });

  it("start afresh on a new connection", async () => {
    const env = await connected();
    env.socket.hang();
    await flush();
    for (const t of env.timers.splice(0)) t.fn();
    await flush();
    const next = env.sockets[env.sockets.length - 1];
    if (!next || next === env.socket) throw new Error("no new socket");
    await welcome(next);
    expect(pagesSent(next)).toHaveLength(1);
  });
});
