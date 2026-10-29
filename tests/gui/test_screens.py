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
    "01-start", "02-start-url", "03-start-error", "03-start-open-pages", "04-settings", "05-tracks", "06-loading",
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


def _card_texts(window: Any) -> list[str]:
    """Every label's text inside the 'Open in your browser' card, or [] when it is not shown."""
    import customtkinter as ctk

    card = window._pages_card
    if card is None or not card.winfo_exists():
        return []
    found: list[str] = []

    def walk(widget: Any) -> None:
        for child in widget.winfo_children():
            if isinstance(child, ctk.CTkLabel) and child.cget("text"):
                found.append(child.cget("text"))
            walk(child)

    walk(card)
    return found


def _report(*pages: Any) -> list[dict[str, Any]]:
    return [{"url": p.url, "title": p.title, "kind": p.kind, "current": p.current} for p in pages]


def _check_open_pages(window: Any) -> dict[str, Any]:
    """The start screen's card of pages open in the browser: shown, updated in place, emptied and hidden."""
    from gui.logic import OPEN_PAGES_EMPTY

    seen: dict[str, Any] = {"empty_text": OPEN_PAGES_EMPTY}
    link, entry = window.link, window._url_entry
    typed = entry.get()
    seen["texts"] = _card_texts(window)
    link._handle_pages(_report(*link.pages[1:2]))  # the list changes: the card is redrawn, the screen is not
    window.update()
    seen["entry_kept"] = window._url_entry is entry and entry.get() == typed
    seen["after_update"] = _card_texts(window)
    link._handle_pages([])
    window.update()
    seen["empty"] = _card_texts(window)
    link._handle_connection(False)
    window.update()
    seen["hidden"] = window._pages_card is None
    link._handle_connection(True)
    chihiro = "https://music.apple.com/us/song/chihiro/1739659140"
    link._handle_pages([{"url": chihiro, "title": "CHIHIRO", "kind": "song", "current": False}])
    window.update()
    # Pressing a row fills the link box and starts Get credits, as the button does.
    started: list[str] = []
    window._detect_thread = lambda u, job: started.append(u)
    window._get_credits_for(chihiro)
    for _ in range(20):
        window.update()
        if started:
            break
    seen["started"], seen["busy"], seen["typed_by_row"] = started, window._busy, entry.get()
    window._set_busy(False)
    entry.delete(0, "end")
    link._handle_pages([])
    return seen


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
        elif name == "03-start-open-pages":
            seen["open_pages"] = _check_open_pages(window)
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
            seen["copy_button_before"] = window._link_copy_btn.cget("text")
            window._copy_code("ABCD-EFGH")
            seen["copied_to_clipboard"] = window.clipboard_get()
            seen["copy_button_after"] = window._link_copy_btn.cget("text")
            window._copy_code("")  # nothing to copy: the clipboard and the button stay as they were
            seen["clipboard_after_empty"] = window.clipboard_get()
            window.clipboard_clear()
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


def test_open_pages_card_lists_what_the_extension_reports(walk):
    texts = walk["open_pages"]["texts"]
    assert texts[0] == "OPEN IN YOUR BROWSER"
    assert "Album" in texts and "Song" in texts
    assert "HIT ME HARD AND SOFT" in texts and "this page" in texts
    assert texts.count("this page") == 1
    assert "Short n' Sweet (Deluxe) by Sabrina Carpenter" in texts


def test_open_pages_card_updates_in_place_without_touching_the_link_box(walk):
    seen = walk["open_pages"]
    assert seen["entry_kept"]
    assert (
        "CHIHIRO" in seen["after_update"] and "Short n' Sweet (Deluxe) by Sabrina Carpenter" not in seen["after_update"]
    )
    assert seen["empty"] == ["OPEN IN YOUR BROWSER", seen["empty_text"]]


def test_open_pages_card_is_hidden_without_a_connected_extension(walk):
    assert walk["open_pages"]["hidden"]


def test_pressing_a_row_starts_get_credits_for_that_page(walk):
    seen = walk["open_pages"]
    assert seen["started"] == ["https://music.apple.com/us/song/chihiro/1739659140"]
    assert seen["typed_by_row"] == seen["started"][0]
    assert seen["busy"]


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
        "What to paste",
        "Pasting on Genius",
        "Reading credits",
        "Window",
    ]


def test_a_change_waits_for_the_window_to_close(walk):
    """Applying each change at once rebuilt the app behind Settings, so the window flickered."""
    assert walk["unchanged_while_open"]
    assert walk["staged_value"] is not None
    assert walk["applied"] and walk["changed_on_apply"]


def test_the_pairing_code_has_a_copy_button(walk):
    assert walk["copy_button_before"] == "Copy"
    assert walk["copied_to_clipboard"] == "ABCD-EFGH"
    assert walk["copy_button_after"] == "Copied ✓"
    assert walk["clipboard_after_empty"] == "ABCD-EFGH"


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
