import asyncio
import io
import threading
import time
import webbrowser
from pathlib import Path

import customtkinter as ctk
import httpx
import keyboard
import pyperclip
from PIL import Image as PILImage

from assistant import flow
from gui import theme
from gui.logic import STEPS, friendly_error, queue_summary, url_hint
from gui.settings_window import SettingsWindow
from scraper import apple_music, pipeline
from scraper.apple_music import AlbumTrackInfo
from scraper.models import SongCredits
from utils.config import settings

theme.apply()

_f = theme.font


_FIELD_LABELS = {
    "written_by": "Written By",
    "produced_by": "Produced By",
    "role": "Additional role",
    "artist": "Artists in this role",
    "copyright_role": "℗/© Role",
    "phonographic_copyright": "℗  Phonographic Copyright",
    "copyright_notice": "©  Copyright",
    "cover_art": "Cover Art URL",
    "youtube_url": "YouTube URL",
}


# Labels in the assistant's step list. Artists and labels sit indented under their
# role or copyright line, so they carry no label of their own.
_LIST_LABELS = {
    "written_by": "Written By",
    "produced_by": "Produced By",
    "role": "Role",
    "copyright_role": "Copyright",
    "youtube_url": "YouTube URL",
    "cover_art": "Cover Art URL",
}
_NESTED_KINDS = frozenset({"artist", "phonographic_copyright", "copyright_notice"})


class App(ctk.CTk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Géniescraper v0.3")
        pos = f"+{settings.win_x}+{settings.win_y}" if settings.win_x >= 0 and settings.win_y >= 0 else ""
        self.geometry(f"620x700{pos}")
        self.resizable(False, True)
        self.attributes("-topmost", settings.always_on_top)
        _icon = Path(__file__).parent.parent / "icon.ico"
        if _icon.exists():
            self.iconbitmap(str(_icon))

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
        self._prefetch_semaphore = threading.Semaphore(1)
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
        self._chips: dict[str, ctk.CTkButton] = {}
        self._chip_label: dict[str, str] = {}
        self._app_focused: bool = False

        self.bind("<FocusIn>", lambda _: setattr(self, "_app_focused", True))
        self.bind("<FocusOut>", lambda _: setattr(self, "_app_focused", False))

        self._show_scrape_screen()

    # ── helpers ──────────────────────────────────────────────────────────

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

    def _register_assistant_keys(self) -> None:
        self._clear_kb_hooks()

        def _on_fwd(e):
            if e.event_type == "down":
                threading.Thread(target=self._on_hotkey, daemon=True).start()

        def _on_back(e):
            if e.event_type == "down":
                threading.Thread(target=self._on_back_hotkey, daemon=True).start()

        self._kb_hooks.append(keyboard.hook_key(settings.hotkey, _on_fwd, suppress=True))
        self._kb_hooks.append(keyboard.hook_key(settings.back_hotkey, _on_back, suppress=True))

    def _header(self, step: int | None) -> None:
        """Top bar on every screen: where you are in the flow, and Settings."""
        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.pack(fill="x", padx=20, pady=(12, 6))
        crumbs = ctk.CTkFrame(bar, fg_color="transparent")
        crumbs.pack(side="left")
        for i, name in enumerate(STEPS):
            if i:
                ctk.CTkLabel(crumbs, text="›", font=_f(12), text_color=theme.DONE).pack(side="left", padx=6)
            if step is None:
                color, weight = theme.FAINT, "normal"
            elif i < step:
                color, weight = theme.MUTED, "normal"
            elif i == step:
                color, weight = theme.TEXT, "bold"
            else:
                color, weight = theme.DONE, "normal"
            ctk.CTkLabel(crumbs, text=name, font=_f(12, weight), text_color=color).pack(side="left")
        ctk.CTkButton(
            bar,
            text="⚙  Settings",
            width=104,
            height=28,
            font=_f(12),
            fg_color=theme.SURFACE,
            hover_color=theme.SURFACE_HI,
            text_color=theme.TEXT,
            border_width=1,
            border_color=theme.BORDER,
            command=self._open_settings,
        ).pack(side="right")

    def _open_settings(self) -> None:
        if self._settings_win is not None and self._settings_win.winfo_exists():
            self._settings_win.lift()
            self._settings_win.focus_force()
            return
        self._settings_win = SettingsWindow(self, on_change=self._settings_changed)

    def _settings_changed(self) -> None:
        """Apply a setting the moment it changes, on whatever screen is showing."""
        self.attributes("-topmost", settings.always_on_top)
        if self._screen == "assistant":
            pos = self._pos
            self._show_assistant_screen()
            with self._lock:
                self._pos = min(pos, len(self._queue))
            self._render_assistant()
        elif self._screen == "credits":
            self._show_credits_screen()
        elif self._screen == "start":
            self._show_scrape_screen()

    def _set_compact(self, compact: bool) -> None:
        if compact:
            if self.winfo_height() > 320:
                self._normal_height = self.winfo_height()
            self.geometry("620x300")
        elif self.winfo_height() <= 320:
            self.geometry(f"620x{self._normal_height}")

    @staticmethod
    def _set_enabled(btn: ctk.CTkButton, enabled: bool) -> None:
        """Disabled primary buttons drop the yellow, so they never look clickable."""
        if enabled:
            btn.configure(state="normal", fg_color=theme.ACCENT, text_color=theme.ACCENT_INK)
        else:
            btn.configure(state="disabled", fg_color=theme.SURFACE_HI, text_color_disabled=theme.FAINT)

    def _button(self, master, text: str, command, *, primary: bool = False, width: int = 140, **kw) -> ctk.CTkButton:
        """Primary actions are filled; everything else is outlined, so the main step is obvious."""
        style = (
            {}
            if primary
            else {
                "fg_color": "transparent",
                "border_width": 1,
                "border_color": theme.BORDER,
                "text_color": theme.TEXT,
                "hover_color": theme.SURFACE_HI,
            }
        )
        return ctk.CTkButton(
            master,
            text=text,
            command=command,
            width=width,
            height=38,
            font=_f(13, "bold" if primary else "normal"),
            **(style | kw),
        )

    def destroy(self) -> None:
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

    def _show_scrape_screen(self) -> None:
        self._screen = "start"
        self._busy = False
        self._set_compact(False)
        self._clear()
        self._header(0)

        body = ctk.CTkFrame(self, fg_color="transparent")
        body.pack(fill="both", expand=True, padx=40)

        ctk.CTkLabel(body, text="Géniescraper", font=theme.display(34), text_color=theme.TEXT).pack(
            anchor="w", pady=(18, 2)
        )
        ctk.CTkLabel(
            body,
            text="Collect a song's credits from Apple Music and paste them into Genius.",
            font=_f(13),
            text_color=theme.MUTED,
        ).pack(anchor="w", pady=(0, 22))

        ctk.CTkLabel(body, text="Apple Music link", font=_f(13, "bold"), text_color=theme.TEXT).pack(anchor="w")
        url_field = ctk.CTkFrame(
            body, height=40, fg_color=theme.SURFACE, border_color=theme.BORDER, border_width=1, corner_radius=6
        )
        url_field.pack(fill="x", pady=(6, 6))
        url_field.pack_propagate(False)
        self._url_entry = ctk.CTkEntry(
            url_field,
            border_width=0,
            corner_radius=0,
            fg_color="transparent",
            placeholder_text="https://music.apple.com/us/album/...",
            font=_f(13),
        )
        self._url_entry.pack(side="left", fill="both", expand=True, padx=(6, 0), pady=3)
        self._url_entry.bind("<Return>", lambda _: self._start_scrape())
        self._url_entry.focus()
        ctk.CTkButton(
            url_field,
            text="Paste",
            width=64,
            height=30,
            fg_color=theme.SURFACE_HI,
            hover_color=theme.BORDER,
            text_color=theme.TEXT,
            corner_radius=4,
            font=_f(12),
            command=self._paste_url,
        ).pack(side="right", padx=(0, 5), pady=4)
        self._hint_lbl = ctk.CTkLabel(body, text="", font=_f(12), text_color=theme.MUTED, anchor="w", justify="left")
        self._hint_lbl.pack(anchor="w", fill="x")

        actions = ctk.CTkFrame(body, fg_color="transparent")
        actions.pack(fill="x", pady=(14, 0))
        self._scrape_btn = self._button(actions, "Scrape", self._start_scrape, primary=True, width=150)
        self._set_enabled(self._scrape_btn, False)
        self._scrape_btn.pack(side="left")
        self._cancel_btn = self._button(actions, "Cancel", self._cancel_scrape, width=100)

        self._progress = ctk.CTkProgressBar(body, mode="indeterminate", height=4, progress_color=theme.ACCENT)
        self._status_lbl = ctk.CTkLabel(body, text="", font=_f(12), text_color=theme.MUTED, anchor="w", justify="left")
        self._status_lbl.pack(anchor="w", fill="x", pady=(10, 0))

        how = ctk.CTkFrame(body, fg_color=theme.SURFACE, corner_radius=8)
        how.pack(fill="x", pady=(24, 0))
        ctk.CTkLabel(how, text="HOW IT WORKS", font=_f(11, "bold"), text_color=theme.FAINT).pack(
            anchor="w", padx=16, pady=(12, 6)
        )
        hk = settings.hotkey.upper()
        for n, text in enumerate(
            (
                "Paste an album or song link and press Scrape.",
                "Choose the tracks, then check the credits that were found.",
                f"Open the song's edit page on Genius, click Written By, and press {hk} once per field.",
            ),
            start=1,
        ):
            row = ctk.CTkFrame(how, fg_color="transparent")
            row.pack(fill="x", padx=16, pady=(0, 8))
            ctk.CTkLabel(row, text=str(n), width=22, font=_f(13, "bold"), text_color=theme.ACCENT, anchor="w").pack(
                side="left", anchor="n"
            )
            ctk.CTkLabel(
                row, text=text, font=_f(13), text_color=theme.TEXT, anchor="w", justify="left", wraplength=470
            ).pack(side="left", fill="x")
        ctk.CTkFrame(how, height=4, fg_color="transparent").pack()

        self._settings_summary(self).pack(side="bottom", pady=(0, 14))
        self._check_url_loop()

    def _settings_summary(self, master) -> ctk.CTkButton:
        """One clickable line with the settings that change how pasting behaves."""
        text = (
            f"Auto-tab {'on' if settings.auto_tab else 'off'}   ·   "
            f"Auto-confirm {'on' if settings.auto_enter else 'off'}   ·   "
            f"Hotkeys {settings.hotkey.upper()} / {settings.back_hotkey.upper()}"
        )
        return ctk.CTkButton(
            master,
            text=text,
            height=26,
            font=_f(12),
            fg_color="transparent",
            hover_color=theme.SURFACE,
            text_color=theme.MUTED,
            command=self._open_settings,
        )

    def _paste_url(self) -> None:
        self._url_entry.delete(0, "end")
        self._url_entry.insert(0, pyperclip.paste().strip())
        self._url_entry.focus()

    def _check_url_loop(self) -> None:
        if not hasattr(self, "_url_entry") or not self._url_entry.winfo_exists():
            return
        if not self._busy:
            ok, hint = url_hint(self._url_entry.get())
            empty = not self._url_entry.get().strip()
            if (self._scrape_btn.cget("state") == "normal") != ok:
                self._set_enabled(self._scrape_btn, ok)
            color = theme.MUTED if ok or empty else theme.WARN
            if self._hint_lbl.cget("text") != hint or self._hint_lbl.cget("text_color") != color:
                self._hint_lbl.configure(text=hint, text_color=color)
        self.after(200, self._check_url_loop)

    def _set_busy(self, busy: bool, status: str = "") -> None:
        """Start-screen state while detecting: progress bar and Cancel instead of Scrape."""
        self._busy = busy
        if not self._scrape_btn.winfo_exists():
            return
        if busy:
            self._set_enabled(self._scrape_btn, False)
            self._url_entry.configure(state="disabled")
            self._cancel_btn.pack(side="left", padx=(8, 0))
            self._progress.pack(fill="x", pady=(14, 0), before=self._status_lbl)
            self._progress.start()
        else:
            self._url_entry.configure(state="normal")
            self._cancel_btn.pack_forget()
            self._progress.stop()
            self._progress.pack_forget()
        self._status_lbl.configure(text=status, text_color=theme.MUTED)

    def _cancel_scrape(self) -> None:
        """Drop whatever is in flight; a late result for the old job is ignored."""
        self._job += 1
        if self._screen == "start":
            self._set_busy(False, "Cancelled.")
        elif self._album_info is not None and self._album_info.track_count > 1:
            self._back_to_album_list()
        else:
            self._go_to_main()

    def _current_queue(self) -> list[tuple[str, str]]:
        assert self._song is not None
        return self._song.typed_queue(
            include_core=settings.scrape_core,
            include_additional=settings.scrape_additional,
            include_copyright=settings.scrape_copyright,
            include_youtube=settings.scrape_youtube,
            include_cover_art=settings.scrape_cover_art,
        )

    def _show_credits_screen(self) -> None:
        self._screen = "credits"
        self._clear_kb_hooks()
        self._set_compact(False)
        self._clear()
        self._header(2)
        song = self._song
        assert song is not None
        queue = self._current_queue()

        extra = ""
        if self._is_album_queue_mode and self._album_info:
            extra = (
                f"Song {self._album_queue_position} of {self._album_queue_total} from {self._album_info.album_title}"
            )
        self._release_header(self, song.title, song.artist, self._cover_image, extra)

        # Buttons anchored to bottom before the scrollable frame so they're always visible
        self._credits_in_countdown = settings.auto_start_assistant
        self._credits_countdown = settings.auto_start_delay
        self._credits_countdown_paused = False

        bottom = ctk.CTkFrame(self, fg_color="transparent")
        bottom.pack(side="bottom", fill="x", padx=40, pady=(6, 14))
        self._button(bottom, "Back", self._back_from_credits, width=90).pack(side="left")
        self._start_assistant_btn = self._button(bottom, "", self._show_assistant_screen, primary=True, width=230)
        self._start_assistant_btn.pack(side="right")
        self._update_start_label()
        if not queue:
            self._set_enabled(self._start_assistant_btn, False)
        else:

            def _on_credits_hotkey(e):
                if e.event_type == "down":
                    self.after(0, self._show_assistant_screen)

            self._kb_hooks.append(keyboard.hook_key(settings.hotkey, _on_credits_hotkey, suppress=True))
            if settings.auto_start_assistant:
                self._start_assistant_btn.bind("<Enter>", lambda _: self._pause_credits_countdown())
                self._start_assistant_btn.bind("<Leave>", lambda _: self._resume_credits_countdown())
                self.after(1000, self._tick_credits_countdown)

        summary = ctk.CTkFrame(self, fg_color="transparent")
        summary.pack(side="bottom", fill="x", padx=40)
        ctk.CTkLabel(
            summary, text=queue_summary(queue), font=_f(12), text_color=theme.MUTED, anchor="w", wraplength=540
        ).pack(anchor="w")
        self._settings_summary(summary).pack(anchor="w")

        sf = ctk.CTkScrollableFrame(self, fg_color=theme.SURFACE, corner_radius=8)
        sf.pack(fill="both", expand=True, padx=40, pady=(0, 6))
        sf.grid_columnconfigure(0, weight=0, minsize=170)
        sf.grid_columnconfigure(1, weight=1)
        row = 0

        def section(title: str) -> None:
            nonlocal row
            ctk.CTkLabel(sf, text=title.upper(), font=_f(11, "bold"), text_color=theme.FAINT, anchor="w").grid(
                row=row, column=0, columnspan=2, sticky="w", padx=10, pady=(12 if row else 6, 4)
            )
            row += 1

        def line(label: str, value: str, *, missing: bool = False, link: str = "", note: str = "") -> None:
            nonlocal row
            ctk.CTkLabel(sf, text=label, font=_f(13), text_color=theme.MUTED, anchor="w").grid(
                row=row, column=0, sticky="nw", padx=10, pady=3
            )
            color = theme.FAINT if missing else (theme.ACCENT if link else theme.TEXT)
            font = ctk.CTkFont(family=theme.UI_FAMILY, size=13, underline=True) if link else _f(13)
            val = ctk.CTkLabel(sf, text=value, font=font, text_color=color, anchor="w", justify="left", wraplength=330)
            val.grid(row=row, column=1, sticky="w", padx=(0, 10), pady=3)
            if link:
                val.configure(cursor="hand2")
                val.bind("<Button-1>", lambda _, u=link: webbrowser.open(u))
            row += 1
            if note:
                ctk.CTkLabel(sf, text=note, font=_f(11), text_color=theme.FAINT, anchor="w").grid(
                    row=row, column=1, sticky="w", padx=(0, 10), pady=(0, 3)
                )
                row += 1

        section("Main credits")
        line("Written By", ", ".join(song.written_by()) or "Not found", missing=not song.written_by())
        line("Produced By", ", ".join(song.produced_by()) or "Not found", missing=not song.produced_by())

        additional = song.additional_credits()
        section(f"Additional credits ({len(additional)})")
        if not additional:
            line("Roles", "Not found", missing=True)
        for credit in additional:
            line(credit.role, ", ".join(credit.artists))

        section("Release")
        phono, notice = song.phonographic_copyright, song.copyright_notice
        line("℗ Phonographic", phono or "Not found", missing=not phono)
        if notice and notice != phono:
            line("© Copyright", notice)
        elif phono:
            line("© Copyright", "Same as ℗", note="Apple Music lists no separate © line")
        else:
            line("© Copyright", "Not found", missing=True)
        if song.youtube_url:
            line("YouTube", "Music video" if song.youtube_is_mv else "Official audio", link=song.youtube_url)
        else:
            line("YouTube", "Not found", missing=True)
        if song.cover_art_url:
            line("Cover art", "1000×1000 PNG", link=song.cover_art_url)
        else:
            line("Cover art", "Not found", missing=True)

    def _update_start_label(self) -> None:
        hk = settings.hotkey.upper()
        if self._credits_in_countdown:
            text = f"Start pasting in {self._credits_countdown}s  ({hk})"
        else:
            text = f"Start pasting  ({hk})"
        self._start_assistant_btn.configure(text=text)

    def _back_from_credits(self) -> None:
        self._credits_in_countdown = False
        self._is_album_queue_mode = False
        self._album_queue_pending = []
        self._album_queue_current = 0
        self._album_queue_position = 0
        self._album_queue_total = 0
        if self._album_info and self._album_info.track_count > 1:
            self._show_track_select_screen()
        else:
            self._show_scrape_screen()

    def _show_assistant_screen(self) -> None:
        self._screen = "assistant"
        self._credits_in_countdown = False
        self._clear()
        self._queue = self._current_queue()
        self._pos = 0
        self._row_widgets = []
        self._queue_sf = None
        song = self._song
        assert song is not None
        self._set_compact(settings.compact_mode)

        if settings.compact_mode:
            bar = ctk.CTkFrame(self, fg_color="transparent")
            bar.pack(fill="x", padx=20, pady=(10, 2))
            ctk.CTkButton(
                bar,
                text="⚙",
                width=30,
                height=26,
                font=_f(13),
                fg_color=theme.SURFACE,
                hover_color=theme.SURFACE_HI,
                text_color=theme.TEXT,
                command=self._open_settings,
            ).pack(side="right")
        else:
            self._header(3)
            bar = ctk.CTkFrame(self, fg_color="transparent")
            bar.pack(fill="x", padx=20, pady=(0, 2))
        ctk.CTkLabel(bar, text=f"{song.title}  ·  {song.artist}", font=_f(12), text_color=theme.MUTED, anchor="w").pack(
            side="left"
        )
        self._prog_lbl = ctk.CTkLabel(bar, text="", text_color=theme.MUTED, font=_f(12))
        self._prog_lbl.pack(side="right", padx=(0, 8))

        self._progress_bar = ctk.CTkProgressBar(self, height=4, progress_color=theme.ACCENT)
        self._progress_bar.pack(fill="x", padx=20, pady=(0, 8))
        self._progress_bar.set(0)

        # ── Hero card: the value the next hotkey press pastes ───────────
        self._hero_card = ctk.CTkFrame(
            self, corner_radius=12, fg_color=theme.SURFACE, border_width=1, border_color=theme.ACCENT
        )
        self._hero_card.pack(fill="x", padx=20, pady=(0, 6))
        badge_row = ctk.CTkFrame(self._hero_card, fg_color="transparent")
        badge_row.pack(fill="x", padx=16, pady=(14, 0))
        self._hero_badge = ctk.CTkLabel(
            badge_row, text="", font=_f(12, "bold"), text_color=theme.ACCENT_INK, fg_color=theme.ACCENT, corner_radius=4
        )
        self._hero_badge.pack(side="left", padx=(0, 8), ipadx=8, ipady=2)
        self._hero_step_lbl = ctk.CTkLabel(badge_row, text="", font=_f(11), text_color=theme.FAINT)
        self._hero_step_lbl.pack(side="left")
        self._hero_value_lbl = ctk.CTkLabel(
            self._hero_card, text="", font=theme.display(32), text_color=theme.TEXT, anchor="w", wraplength=540
        )
        self._hero_value_lbl.pack(anchor="w", padx=16, pady=(6, 4))
        self._card_instr_lbl = ctk.CTkLabel(
            self._hero_card,
            text="",
            anchor="w",
            justify="left",
            wraplength=540,
            font=_f(12),
            text_color=theme.MUTED,
        )
        self._card_instr_lbl.pack(anchor="w", padx=16, pady=(0, 12))

        # ── Controls: mouse equivalents of the hotkeys, and live toggles ─
        controls = ctk.CTkFrame(self, fg_color="transparent")
        controls.pack(fill="x", padx=20, pady=(0, 6))
        back_text = f"‹ Back  {settings.back_hotkey.upper()}"
        for text, command in ((back_text, self._on_back_hotkey), ("Skip ›", self._skip)):
            ctk.CTkButton(
                controls,
                text=text,
                width=92,
                height=28,
                font=_f(12),
                fg_color=theme.SURFACE,
                hover_color=theme.SURFACE_HI,
                text_color=theme.TEXT,
                command=command,
            ).pack(side="left", padx=(0, 6))
        self._chips = {}
        for key, label in (("auto_enter", "Auto-confirm"), ("auto_tab", "Auto-tab")):
            chip = ctk.CTkButton(
                controls,
                text="",
                width=118,
                height=28,
                font=_f(12),
                corner_radius=14,
                border_width=1,
                command=lambda k=key: self._toggle_chip(k),
            )
            chip.pack(side="right", padx=(6, 0))
            self._chips[key] = chip
            self._chip_label[key] = label
        self._refresh_chips()

        if not settings.compact_mode:
            hint = f"Press {settings.hotkey.upper()} to paste.  Esc ends pasting.  Click a step to jump to it."
            ctk.CTkLabel(self, text=hint, font=_f(11), text_color=theme.FAINT, anchor="w").pack(
                fill="x", padx=22, pady=(0, 2)
            )
            self._queue_sf = ctk.CTkScrollableFrame(self, fg_color=theme.SURFACE, corner_radius=8)
            self._queue_sf.pack(fill="both", expand=True, padx=20, pady=(0, 12))
            self._queue_sf.grid_columnconfigure(0, weight=1)

            for i, (kind, value) in enumerate(self._queue):
                row_frame = ctk.CTkFrame(self._queue_sf, fg_color="transparent", corner_radius=4, height=28)
                row_frame.grid(row=i, column=0, sticky="ew", padx=0, pady=0)
                row_frame.grid_columnconfigure(0, minsize=24)
                row_frame.grid_columnconfigure(1, minsize=150)
                row_frame.grid_columnconfigure(2, weight=1)

                m = ctk.CTkLabel(row_frame, text="", width=20, anchor="center", font=_f(11))
                m.grid(row=0, column=0, sticky="w", padx=(4, 0), pady=2)
                nested = kind in _NESTED_KINDS
                t = ctk.CTkLabel(
                    row_frame,
                    text="" if nested else _LIST_LABELS.get(kind, kind),
                    width=140,
                    anchor="w",
                    font=_f(11),
                )
                t.grid(row=0, column=1, sticky="w", padx=4, pady=2)
                v = ctk.CTkLabel(row_frame, text=value, anchor="w", font=_f(12))
                v.grid(row=0, column=2, sticky="w", padx=(20 if nested else 4, 4), pady=2)
                for w in (row_frame, m, t, v):
                    w.bind("<Button-1>", lambda _, idx=i: self._jump_to(idx))
                    w.configure(cursor="hand2")
                self._row_widgets.append((row_frame, m, t, v, kind))

        self._render_assistant()
        self._register_assistant_keys()
        threading.Thread(target=self._wait_esc, daemon=True).start()

    def _refresh_chips(self) -> None:
        for key, chip in self._chips.items():
            on = bool(getattr(settings, key))
            chip.configure(
                text=f"{self._chip_label[key]}  {'on' if on else 'off'}",
                fg_color=theme.ACCENT_DIM if on else "transparent",
                border_color=theme.ACCENT if on else theme.BORDER,
                text_color=theme.ACCENT if on else theme.MUTED,
                hover_color=theme.SURFACE_HI,
            )

    def _toggle_chip(self, key: str) -> None:
        setattr(settings, key, not getattr(settings, key))
        settings.save()
        self._refresh_chips()
        self._card_instr_lbl.configure(text=self._instruction_text())

    def _skip(self) -> None:
        """Move to the next step without pasting, for a field that is already filled on Genius."""
        with self._lock:
            if self._pos >= len(self._queue):
                return
            self._pos += 1
            done = self._pos >= len(self._queue)
        if done:
            self._finish_song()
        else:
            self._render_assistant()

    def _jump_to(self, index: int) -> None:
        with self._lock:
            self._pos = max(0, min(index, len(self._queue) - 1))
        self._render_assistant()

    def _finish_song(self) -> None:
        if self._is_album_queue_mode:
            self.after(500, self._advance_album_queue)
        else:
            self.after(500, self._show_done_screen)

    # ── scrape ───────────────────────────────────────────────────────────

    def _start_scrape(self) -> None:
        url = self._url_entry.get().strip()
        if self._busy or not url_hint(url)[0]:
            return
        self._job += 1
        self._set_busy(True, "Opening the Apple Music page…")
        threading.Thread(target=self._detect_thread, args=(url, self._job), daemon=True).start()

    @staticmethod
    def _download_cover(url: str) -> PILImage.Image | None:
        if not url:
            return None
        try:
            resp = httpx.get(url, timeout=8.0)
            resp.raise_for_status()
            return PILImage.open(io.BytesIO(resp.content))
        except (httpx.HTTPError, OSError):
            return None

    def _scrape_track_thread(self, url: str, track_index: int, track_title: str, job: int | None = None) -> None:
        job = self._job if job is None else job
        try:
            artist = self._album_info.artist if self._album_info else ""
            song = asyncio.run_coroutine_threadsafe(
                pipeline.fetch_track(url, track_index, track_title, artist), self._loop
            ).result()
            cover_image = self._download_cover(song.cover_art_url) or getattr(self, "_album_cover_image", None)
            self.after(0, self._scrape_done, song, cover_image, job)
        except Exception as exc:
            self.after(0, self._scrape_error, str(exc), job)

    def _scrape_done(self, song: SongCredits, cover_image: PILImage.Image | None, job: int | None = None) -> None:
        if job is not None and job != self._job:
            return
        self._song = song
        self._cover_image = cover_image
        self._show_credits_screen()

    def _scrape_error(self, message: str, job: int | None = None) -> None:
        if job is not None and job != self._job:
            return
        self._is_album_queue_mode = False
        self._album_queue_pending = []
        self._album_queue_current = 0
        self._album_queue_position = 0
        self._album_queue_total = 0
        with self._prefetch_cache_lock:
            self._prefetch_cache.clear()
        if self._screen != "start":
            if self._album_info is not None and self._album_info.track_count > 1:
                self._show_track_select_screen()
            else:
                self._show_scrape_screen()
        self._set_busy(False)
        if self._screen == "start":
            self._status_lbl.configure(text=friendly_error(message), text_color=theme.DANGER)
        else:
            self._toast(friendly_error(message), error=True)

    def _detect_thread(self, url: str, job: int) -> None:
        try:
            info = asyncio.run_coroutine_threadsafe(pipeline.detect(url), self._loop).result()
            cover_image = self._download_cover(info.cover_art_url)
            self.after(0, self._detect_done, info, cover_image, job)
        except Exception as exc:
            self.after(0, self._scrape_error, str(exc), job)

    def _detect_done(self, info: AlbumTrackInfo, cover_image: PILImage.Image | None = None, job: int = 0) -> None:
        if job != self._job:
            return
        # Always store so _scrape_track_thread can access artist + cover fallback
        self._album_info = info
        self._album_cover_image = cover_image
        if info.track_count <= 1:
            self._status_lbl.configure(text="Reading the credits…")
            threading.Thread(
                target=self._scrape_track_thread,
                args=(info.url, 1, info.album_title, job),
                daemon=True,
            ).start()
        else:
            self._show_track_select_screen()

    def _toast(self, text: str, *, error: bool = False) -> None:
        """Short message at the bottom of the window that disappears on its own."""
        lbl = ctk.CTkLabel(
            self,
            text=text,
            font=_f(12),
            text_color=theme.TEXT,
            fg_color=theme.DANGER_DIM if error else theme.SURFACE_HI,
            corner_radius=6,
            wraplength=520,
        )
        lbl.place(relx=0.5, rely=1.0, y=-16, anchor="s")
        lbl.lift()
        self.after(6000, lambda: lbl.destroy() if lbl.winfo_exists() else None)

    def _show_track_select_screen(self) -> None:
        self._screen = "tracks"
        self._set_compact(False)
        self._clear()
        self._header(1)
        info = self._album_info
        assert info is not None
        self._track_vars = []
        self._scrape_selected_btn = None

        self._release_header(self, info.album_title, info.artist, getattr(self, "_album_cover_image", None))

        tools = ctk.CTkFrame(self, fg_color="transparent")
        tools.pack(fill="x", padx=40, pady=(4, 4))
        ctk.CTkLabel(
            tools, text=f"{info.track_count} songs. Tick the ones to paste.", font=_f(13), text_color=theme.MUTED
        ).pack(side="left")
        for text, value in (("Clear", False), ("Select all", True)):
            ctk.CTkButton(
                tools,
                text=text,
                width=80,
                height=26,
                font=_f(12),
                fg_color="transparent",
                hover_color=theme.SURFACE,
                text_color=theme.ACCENT,
                command=lambda v=value: self._select_all(v),
            ).pack(side="right")

        # Bottom buttons — packed before the scrollable frame so they're always visible
        btn_row = ctk.CTkFrame(self, fg_color="transparent")
        btn_row.pack(side="bottom", fill="x", padx=40, pady=(8, 14))
        self._button(btn_row, "Back", self._go_to_main_from_album, width=90).pack(side="left")
        self._scrape_selected_btn = self._button(
            btn_row, "Start with selected", self._start_selected_queue, primary=True, width=190
        )
        self._scrape_selected_btn.pack(side="right")
        self._button(btn_row, f"All {info.track_count} songs", self._start_album_queue, width=130).pack(
            side="right", padx=(0, 8)
        )

        sf = ctk.CTkScrollableFrame(self, fg_color=theme.SURFACE, corner_radius=8)
        sf.pack(fill="both", expand=True, padx=40, pady=(0, 4))

        for i, title in enumerate(info.track_titles):
            n = i + 1
            var = ctk.BooleanVar(value=False)
            self._track_vars.append(var)

            row = ctk.CTkFrame(sf, fg_color="transparent", corner_radius=4)
            row.pack(fill="x", padx=2, pady=1)

            cb = ctk.CTkCheckBox(
                row,
                variable=var,
                text="",
                width=24,
                height=24,
                checkbox_width=18,
                checkbox_height=18,
                command=self._update_selection_btn,
            )
            cb.pack(side="left", padx=(8, 4))

            num_lbl = ctk.CTkLabel(row, text=str(n), width=28, text_color=theme.FAINT, anchor="e", font=_f(13))
            num_lbl.pack(side="left", padx=(0, 10))
            title_lbl = ctk.CTkLabel(row, text=title, anchor="w", font=_f(13), text_color=theme.TEXT)
            title_lbl.pack(side="left", fill="x", expand=True, pady=4)

            def _hover_on(_, r=row):
                r.configure(fg_color=theme.FOCUS)

            def _hover_off(_, r=row):
                r.configure(fg_color="transparent")

            def _toggle(_, v=var):
                v.set(not v.get())
                self._update_selection_btn()

            for w in (row, num_lbl, title_lbl):
                w.bind("<Enter>", _hover_on)
                w.bind("<Leave>", _hover_off)
            for w in (row, num_lbl, title_lbl):
                w.bind("<Button-1>", _toggle)
                w.configure(cursor="hand2")
        self._update_selection_btn()

    def _release_header(self, master, title: str, artist: str, cover: PILImage.Image | None, extra: str = "") -> None:
        top = ctk.CTkFrame(master, fg_color="transparent")
        top.pack(fill="x", padx=40, pady=(10, 10))
        if cover is not None:
            thumb = ctk.CTkImage(cover, size=(88, 88))
            ctk.CTkLabel(top, image=thumb, text="").pack(side="left", padx=(0, 16))
        info = ctk.CTkFrame(top, fg_color="transparent")
        info.pack(side="left", fill="both", expand=True)
        ctk.CTkLabel(
            info, text=title, font=theme.display(24), text_color=theme.TEXT, anchor="w", justify="left", wraplength=400
        ).pack(anchor="w")
        ctk.CTkLabel(info, text=artist, font=_f(14), text_color=theme.MUTED, anchor="w").pack(anchor="w")
        if extra:
            ctk.CTkLabel(info, text=extra, font=_f(12), text_color=theme.ACCENT, anchor="w").pack(
                anchor="w", pady=(6, 0)
            )

    def _select_all(self, value: bool) -> None:
        for var in self._track_vars:
            var.set(value)
        self._update_selection_btn()

    def _update_selection_btn(self) -> None:
        btn = self._scrape_selected_btn
        if btn is None:
            return
        try:
            if not btn.winfo_exists():
                return
        except Exception:
            return
        count = sum(1 for v in self._track_vars if v.get())
        if count == 0:
            btn.configure(text="Start with selected")
            self._set_enabled(btn, False)
        else:
            btn.configure(text=f"Start with {count} selected")
            self._set_enabled(btn, True)

    def _start_selected_queue(self) -> None:
        info = self._album_info
        selected = [
            (i + 1, title)
            for i, (title, var) in enumerate(zip(info.track_titles, self._track_vars, strict=False))
            if var.get()
        ]
        if not selected:
            return
        self._is_album_queue_mode = True
        self._album_queue_total = len(selected)
        self._album_queue_position = 1
        self._album_queue_pending = selected[:]
        track_index, track_title = self._album_queue_pending.pop(0)
        self._album_queue_current = track_index
        self._on_track_selected(track_index, track_title)
        self._prefetch_tracks(2)

    def _start_album_queue(self) -> None:
        info = self._album_info
        self._is_album_queue_mode = True
        self._album_queue_total = info.track_count
        self._album_queue_position = 1
        self._album_queue_pending = [(i + 1, title) for i, title in enumerate(info.track_titles)]
        track_index, track_title = self._album_queue_pending.pop(0)
        self._album_queue_current = track_index
        self._on_track_selected(track_index, track_title)
        self._prefetch_tracks(2)

    def _on_track_selected(self, track_index: int, track_title: str) -> None:
        with self._prefetch_cache_lock:
            cached = self._prefetch_cache.pop(track_index, None)
        if cached is not None:
            self._clear()
            self.after(0, self._scrape_done, *cached)
            return

        self._show_loading_screen(track_title)
        threading.Thread(
            target=self._scrape_track_thread,
            args=(self._album_info.url, track_index, track_title, self._job),
            daemon=True,
        ).start()

    def _show_loading_screen(self, track_title: str) -> None:
        self._screen = "loading"
        self._job += 1
        self._clear()
        self._header(1)
        box = ctk.CTkFrame(self, fg_color="transparent")
        box.pack(expand=True)
        if self._is_album_queue_mode:
            ctk.CTkLabel(
                box,
                text=f"Song {self._album_queue_position} of {self._album_queue_total}",
                font=_f(12),
                text_color=theme.FAINT,
            ).pack()
        ctk.CTkLabel(box, text=track_title, font=theme.display(26), text_color=theme.TEXT, wraplength=480).pack(
            pady=(2, 14)
        )
        bar = ctk.CTkProgressBar(box, mode="indeterminate", width=320, height=4, progress_color=theme.ACCENT)
        bar.pack()
        bar.start()
        ctk.CTkLabel(
            box,
            text=(
                "Reading the credits on Apple Music and finding the YouTube link and cover art.\n"
                "This usually takes 3 to 8 seconds."
            ),
            font=_f(12),
            text_color=theme.MUTED,
            justify="center",
        ).pack(pady=(14, 18))
        self._button(box, "Cancel", self._cancel_scrape, width=110).pack()

    def _advance_album_queue(self) -> None:
        self._clear_kb_hooks()
        self.geometry("620x700")
        if not self._album_queue_pending:
            self._is_album_queue_mode = False
            self._show_done_screen()
            return
        track_index, track_title = self._album_queue_pending.pop(0)
        self._album_queue_current = track_index
        self._album_queue_position += 1
        self._song = None
        self._cover_image = None
        self._queue = []
        self._pos = 0
        self._on_track_selected(track_index, track_title)
        self._prefetch_tracks(2)

    def _prefetch_tracks(self, n: int = 2) -> None:
        if not self._is_album_queue_mode or self._album_info is None:
            return
        with self._prefetch_cache_lock:
            cached = set(self._prefetch_cache)
        count = 0
        for track_index, track_title in self._album_queue_pending:
            if count >= n:
                break
            if track_index not in cached:
                threading.Thread(
                    target=self._prefetch_worker,
                    args=(track_index, track_title),
                    daemon=True,
                ).start()
                count += 1

    def _prefetch_worker(self, track_index: int, track_title: str) -> None:
        album_info = self._album_info
        if album_info is None:
            return
        url, artist = album_info.url, album_info.artist

        if not self._prefetch_semaphore.acquire(timeout=120):
            return
        try:
            with self._prefetch_cache_lock:
                if track_index in self._prefetch_cache:
                    return

            song = asyncio.run_coroutine_threadsafe(
                pipeline.fetch_track(url, track_index, track_title, artist),
                self._loop,
            ).result()
            cover_url = song.cover_art_url

            cover_image: PILImage.Image | None = None
            if cover_url:
                try:
                    resp = httpx.get(cover_url, timeout=8.0)
                    cover_image = PILImage.open(io.BytesIO(resp.content))
                except Exception:
                    pass
            if cover_image is None:
                cover_image = getattr(self, "_album_cover_image", None)

            with self._prefetch_cache_lock:
                self._prefetch_cache[track_index] = (song, cover_image)
        except Exception:
            pass
        finally:
            self._prefetch_semaphore.release()

    # ── hotkey assistant ─────────────────────────────────────────────────

    def _on_back_hotkey(self) -> None:
        with self._lock:
            if self._pos > 0:
                self._pos -= 1
                self.after(0, self._render_assistant)

    def _on_hotkey(self) -> None:
        with self._lock:
            if self._pos >= len(self._queue):
                return
            kind, value = self._queue[self._pos]
            self._pos += 1  # advance immediately so F7 can decrement during paste
            next_kind = self._queue[self._pos][0] if self._pos < len(self._queue) else None

        # Perform slow I/O outside the lock so F7 can always respond immediately
        time.sleep(0.15)
        pyperclip.copy(value)
        keyboard.press_and_release("ctrl+v")
        if kind not in flow.CLIPBOARD_ONLY_KINDS and settings.auto_enter:
            time.sleep(settings.autocomplete_wait)
            keyboard.press_and_release("enter")
        if settings.auto_tab:
            for key, pause in flow.autotab_steps(kind, next_kind):
                time.sleep(pause)
                keyboard.press_and_release(key)

        # Re-read pos — F7 may have decremented it during the paste window
        with self._lock:
            new_pos = self._pos
            queue_len = len(self._queue)

        if new_pos >= queue_len:
            self._finish_song()
        else:
            self.after(0, self._render_assistant)

    def _render_assistant(self) -> None:
        total = len(self._queue)
        pos = self._pos

        if pos < total:
            kind, value = self._queue[pos]
            field_label = _FIELD_LABELS.get(kind, kind)

            self._prog_lbl.configure(text=f"{pos + 1} / {total}")
            self._progress_bar.set((pos + 1) / total if total else 0)

            # Hero card updates
            self._hero_badge.configure(text=field_label)
            self._hero_step_lbl.configure(text=f"Step {pos + 1} of {total}")
            self._hero_value_lbl.configure(text=value)
            self._card_instr_lbl.configure(text=self._instruction_text())

            # Auto-scroll the queue list to keep the current item visible
            if self._queue_sf is not None and self._queue_sf.winfo_exists():
                fraction = max(0.0, (pos - 2) / max(1, total))
                self._queue_sf._parent_canvas.yview_moveto(fraction)

        # Full row sweep — avoids a race where scheduled renders see a stale _prev_pos
        for i, (row_frame, m, t, v, _kind) in enumerate(self._row_widgets):
            if i < pos:
                row_frame.configure(fg_color="transparent")
                m.configure(text="✓", text_color=theme.DONE)
                t.configure(text_color=theme.DONE, font=_f(11))
                v.configure(text_color=theme.DONE, font=_f(12))
            elif i == pos:
                row_frame.configure(fg_color=theme.FOCUS)
                m.configure(text="▶", text_color=theme.ACCENT)
                t.configure(text_color=theme.ACCENT, font=_f(11, "bold"))
                v.configure(text_color=theme.TEXT, font=_f(12, "bold"))
            else:
                row_frame.configure(fg_color="transparent")
                m.configure(text="")
                t.configure(text_color=theme.FAINT, font=_f(11))
                v.configure(text_color=theme.MUTED, font=_f(12))

    def _instruction_text(self) -> str:
        return flow.instruction_text(self._queue, self._pos, settings.hotkey)

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
        ).pack(pady=(4, 22))

        self._back_btn = self._button(box, "", self._go_to_main, primary=True, width=260)
        self._back_btn.pack(pady=(0, 8))
        self._back_btn.bind("<Enter>", lambda _: self._pause_countdown())
        self._back_btn.bind("<Leave>", lambda _: self._resume_countdown())
        self._update_done_label()
        if self._album_info is not None and self._album_info.track_count > 1:
            self._button(box, "Back to the track list", self._back_to_album_list, width=260).pack(pady=(0, 8))
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

    def _tick_credits_countdown(self) -> None:
        if not getattr(self, "_credits_in_countdown", False):
            return
        if self._credits_countdown_paused:
            self.after(1000, self._tick_credits_countdown)
            return
        self._credits_countdown -= 1
        if self._credits_countdown <= 0:
            self._credits_in_countdown = False
            self._show_assistant_screen()
            return
        try:
            self._update_start_label()
        except Exception:
            return
        self.after(1000, self._tick_credits_countdown)

    def _pause_credits_countdown(self) -> None:
        self._credits_countdown_paused = True

    def _resume_credits_countdown(self) -> None:
        self._credits_countdown_paused = False

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
        # _album_info intentionally kept — no re-fetch needed
        self._show_track_select_screen()

    def _go_to_main_from_album(self) -> None:
        self._album_info = None
        self._album_cover_image = None
        self._go_to_main()

    def _go_to_main(self) -> None:
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

    def _wait_esc(self) -> None:
        while True:
            keyboard.wait("esc")
            if self._app_focused:
                self.after(0, self._show_esc_confirm)
                return

    def _show_esc_confirm(self) -> None:
        # Unhook the assistant hotkeys so they don't fire during confirmation
        self._clear_kb_hooks()

        # Dark overlay frame on top of everything
        self._esc_overlay = ctk.CTkFrame(
            self, fg_color=theme.SURFACE, corner_radius=12, border_width=1, border_color=theme.BORDER
        )
        self._esc_overlay.place(relx=0.5, rely=0.5, anchor="center", relwidth=0.85)

        ctk.CTkLabel(
            self._esc_overlay,
            text="End pasting for this song?",
            font=theme.display(22),
            text_color=theme.TEXT,
        ).pack(pady=(28, 20))

        btn_row = ctk.CTkFrame(self._esc_overlay, fg_color="transparent")
        btn_row.pack(pady=(0, 28))

        ctk.CTkButton(
            btn_row,
            text="Keep pasting",
            width=140,
            height=38,
            fg_color="transparent",
            border_width=1,
            border_color=theme.BORDER,
            text_color=theme.TEXT,
            hover_color=theme.SURFACE_HI,
            command=self._dismiss_esc_confirm,
            font=_f(13, "bold"),
        ).pack(side="left", padx=(0, 12))
        ctk.CTkButton(
            btn_row,
            text="End and start over",
            width=160,
            height=38,
            fg_color=theme.DANGER_DIM,
            hover_color=theme.DANGER_HOVER,
            text_color=theme.DANGER,
            border_width=1,
            border_color=theme.DANGER,
            command=self._confirm_esc_quit,
            font=_f(13, "bold"),
        ).pack(side="left")

    def _dismiss_esc_confirm(self) -> None:
        """User chose to resume — remove overlay and re-register hotkeys."""
        if hasattr(self, "_esc_overlay") and self._esc_overlay.winfo_exists():
            self._esc_overlay.destroy()
        # Re-register assistant hotkeys
        self._register_assistant_keys()
        threading.Thread(target=self._wait_esc, daemon=True).start()

    def _confirm_esc_quit(self) -> None:
        """User confirmed quit — clean up and go to main menu."""
        self._clear_kb_hooks()
        if hasattr(self, "_esc_overlay") and self._esc_overlay.winfo_exists():
            self._esc_overlay.destroy()
        self._go_to_main()


def run() -> None:
    App().mainloop()
