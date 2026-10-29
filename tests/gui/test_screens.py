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

from tools.gui_snapshots import FakeBridge

pytestmark = [
    pytest.mark.gui,
    pytest.mark.skipif(sys.platform != "win32", reason="the GUI is Windows only"),
]

EXPECTED_SCREENS = [
    "01-start", "02-start-url", "03-start-error", "03-start-open-pages", "04-settings", "05-tracks", "06-loading",
    "07-credits", "08-assistant-start", "09-assistant-middle", "09a-settings-from-connect", "09b-assistant-linked-auto",
    "09c-assistant-linked-manual", "09d-assistant-linked-message", "10-esc-confirm",
    "11-assistant-compact", "12-done",
]  # fmt: skip


def _dark_title_bar_attr(window: Any) -> int:
    hwnd = ctypes.windll.user32.GetParent(window.winfo_id())
    value = ctypes.c_int(-1)
    ctypes.windll.dwmapi.DwmGetWindowAttribute(hwnd, 20, ctypes.byref(value), ctypes.sizeof(value))
    return value.value


_FakeBridge = FakeBridge


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


def _texts(widget: Any) -> list[str]:
    """Every piece of text a widget tree shows: labels, buttons and switches."""
    found: list[str] = []
    for child in widget.winfo_children():
        try:
            text = child.cget("text")
        except Exception:
            text = ""
        if isinstance(text, str) and text:
            found.append(text)
        found.extend(_texts(child))
    return found


def _buttons(window: Any) -> dict[str, dict[str, Any]]:
    """The pasting screen's buttons by name: their text, whether they are enabled and whether they are on screen."""
    return {
        name: {"text": b.cget("text"), "enabled": str(b.cget("state")) == "normal", "shown": bool(b.winfo_ismapped())}
        for name, b in window._ctl.items()
    }


def _check_hotkey_path(window: Any) -> dict[str, Any]:
    """Press the hotkey with the keyboard stubbed: it must always confirm and always tab."""
    from unittest import mock

    keys: list[str] = []
    old_queue, old_pos = window._queue, window._pos
    window._queue = [("written_by", "A"), ("role", "Mixer"), ("cover_art", "https://x/y.png"), ("written_by", "B")]
    try:
        with (
            mock.patch("gui.app.keyboard.press_and_release", side_effect=keys.append),
            mock.patch("gui.app.pyperclip.copy"),
            mock.patch("gui.app.time.sleep"),
            mock.patch.object(window, "iconify") as iconify,
        ):
            window._pos = 0
            window._on_hotkey()  # a songwriter, then a role: Enter, then Tab, Tab, Enter to Add additional credits
            after_name = list(keys)
            keys.clear()
            window._pos = 2
            window._on_hotkey()  # a cover link is only copied: nothing to confirm
            after_clipboard = list(keys)
    finally:
        window._queue, window._pos = old_queue, old_pos
    return {
        "name": after_name,
        "clipboard": after_clipboard,
        "iconified": iconify.called,
        "window_state": window.state(),
    }


def _check_assistant_controls(window: Any) -> dict[str, Any]:
    """With no extension: no Next button, Auto-paste is grayed out and says why, the manual-mode notice is up."""
    window._pos = 0
    window._render_assistant()
    window.update()
    seen: dict[str, Any] = {"at_start": _buttons(window), "hint": window._auto_hint_lbl.cget("text")}
    seen["texts"] = _texts(window)
    seen["instruction"] = window._card_instr_lbl.cget("text")
    card = window._manual_card
    seen["notice_shown"] = bool(card.winfo_ismapped())
    seen["notice_texts"] = _texts(card)
    seen["notice_above_buttons"] = card.winfo_y() < window._ctl["auto"].master.winfo_y()
    seen["window_state"] = window.state()
    seen["settings_label_texts"] = []
    window._pos = 21
    window._render_assistant()
    seen["middle_buttons_early"] = None
    window._pos = len(window._queue)
    window._render_assistant()
    seen["finished"] = _buttons(window)
    seen["finished_progress"] = window._prog_lbl.cget("text")
    window._pos = 21
    window._render_assistant()
    seen["middle_progress"] = window._prog_lbl.cget("text")
    seen["middle"] = _buttons(window)
    seen["done_header"] = window._steps_heads["done"].cget("text")
    seen["left_header"] = window._steps_heads["left"].cget("text")
    seen["done_rows_hidden"] = not window._row_widgets[0][0].winfo_ismapped()
    window._toggle_steps("done")
    window.update()
    seen["done_rows_shown_after_toggle"] = window._row_widgets[0][0].winfo_ismapped()
    window._toggle_steps("done")
    return seen


def _check_manual_notice(window: Any) -> dict[str, Any]:
    """The notice goes away when the extension connects and comes back when the link drops, without a rebuild."""
    seen: dict[str, Any] = {}
    link, card = window.link, window._manual_card
    link._bridge = _FakeBridge()
    link._handle_connection(True)
    window.update()
    seen["hidden_when_connected"] = not card.winfo_ismapped()
    link._handle_connection(False)
    window.update()
    seen["back_after_drop"] = bool(card.winfo_ismapped())
    seen["same_card"] = window._manual_card is card
    link.end_run()
    return seen


def _check_connect(settings_win: Any) -> dict[str, Any]:
    """After the Connect button: the Settings window is open, pairing has begun and the code is in view."""
    settings_win.update()
    body = settings_win._body
    top = body.winfo_rooty()
    return {
        "code": settings_win._link.pairing_code,
        "code_shown": bool(settings_win._link_code_box.winfo_ismapped()),
        "copy_in_view": top <= settings_win._link_copy_btn.winfo_rooty() < top + body._parent_canvas.winfo_height(),
        "copy_text": settings_win._link_copy_btn.cget("text"),
    }


def _check_linked(window: Any, name: str) -> dict[str, Any]:
    """The extension's Auto-paste toggle on the pasting screen, with a fake bridge behind the link."""
    fake = window.link._bridge
    seen: dict[str, Any] = {"buttons": _buttons(window), "status": window._link_lbl.cget("text")}
    before = len(fake.sent)
    window._ctl["auto"].invoke()
    seen["clicked"] = [n for n, _ in fake.sent[before:]]
    seen["link_mode"] = None
    from utils.config import settings

    seen["link_mode"] = settings.link_mode
    settings.link_mode = "auto"
    return seen


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
    seen["resume_button"] = _buttons(window)
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
            seen["settings_texts"] = _texts(window)
            calls: list[int] = []
            window._on_change = lambda: calls.append(1)
            original = settings.find_youtube
            window._set("find_youtube", not original)
            seen["staged_value"] = window._value("find_youtube")
            seen["unchanged_while_open"] = settings.find_youtube is original and not calls
            seen["applied"] = window._apply()
            seen["changed_on_apply"] = settings.find_youtube is (not original)
            settings.find_youtube = original
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
            seen["hotkey_path"] = _check_hotkey_path(window)
            seen["unlinked"] = _check_assistant_controls(window)
            seen["manual_notice"] = _check_manual_notice(window)
            window._pos = 21
            window._render_assistant()
            seen["link"] = _drive_link(window)
            window._pos = 21
            window._render_assistant()
        elif name == "09a-settings-from-connect":
            seen["connect"] = _check_connect(window)
        elif name == "09b-assistant-linked-auto":
            seen["linked_auto"] = _check_linked(window, name)
        elif name == "09c-assistant-linked-manual":
            seen["linked_manual"] = _check_linked(window, name)
        elif name == "09d-assistant-linked-message":
            seen["linked_message"] = window._link_lbl.cget("text")
        elif name == "11-assistant-compact":
            seen["compact_texts"] = _texts(window)
            seen["compact_height"] = window.winfo_height() * 620 / window.winfo_width()  # in 100%-scale pixels
            seen["compact_has_list"] = window._queue_sf is not None
            window._ask_back_to_credits()
            window.update()
            seen["back_confirm_open"] = window._esc_overlay_open()
            seen["back_confirm_texts"] = _texts(window._esc_overlay)
            window._back_to_credits()
            window.update()
            seen["back_screen"] = window._screen
            seen["back_countdown"] = window._credits_in_countdown

    walk_screens(on_screen)
    return seen


def test_open_pages_card_lists_what_the_extension_reports(walk):
    texts = walk["open_pages"]["texts"]
    assert texts[:2] == ["3 Apple Music pages detected", "Pick one to get its credits."]
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
    assert seen["empty"] == ["Listening for Apple Music pages…", seen["empty_text"]]


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
        "YouTube links",
        "Cover art look-up",
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
    assert link["resume_button"]["auto"]["text"] == "Auto-paste: OFF" and link["resume_button"]["auto"]["enabled"]


def test_dropping_the_link_gives_the_keys_back(walk):
    assert walk["link"]["hooks_after_drop"] > 0


def _has_removed_option(texts: list[str]) -> bool:
    return any(word in text.lower() for text in texts for word in ("auto-tab", "auto-confirm", "autotab"))


def test_auto_tab_and_auto_confirm_are_gone_from_settings_and_the_assistant(walk):
    from utils.config import Settings

    assert "auto_tab" not in Settings.model_fields and "auto_enter" not in Settings.model_fields
    assert not _has_removed_option(walk["settings_texts"])
    assert not _has_removed_option(walk["unlinked"]["texts"])
    assert not _has_removed_option(walk["compact_texts"])


def test_the_hotkey_path_always_confirms_and_always_tabs(walk):
    path = walk["hotkey_path"]
    assert path["name"] == ["ctrl+v", "enter", "tab", "tab", "enter"]
    assert path["clipboard"] == ["ctrl+v"]


def test_settings_say_what_the_wait_is_for_and_that_the_hotkeys_cannot_check(walk):
    texts = " ".join(walk["settings_texts"])
    assert "Wait for suggestions to settle" in walk["settings_texts"]
    assert "cannot see Genius" in texts and "does not check that an artist" in texts
    assert "matches the typed name exactly" in texts


def test_pasting_screen_without_the_extension(walk):
    seen = walk["unlinked"]
    start, auto = seen["at_start"], seen["at_start"]["auto"]
    assert auto["text"] == "Auto-paste: OFF" and not auto["enabled"]
    assert seen["hint"] == "Connect the browser extension in Settings to use Auto-paste"
    assert not start["next"]["shown"]
    assert start["back"]["text"].startswith("Previous (")
    assert start["stop"]["text"] == "Back to credits"
    assert "Paste into Genius" in seen["texts"] and "CHIHIRO  ·  Billie Eilish" in seen["texts"]
    assert any(t.startswith("Keep the song's Edit Metadata form open") for t in seen["texts"])


def test_previous_is_off_at_the_first_step_and_skip_and_next_when_finished(walk):
    seen = walk["unlinked"]
    assert not seen["at_start"]["back"]["enabled"]
    assert seen["middle"]["back"]["enabled"]
    assert not seen["finished"]["skip"]["enabled"] and not seen["finished"]["next"]["shown"]
    assert seen["finished"]["back"]["enabled"]
    assert seen["finished_progress"] == "All steps done"
    assert seen["middle_progress"] == "Step 22 of 48"


def test_step_lists_are_disclosures_done_closed_and_left_open(walk):
    seen = walk["unlinked"]
    assert seen["done_header"].endswith("Steps done (21)") and seen["left_header"].endswith("Steps left (27)")
    assert seen["done_rows_hidden"] and seen["done_rows_shown_after_toggle"]


def test_auto_paste_on_hides_next_and_toggling_pauses(walk):
    seen = walk["linked_auto"]
    assert seen["buttons"]["auto"]["text"] == "Auto-paste: ON" and seen["buttons"]["auto"]["enabled"]
    assert not seen["buttons"]["next"]["shown"]
    assert seen["clicked"] == ["pause"]
    assert seen["link_mode"] == "manual"


def test_auto_paste_off_shows_next_and_toggling_resumes(walk):
    seen = walk["linked_manual"]
    assert seen["buttons"]["auto"]["text"] == "Auto-paste: OFF" and seen["buttons"]["auto"]["enabled"]
    assert seen["buttons"]["next"]["shown"] and seen["buttons"]["next"]["enabled"]
    assert seen["clicked"] == ["resume"]
    assert seen["link_mode"] == "auto"
    assert "paused" in seen["status"].lower() or "pause" in seen["status"].lower()


def test_the_extension_message_shows_above_the_step_counter(walk):
    assert walk["linked_message"] == "Pick the suggestion on Genius."


def test_compact_mode_hides_the_step_list_and_keeps_the_buttons(walk):
    assert not walk["compact_has_list"]
    assert walk["compact_height"] <= 320
    assert "Back to credits" in walk["compact_texts"]


def test_back_to_credits_asks_first_then_leaves_without_restarting_the_countdown(walk):
    assert walk["back_confirm_open"]
    assert "Back to the credits?" in walk["back_confirm_texts"]
    assert walk["back_screen"] == "credits"
    assert not walk["back_countdown"]


def test_manual_mode_notice_is_shown_without_the_extension(walk):
    seen = walk["unlinked"]
    assert seen["notice_shown"] and seen["notice_above_buttons"]
    texts = " ".join(seen["notice_texts"])
    assert "Manual mode" in seen["notice_texts"] and "Connect browser extension" in seen["notice_texts"]
    assert "not connected" in texts and "press F8" in texts and "Skip" in texts and "artist exists" in texts


def test_manual_mode_instruction_says_to_click_the_field_before_the_hotkey(walk):
    seen = walk["unlinked"]
    assert "Click the field on Genius first" in seen["instruction"] and "F8" in seen["instruction"]


def test_manual_mode_has_no_next_button_and_never_touches_the_window(walk):
    seen = walk["unlinked"]
    assert not seen["at_start"]["next"]["shown"] and not seen["middle"]["next"]["shown"]
    assert seen["window_state"] == "normal"
    assert walk["hotkey_path"]["window_state"] == "normal" and not walk["hotkey_path"]["iconified"]


def test_the_notice_follows_the_connection_without_rebuilding_the_screen(walk):
    seen = walk["manual_notice"]
    assert seen["hidden_when_connected"] and seen["back_after_drop"] and seen["same_card"]


def test_connect_opens_settings_at_the_link_card_and_starts_pairing(walk):
    seen = walk["connect"]
    assert seen["code"] == "ABCD-EFGH" and seen["code_shown"] and seen["copy_in_view"]
