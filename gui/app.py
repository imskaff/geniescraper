import asyncio
import os
import threading

import customtkinter as ctk
from PIL import Image as PILImage

from gui import theme
from gui.assistant_keys import AssistantKeysMixin
from gui.assistant_screen import AssistantScreenMixin
from gui.chrome import ChromeMixin
from gui.connect_prompt import ConnectPrompt
from gui.credits_screen import CreditsScreenMixin
from gui.done_screen import DoneScreenMixin
from gui.foreground import GeniusWindowTracker, Win32Api
from gui.host import Host
from gui.link import LinkController, OpenPage
from gui.link_glue import LinkGlueMixin
from gui.logic import (
    prefetch_plan,
)
from gui.queue_controller import QueueControllerMixin
from gui.settings_window import SettingsWindow
from gui.start_screen import StartScreenMixin
from gui.tracks_screen import TracksScreenMixin
from scraper import apple_music
from scraper.apple_music import AlbumTrackInfo
from scraper.models import SongCredits
from utils.config import settings

theme.apply()


class App(
    LinkGlueMixin,
    AssistantScreenMixin,
    AssistantKeysMixin,
    DoneScreenMixin,
    CreditsScreenMixin,
    TracksScreenMixin,
    QueueControllerMixin,
    StartScreenMixin,
    ChromeMixin,
    Host,
):
    def __init__(self, *, start_link: bool = True) -> None:
        super().__init__()
        self.title("Géniescraper v0.6.2")
        pos = f"+{settings.win_x}+{settings.win_y}" if settings.win_x >= 0 and settings.win_y >= 0 else ""
        self.geometry(f"620x700{pos}")
        self.resizable(False, True)
        self.attributes("-topmost", settings.always_on_top)
        theme.set_icon(self)

        # Dedicated background event loop for Playwright/asyncio
        self._loop = asyncio.new_event_loop()
        threading.Thread(target=self._loop.run_forever, daemon=True).start()
        self.protocol("WM_DELETE_WINDOW", self.destroy)

        self._song: SongCredits | None = None
        self._cover_image: PILImage.Image | None = None
        self._album_info: AlbumTrackInfo | None = None
        self._queue: list[tuple[str, str]] = []
        self._pos: int = 0
        self._lock = threading.Lock()
        self._row_widgets: list[tuple] = []
        self._is_album_queue_mode: bool = False
        self._album_queue_pending: list[tuple[int, str]] = []
        self._album_queue_current: int = 0
        self._album_queue_position: int = 0
        self._album_queue_total: int = 0
        self._prefetch_cache: dict[int, tuple[SongCredits, PILImage.Image | None]] = {}
        self._prefetch_cache_lock = threading.Lock()
        self._prefetch_running: set[int] = set()  # tracks being read ahead; guarded by the lock
        self._prefetch_limit = prefetch_plan(settings.parallel_reads)[0]
        self._prefetch_semaphore = threading.Semaphore(self._prefetch_limit)
        self._track_vars: list = []
        self._scrape_selected_btn: ctk.CTkButton | None = None
        self._credits_in_countdown: bool = False
        self._credits_countdown: int = settings.auto_start_delay
        self._credits_countdown_paused: bool = False
        self._kb_hooks: list = []
        self._queue_sf: ctk.CTkScrollableFrame | None = None
        self._screen: str = ""
        self._job: int = 0  # bumped on every new scrape or cancel; stale results are dropped
        self._settings_win: SettingsWindow | None = None
        self._normal_height: int = 700
        self._steps_open = {"done": False, "left": True}  # the step lists' disclosures: done closed, left open
        self._esc_from_key = False
        self._app_focused: bool = False
        self._genius_windows = GeniusWindowTracker(
            Win32Api(), os.getpid()
        )  # where the Next button hands the keyboard back to
        self._genius_windows.start()

        self._link_lbl: ctk.CTkLabel | None = None
        self._link_before: ctk.CTkLabel | None = None
        self._ctl: dict[str, ctk.CTkButton] = {}
        self._auto_hint_lbl: ctk.CTkLabel | None = None
        self._handoff_lbl: ctk.CTkLabel | None = None  # why the Next button could not paste
        self._manual_card: ctk.CTkFrame | None = None  # the 'Manual mode' notice, shown only without the extension
        self._steps_heads: dict[str, ctk.CTkButton] = {}
        # The 'Open in your browser' card on the start screen, and what it currently shows.
        self._pages_card: ctk.CTkFrame | None = None
        self._connect_card: ConnectPrompt | None = None  # the glowing 'Connect your browser extension' call
        self._how_card: ctk.CTkFrame | None = None
        self._pages_shown: tuple[bool, tuple[OpenPage, ...]] | None = None

        # Companion link to the browser extension; its callbacks arrive on the bridge's thread and hop to Tk here.
        self.link = LinkController(
            secret=settings.bridge_secret,
            origin=settings.bridge_origin,
            persist=self._persist_pairing,
            erase=self._erase_pairing,
            schedule=self._on_tk_thread,
        )
        self.link.on_change = self._link_changed
        self.link.on_status = self._link_status
        self.link.on_finished = self._link_finished
        self.link.on_run_ended = self._link_run_ended
        self.link.on_connection = self._link_connection
        self.link.on_pages = self._render_open_pages
        if start_link:
            self.link.start()

        self.bind("<FocusIn>", lambda _: setattr(self, "_app_focused", True))
        self.bind("<FocusOut>", lambda _: setattr(self, "_app_focused", False))

        self._show_scrape_screen()

    # ── helpers ──────────────────────────────────────────────────────────

    def _settings_changed(self) -> None:
        """Apply a setting the moment it changes, on whatever screen is showing."""
        self.attributes("-topmost", settings.always_on_top)
        if self._screen == "assistant":
            pos, old_queue = self._pos, list(self._queue)
            self._show_assistant_screen(keep_run=True)
            with self._lock:
                self._pos = min(pos, len(self._queue))
            if self._queue != old_queue and (self.link.run_active or self.link.connected):
                self._begin_link_run(self._pos)  # the extension holds the old queue: start it over, caught up
                self._sync_hooks()
            self._render_assistant()
            self._render_link()
        elif self._screen == "credits":
            self._show_credits_screen()
        elif self._screen == "start":
            self._show_scrape_screen()

    def destroy(self) -> None:
        self.link.end_run()
        self.link.stop()
        try:
            settings.win_x = self.winfo_x()
            settings.win_y = self.winfo_y()
            settings.save()
        except Exception:
            pass
        future = asyncio.run_coroutine_threadsafe(apple_music.close_browser(), self._loop)
        try:
            future.result(timeout=5)
        except Exception:
            pass
        super().destroy()

    # ── screens ──────────────────────────────────────────────────────────

    # ── scrape ───────────────────────────────────────────────────────────

    # ── hotkey assistant ─────────────────────────────────────────────────

    # ── companion link ───────────────────────────────────────────────────


def run() -> None:
    App().mainloop()
