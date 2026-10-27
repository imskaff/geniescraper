"""
GUI tests: open the real window once, walk every screen, and check behavior on the way.

The walk runs a single time per test session. Creating and destroying several Tk roots
in one process made Tcl fail to initialise on GitHub's Windows runners, so every check
records its result during one walk and the tests below assert on those results.
"""

import ctypes
import sys
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


def test_main_and_settings_windows_have_dark_title_bars(walk):
    """transient() replaces the Settings window frame; the dark title bar must survive it."""
    assert walk["main_dark_title_bar"] == 1
    assert walk["settings_dark_title_bar"] == 1
