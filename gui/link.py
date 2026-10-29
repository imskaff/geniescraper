"""The desktop side of the companion link, as plain logic: no Tk, no sockets.

``LinkController`` owns a ``Bridge`` (anything with the same few methods), remembers whether a run belongs to the
link, and turns the extension's events into calls the GUI makes on its own thread. The bridge calls back on its own
thread, so every callback is handed to ``schedule`` (the GUI passes ``lambda fn: app.after(0, fn)``) before it
touches state. The pairing secret goes only to ``persist`` and is never put in a message, a label or a log line.
"""

from __future__ import annotations

import math
import time
from collections.abc import Callable
from concurrent.futures import Future
from dataclasses import dataclass
from enum import Enum
from typing import Any, Protocol

from assistant.bridge import PAIRING_TTL_S, Bridge, NotConnected, ProtocolError

_Callbacks = dict[str, Callable[..., None]]


class BridgeLike(Protocol):
    def start(self) -> None: ...
    def stop(self) -> None: ...
    def begin_pairing(self) -> str: ...
    def forget_pairing(self) -> None: ...
    def send_command(self, name: str, **fields: Any) -> Future[tuple[bool, dict[str, str] | None]]: ...


BridgeFactory = Callable[[str | None, str | None, _Callbacks], BridgeLike]

#: Buttons on the pasting screen that become commands while the run is linked.
BUTTON_COMMANDS = frozenset({"back", "skip", "fill-next", "pause", "resume"})


def default_factory(secret: str | None, origin: str | None, callbacks: _Callbacks) -> BridgeLike:
    return Bridge(
        secret=secret or None,
        pinned_origin=origin or None,
        on_status=callbacks["on_status"],
        on_connection=callbacks["on_connection"],
        on_paired=callbacks["on_paired"],
    )


class LinkState(Enum):
    NOT_PAIRED = "Not paired"
    WAITING = "Waiting for the extension"
    CONNECTED = "Connected"
    LOST = "Lost"


@dataclass(frozen=True)
class RunStatus:
    """What the extension reports about the run, without any queue text."""

    active: bool
    auto: str
    pause_reason: str
    title: str
    position: int
    total: int
    awaiting: bool
    busy: bool
    message: str
    tone: str

    @classmethod
    def from_state(cls, state: dict[str, Any]) -> RunStatus:
        return cls(
            active=bool(state.get("active")),
            auto=str(state.get("auto", "off")),
            pause_reason=str(state.get("pauseReason", "")),
            title=str(state.get("title", "")),
            position=int(state.get("position", 0)),
            total=int(state.get("total", 0)),
            awaiting=bool(state.get("awaiting")),
            busy=bool(state.get("busy")),
            message=str(state.get("message", "")),
            tone=str(state.get("tone", "info")),
        )


_PAUSE_WORDING = {
    "user": "Paused: you paused the run.",
    "input": "Paused: Genius is waiting for your input.",
    "panel-closed": "Paused: the extension panel was closed.",
    "page-changed": "Paused: the Genius page changed.",
    "problem": "Paused: there was a problem on the page.",
    "bridge-lost": "Paused: the link to the desktop app was lost.",
}


def describe_status(status: RunStatus) -> tuple[str, str]:
    """(text, tone) for the pasting screen: the extension's own wording first, then a plain reason."""
    if status.message:
        return status.message, status.tone
    if status.auto == "paused":
        return _PAUSE_WORDING.get(status.pause_reason, "Paused."), "attention"
    if status.awaiting:
        return "Pick the suggestion on Genius to continue.", "attention"
    return "", "info"


def state_label(state: LinkState) -> str:
    return state.value


def _clock_text(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


def state_hint(state: LinkState, *, code: str | None, seconds_left: int) -> str:
    if state is LinkState.NOT_PAIRED:
        return "Pair once and the extension fills the Genius form for you. Without it the hotkeys work as before."
    if state is LinkState.WAITING:
        if code:
            return (
                f"Type {code} into the extension (Settings, Desktop app) within {_clock_text(seconds_left)}. "
                "The code works once."
            )
        return "Open Genius in your browser. The extension connects by itself."
    if state is LinkState.CONNECTED:
        return "The extension fills Genius and handles the pasting keys while a run is linked."
    return "The extension disconnected. The hotkeys work again until it reconnects."


class LinkController:
    def __init__(
        self,
        *,
        bridge_factory: BridgeFactory = default_factory,
        secret: str | None = None,
        origin: str | None = None,
        persist: Callable[[str, str], None],
        erase: Callable[[], None],
        schedule: Callable[[Callable[[], None]], None],
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._factory = bridge_factory
        self._secret = secret or None
        self._origin = origin or None
        self._persist = persist
        self._erase = erase
        self._schedule = schedule
        self._clock = clock
        self._gen = 0
        self._started = False
        self._connected = False
        self._lost = False
        self._deadline: float | None = None
        self._begin_acked = False
        self._sync_to = 0
        self._run_total = 0
        self._notice = ""
        self.run_active = False
        self.unavailable = False
        self.status: RunStatus | None = None
        # The GUI sets these; all run on its thread.
        self.on_change: Callable[[], None] | None = None
        self.on_status: Callable[[RunStatus], None] | None = None
        self.on_finished: Callable[[], None] | None = None
        self.on_run_ended: Callable[[], None] | None = None
        self.on_connection: Callable[[bool], None] | None = None
        self._bridge: BridgeLike = self._make_bridge()

    # -- lifecycle --
    def _make_bridge(self) -> BridgeLike:
        gen = self._gen
        callbacks: _Callbacks = {
            "on_status": lambda state: self._post(gen, self._handle_status, state),
            "on_connection": lambda up: self._post(gen, self._handle_connection, up),
            "on_paired": lambda secret, origin: self._post(gen, self._handle_paired, secret, origin),
        }
        return self._factory(self._secret, self._origin, callbacks)

    def _start_bridge(self) -> None:
        try:
            self._bridge.start()
            self.unavailable = False
        except OSError:
            self.unavailable = True  # every port is taken: the hotkeys keep working

    def start(self) -> None:
        self._started = True
        self._start_bridge()
        self._changed()

    def stop(self) -> None:
        self._started = False
        try:
            self._bridge.stop()
        except Exception:
            pass

    def _post(self, gen: int, fn: Callable[..., None], *args: Any) -> None:
        def run() -> None:
            if gen == self._gen:
                fn(*args)

        try:
            self._schedule(run)
        except Exception:
            pass  # the window is gone

    def _changed(self) -> None:
        if self.on_change is not None:
            self.on_change()

    # -- state --
    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def paired(self) -> bool:
        return self._secret is not None

    @property
    def bridged(self) -> bool:
        """A run the link started is going on and the extension is there to run it."""
        return self.run_active and self._connected

    @property
    def notice(self) -> str:
        return self._notice

    @property
    def state(self) -> LinkState:
        if self._connected:
            return LinkState.CONNECTED
        if self._secret is not None:
            return LinkState.LOST if self._lost else LinkState.WAITING
        return LinkState.WAITING if self.pairing_code else LinkState.NOT_PAIRED

    @property
    def pairing_code(self) -> str | None:
        return self._code if self.pairing_seconds_left() > 0 else None

    _code: str | None = None

    def pairing_seconds_left(self) -> int:
        if self._deadline is None:
            return 0
        return max(0, math.ceil(self._deadline - self._clock()))

    # -- pairing --
    def begin_pairing(self) -> str | None:
        if self.unavailable:
            return None
        self._code = self._bridge.begin_pairing()
        self._deadline = self._clock() + PAIRING_TTL_S
        self._changed()
        return self._code

    def forget(self) -> None:
        """Remove the pairing everywhere and drop the live connection (by listening afresh)."""
        self._gen += 1  # the old bridge's late callbacks are ignored
        old = self._bridge
        try:
            old.forget_pairing()
            old.stop()
        except Exception:
            pass
        self._erase()
        self._secret = self._origin = None
        self._connected = self._lost = False
        self._code = self._deadline = None
        self._reset_run()
        self._bridge = self._make_bridge()
        if self._started:
            self._start_bridge()
        self._changed()

    def _handle_paired(self, secret: str, origin: str) -> None:
        self._secret, self._origin = secret, origin
        self._code = self._deadline = None
        try:
            self._persist(secret, origin)
        except Exception:
            self._notice = "The pairing could not be saved, so it will be lost when the app closes."
        self._changed()

    def _handle_connection(self, up: bool) -> None:
        self._connected = up
        if up:
            self._lost = False
        elif self._secret is not None:
            self._lost = True
        if self.on_connection is not None:
            self.on_connection(up)
        self._changed()

    # -- a run --
    def _reset_run(self) -> None:
        self.run_active = False
        self._begin_acked = False
        self._sync_to = 0
        self._run_total = 0
        self.status = None
        self._notice = ""

    def start_run(self, title: str, queue: list[tuple[str, str]], mode: str, resume_at: int = 0) -> bool:
        """Hand the queue to the extension. False means nothing was sent and the hotkeys stay in charge."""
        if not self._connected or self.unavailable:
            return False
        try:
            future = self._bridge.send_command("begin", title=title, queue=list(queue), mode=mode)
        except (NotConnected, ProtocolError):
            return False
        self._reset_run()
        self.run_active = True
        self._run_total = len(queue)
        self._sync_to = resume_at
        gen = self._gen
        future.add_done_callback(lambda f: self._post(gen, self._begin_done, f))
        self._changed()
        return True

    @staticmethod
    def _answer(future: Future[tuple[bool, dict[str, str] | None]]) -> tuple[bool, dict[str, str] | None] | None:
        try:
            return future.result()
        except Exception:
            return None  # the connection went away before an answer

    def _begin_done(self, future: Future[tuple[bool, dict[str, str] | None]]) -> None:
        if not self.run_active:
            return
        answer = self._answer(future)
        if answer is None:
            self._end_by_extension("")
            return
        ok, error = answer
        if ok or (error is not None and error["code"] == "tab-failed"):
            self._begin_acked = True
            if error is not None:
                self._notice = error["message"]  # the form is not open yet; the user resumes when it is
            if self._sync_to > 0:
                self.jump(self._sync_to)
                self._sync_to = 0
            self._changed()
            return
        self._end_by_extension(error["message"] if error else "The extension refused to start.")

    def _end_by_extension(self, notice: str) -> None:
        """The extension is not running this any more: give the keys back to the desktop."""
        self._reset_run()
        self._notice = notice
        if self.on_run_ended is not None:
            self.on_run_ended()
        self._changed()

    def end_run(self) -> None:
        """The user ended the run (Esc, a new track, leaving the screen)."""
        if self.run_active and self._connected:
            try:
                self._bridge.send_command("stop")
            except (NotConnected, ProtocolError):
                pass
        was_active = self.run_active
        self._reset_run()
        if was_active:
            self._changed()

    def _handle_status(self, state: dict[str, Any]) -> None:
        status = RunStatus.from_state(state)
        if not self.run_active or status.total != self._run_total:
            return  # not ours: a run started in the panel, or an old snapshot
        if not self._begin_acked and not status.active:
            return  # the snapshot sent at connect time, before our begin took effect
        if status.position >= status.total > 0 and (not status.active or not status.busy):
            self.status = status
            self._reset_run_keep_status(status)
            if self.on_status is not None:
                self.on_status(status)
            if self.on_finished is not None:
                self.on_finished()
            self._changed()
            return
        if not status.active:
            self._end_by_extension("The extension ended the run. The hotkeys are back.")
            return
        self.status = status
        self._notice = ""
        if self.on_status is not None:
            self.on_status(status)
        self._changed()

    def _reset_run_keep_status(self, status: RunStatus) -> None:
        self._reset_run()
        self.status = status

    # -- commands --
    def _send(self, name: str, then: Callable[[], None] | None = None) -> bool:
        if not self.bridged:
            return False
        try:
            future = self._bridge.send_command(name)
        except (NotConnected, ProtocolError):
            return False
        gen = self._gen
        future.add_done_callback(lambda f: self._post(gen, self._command_done, f, then))
        return True

    def _command_done(
        self, future: Future[tuple[bool, dict[str, str] | None]], then: Callable[[], None] | None
    ) -> None:
        answer = self._answer(future)
        if answer is None:
            return
        ok, error = answer
        if ok:
            if then is not None:
                then()
            return
        self._notice = error["message"] if error else "The extension could not do that."
        self._changed()

    def command(self, name: str) -> bool:
        """Send a button's command. False means the run is not linked and the caller handles it locally."""
        return name in BUTTON_COMMANDS and self._send(name)

    def jump(self, delta: int) -> bool:
        """Move by ``delta`` steps as a chain of skip or back commands; one refusal stops the chain."""
        if delta == 0 or not self.bridged:
            return False
        self._chain(["skip" if delta > 0 else "back"] * abs(delta))
        return True

    def _chain(self, names: list[str]) -> None:
        if names:
            rest = names[1:]
            self._send(names[0], then=lambda: self._chain(rest))
