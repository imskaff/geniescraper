"""Companion link between the desktop app and the Géniescraper browser extension.

The desktop app listens on 127.0.0.1 only. The extension's service worker connects, proves it knows the pairing
secret, and then runs the fill engine it already has on the user's own Genius tab, driven by the commands sent here.
The desktop app never sees a Genius credential and never starts a browser.

Layout:
  - Pure helpers and ``ClientSession``: authentication, schema validation, size limits. No sockets, no threads,
    so they are tested against a fake client.
  - ``Bridge``: the thread-safe façade the GUI uses, with the ``websockets`` server as a thin adapter.

The protocol and its threat model are in docs/extension-plan.md, section 39.
Everything received is data: it is parsed as JSON, checked field by field, and never evaluated.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import re
import secrets
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future
from hashlib import sha256
from http import HTTPStatus
from typing import Any, TypeGuard

PROTOCOL_VERSION = 1
HOST = "127.0.0.1"
#: The extension tries these in order, so the user never types a port.
DEFAULT_PORTS: tuple[int, ...] = (47831, 47832, 47833, 47834, 47835)
#: Largest message accepted from the extension, in bytes. A status is well under 2 KiB.
MAX_MESSAGE_BYTES = 64 * 1024
MAX_QUEUE_ITEMS = 500
MAX_TEXT = 2000
MAX_STATUS_TEXT = 500
#: Seconds a new connection has to authenticate before it is dropped.
AUTH_TIMEOUT_S = 5.0
#: A pairing code works for this long, for one pairing, and dies after this many wrong guesses.
PAIRING_TTL_S = 120.0
PAIRING_MAX_FAILURES = 5
#: The desktop pings this often; it also keeps the extension's service worker awake.
HEARTBEAT_S = 20.0

#: The kinds ``SongCredits.typed_queue`` produces; the extension accepts exactly these.
QUEUE_KINDS = frozenset(
    {
        "written_by",
        "produced_by",
        "role",
        "artist",
        "copyright_role",
        "phonographic_copyright",
        "copyright_notice",
        "youtube_url",
        "cover_art",
    }
)
SIMPLE_COMMANDS = frozenset({"fill-next", "back", "skip", "pause", "resume", "stop", "get-status"})
_AUTO_MODES = frozenset({"off", "running", "paused"})
_TONES = frozenset({"info", "ok", "attention"})
_PAUSE_REASONS = frozenset({"", "user", "input", "panel-closed", "page-changed", "problem", "bridge-lost"})

_ORIGIN_RE = re.compile(r"chrome-extension://[a-p]{32}")
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_CLOSE_POLICY = 1008
_CLOSE_BUSY = 1013


class ProtocolError(ValueError):
    """A message or argument that does not fit the protocol."""


class NotConnected(RuntimeError):
    """No authenticated extension is connected."""


# --- pure helpers ---------------------------------------------------------------------------------------------


def generate_secret() -> str:
    return secrets.token_hex(32)


def generate_pairing_code() -> str:
    raw = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def _normalise_code(code: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", code.upper())


def origin_allowed(origin: str | None, pinned: str | None = None) -> bool:
    """Only an extension origin. A web page cannot forge the header, but any local process can: the secret is the gate."""
    if not origin or _ORIGIN_RE.fullmatch(origin) is None:
        return False
    return pinned is None or origin == pinned


def host_allowed(host: str | None, port: int) -> bool:
    """The Host header must be the loopback literal on our port; anything else is a DNS-rebinding attempt."""
    return host == f"{HOST}:{port}"


def compute_proof(secret: str, role: str, server_nonce: str, client_nonce: str) -> str:
    message = f"{role}|{server_nonce}|{client_nonce}".encode()
    return hmac.new(secret.encode(), message, sha256).hexdigest()


class PairingWindow:
    """A short one-time code the user types into the extension once."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self.renew()

    def renew(self) -> str:
        self.code = generate_pairing_code()
        self._expires = self._clock() + PAIRING_TTL_S
        self._failures = 0
        self._spent = False
        return self.code

    def check(self, attempt: str) -> bool:
        if self._spent or self._failures >= PAIRING_MAX_FAILURES or self._clock() > self._expires:
            return False
        if hmac.compare_digest(_normalise_code(attempt).encode(), _normalise_code(self.code).encode()):
            self._spent = True
            return True
        self._failures += 1
        return False


# --- message validation ---------------------------------------------------------------------------------------


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _text(value: Any, limit: int) -> TypeGuard[str]:
    return isinstance(value, str) and len(value) <= limit


def _check_state(state: Any) -> dict[str, Any]:
    keys = {"active", "auto", "pauseReason", "title", "position", "total", "awaiting", "busy", "message", "tone"}
    if not isinstance(state, dict) or set(state) != keys:
        raise ProtocolError("status: wrong fields")
    ok = (
        isinstance(state["active"], bool)
        and state["auto"] in _AUTO_MODES
        and state["pauseReason"] in _PAUSE_REASONS
        and _text(state["title"], MAX_STATUS_TEXT)
        and _is_int(state["position"])
        and 0 <= state["position"] <= MAX_QUEUE_ITEMS
        and _is_int(state["total"])
        and 0 <= state["total"] <= MAX_QUEUE_ITEMS
        and isinstance(state["awaiting"], bool)
        and isinstance(state["busy"], bool)
        and _text(state["message"], MAX_STATUS_TEXT)
        and state["tone"] in _TONES
    )
    if not ok:
        raise ProtocolError("status: bad value")
    return state


def _check_error(error: Any) -> dict[str, str]:
    if (
        not isinstance(error, dict)
        or set(error) != {"code", "message"}
        or not _text(error["code"], 40)
        or not _text(error["message"], MAX_STATUS_TEXT)
    ):
        raise ProtocolError("ack: bad error")
    return error


def parse_message(raw: str | bytes) -> dict[str, Any]:
    """Parse one frame into a dict with a string ``type``; anything else is a protocol error."""
    if not isinstance(raw, str):
        raise ProtocolError("text frames only")
    if len(raw) > MAX_MESSAGE_BYTES or len(raw.encode("utf-8", "replace")) > MAX_MESSAGE_BYTES:
        raise ProtocolError("message too large")
    try:
        message = json.loads(raw)
    except ValueError as exc:
        raise ProtocolError("not JSON") from exc
    if not isinstance(message, dict) or not isinstance(message.get("type"), str):
        raise ProtocolError("no type")
    return message


def make_command(command_id: int, name: str, **fields: Any) -> dict[str, Any]:
    """Build a command for the extension, checked the way the extension will check it."""
    if name == "begin":
        title, queue, mode = fields.get("title"), fields.get("queue"), fields.get("mode")
        if not _text(title, MAX_TEXT) or mode not in ("auto", "manual") or not isinstance(queue, (list, tuple)):
            raise ProtocolError("begin: bad title, mode or queue")
        if len(queue) > MAX_QUEUE_ITEMS:
            raise ProtocolError("begin: queue too long")
        items: list[list[str]] = []
        for pair in queue:
            if len(pair) != 2 or pair[0] not in QUEUE_KINDS or not _text(pair[1], MAX_TEXT):
                raise ProtocolError("begin: bad queue item")
            items.append([pair[0], pair[1]])
        return {"type": "begin", "v": PROTOCOL_VERSION, "id": command_id, "title": title, "queue": items, "mode": mode}
    if name in SIMPLE_COMMANDS and not fields:
        return {"type": name, "v": PROTOCOL_VERSION, "id": command_id}
    raise ProtocolError(f"unknown command {name!r}")


# --- one connection's protocol state --------------------------------------------------------------------------


class Reaction:
    def __init__(
        self,
        sends: list[dict[str, Any]] | None = None,
        close: tuple[int, str] | None = None,
        events: list[tuple[Any, ...]] | None = None,
    ) -> None:
        self.sends = sends or []
        self.close = close
        self.events = events or []


def _refuse(reason: str) -> Reaction:
    return Reaction(close=(_CLOSE_POLICY, reason))


class ClientSession:
    """The protocol state of one connection. Pure: ``receive`` returns what to send, close and report."""

    def __init__(
        self,
        *,
        secret: str | None,
        pairing: PairingWindow | None,
        origin: str | None,
        pinned_origin: str | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._secret = secret
        self._pairing = pairing
        self._origin = origin
        self._pinned = pinned_origin
        self._clock = clock
        self._started = clock()
        self.nonce = secrets.token_hex(16)
        self.ready = False

    def start(self) -> dict[str, Any]:
        return {"type": "challenge", "v": PROTOCOL_VERSION, "nonce": self.nonce}

    def expired(self) -> bool:
        return not self.ready and self._clock() - self._started > AUTH_TIMEOUT_S

    def receive(self, raw: str | bytes) -> Reaction:
        try:
            message = parse_message(raw)
            return self._ready(message) if self.ready else self._authenticate(message)
        except ProtocolError as exc:
            return _refuse(str(exc))

    def _authenticate(self, message: dict[str, Any]) -> Reaction:
        if message.get("v") != PROTOCOL_VERSION or not origin_allowed(self._origin, self._pinned):
            return _refuse("not allowed")
        client_nonce = message.get("nonce")
        if message["type"] == "hello":
            proof = message.get("proof")
            if self._secret is None or not _text(client_nonce, 64) or not _text(proof, 128):
                return _refuse("not allowed")
            expected = compute_proof(self._secret, "client", self.nonce, client_nonce)
            if not hmac.compare_digest(expected.encode(), proof.encode()):
                return _refuse("bad proof")
            self.ready = True
            welcome = {
                "type": "welcome",
                "v": PROTOCOL_VERSION,
                "proof": compute_proof(self._secret, "server", self.nonce, client_nonce),
            }
            return Reaction(sends=[welcome], events=[("ready",)])
        if message["type"] == "pair":
            code = message.get("code")
            if self._pairing is None or not _text(code, 32) or not self._pairing.check(code):
                return _refuse("pairing refused")
            self._secret = generate_secret()
            self._pinned = self._origin
            self.ready = True
            paired = {"type": "paired", "v": PROTOCOL_VERSION, "secret": self._secret}
            return Reaction(sends=[paired], events=[("paired", self._secret, self._origin), ("ready",)])
        return _refuse("authenticate first")

    def _ready(self, message: dict[str, Any]) -> Reaction:
        kind = message["type"]
        if kind == "pong":
            return Reaction()
        if kind == "status":
            return Reaction(events=[("status", _check_state(message.get("state")))])
        if kind == "ack":
            command_id, ok = message.get("id"), message.get("ok")
            if not _is_int(command_id) or not isinstance(ok, bool):
                raise ProtocolError("ack: bad fields")
            if ok:
                if "error" in message:
                    raise ProtocolError("ack: error on success")
                return Reaction(events=[("ack", command_id, True, None)])
            return Reaction(events=[("ack", command_id, False, _check_error(message.get("error")))])
        raise ProtocolError("unexpected message")


# --- the façade the GUI uses ----------------------------------------------------------------------------------


class Bridge:
    """Listens on 127.0.0.1 and talks to one paired extension at a time.

    Callbacks run on the bridge's own thread: a GUI must hand them over to its own thread (``after``).
    """

    def __init__(
        self,
        *,
        secret: str | None = None,
        pinned_origin: str | None = None,
        ports: tuple[int, ...] = DEFAULT_PORTS,
        on_status: Callable[[dict[str, Any]], None] | None = None,
        on_connection: Callable[[bool], None] | None = None,
        on_paired: Callable[[str, str], None] | None = None,
    ) -> None:
        self.host = HOST
        self.port = 0
        self.secret = secret
        self.pinned_origin = pinned_origin
        self._ports = ports
        self._on_status = on_status
        self._on_connection = on_connection
        self._on_paired = on_paired
        self._pairing: PairingWindow | None = None
        self._server: Any = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._conn: Any = None
        self._sessions: dict[Any, ClientSession] = {}
        self._pending: dict[int, Future[tuple[bool, dict[str, str] | None]]] = {}
        self._next_id = 0
        self._tasks: set[asyncio.Task[Any]] = set()

    # -- pairing and state --
    def begin_pairing(self) -> str:
        """Show this code to the user; it is good for two minutes and one pairing."""
        if self._pairing is None:
            self._pairing = PairingWindow()
            return self._pairing.code
        return self._pairing.renew()

    def forget_pairing(self) -> None:
        self.secret = None
        self.pinned_origin = None

    @property
    def connected(self) -> bool:
        return self._conn is not None

    # -- lifecycle --
    async def start_async(self) -> None:
        from websockets.asyncio.server import serve

        self._loop = asyncio.get_running_loop()
        last: Exception | None = None
        for port in self._ports:
            try:
                self._server = await serve(
                    self._handler,
                    self.host,
                    port,
                    process_request=self._check_handshake,
                    max_size=MAX_MESSAGE_BYTES,
                    compression=None,
                    ping_interval=None,
                    max_queue=8,
                )
                break
            except OSError as exc:
                last = exc
        if self._server is None:
            raise OSError(f"no free port among {self._ports}") from last
        self.port = self._server.sockets[0].getsockname()[1]
        self._spawn(self._heartbeat())

    async def stop_async(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

    def start(self) -> None:
        """Run the server on a background thread; returns once it is listening (or raises)."""
        ready: Future[None] = Future()

        def run() -> None:
            async def main() -> None:
                try:
                    await self.start_async()
                except Exception as exc:
                    ready.set_exception(exc)
                    return
                ready.set_result(None)
                await asyncio.Event().wait()

            try:
                asyncio.run(main())
            except asyncio.CancelledError:
                pass

        self._thread = threading.Thread(target=run, name="genie-bridge", daemon=True)
        self._thread.start()
        ready.result(timeout=10)

    def stop(self) -> None:
        loop = self._loop
        if loop is None or self._thread is None:
            return
        asyncio.run_coroutine_threadsafe(self.stop_async(), loop).result(timeout=5)
        for task in asyncio.all_tasks(loop):
            loop.call_soon_threadsafe(task.cancel)
        self._thread.join(timeout=5)
        self._thread = None

    # -- commands --
    def send_command(self, name: str, **fields: Any) -> Future[tuple[bool, dict[str, str] | None]]:
        """Send a command from any thread. The future resolves to ``(ok, error)`` when the extension answers."""
        if self._conn is None or self._loop is None:
            raise NotConnected("the extension is not connected")
        self._next_id += 1
        command_id = self._next_id
        command = make_command(command_id, name, **fields)
        future: Future[tuple[bool, dict[str, str] | None]] = Future()
        self._pending[command_id] = future
        conn = self._conn

        def dispatch() -> None:
            self._spawn(self._safe_send(conn, command, command_id))

        self._loop.call_soon_threadsafe(dispatch)
        return future

    async def _safe_send(self, conn: Any, message: dict[str, Any], command_id: int | None = None) -> None:
        try:
            await conn.send(json.dumps(message))
        except Exception:
            future = self._pending.pop(command_id, None) if command_id is not None else None
            if future is not None and not future.done():
                future.set_exception(NotConnected("connection lost"))

    def _spawn(self, coro: Any) -> None:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    # -- server plumbing --
    def _check_handshake(self, connection: Any, request: Any) -> Any:
        if not host_allowed(request.headers.get("Host"), self.port):
            return connection.respond(HTTPStatus.FORBIDDEN, "forbidden\n")
        if not origin_allowed(request.headers.get("Origin"), self.pinned_origin if self._pairing is None else None):
            return connection.respond(HTTPStatus.FORBIDDEN, "forbidden\n")
        return None

    async def _handler(self, ws: Any) -> None:
        await self._serve(ws, ws.request.headers.get("Origin"))

    async def _serve(self, conn: Any, origin: str | None) -> None:
        self._loop = asyncio.get_running_loop()
        if self._conn is not None or conn in self._sessions:
            await conn.close(_CLOSE_BUSY, "busy")
            return
        session = ClientSession(
            secret=self.secret,
            pairing=self._pairing,
            origin=origin,
            pinned_origin=self.pinned_origin,
        )
        self._sessions[conn] = session
        watchdog = asyncio.ensure_future(self._deadline(conn, session))
        try:
            await conn.send(json.dumps(session.start()))
            async for raw in conn:
                await self._feed(conn, raw)
        except Exception:
            pass
        finally:
            watchdog.cancel()
            self._drop(conn)

    async def _deadline(self, conn: Any, session: ClientSession) -> None:
        await asyncio.sleep(AUTH_TIMEOUT_S)
        if not session.ready:
            await conn.close(_CLOSE_POLICY, "too slow")

    async def _feed(self, conn: Any, raw: str | bytes) -> None:
        session = self._sessions.get(conn)
        if session is None:
            session = self._sessions[conn] = ClientSession(
                secret=self.secret, pairing=self._pairing, origin=None, pinned_origin=self.pinned_origin
            )
        reaction = session.receive(raw)
        for message in reaction.sends:
            await conn.send(json.dumps(message))
        for event in reaction.events:
            self._dispatch(conn, event)
        if reaction.close is not None:
            await conn.close(*reaction.close)

    def _dispatch(self, conn: Any, event: tuple[Any, ...]) -> None:
        kind = event[0]
        if kind == "paired":
            self.secret, self.pinned_origin = event[1], event[2]
            self._pairing = None
            self._call(self._on_paired, event[1], event[2])
        elif kind == "ready":
            self._conn = conn
            self._call(self._on_connection, True)
        elif kind == "status":
            self._call(self._on_status, event[1])
        elif kind == "ack":
            future = self._pending.pop(event[1], None)
            if future is not None and not future.done():
                future.set_result((event[2], event[3]))

    def _drop(self, conn: Any) -> None:
        self._sessions.pop(conn, None)
        if self._conn is conn:
            self._conn = None
            for future in self._pending.values():
                if not future.done():
                    future.set_exception(NotConnected("connection lost"))
            self._pending.clear()
            self._call(self._on_connection, False)

    @staticmethod
    def _call(callback: Callable[..., None] | None, *args: Any) -> None:
        if callback is None:
            return
        try:
            callback(*args)
        except Exception:
            pass

    async def _heartbeat(self) -> None:
        while True:
            await asyncio.sleep(HEARTBEAT_S)
            if self._conn is not None:
                await self._safe_send(self._conn, {"type": "ping", "v": PROTOCOL_VERSION})
