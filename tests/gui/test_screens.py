"""
GUI tests: open the real window once, walk every screen, and check behavior on the way.

The walk runs a single time per test session. Creating and destroying several Tk roots
in one process made Tcl fail to initialise on GitHub's Windows runners, so every check
records its result during one walk and the tests below assert on those results.
"""

import ctypes
import sys
from concurrent.futures import Future
from typing import Any

import pytest

pytestmark = [
    pytest.mark.gui,
    pytest.mark.skipif(sys.platform != "win32", reason="the GUI is Windows only"),
]

EXPECTED_SCREENS = [
    "01-start", "02-start-url", "03-start-error", "04-settings", "05-tracks", "06-loading",
    "07-credits", "08-assistant-start", "09-assistant-middle", "10-esc-confirm",
    "11-assistant-compact", "12-done",
]  # fmt: skip


def _dark_title_bar_attr(window: Any) -> int:
    hwnd = ctypes.windll.user32.GetParent(window.winfo_id())
    value = ctypes.c_int(-1)
    ctypes.windll.dwmapi.DwmGetWindowAttribute(hwnd, 20, ctypes.byref(value), ctypes.sizeof(value))
    return value.value


class _FakeBridge:
    """Stands in for the websocket bridge so the real App can be linked without a socket."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, Future[Any]]] = []

    def start(self) -> None: ...
    def stop(self) -> None: ...
    def forget_pairing(self) -> None: ...

    def begin_pairing(self) -> str:
        return "ABCD-EFGH"

    def send_command(self, name: str, **fields: Any) -> Future[Any]:
        future: Future[Any] = Future()
        self.sent.append((name, future))
        return future


def _drive_link(window: Any) -> dict[str, Any]:
    """Connect a fake extension to the pasting screen and record how the screen and its hotkeys react."""
    seen: dict[str, Any] = {}
    fake = _FakeBridge()
    link = window.link
    link._bridge = fake
    seen["hooks_unlinked"] = len(window._kb_hooks)
    link._handle_connection(True)  # connects mid-song: the run starts from the current step
    seen["begin_sent"] = [name for name, _ in fake.sent]
    fake.sent[0][1].set_result((True, None))
    window.update()
    seen["hooks_linked"] = len(window._kb_hooks)
    before = window._pos
    window._skip()
    seen["skip_command"] = fake.sent[-1][0]
    seen["pos_unchanged_by_skip"] = window._pos == before
    total = len(window._queue)
    link._handle_status(
        {
            "active": True, "auto": "paused", "pauseReason": "bridge-lost", "title": "t", "position": 4,
            "total": total, "awaiting": False, "busy": False, "message": "", "tone": "info",
        }
    )  # fmt: skip
    seen["pos_from_status"] = window._pos
    seen["status_line"] = window._link_lbl.cget("text")
    seen["resume_button"] = [w.cget("text") for w in window._link_btns.winfo_children()]
    link._handle_connection(False)
    seen["hooks_after_drop"] = len(window._kb_hooks)
    link.end_run()
    window._pos = 21
    window._render_link()
    return seen


@pytest.fixture(scope="module")
def walk() -> dict[str, Any]:
    from tools.gui_snapshots import walk_screens
    from utils.config import settings

    seen: dict[str, Any] = {"screens": []}

    def on_screen(window: Any, name: str) -> None:
        seen["screens"].append(name)
        if name == "01-start":
            seen["main_dark_title_bar"] = _dark_title_bar_attr(window)
        elif name == "04-settings":
            seen["settings_dark_title_bar"] = _dark_title_bar_attr(window)
            seen["settings_icon_set"] = window._iconbitmap_method_called
            seen["settings_scroll_increment"] = int(window._body._parent_canvas.cget("yscrollincrement"))
            seen["settings_headings"] = window.headings
            calls: list[int] = []
            window._on_change = lambda: calls.append(1)
            original = settings.auto_tab
            window._set("auto_tab", not original)
            seen["staged_value"] = window._value("auto_tab")
            seen["unchanged_while_open"] = settings.auto_tab is original and not calls
            seen["applied"] = window._apply()
            seen["changed_on_apply"] = settings.auto_tab is (not original)
            settings.auto_tab = original
            seen["auto_paste_state"] = str(window._auto_switch.cget("state"))
            seen["auto_paste_hint"] = window._auto_hint.cget("text")
        elif name == "07-credits":
            seen["review_hooks_before_back"] = len(window._kb_hooks)
            window._back_from_credits()
            seen["review_hooks_after_back"] = len(window._kb_hooks)
        elif name == "09-assistant-middle":
            window._skip()
            seen["pos_after_skip"] = window._pos
            window._jump_to(3)
            seen["pos_after_jump"] = window._pos
            window._jump_to(999)
            seen["pos_after_jump_past_end"], seen["queue_len"] = window._pos, len(window._queue)
            before = settings.auto_tab
            window._toggle_chip("auto_tab")
            seen["auto_tab_toggled"] = settings.auto_tab is (not before)
            seen["chip_text"], seen["auto_tab_now"] = window._chips["auto_tab"].cget("text"), settings.auto_tab
            window._pos = 21
            window._render_assistant()
            seen["link"] = _drive_link(window)

    walk_screens(on_screen)
    return seen


def test_every_screen_renders(walk):
    assert walk["screens"] == EXPECTED_SCREENS


def test_assistant_controls_skip_jump_and_toggle(walk):
    assert walk["pos_after_skip"] == 22
    assert walk["pos_after_jump"] == 3
    assert walk["pos_after_jump_past_end"] == walk["queue_len"] - 1
    assert walk["auto_tab_toggled"]
    assert walk["chip_text"].endswith("on" if walk["auto_tab_now"] else "off")


def test_leaving_review_screen_releases_its_f8_hotkey(walk):
    """F8 on the review screen starts pasting; after Back it must not fire any more."""
    assert walk["review_hooks_before_back"] > 0
    assert walk["review_hooks_after_back"] == 0


def test_settings_window_uses_app_icon_and_fast_scroll(walk):
    assert walk["settings_icon_set"], "the app icon replaces customtkinter's default"
    assert walk["settings_scroll_increment"] == 3


def test_settings_follow_the_extensions_order(walk):
    assert walk["settings_headings"] == [
        "What to collect",
        "Pasting into Genius",
        "Reading tracks",
        "Browser extension",
        "Window",
    ]


def test_a_change_waits_for_the_window_to_close(walk):
    """Applying each change at once rebuilt the app behind Settings, so the window flickered."""
    assert walk["unchanged_while_open"]
    assert walk["staged_value"] is not None
    assert walk["applied"] and walk["changed_on_apply"]


def test_auto_paste_is_grayed_out_until_an_extension_is_connected(walk):
    assert walk["auto_paste_state"] == "disabled"
    assert "browser extension" in walk["auto_paste_hint"]


def test_main_and_settings_windows_have_dark_title_bars(walk):
    """transient() replaces the Settings window frame; the dark title bar must survive it."""
    assert walk["main_dark_title_bar"] == 1
    assert walk["settings_dark_title_bar"] == 1


def test_a_connected_extension_owns_the_keys_and_drives_the_screen(walk):
    link = walk["link"]
    assert link["hooks_unlinked"] > 0
    assert link["begin_sent"] == ["begin"]
    assert link["hooks_linked"] == 0, "desktop and extension must not both step"
    assert link["skip_command"] == "skip" and link["pos_unchanged_by_skip"]
    assert link["pos_from_status"] == 4
    assert "link to the desktop app was lost" in link["status_line"]
    assert any("Resume" in text for text in link["resume_button"])


def test_dropping_the_link_gives_the_keys_back(walk):
    assert walk["link"]["hooks_after_drop"] > 0
