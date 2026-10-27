"""Smoke test: every GUI screen builds and renders with sample data, without Tk errors."""

import sys

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


def test_every_screen_renders():
    from tools.gui_snapshots import walk_screens

    seen: list[str] = []
    walk_screens(lambda app, name: seen.append(name))
    assert seen == EXPECTED_SCREENS


def test_assistant_controls_skip_jump_and_toggle():
    from tools.gui_snapshots import walk_screens
    from utils.config import settings

    checked: list[str] = []

    def on_screen(app, name):
        if name != "09-assistant-middle":
            return
        app._skip()
        assert app._pos == 22
        app._jump_to(3)
        assert app._pos == 3
        app._jump_to(999)
        assert app._pos == len(app._queue) - 1
        before = settings.auto_tab
        app._toggle_chip("auto_tab")
        assert settings.auto_tab is (not before)
        assert app._chips["auto_tab"].cget("text").endswith("on" if settings.auto_tab else "off")
        app._pos = 21
        app._render_assistant()
        checked.append(name)

    walk_screens(on_screen)
    assert checked == ["09-assistant-middle"]


def test_leaving_review_screen_releases_its_f8_hotkey():
    """F8 on the review screen starts pasting; after Back it must not fire any more."""
    from tools.gui_snapshots import walk_screens

    checked: list[bool] = []

    def on_screen(app, name):
        if name != "07-credits":
            return
        assert app._kb_hooks, "the review screen registers F8"
        app._back_from_credits()
        checked.append(app._kb_hooks == [])

    walk_screens(on_screen)
    assert checked == [True]


def test_settings_window_uses_app_icon_and_fast_scroll():
    from tools.gui_snapshots import walk_screens

    checked: list[str] = []

    def on_screen(window, name):
        if name != "04-settings":
            return
        assert window._iconbitmap_method_called, "the app icon replaces customtkinter's default"
        assert int(window._body._parent_canvas.cget("yscrollincrement")) == 3
        checked.append(name)

    walk_screens(on_screen)
    assert checked == ["04-settings"]


def _dark_title_bar_attr(window) -> int:
    import ctypes

    hwnd = ctypes.windll.user32.GetParent(window.winfo_id())
    value = ctypes.c_int(-1)
    ctypes.windll.dwmapi.DwmGetWindowAttribute(hwnd, 20, ctypes.byref(value), ctypes.sizeof(value))
    return value.value


def test_main_and_settings_windows_have_dark_title_bars():
    """transient() replaces the Settings window frame; the dark title bar must survive it."""
    from tools.gui_snapshots import walk_screens

    seen: dict[str, int] = {}

    def on_screen(window, name):
        if name in ("01-start", "04-settings"):
            seen[name] = _dark_title_bar_attr(window)

    walk_screens(on_screen)
    assert seen == {"01-start": 1, "04-settings": 1}
