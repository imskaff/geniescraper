"""The companion link's desktop side: pairing, origin checks, schema validation and message flow."""

from __future__ import annotations

import asyncio
import json

import pytest

from assistant import bridge as b

EXT_ORIGIN = "chrome-extension://" + "a" * 32
OTHER_ORIGIN = "chrome-extension://" + "b" * 32
SECRET = "ab" * 32


def status_state(**over):
    state = {
        "active": True,
        "auto": "off",
        "pauseReason": "",
        "title": "Song",
        "position": 0,
        "total": 3,
        "awaiting": False,
        "busy": False,
        "message": "",
        "tone": "info",
    }
    state.update(over)
    return state


def make_session(*, secret: str | None = SECRET, pairing=None, origin=EXT_ORIGIN, pinned=None, now=0.0):
    clock = {"t": now}
    session = b.ClientSession(
        secret=secret, pairing=pairing, origin=origin, pinned_origin=pinned, clock=lambda: clock["t"]
    )
    return session, clock


def hello(session, *, secret=SECRET, nonce="c" * 32):
    server_nonce = session.nonce
    return json.dumps(
        {
            "type": "hello",
            "v": 1,
            "nonce": nonce,
            "proof": b.compute_proof(secret, "client", server_nonce, nonce),
        }
    )


def ready_session(**kw):
    session, clock = make_session(**kw)
    reaction = session.receive(hello(session))
    assert reaction.close is None
    return session, clock


# --- pure helpers ---------------------------------------------------------------------------------------------


def test_secrets_and_codes_are_random_and_shaped():
    assert len(b.generate_secret()) == 64
    assert b.generate_secret() != b.generate_secret()
    code = b.generate_pairing_code()
    assert len(code) == 9 and code[4] == "-"
    assert b.generate_pairing_code() != b.generate_pairing_code()
    assert not set(code.replace("-", "")) & set("01OIL")


@pytest.mark.parametrize(
    "origin,pinned,ok",
    [
        (EXT_ORIGIN, None, True),
        (EXT_ORIGIN, EXT_ORIGIN, True),
        (OTHER_ORIGIN, EXT_ORIGIN, False),
        (None, None, False),
        ("", None, False),
        ("https://genius.com", None, False),
        ("http://127.0.0.1:3000", None, False),
        ("null", None, False),
        ("chrome-extension://" + "a" * 31, None, False),
        ("chrome-extension://" + "A" * 32, None, False),
        ("chrome-extension://" + "z" * 32, None, False),
        (EXT_ORIGIN + "/", None, False),
        (EXT_ORIGIN + ".evil.com", None, False),
        ("moz-extension://" + "a" * 32, None, False),
    ],
)
def test_origin_allows_only_an_extension_origin(origin, pinned, ok):
    assert b.origin_allowed(origin, pinned) is ok


@pytest.mark.parametrize(
    "host,ok",
    [
        ("127.0.0.1:47831", True),
        ("localhost:47831", False),
        ("127.0.0.1:1", False),
        ("evil.com:47831", False),
        ("127.0.0.1.evil.com:47831", False),
        ("127.0.0.1", False),
        (None, False),
    ],
)
def test_host_must_be_the_loopback_literal_on_our_port(host, ok):
    assert b.host_allowed(host, 47831) is ok


def test_proof_is_bound_to_role_both_nonces_and_secret():
    p = b.compute_proof(SECRET, "client", "n1", "n2")
    assert p == b.compute_proof(SECRET, "client", "n1", "n2")
    assert p != b.compute_proof(SECRET, "server", "n1", "n2")
    assert p != b.compute_proof(SECRET, "client", "n2", "n1")
    assert p != b.compute_proof("cd" * 32, "client", "n1", "n2")


# --- pairing window -------------------------------------------------------------------------------------------


def test_pairing_code_expires():
    clock = {"t": 0.0}
    w = b.PairingWindow(clock=lambda: clock["t"])
    assert not w.check("WRONG-CODE")
    assert w.check(w.code)
    w.renew()
    clock["t"] = b.PAIRING_TTL_S + 1
    assert not w.check(w.code)


def test_pairing_locks_after_repeated_failures_even_for_the_right_code():
    clock = {"t": 0.0}
    w = b.PairingWindow(clock=lambda: clock["t"])
    for _ in range(b.PAIRING_MAX_FAILURES):
        assert not w.check("WRONG-CODE")
    assert not w.check(w.code)
    w.renew()
    assert w.check(w.code)


def test_pairing_code_is_case_and_dash_insensitive():
    w = b.PairingWindow()
    assert w.check(w.code.lower().replace("-", " "))


def test_pairing_code_is_single_use():
    w = b.PairingWindow()
    code = w.code
    assert w.check(code)
    assert not w.check(code)


# --- authentication -------------------------------------------------------------------------------------------


def test_the_server_speaks_first_with_a_fresh_nonce():
    s1, _ = make_session()
    s2, _ = make_session()
    out = s1.start()
    assert out == {"type": "challenge", "v": 1, "nonce": s1.nonce}
    assert len(s1.nonce) == 32 and s1.nonce != s2.nonce


def test_hello_with_the_right_proof_gets_a_server_proof_and_becomes_ready():
    session, _ = make_session()
    reaction = session.receive(hello(session, nonce="c" * 32))
    assert reaction.close is None
    (welcome,) = reaction.sends
    assert welcome["type"] == "welcome"
    assert welcome["proof"] == b.compute_proof(SECRET, "server", session.nonce, "c" * 32)
    assert ("ready",) in reaction.events
    assert session.ready


def test_the_secret_never_appears_in_anything_the_server_sends():
    session, _ = make_session()
    sent = [session.start(), *session.receive(hello(session)).sends]
    assert SECRET not in json.dumps(sent)


def test_a_wrong_proof_closes_the_connection():
    session, _ = make_session()
    reaction = session.receive(hello(session, secret="cd" * 32))
    assert reaction.close is not None and reaction.close[0] == 1008
    assert not session.ready


def test_a_hello_from_a_different_origin_than_the_pinned_one_is_refused():
    session, _ = make_session(origin=OTHER_ORIGIN, pinned=EXT_ORIGIN)
    reaction = session.receive(hello(session))
    assert reaction.close is not None


def test_hello_when_nothing_is_paired_is_refused():
    session, _ = make_session(secret=None)
    reaction = session.receive(hello(session))
    assert reaction.close is not None


@pytest.mark.parametrize(
    "message",
    [
        {"type": "status", "state": status_state()},
        {"type": "ack", "id": 1, "ok": True},
        {"type": "pong"},
        {"type": "begin", "id": 1},
        "not json {",
        "[]",
        "5",
    ],
)
def test_nothing_but_hello_or_pair_is_accepted_before_authentication(message):
    session, _ = make_session()
    raw = message if isinstance(message, str) else json.dumps(message)
    reaction = session.receive(raw)
    assert reaction.close is not None
    assert reaction.events == []
    assert not session.ready


def test_the_authentication_deadline():
    session, clock = make_session()
    assert not session.expired()
    clock["t"] = b.AUTH_TIMEOUT_S + 0.1
    assert session.expired()
    session2, clock2 = make_session()
    session2.receive(hello(session2))
    clock2["t"] = 1000
    assert not session2.expired()


def test_binary_and_oversized_frames_are_refused():
    session, _ = make_session()
    assert session.receive(b"\x00\x01").close is not None
    session, _ = make_session()
    assert session.receive("x" * (b.MAX_MESSAGE_BYTES + 1)).close is not None
    session, _ = make_session()
    assert session.receive("é" * (b.MAX_MESSAGE_BYTES // 2 + 1)).close is not None


def test_a_hello_replay_after_ready_is_refused():
    session, _ = ready_session()
    assert session.receive(hello(session)).close is not None


# --- pairing over the wire -------------------------------------------------------------------------------------


def test_pair_with_the_right_code_hands_out_a_new_secret_once_and_pins_the_origin():
    window = b.PairingWindow()
    session, _ = make_session(secret=None, pairing=window)
    reaction = session.receive(json.dumps({"type": "pair", "v": 1, "code": window.code}))
    assert reaction.close is None
    (paired,) = reaction.sends
    assert paired["type"] == "paired" and len(paired["secret"]) == 64
    assert ("paired", paired["secret"], EXT_ORIGIN) in reaction.events
    assert session.ready
    # The one-time code is spent.
    again, _ = make_session(secret=None, pairing=window)
    assert again.receive(json.dumps({"type": "pair", "v": 1, "code": window.code})).close is not None


def test_pair_with_a_wrong_code_or_without_a_pairing_window_closes():
    window = b.PairingWindow()
    session, _ = make_session(secret=None, pairing=window)
    assert session.receive(json.dumps({"type": "pair", "v": 1, "code": "AAAA-AAAA"})).close is not None
    session, _ = make_session(secret=None, pairing=None)
    assert session.receive(json.dumps({"type": "pair", "v": 1, "code": window.code})).close is not None


# --- schema validation of what the extension sends -------------------------------------------------------------


@pytest.mark.parametrize(
    "message",
    [
        {"type": "status", "state": status_state(auto="sideways")},
        {"type": "status", "state": status_state(position=-1)},
        {"type": "status", "state": status_state(position=True)},
        {"type": "status", "state": status_state(total=10**9)},
        {"type": "status", "state": status_state(message="x" * 600)},
        {"type": "status", "state": status_state(tone="loud")},
        {"type": "status", "state": {**status_state(), "extra": 1}},
        {"type": "status", "state": {k: v for k, v in status_state().items() if k != "busy"}},
        {"type": "status", "state": "nope"},
        {"type": "status"},
        {"type": "ack", "id": "1", "ok": True},
        {"type": "ack", "id": 1},
        {"type": "ack", "id": 1, "ok": False, "error": {"code": "x"}},
        {"type": "ack", "id": 1, "ok": False, "error": {"code": "tab-failed", "message": "m" * 600}},
        {"type": "mystery"},
        {"v": 1},
        {"type": "begin", "id": 1, "title": "t", "queue": [], "mode": "auto"},
    ],
)
def test_invalid_messages_after_authentication_close_the_connection(message):
    session, _ = ready_session()
    reaction = session.receive(json.dumps(message))
    assert reaction.close is not None
    assert reaction.events == []


def test_valid_status_ack_and_pong_become_events():
    session, _ = ready_session()
    state = status_state(position=2, message="Filled.")
    assert session.receive(json.dumps({"type": "status", "state": state})).events == [("status", state)]
    err = {"code": "tab-failed", "message": "Open the form."}
    assert session.receive(json.dumps({"type": "ack", "id": 4, "ok": False, "error": err})).events == [
        ("ack", 4, False, err)
    ]
    assert session.receive(json.dumps({"type": "ack", "id": 5, "ok": True})).events == [("ack", 5, True, None)]
    assert session.receive(json.dumps({"type": "pong"})).events == []


def test_scraped_text_in_a_status_is_data_only():
    session, _ = ready_session()
    nasty = '{"type":"begin"} <script>alert(1)</script>'
    reaction = session.receive(json.dumps({"type": "status", "state": status_state(message=nasty)}))
    assert reaction.close is None
    assert reaction.events[0][1]["message"] == nasty
    assert reaction.sends == []


# --- commands the desktop sends --------------------------------------------------------------------------------


def test_begin_builds_a_checked_command():
    queue = [("written_by", "A"), ("role", "Vocals"), ("artist", "B")]
    cmd = b.make_command(7, "begin", title="Song", queue=queue, mode="auto")
    assert cmd == {
        "type": "begin",
        "v": 1,
        "id": 7,
        "title": "Song",
        "queue": [["written_by", "A"], ["role", "Vocals"], ["artist", "B"]],
        "mode": "auto",
    }
    json.dumps(cmd)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"title": "t", "queue": [("bogus", "x")], "mode": "auto"},
        {"title": "t", "queue": [("artist", 5)], "mode": "auto"},
        {"title": "t", "queue": [("artist", "x" * (b.MAX_TEXT + 1))], "mode": "auto"},
        {"title": "t", "queue": [("artist", "x")] * (b.MAX_QUEUE_ITEMS + 1), "mode": "auto"},
        {"title": "t", "queue": [("artist", "x")], "mode": "turbo"},
        {"title": "x" * (b.MAX_TEXT + 1), "queue": [], "mode": "auto"},
    ],
)
def test_begin_refuses_bad_input(kwargs):
    with pytest.raises(b.ProtocolError):
        b.make_command(1, "begin", **kwargs)


def test_a_full_album_sized_queue_fits_in_one_message():
    queue = [("artist", "n" * 200)] * b.MAX_QUEUE_ITEMS
    raw = json.dumps(b.make_command(1, "begin", title="t", queue=queue, mode="manual"))
    assert len(raw.encode()) < b.MAX_MESSAGE_BYTES * 4  # outbound limit is the extension's, not ours


@pytest.mark.parametrize("name", ["fill-next", "back", "skip", "pause", "resume", "stop", "get-status"])
def test_simple_commands(name):
    assert b.make_command(3, name) == {"type": name, "v": 1, "id": 3}


def test_unknown_command_is_refused():
    with pytest.raises(b.ProtocolError):
        b.make_command(1, "detect")
    with pytest.raises(b.ProtocolError):
        b.make_command(1, "scrape-track")


# --- the Bridge façade with a fake connection ------------------------------------------------------------------


class FakeConn:
    def __init__(self):
        self.sent: list[dict] = []
        self.closed = None

    async def send(self, raw: str):
        self.sent.append(json.loads(raw))

    async def close(self, code: int, reason: str):
        self.closed = (code, reason)

    def __aiter__(self):
        return self

    async def __anext__(self):
        await asyncio.Event().wait()


async def test_bridge_runs_a_command_and_delivers_status_and_ack_to_callbacks():
    statuses, connections = [], []
    bridge = b.Bridge(
        secret=SECRET,
        on_status=statuses.append,
        on_connection=connections.append,
        on_paired=lambda *a: None,
    )
    conn = FakeConn()
    task = asyncio.create_task(bridge._serve(conn, EXT_ORIGIN))
    await asyncio.sleep(0)
    assert conn.sent[0]["type"] == "challenge"
    nonce = conn.sent[0]["nonce"]
    await bridge._feed(
        conn,
        json.dumps(
            {"type": "hello", "v": 1, "nonce": "c" * 32, "proof": b.compute_proof(SECRET, "client", nonce, "c" * 32)}
        ),
    )
    assert conn.sent[1]["type"] == "welcome"
    assert connections == [True]

    fut = bridge.send_command("fill-next")
    for _ in range(5):
        await asyncio.sleep(0)
    assert conn.sent[-1] == {"type": "fill-next", "v": 1, "id": 1}
    await bridge._feed(conn, json.dumps({"type": "ack", "id": 1, "ok": True}))
    assert fut.result(timeout=1) == (True, None)

    state = status_state(position=1)
    await bridge._feed(conn, json.dumps({"type": "status", "state": state}))
    assert statuses == [state]
    task.cancel()


async def test_bridge_closes_on_a_protocol_violation_and_reports_disconnect():
    connections = []
    bridge = b.Bridge(secret=SECRET, on_connection=connections.append)
    conn = FakeConn()
    task = asyncio.create_task(bridge._serve(conn, EXT_ORIGIN))
    await asyncio.sleep(0)
    await bridge._feed(conn, "garbage")
    assert conn.closed is not None and conn.closed[0] == 1008
    assert connections == []
    task.cancel()


def test_send_command_without_a_connection_raises():
    bridge = b.Bridge(secret=SECRET)
    with pytest.raises(b.NotConnected):
        bridge.send_command("fill-next")


# --- the real socket, with the websockets library as the fake client -------------------------------------------


websockets = pytest.importorskip("websockets")


async def connect(port, *, origin: str | None = EXT_ORIGIN, host=None):
    headers = {"Host": host} if host else None
    return await websockets.connect(f"ws://127.0.0.1:{port}/", origin=origin, additional_headers=headers)


async def authenticate(ws, secret=SECRET):
    challenge = json.loads(await ws.recv())
    nonce = "d" * 32
    await ws.send(
        json.dumps(
            {
                "type": "hello",
                "v": 1,
                "nonce": nonce,
                "proof": b.compute_proof(secret, "client", challenge["nonce"], nonce),
            }
        )
    )
    welcome = json.loads(await ws.recv())
    assert welcome["proof"] == b.compute_proof(secret, "server", challenge["nonce"], nonce)


@pytest.fixture
async def running():
    statuses, conns = [], []
    bridge = b.Bridge(secret=SECRET, ports=(0,), on_status=statuses.append, on_connection=conns.append)
    await bridge.start_async()
    yield bridge, statuses, conns
    await bridge.stop_async()


async def test_end_to_end_over_a_real_socket(running):
    bridge, statuses, conns = running
    async with await connect(bridge.port) as ws:
        await authenticate(ws)
        await asyncio.sleep(0.05)
        assert conns == [True]
        fut = bridge.send_command("begin", title="S", queue=[("written_by", "A")], mode="auto")
        cmd = json.loads(await asyncio.wait_for(ws.recv(), 2))
        assert cmd["type"] == "begin" and cmd["queue"] == [["written_by", "A"]]
        await ws.send(json.dumps({"type": "ack", "id": cmd["id"], "ok": True}))
        await ws.send(json.dumps({"type": "status", "state": status_state()}))
        assert await asyncio.wrap_future(fut) == (True, None)
        await asyncio.sleep(0.05)
        assert statuses == [status_state()]
    await asyncio.sleep(0.05)
    assert conns == [True, False]


async def test_a_web_page_origin_is_refused_at_the_handshake(running):
    bridge, *_ = running
    with pytest.raises(websockets.exceptions.InvalidStatus) as err:
        await connect(bridge.port, origin="https://genius.com")
    assert err.value.response.status_code == 403


async def test_no_origin_is_refused_at_the_handshake(running):
    bridge, *_ = running
    with pytest.raises(websockets.exceptions.InvalidStatus):
        await connect(bridge.port, origin=None)


async def test_a_rebinding_host_header_is_refused(running):
    bridge, *_ = running
    with pytest.raises(websockets.exceptions.InvalidStatus):
        await connect(bridge.port, host="evil.com")


async def test_an_oversized_frame_ends_the_connection(running):
    bridge, *_ = running
    async with await connect(bridge.port) as ws:
        await authenticate(ws)
        await ws.send("x" * (b.MAX_MESSAGE_BYTES + 10))
        with pytest.raises(websockets.exceptions.ConnectionClosed):
            await asyncio.wait_for(ws.recv(), 2)


async def test_a_silent_client_is_dropped_at_the_deadline(monkeypatch):
    monkeypatch.setattr(b, "AUTH_TIMEOUT_S", 0.2)
    bridge = b.Bridge(secret=SECRET, ports=(0,))
    await bridge.start_async()
    try:
        async with await connect(bridge.port) as ws:
            await ws.recv()  # the challenge
            with pytest.raises(websockets.exceptions.ConnectionClosed):
                await asyncio.wait_for(ws.recv(), 2)
    finally:
        await bridge.stop_async()


async def test_pairing_over_a_real_socket_returns_the_secret_to_the_callback():
    paired = []
    bridge = b.Bridge(secret=None, ports=(0,), on_paired=lambda secret, origin: paired.append((secret, origin)))
    code = bridge.begin_pairing()
    await bridge.start_async()
    try:
        async with await connect(bridge.port) as ws:
            await ws.recv()
            await ws.send(json.dumps({"type": "pair", "v": 1, "code": code}))
            msg = json.loads(await ws.recv())
            assert msg["type"] == "paired"
        await asyncio.sleep(0.05)
        assert paired == [(msg["secret"], EXT_ORIGIN)]
    finally:
        await bridge.stop_async()


async def test_the_server_listens_on_loopback_only(running):
    bridge, *_ = running
    assert bridge.host == "127.0.0.1"
    for sock in bridge._server.sockets:
        assert sock.getsockname()[0] == "127.0.0.1"


async def test_a_second_client_is_refused_while_one_is_connected(running):
    bridge, *_ = running
    async with await connect(bridge.port) as first:
        await authenticate(first)
        async with await connect(bridge.port) as second:
            with pytest.raises(websockets.exceptions.ConnectionClosed):
                while True:
                    await asyncio.wait_for(second.recv(), 2)


async def test_an_expired_pairing_window_is_dropped_and_the_pin_holds():
    now = {"t": 0.0}
    bridge = b.Bridge(secret=SECRET, pinned_origin=EXT_ORIGIN, ports=(0,))
    bridge._pairing = b.PairingWindow(clock=lambda: now["t"])
    await bridge.start_async()
    try:
        with pytest.raises(websockets.exceptions.InvalidStatus):
            await connect(bridge.port, origin=OTHER_ORIGIN)  # pinned even while a window is open
        now["t"] = b.PAIRING_TTL_S + 1
        with pytest.raises(websockets.exceptions.InvalidStatus):
            await connect(bridge.port, origin=OTHER_ORIGIN)
        async with await connect(bridge.port) as ws:
            await authenticate(ws)  # the paired extension still gets in
        assert bridge._pairing is None  # the dead window is gone, not just ignored
    finally:
        await bridge.stop_async()


async def test_a_cancelled_pairing_code_no_longer_pairs():
    bridge = b.Bridge(secret=None, ports=(0,))
    code = bridge.begin_pairing()
    bridge.cancel_pairing()
    await bridge.start_async()
    try:
        async with await connect(bridge.port) as ws:
            await ws.recv()
            await ws.send(json.dumps({"type": "pair", "v": 1, "code": code}))
            with pytest.raises(websockets.exceptions.ConnectionClosed):
                await asyncio.wait_for(ws.recv(), 2)
    finally:
        await bridge.stop_async()


def test_a_locked_pairing_window_is_not_alive():
    w = b.PairingWindow()
    for _ in range(b.PAIRING_MAX_FAILURES):
        w.check("WRONG-CODE")
    assert not w.alive


# --- the open Apple Music pages -----------------------------------------------------------------------------------

ALBUM_URL = "https://music.apple.com/us/album/hit-me-hard-and-soft/1739659134"
SONG_URL = "https://music.apple.com/us/song/chihiro/1739659140"


def page(**over):
    base = {"url": ALBUM_URL, "title": "Hit Me Hard And Soft", "kind": "album", "current": True}
    base.update(over)
    return base


def pages_event(session, pages):
    return session.receive(json.dumps({"type": "pages", "v": 1, "pages": pages}))


def test_valid_pages_become_an_event():
    session, _ = ready_session()
    reaction = pages_event(session, [page(), page(url=SONG_URL, title="Chihiro", kind="song", current=False)])
    assert reaction.close is None
    assert reaction.events == [("pages", [page(), page(url=SONG_URL, title="Chihiro", kind="song", current=False)])]
    assert pages_event(session, []).events == [("pages", [])]


@pytest.mark.parametrize("pages", ["nope", None, {"a": 1}, 5])
def test_pages_of_the_wrong_shape_close_the_connection(pages):
    session, _ = ready_session()
    reaction = pages_event(session, pages)
    assert reaction.close is not None
    assert reaction.events == []


@pytest.mark.parametrize(
    "hostile",
    [
        page(url="http://music.apple.com/us/album/x/1"),
        page(url="https://music.apple.com.evil.example/us/album/x/1"),
        page(url="https://evil.example/music.apple.com/us/album/x/1"),
        page(url="https://music.apple.com@evil.example/us/album/x/1"),
        page(url="https://evil.example\\@music.apple.com/us/album/x/1"),
        page(url="https://user:pw@music.apple.com/us/album/x/1"),
        page(url="https://music.apple.com:8443/us/album/x/1"),
        page(url="https://MUSIC.apple.com/us/album/x/1"),
        page(url="https://music.apple.com/us/album/x/1 evil"),
        page(url="https://music.apple.com/us/album/x/1\n"),
        page(url="javascript:alert(1)"),
        page(url="file:///C:/Windows/win.ini"),
        page(url="https://music.apple.com/" + "a" * 2100),
        page(url=""),
        page(url=7),
        page(title=None),
        page(kind="playlist"),
        page(kind=None),
        page(current="yes"),
        page(current=1),
        {**page(), "extra": 1},
        {k: v for k, v in page().items() if k != "kind"},
        "https://music.apple.com/us/album/x/1",
        None,
        ["x"],
        7,
    ],
)
def test_hostile_page_entries_are_dropped_and_the_good_ones_kept(hostile):
    session, _ = ready_session()
    reaction = pages_event(session, [hostile, page(url=SONG_URL, title="Chihiro", kind="song", current=False)])
    assert reaction.close is None
    assert reaction.events == [("pages", [page(url=SONG_URL, title="Chihiro", kind="song", current=False)])]


@pytest.mark.parametrize(
    ("raw", "shown"),
    [
        ("Some\u00a0Album\u2009Name", "Some Album Name"),  # no-break and thin spaces, which Apple's titles can hold
        ("Em\u3000space \u2003 em", "Em space em"),
        ("Two\tcolumns\nand newline", "Two columns and newline"),
        ("Bad\x07Title\x00", "BadTitle"),
        ("Private\ue000use", "Privateuse"),
        ("\u200eCHIHIRO\u200f", "CHIHIRO"),
        ("\u202eevil\u202c title", "evil title"),  # right-to-left override: it could reorder what is shown
        ("\U0001f525 Emoji \U0001f3b6", "\U0001f525 Emoji \U0001f3b6"),
        ("  padded  ", "padded"),
        ("t" * 121, "t" * 119 + "\u2026"),
    ],
)
def test_a_title_is_cleaned_not_the_reason_to_lose_the_page(raw, shown):
    session, _ = ready_session()
    reaction = pages_event(session, [page(title=raw)])
    assert reaction.close is None
    assert reaction.events == [("pages", [page(title=shown)])]


@pytest.mark.parametrize("raw", ["", "   ", "\u200b\u200b", "\x07\x00"])
def test_a_title_with_nothing_left_is_named_by_its_kind(raw):
    session, _ = ready_session()
    assert pages_event(session, [page(title=raw)]).events == [("pages", [page(title="Apple Music album")])]
    song = page(url=SONG_URL, title=raw, kind="song", current=False)
    assert pages_event(session, [song]).events == [("pages", [{**song, "title": "Apple Music song"}])]


def test_at_most_twenty_pages_are_kept():
    session, _ = ready_session()
    many = [page(url=f"https://music.apple.com/us/song/s{n}/{100 + n}", title=f"S{n}", kind="song") for n in range(60)]
    kept = pages_event(session, many).events[0][1]
    assert len(kept) == b.MAX_PAGES == 20
    assert [p["title"] for p in kept] == [f"S{n}" for n in range(20)]


def test_page_titles_are_data_only():
    session, _ = ready_session()
    nasty = '{"type":"begin"} <script>alert(1)</script>'
    reaction = pages_event(session, [page(title=nasty)])
    assert reaction.close is None and reaction.sends == []
    assert reaction.events == [("pages", [page(title=nasty)])]


def test_pages_before_authentication_are_refused():
    session, _ = make_session()
    reaction = session.receive(json.dumps({"type": "pages", "v": 1, "pages": []}))
    assert reaction.close is not None and reaction.events == []


async def test_bridge_delivers_pages_to_its_callback():
    got = []
    bridge = b.Bridge(secret=SECRET, on_pages=got.append)
    conn = FakeConn()
    task = asyncio.create_task(bridge._serve(conn, EXT_ORIGIN))
    await asyncio.sleep(0)
    nonce = conn.sent[0]["nonce"]
    await bridge._feed(
        conn,
        json.dumps(
            {"type": "hello", "v": 1, "nonce": "c" * 32, "proof": b.compute_proof(SECRET, "client", nonce, "c" * 32)}
        ),
    )
    await bridge._feed(conn, json.dumps({"type": "pages", "v": 1, "pages": [page(), {"url": "http://x"}]}))
    assert got == [[page()]]
    task.cancel()
