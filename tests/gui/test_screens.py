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
