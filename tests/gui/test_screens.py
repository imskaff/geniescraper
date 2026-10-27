"""Smoke test: every GUI screen builds and renders with sample data, without Tk errors."""

import sys

import pytest

pytestmark = [
    pytest.mark.gui,
    pytest.mark.skipif(sys.platform != "win32", reason="the GUI is Windows only"),
]

EXPECTED_SCREENS = [
    "01-start", "02-start-url", "03-start-error", "04-options", "05-tracks", "06-loading",
    "07-credits", "08-assistant-start", "09-assistant-middle", "10-esc-confirm",
    "11-assistant-compact", "12-done",
]  # fmt: skip


def test_every_screen_renders():
    from tools.gui_snapshots import walk_screens

    seen: list[str] = []
    walk_screens(lambda app, name: seen.append(name))
    assert seen == EXPECTED_SCREENS
