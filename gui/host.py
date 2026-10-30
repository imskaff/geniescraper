"""The window's shared state, declared once so every screen module type-checks against the same names.

`App` (gui/app.py) assigns these in `__init__`; the screen modules are mixins that read and write them.
The stub methods at the bottom stand in for methods a mixin calls on a sibling mixin; the real one wins in the MRO.
"""

import asyncio
import threading

import customtkinter as ctk
import keyboard
from PIL import Image as PILImage

from gui.connect_prompt import ConnectPrompt
from gui.link import LinkController, OpenPage
from gui.settings_window import SettingsWindow
from scraper.apple_music import AlbumTrackInfo
from scraper.models import SongCredits


class Host(ctk.CTk):
    # Background event loop for Playwright and httpx; worker threads submit to it.
    _loop: asyncio.AbstractEventLoop
    link: LinkController

    # The song being pasted, and the album it came from.
    _song: SongCredits | None
    _cover_image: PILImage.Image | None
    _album_info: AlbumTrackInfo | None
    _album_cover_image: PILImage.Image | None
    _queue: list[tuple[str, str]]
    _pos: int
    _lock: threading.Lock

    # Album queue and read-ahead.
    _is_album_queue_mode: bool
    _album_queue_pending: list[tuple[int, str]]
    _album_queue_current: int
    _album_queue_position: int
    _album_queue_total: int
    _prefetch_cache: dict[int, tuple[SongCredits, PILImage.Image | None]]
    _prefetch_cache_lock: threading.Lock
    _prefetch_running: set[int]
    _prefetch_limit: int
    _prefetch_semaphore: threading.Semaphore

    # Window state.
    _screen: str
    _job: int
    _kb_hooks: list
    _settings_win: SettingsWindow | None
    _normal_height: int
    _app_focused: bool

    # Start screen.
    _busy: bool
    _url_entry: ctk.CTkEntry
    _hint_lbl: ctk.CTkLabel
    _scrape_btn: ctk.CTkButton
    _cancel_btn: ctk.CTkButton
    _progress: ctk.CTkProgressBar
    _status_lbl: ctk.CTkLabel
    _pages_card: ctk.CTkFrame | None
    _connect_card: ConnectPrompt | None
    _how_card: ctk.CTkFrame | None
    _pages_shown: tuple[bool, tuple[OpenPage, ...]] | None

    # Track list.
    _track_vars: list
    _scrape_selected_btn: ctk.CTkButton | None

    # Credits screen.
    _start_assistant_btn: ctk.CTkButton
    _credits_in_countdown: bool
    _credits_countdown: int
    _credits_countdown_paused: bool

    # Assistant screen.
    _row_widgets: list[tuple]
    _queue_sf: ctk.CTkScrollableFrame | None
    _steps_open: dict[str, bool]
    _esc_from_key: bool
    _esc_overlay: ctk.CTkFrame
    _link_lbl: ctk.CTkLabel | None
    _link_before: ctk.CTkLabel | None
    _ctl: dict[str, ctk.CTkButton]
    _auto_hint_lbl: ctk.CTkLabel | None
    _manual_card: ctk.CTkFrame | None
    _steps_heads: dict[str, ctk.CTkButton]
    _prog_lbl: ctk.CTkLabel
    _hero_card: ctk.CTkFrame
    _hero_badge: ctk.CTkLabel
    _hero_value_lbl: ctk.CTkLabel
    _card_instr_lbl: ctk.CTkLabel

    # Done screen.
    _in_countdown: bool
    _countdown: int
    _countdown_paused: bool
    _back_btn: ctk.CTkButton

    def _clear(self) -> None:
        """Remove the current screen, including its global hotkeys, so no stale key handler survives."""
        self._clear_kb_hooks()
        for w in self.winfo_children():
            if isinstance(w, ctk.CTkToplevel):
                continue
            w.destroy()

    def _clear_kb_hooks(self) -> None:
        for hook in self._kb_hooks:
            try:
                keyboard.unhook(hook)
            except Exception:
                pass
        self._kb_hooks = []

    # Stand-ins for methods a mixin calls on a sibling mixin or on App; the real ones win in the MRO.

    def _settings_changed(self) -> None:
        raise NotImplementedError

    def _esc_overlay_open(self) -> bool:
        raise NotImplementedError

    def _register_assistant_keys(self) -> None:
        raise NotImplementedError

    def _render_open_pages(self) -> None:
        raise NotImplementedError

    def _render_assistant(self) -> None:
        raise NotImplementedError

    def _finish_song(self) -> None:
        raise NotImplementedError

    def _instruction_text(self) -> str:
        raise NotImplementedError

    def _render_controls(self) -> None:
        raise NotImplementedError

    def _show_credits_screen(self) -> None:
        raise NotImplementedError

    def _show_track_select_screen(self) -> None:
        raise NotImplementedError

    def _show_scrape_screen(self) -> None:
        raise NotImplementedError

    def _show_loading_screen(self, track_title: str) -> None:
        raise NotImplementedError

    def _show_done_screen(self) -> None:
        raise NotImplementedError

    def _back_to_album_list(self) -> None:
        raise NotImplementedError

    def _go_to_main(self) -> None:
        raise NotImplementedError

    def _set_busy(self, busy: bool, status: str = "") -> None:
        raise NotImplementedError

    def _detect_thread(self, url: str, job: int) -> None:
        raise NotImplementedError

    def _show_assistant_screen(self) -> None:
        raise NotImplementedError

    def _go_to_main_from_album(self) -> None:
        raise NotImplementedError

    def _start_selected_queue(self) -> None:
        raise NotImplementedError

    def _start_album_queue(self) -> None:
        raise NotImplementedError

    def _cancel_scrape(self) -> None:
        raise NotImplementedError

    def _back_to_credits(self) -> None:
        raise NotImplementedError

    def _current_queue(self) -> list[tuple[str, str]]:
        raise NotImplementedError

    def _on_back_hotkey(self) -> None:
        raise NotImplementedError

    def _fill_next_by_hand(self) -> None:
        raise NotImplementedError

    def _begin_link_run(self, resume_at: int) -> None:
        raise NotImplementedError

    def _render_link(self) -> None:
        raise NotImplementedError

    def _wait_esc(self) -> None:
        raise NotImplementedError

    def _show_esc_confirm(self, *, from_key: bool = False, to_credits: bool = False) -> None:
        raise NotImplementedError

    def _update_start_label(self) -> None:
        raise NotImplementedError

    def _advance_album_queue(self) -> None:
        raise NotImplementedError
