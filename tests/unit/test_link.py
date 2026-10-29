"""The GUI side of the companion link, driven by a fake bridge: no sockets, no Tk, no threads."""

from __future__ import annotations

from concurrent.futures import Future
from typing import Any

import pytest

from assistant.bridge import NotConnected
from gui import link
from gui.link import LinkController, LinkState, RunStatus, describe_status

SECRET = "ab" * 32
ORIGIN = "chrome-extension://" + "a" * 32
QUEUE = [("written_by", "A"), ("produced_by", "B"), ("role", "C")]


class FakeBridge:
    def __init__(self, secret: str | None, origin: str | None, callbacks: dict[str, Any], fail_start: bool = False):
        self.secret, self.origin, self.cb = secret, origin, callbacks
        self.connected = False
        self.started = self.stopped = False
        self.fail_start = fail_start
        self.sent: list[tuple[str, dict[str, Any], Future[Any]]] = []
        self.pairings = 0

    def start(self) -> None:
        if self.fail_start:
            raise OSError("no free port")
        self.started = True

    def stop(self) -> None:
        self.stopped = True

    def begin_pairing(self) -> str:
        self.pairings += 1
        return "ABCD-EFGH"

    def forget_pairing(self) -> None:
        self.secret = self.origin = None

    def send_command(self, name: str, **fields: Any) -> Future[Any]:
        if not self.connected:
            raise NotConnected("not connected")
        future: Future[Any] = Future()
        self.sent.append((name, fields, future))
        return future

    # what the real bridge's thread would do
    def connect(self) -> None:
        self.connected = True
        self.cb["on_connection"](True)

    def drop(self) -> None:
        self.connected = False
        self.cb["on_connection"](False)

    def names(self) -> list[str]:
        return [name for name, _, _ in self.sent]


def state(**over: Any) -> dict[str, Any]:
    base = {
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
    base.update(over)
    return base


class Rig:
    def __init__(self, secret: str | None = None, origin: str | None = None, fail_start: bool = False):
        self.bridges: list[FakeBridge] = []
        self.clock = 1000.0
        self.saved: list[tuple[str, str]] = []
        self.erased = 0
        self.events: list[tuple[Any, ...]] = []
        self.fail_start = fail_start

        def factory(secret: str | None, origin: str | None, callbacks: dict[str, Any]) -> FakeBridge:
            bridge = FakeBridge(secret, origin, callbacks, self.fail_start)
            self.bridges.append(bridge)
            return bridge

        self.link = LinkController(
            bridge_factory=factory,
            secret=secret,
            origin=origin,
            persist=lambda s, o: self.saved.append((s, o)),
            erase=self._erase,
            schedule=lambda fn: fn(),
            clock=lambda: self.clock,
        )
        self.link.on_status = lambda status: self.events.append(("status", status.position))
        self.link.on_finished = lambda: self.events.append(("finished",))
        self.link.on_run_ended = lambda: self.events.append(("run-ended",))
        self.link.on_connection = lambda up: self.events.append(("connection", up))

    def _erase(self) -> None:
        self.erased += 1

    @property
    def bridge(self) -> FakeBridge:
        return self.bridges[-1]

    def begun(self, mode: str = "manual", *, ack: bool = True) -> None:
        """Connect, start a run on the 3-item queue and (optionally) have the extension acknowledge it."""
        self.bridge.connect()
        assert self.link.start_run("Song", QUEUE, mode)
        if ack:
            self.bridge.sent[-1][2].set_result((True, None))


def rig_started(**kw: Any) -> Rig:
    rig = Rig(**kw)
    rig.link.start()
    return rig


# --- states ---------------------------------------------------------------------------------------------------


def test_state_walks_not_paired_waiting_connected_lost():
    rig = rig_started()
    assert rig.link.state is LinkState.NOT_PAIRED
    assert rig.link.begin_pairing() == "ABCD-EFGH"
    assert rig.link.state is LinkState.WAITING
    rig.bridge.cb["on_paired"](SECRET, ORIGIN)
    assert rig.saved == [(SECRET, ORIGIN)]
    assert rig.link.state is LinkState.WAITING and rig.link.pairing_code is None
    rig.bridge.connect()
    assert rig.link.state is LinkState.CONNECTED
    rig.bridge.drop()
    assert rig.link.state is LinkState.LOST
    rig.bridge.connect()
    assert rig.link.state is LinkState.CONNECTED


def test_a_stored_pairing_starts_in_waiting():
    rig = rig_started(secret=SECRET, origin=ORIGIN)
    assert rig.link.state is LinkState.WAITING
    assert rig.bridge.secret == SECRET and rig.bridge.origin == ORIGIN


def test_pairing_code_expires_after_two_minutes():
    rig = rig_started()
    rig.link.begin_pairing()
    assert rig.link.pairing_seconds_left() == 120
    rig.clock += 61
    assert rig.link.pairing_seconds_left() == 59
    assert rig.link.state is LinkState.WAITING
    rig.clock += 60
    assert rig.link.pairing_seconds_left() == 0
    assert rig.link.pairing_code is None
    assert rig.link.state is LinkState.NOT_PAIRED


def test_all_ports_busy_leaves_the_hotkeys_working():
    rig = rig_started(fail_start=True)
    assert rig.link.unavailable
    assert rig.link.begin_pairing() is None
    assert rig.link.state is LinkState.NOT_PAIRED
    assert not rig.link.start_run("Song", QUEUE, "manual")


def test_forget_clears_the_secret_drops_the_connection_and_listens_afresh():
    rig = rig_started(secret=SECRET, origin=ORIGIN)
    old = rig.bridge
    rig.begun()
    rig.link.forget()
    assert rig.erased == 1 and old.stopped
    assert len(rig.bridges) == 2 and rig.bridge.secret is None and rig.bridge.started
    assert rig.link.state is LinkState.NOT_PAIRED
    assert not rig.link.run_active and not rig.link.connected


def test_callbacks_of_a_replaced_bridge_are_ignored():
    rig = rig_started(secret=SECRET, origin=ORIGIN)
    old = rig.bridge
    rig.link.forget()
    old.cb["on_connection"](True)
    old.cb["on_status"](state())
    assert rig.link.state is LinkState.NOT_PAIRED
    assert ("connection", True) not in rig.events


def test_stop_stops_the_bridge():
    rig = rig_started()
    rig.link.stop()
    assert rig.bridge.stopped


# --- starting a run -------------------------------------------------------------------------------------------


def test_start_run_needs_a_connection():
    rig = rig_started(secret=SECRET)
    assert not rig.link.start_run("Song", QUEUE, "manual")
    assert not rig.link.run_active and rig.bridge.sent == []


def test_start_run_sends_begin_with_the_typed_queue():
    rig = rig_started(secret=SECRET)
    rig.bridge.connect()
    assert rig.link.start_run("Song", QUEUE, "auto")
    name, fields, _ = rig.bridge.sent[0]
    assert name == "begin" and fields == {"title": "Song", "queue": QUEUE, "mode": "auto"}
    assert rig.link.run_active and rig.link.bridged


def test_a_refused_begin_ends_the_run_and_says_why():
    rig = rig_started(secret=SECRET)
    rig.begun(ack=False)
    rig.bridge.sent[0][2].set_result((False, {"code": "busy", "message": "A session is already running."}))
    assert not rig.link.run_active and not rig.link.bridged
    assert rig.link.notice == "A session is already running."
    assert ("run-ended",) in rig.events


def test_begin_that_only_misses_the_genius_form_keeps_the_run():
    rig = rig_started(secret=SECRET)
    rig.begun(ack=False)
    rig.bridge.sent[0][2].set_result((False, {"code": "tab-failed", "message": "Open the Genius form."}))
    assert rig.link.run_active and rig.link.bridged
    assert rig.link.notice == "Open the Genius form."


def test_connection_lost_while_sending_ends_the_run():
    rig = rig_started(secret=SECRET)
    rig.begun(ack=False)
    rig.bridge.sent[0][2].set_exception(NotConnected("connection lost"))
    assert not rig.link.run_active


def test_resync_skips_to_where_the_desktop_already_was():
    rig = rig_started(secret=SECRET)
    rig.bridge.connect()
    assert rig.link.start_run("Song", QUEUE, "manual", resume_at=2)
    rig.bridge.sent[0][2].set_result((True, None))
    assert rig.bridge.names() == ["begin", "skip"]
    rig.bridge.sent[1][2].set_result((True, None))
    assert rig.bridge.names() == ["begin", "skip", "skip"]


# --- status ---------------------------------------------------------------------------------------------------


def test_status_moves_the_position_while_a_run_is_ours():
    rig = rig_started(secret=SECRET)
    rig.begun()
    rig.bridge.cb["on_status"](state(position=2, message="Filled."))
    assert ("status", 2) in rig.events
    assert rig.link.status is not None and rig.link.status.message == "Filled."


def test_status_is_ignored_without_a_run_or_for_another_queue():
    rig = rig_started(secret=SECRET)
    rig.bridge.connect()
    rig.bridge.cb["on_status"](state(position=1))
    assert not any(e[0] == "status" for e in rig.events)
    rig.begun()
    rig.bridge.cb["on_status"](state(position=1, total=9))
    assert not any(e[0] == "status" for e in rig.events)


def test_last_step_finishes_the_run_once():
    rig = rig_started(secret=SECRET)
    rig.begun()
    rig.bridge.cb["on_status"](state(position=3, active=False))
    rig.bridge.cb["on_status"](state(position=3, active=False))
    assert rig.events.count(("finished",)) == 1
    assert not rig.link.run_active


def test_an_inactive_snapshot_before_the_begin_is_acknowledged_is_not_the_end():
    rig = rig_started(secret=SECRET)
    rig.begun(ack=False)
    rig.bridge.cb["on_status"](state(active=False, position=0))
    assert rig.link.run_active
    rig.bridge.sent[0][2].set_result((True, None))
    rig.bridge.cb["on_status"](state(active=False, position=1))
    assert not rig.link.run_active and ("run-ended",) in rig.events


def test_a_drop_keeps_the_run_but_unbridges_it_and_a_return_rebridges():
    rig = rig_started(secret=SECRET)
    rig.begun()
    rig.bridge.drop()
    assert rig.link.run_active and not rig.link.bridged
    assert ("connection", False) in rig.events
    rig.bridge.connect()
    assert rig.link.bridged
    rig.bridge.cb["on_status"](state(auto="paused", pauseReason="bridge-lost", position=1))
    assert rig.link.status is not None and rig.link.status.pause_reason == "bridge-lost"


# --- commands -------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("name", ["back", "skip", "fill-next", "pause", "resume"])
def test_buttons_become_commands_while_bridged(name):
    rig = rig_started(secret=SECRET)
    rig.begun()
    assert rig.link.command(name)
    assert rig.bridge.names()[-1] == name


def test_commands_do_nothing_without_a_bridged_run():
    rig = rig_started(secret=SECRET)
    assert not rig.link.command("skip")
    rig.begun()
    rig.bridge.drop()
    assert not rig.link.command("skip")
    assert rig.link.command("nonsense") is False


def test_a_refused_command_is_shown():
    rig = rig_started(secret=SECRET)
    rig.begun()
    rig.link.command("fill-next")
    rig.bridge.sent[-1][2].set_result((False, {"code": "no-tab", "message": "Open the Genius form first."}))
    assert rig.link.notice == "Open the Genius form first."


def test_jump_forward_is_a_chain_of_skips_that_stops_on_a_refusal():
    rig = rig_started(secret=SECRET)
    rig.begun()
    assert rig.link.jump(2)
    assert rig.bridge.names() == ["begin", "skip"]
    rig.bridge.sent[1][2].set_result((True, None))
    assert rig.bridge.names() == ["begin", "skip", "skip"]
    rig.bridge.sent[2][2].set_result((False, {"code": "busy", "message": "Busy."}))
    assert rig.bridge.names() == ["begin", "skip", "skip"]
    assert rig.link.notice == "Busy."


def test_jump_back_uses_back():
    rig = rig_started(secret=SECRET)
    rig.begun()
    rig.link.jump(-1)
    assert rig.bridge.names()[-1] == "back"
    assert not rig.link.jump(0)


def test_end_run_sends_stop_once():
    rig = rig_started(secret=SECRET)
    rig.begun()
    rig.link.end_run()
    rig.link.end_run()
    assert rig.bridge.names() == ["begin", "stop"]
    assert not rig.link.run_active and rig.link.status is None


def test_end_run_while_disconnected_just_forgets_the_run():
    rig = rig_started(secret=SECRET)
    rig.begun()
    rig.bridge.drop()
    rig.link.end_run()
    assert not rig.link.run_active


# --- wording --------------------------------------------------------------------------------------------------


def status(**over: Any) -> RunStatus:
    return RunStatus.from_state(state(**over))


def test_describe_prefers_the_extensions_own_message():
    assert describe_status(status(message="Filled Written By.", tone="ok")) == ("Filled Written By.", "ok")


@pytest.mark.parametrize(
    "reason, expected",
    [
        ("bridge-lost", "link to the desktop app was lost"),
        ("user", "you paused"),
        ("panel-closed", "panel was closed"),
        ("page-changed", "page changed"),
        ("problem", "problem"),
        ("input", "input"),
    ],
)
def test_describe_explains_every_pause_reason(reason, expected):
    text, tone = describe_status(status(auto="paused", pauseReason=reason))
    assert expected in text.lower() and tone == "attention"


def test_describe_awaiting_a_choice():
    text, tone = describe_status(status(awaiting=True))
    assert "choose" in text.lower() or "pick" in text.lower()
    assert tone == "attention"


def test_describe_quiet_state_is_empty():
    assert describe_status(status()) == ("", "info")


def test_connection_wording_covers_every_state():
    for state_ in LinkState:
        assert link.state_label(state_)
        assert link.state_hint(state_, code="ABCD-EFGH", seconds_left=75)
    assert "1:15" in link.state_hint(LinkState.WAITING, code="ABCD-EFGH", seconds_left=75)
    assert "ABCD-EFGH" not in link.state_hint(LinkState.CONNECTED, code=None, seconds_left=0)


# --- the pages open in the browser ----------------------------------------------------------------------------

ALBUM = "https://music.apple.com/us/album/hit-me-hard-and-soft/1739659134"
SONG = "https://music.apple.com/us/song/chihiro/1739659140"
REPORT = [
    {"url": ALBUM, "title": "Hit Me Hard And Soft", "kind": "album", "current": True},
    {"url": SONG, "title": "Chihiro", "kind": "song", "current": False},
]


def test_pages_are_empty_until_an_extension_reports_them():
    rig = rig_started(secret=SECRET, origin=ORIGIN)
    assert rig.link.pages == ()
    rig.bridge.connect()
    assert rig.link.pages == ()


def test_the_reported_pages_are_kept_and_the_gui_told_once_per_change():
    rig = rig_started(secret=SECRET, origin=ORIGIN)
    told: list[int] = []
    rig.link.on_pages = lambda: told.append(len(rig.link.pages))
    rig.bridge.connect()
    rig.bridge.cb["on_pages"](REPORT)
    assert rig.link.pages == (
        link.OpenPage(ALBUM, "Hit Me Hard And Soft", "album", True),
        link.OpenPage(SONG, "Chihiro", "song", False),
    )
    rig.bridge.cb["on_pages"](REPORT)  # the same list again changes nothing
    rig.bridge.cb["on_pages"]([])
    assert rig.link.pages == () and told == [2, 0]


def test_the_pages_go_when_the_link_drops():
    rig = rig_started(secret=SECRET, origin=ORIGIN)
    rig.bridge.connect()
    rig.bridge.cb["on_pages"](REPORT)
    rig.bridge.drop()
    assert rig.link.pages == ()
    rig.bridge.cb["on_pages"](REPORT)  # a late report from the dropped link is ignored
    assert rig.link.pages == ()


def test_the_pages_go_when_the_pairing_is_forgotten():
    rig = rig_started(secret=SECRET, origin=ORIGIN)
    rig.bridge.connect()
    old = rig.bridge
    rig.bridge.cb["on_pages"](REPORT)
    rig.link.forget()
    assert rig.link.pages == ()
    old.cb["on_pages"](REPORT)  # the old bridge's late callbacks are ignored
    assert rig.link.pages == ()
