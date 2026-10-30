import customtkinter as ctk

from gui import theme
from gui.chrome import ChromeMixin

_f = theme.font


class DoneScreenMixin(ChromeMixin):
    """The done screen and the ways back to the track list or the start screen."""

    def _show_done_screen(self) -> None:
        self._screen = "done"
        self._set_compact(False)
        self._clear()
        self._header(3)
        self._in_countdown = True
        self._countdown = 10
        self._countdown_paused = False

        box = ctk.CTkFrame(self, fg_color="transparent")
        box.pack(expand=True)
        ctk.CTkLabel(box, text="✓", font=theme.font(48, "bold"), text_color=theme.ACCENT).pack()
        ctk.CTkLabel(box, text="All credits entered", font=theme.display(30), text_color=theme.TEXT).pack()
        ctk.CTkLabel(
            box,
            text="Check the Genius page, then press Save there.",
            font=_f(13),
            text_color=theme.MUTED,
        ).pack(pady=(theme.SPACE_1, theme.SPACE_5))

        self._back_btn = self._button(box, "", self._go_to_main, primary=True, width=260)
        self._back_btn.pack(pady=(0, theme.SPACE_2))
        self._back_btn.bind("<Enter>", lambda _: self._pause_countdown())
        self._back_btn.bind("<Leave>", lambda _: self._resume_countdown())
        self._update_done_label()
        if self._album_info is not None and self._album_info.track_count > 1:
            self._button(box, "Back to the track list", self._back_to_album_list, width=260).pack(
                pady=(0, theme.SPACE_2)
            )
        self._button(box, "Close Géniescraper", self.destroy, width=260).pack()

        self.after(1000, self._tick_countdown)

    def _update_done_label(self) -> None:
        self._back_btn.configure(text=f"Paste another song  ({self._countdown}s)")

    def _tick_countdown(self) -> None:
        if not getattr(self, "_in_countdown", False):
            return
        if self._countdown_paused:
            self.after(1000, self._tick_countdown)
            return
        self._countdown -= 1
        if self._countdown <= 0:
            self._go_to_main()
            return
        try:
            self._update_done_label()
        except Exception:
            return
        self.after(1000, self._tick_countdown)

    def _pause_countdown(self) -> None:
        self._countdown_paused = True

    def _resume_countdown(self) -> None:
        self._countdown_paused = False

    def _back_to_album_list(self) -> None:
        self._in_countdown = False
        self._song = None
        self._cover_image = None
        self._queue = []
        self._pos = 0
        self._is_album_queue_mode = False
        self._album_queue_pending = []
        self._album_queue_current = 0
        self._album_queue_position = 0
        self._album_queue_total = 0
        with self._prefetch_cache_lock:
            self._prefetch_cache.clear()
        # _album_info intentionally kept - no re-fetch needed
        self._show_track_select_screen()

    def _go_to_main_from_album(self) -> None:
        self._album_info = None
        self._album_cover_image = None
        self._go_to_main()

    def _go_to_main(self) -> None:
        self.link.end_run()
        self._in_countdown = False
        self._song = None
        self._cover_image = None
        self._album_info = None
        self._album_cover_image = None
        self._queue = []
        self._pos = 0
        self._is_album_queue_mode = False
        self._album_queue_pending = []
        self._album_queue_current = 0
        self._album_queue_position = 0
        self._album_queue_total = 0
        with self._prefetch_cache_lock:
            self._prefetch_cache.clear()
        self._show_scrape_screen()
