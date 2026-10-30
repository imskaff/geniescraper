import asyncio
import threading
import time

import customtkinter as ctk
import keyboard
import pyperclip
from PIL import Image as PILImage

from assistant import flow
from gui import theme
from gui.chrome import ChromeMixin
from gui.connect_prompt import ConnectPrompt
from gui.credits_screen import CreditsScreenMixin
from gui.done_screen import DoneScreenMixin
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

_f = theme.font

# The extension's paste-screen help line, word for word.
_PASTE_HELP = (
    "Keep the song's Edit Metadata form open on Genius. Nothing is saved for you: check the form, then save it there."
)
_AUTO_HINT_OFFLINE = "Connect the browser extension in Settings to use Auto-paste"
_AUTO_HINT_IDLE = "The extension is not running this song. Use the hotkeys, or reconnect it in Settings."


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
    "release_month": "Release month",
    "release_day": "Release day",
    "release_year": "Release year",
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
    "release_month": "Release month",
    "release_day": "Release day",
    "release_year": "Release year",
}
_NESTED_KINDS = frozenset({"artist", "phonographic_copyright", "copyright_notice"})


class App(
    LinkGlueMixin,
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
        self.title("Géniescraper v0.5")
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

        self._link_lbl: ctk.CTkLabel | None = None
        self._link_before: ctk.CTkLabel | None = None
        self._ctl: dict[str, ctk.CTkButton] = {}
        self._auto_hint_lbl: ctk.CTkLabel | None = None
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

    def _register_assistant_keys(self) -> None:
        self._clear_kb_hooks()
        if self.link.bridged:
            return  # the extension owns the keys while it runs the paste; both at once would double-step

        def _on_fwd(e):
            if e.event_type == "down":
                threading.Thread(target=self._on_hotkey, daemon=True).start()

        def _on_back(e):
            if e.event_type == "down":
                threading.Thread(target=self._on_back_hotkey, daemon=True).start()

        self._kb_hooks.append(keyboard.hook_key(settings.hotkey, _on_fwd, suppress=True))
        self._kb_hooks.append(keyboard.hook_key(settings.back_hotkey, _on_back, suppress=True))

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

    def _show_assistant_screen(self, *, keep_run: bool = False) -> None:
        self._screen = "assistant"
        self._credits_in_countdown = False
        self._link_lbl = self._link_before = self._auto_hint_lbl = self._manual_card = None
        self._ctl = {}
        self._steps_heads = {}
        self._clear()
        self._queue = self._current_queue()
        self._pos = 0
        self._row_widgets = []
        self._queue_sf = None
        song = self._song
        assert song is not None
        self._set_compact(settings.compact_mode)

        compact = settings.compact_mode
        if compact:
            bar = ctk.CTkFrame(self, fg_color="transparent")
            bar.pack(fill="x", padx=theme.SPACE_4, pady=(theme.SPACE_2, 0))
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
            ctk.CTkLabel(
                self, text="Paste into Genius", font=theme.display(24), text_color=theme.TEXT, anchor="w"
            ).pack(fill="x", padx=theme.SPACE_4, pady=(0, theme.SPACE_1))
            bar = ctk.CTkFrame(self, fg_color="transparent")
            bar.pack(fill="x", padx=theme.SPACE_4, pady=(0, theme.SPACE_2))
        ctk.CTkLabel(bar, text=f"{song.title}  ·  {song.artist}", font=_f(12), text_color=theme.MUTED, anchor="w").pack(
            side="left"
        )

        # The status or error comes first, then the step counter, as in the extension's paste screen.
        self._link_lbl = ctk.CTkLabel(
            self, text="", font=_f(12), text_color=theme.MUTED, anchor="w", justify="left", wraplength=560
        )
        self._prog_lbl = ctk.CTkLabel(self, text="", font=_f(12, "bold"), text_color=theme.MUTED, anchor="w")
        self._prog_lbl.pack(fill="x", padx=theme.SPACE_4, pady=(0, theme.SPACE_1))
        self._link_before = self._prog_lbl

        # The step card: the value the next paste puts into Genius.
        self._hero_card = ctk.CTkFrame(
            self, corner_radius=12, fg_color=theme.SURFACE, border_width=1, border_color=theme.ACCENT
        )
        self._hero_card.pack(fill="x", padx=theme.SPACE_4, pady=(0, theme.SPACE_2))
        badge_row = ctk.CTkFrame(self._hero_card, fg_color="transparent")
        badge_row.pack(fill="x", padx=theme.SPACE_4, pady=(theme.SPACE_3, 0))
        self._hero_badge = ctk.CTkLabel(
            badge_row, text="", font=_f(12, "bold"), text_color=theme.ACCENT_INK, fg_color=theme.ACCENT, corner_radius=4
        )
        self._hero_badge.pack(side="left", ipadx=theme.SPACE_2, ipady=theme.SPACE_1)
        self._hero_value_lbl = ctk.CTkLabel(
            self._hero_card,
            text="",
            font=theme.display(24 if compact else 32),
            text_color=theme.TEXT,
            anchor="w",
            justify="left",
            wraplength=540,
        )
        self._hero_value_lbl.pack(anchor="w", padx=theme.SPACE_4, pady=(theme.SPACE_1, theme.SPACE_3))
        self._card_instr_lbl = ctk.CTkLabel(
            self, text="", anchor="w", justify="left", wraplength=560, font=_f(12), text_color=theme.TEXT
        )
        self._card_instr_lbl.pack(fill="x", padx=theme.SPACE_4, pady=(0, theme.SPACE_2))
        self._build_manual_card(compact)

        # Buttons, in the extension's order.
        controls = ctk.CTkFrame(self, fg_color="transparent")
        controls.pack(fill="x", padx=theme.SPACE_4, pady=(0, theme.SPACE_1))
        self._ctl = {
            "auto": self._control(controls, "Auto-paste: OFF", self._toggle_auto, 128),
            "next": self._control(controls, "", self._next_clicked, 104),
            "back": self._control(controls, "", self._on_back_hotkey, 108),
            "skip": self._control(controls, "Skip", self._skip, 64),
        }
        for name in ("auto", "next", "back", "skip"):
            self._ctl[name].pack(side="left", padx=(0, theme.SPACE_2))
        stop = self._control(controls, "Back to credits", self._ask_back_to_credits, 120)
        stop.configure(fg_color="transparent", border_width=1, border_color=theme.BORDER)
        stop.pack(side="right")
        self._ctl["stop"] = stop
        self._auto_hint_lbl = ctk.CTkLabel(self, text="", font=_f(11), text_color=theme.FAINT, anchor="w")
        if not compact:
            ctk.CTkLabel(
                self,
                text=_PASTE_HELP,
                font=_f(11),
                text_color=theme.FAINT,
                anchor="w",
                justify="left",
                wraplength=560,
            ).pack(fill="x", padx=theme.SPACE_4, pady=(0, theme.SPACE_2))
            self._build_steps_list()

        if not keep_run:
            self._begin_link_run(0)
        self._render_assistant()
        self._render_link()
        self._register_assistant_keys()
        threading.Thread(target=self._wait_esc, daemon=True).start()

    def _build_manual_card(self, compact: bool) -> None:
        """The 'Manual mode' notice. It is packed by _render_controls while no extension is connected."""
        card = ctk.CTkFrame(self, corner_radius=12, fg_color=theme.SURFACE, border_width=1, border_color=theme.BORDER)
        if compact:
            # One line: the window is only 300 tall, so the explanation lives in the full-size screen.
            row = ctk.CTkFrame(card, fg_color="transparent")
            row.pack(fill="x", padx=theme.SPACE_3, pady=theme.SPACE_2)
            ctk.CTkLabel(
                row, text="Manual mode: extension not connected", font=_f(12, "bold"), text_color=theme.TEXT
            ).pack(side="left")
            connect = self._button(row, "Connect browser extension", self._connect_extension, primary=True, width=200)
            connect.configure(height=28)
            connect.pack(side="right")
        else:
            ctk.CTkLabel(card, text="Manual mode", font=_f(13, "bold"), text_color=theme.TEXT, anchor="w").pack(
                fill="x", padx=theme.SPACE_4, pady=(theme.SPACE_3, 0)
            )
            ctk.CTkLabel(
                card,
                text=(
                    "The browser extension is not connected, so Géniescraper cannot see Genius. "
                    f"Click each field yourself, then press {settings.hotkey.upper()}. "
                    "It cannot tell what is already filled in (use Skip for those) or check that an artist exists."
                ),
                font=_f(12),
                text_color=theme.MUTED,
                anchor="w",
                justify="left",
                wraplength=520,
            ).pack(fill="x", padx=theme.SPACE_4, pady=(theme.SPACE_1, theme.SPACE_2))
            connect = self._button(card, "Connect browser extension", self._connect_extension, primary=True, width=220)
            connect.pack(anchor="w", padx=theme.SPACE_4, pady=(0, theme.SPACE_3))
        self._manual_card = card

    def _build_steps_list(self) -> None:
        """The step lists, in one scroll area: 'Steps done' (closed to start with) above 'Steps left' (open)."""
        sf = self._queue_sf = theme.scroll_frame(self, fg_color=theme.SURFACE, corner_radius=8)
        sf.pack(fill="both", expand=True, padx=theme.SPACE_4, pady=(0, theme.SPACE_3))
        sf.grid_columnconfigure(0, weight=1)
        for key in ("done", "left"):
            self._steps_heads[key] = ctk.CTkButton(
                sf,
                text="",
                anchor="w",
                height=26,
                font=_f(12, "bold"),
                fg_color="transparent",
                hover_color=theme.SURFACE_HI,
                text_color=theme.MUTED,
                command=lambda k=key: self._toggle_steps(k),
            )
        for i, (kind, value) in enumerate(self._queue):
            row_frame = ctk.CTkFrame(sf, fg_color="transparent", corner_radius=4, height=28)
            row_frame.grid_columnconfigure(0, minsize=24)
            row_frame.grid_columnconfigure(1, minsize=150)
            row_frame.grid_columnconfigure(2, weight=1)

            m = ctk.CTkLabel(row_frame, text="", width=20, anchor="center", font=_f(11))
            m.grid(row=0, column=0, sticky="w", padx=(theme.SPACE_1, 0), pady=theme.SPACE_1)
            nested = kind in _NESTED_KINDS
            t = ctk.CTkLabel(
                row_frame,
                text="" if nested else _LIST_LABELS.get(kind, kind),
                width=140,
                anchor="w",
                font=_f(11),
            )
            t.grid(row=0, column=1, sticky="w", padx=theme.SPACE_1, pady=theme.SPACE_1)
            v = ctk.CTkLabel(row_frame, text=value, anchor="w", font=_f(12))
            v.grid(
                row=0,
                column=2,
                sticky="w",
                padx=(theme.SPACE_4 if nested else theme.SPACE_1, theme.SPACE_1),
                pady=theme.SPACE_1,
            )
            for w in (row_frame, m, t, v):
                w.bind("<Button-1>", lambda _, idx=i: self._jump_to(idx))
                w.configure(cursor="hand2")
            self._row_widgets.append((row_frame, m, t, v, kind))

    def _toggle_steps(self, key: str) -> None:
        self._steps_open[key] = not self._steps_open[key]
        self._render_assistant()

    def _auto_on(self) -> bool:
        status = self.link.status
        return self.link.bridged and status is not None and status.auto == "running"

    def _toggle_auto(self) -> None:
        """Auto-paste on the extension: pause it when it runs, otherwise start or resume it. Remembered for the next song."""
        if not self.link.bridged:
            return
        turn_on = not self._auto_on()
        if self.link.command("resume" if turn_on else "pause"):
            settings.link_mode = "auto" if turn_on else "manual"
            settings.save()

    def _next_clicked(self) -> None:
        """Next is only on screen while the extension runs the paste: it fills the step."""
        self.link.command("fill-next")

    def _ask_back_to_credits(self) -> None:
        self._show_esc_confirm(to_credits=True)

    def _back_to_credits(self) -> None:
        """Leave pasting for the song's credits, without starting the countdown that would begin pasting again."""
        self.link.end_run()
        self._clear_kb_hooks()
        if self._esc_overlay_open():
            self._esc_overlay.destroy()
        self._show_credits_screen()
        self._credits_in_countdown = False
        self._update_start_label()

    def _skip(self) -> None:
        """Move to the next step without pasting, for a field that is already filled on Genius."""
        if self.link.bridged:
            self.link.command("skip")  # the extension moves; its status updates the position
            return
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
        if self.link.bridged:
            self.link.jump(index - self._pos)
            return
        with self._lock:
            self._pos = max(0, min(index, len(self._queue) - 1))
        self._render_assistant()

    def _finish_song(self) -> None:
        if self._is_album_queue_mode:
            self.after(500, self._advance_album_queue)
        else:
            self.after(500, self._show_done_screen)

    # ── scrape ───────────────────────────────────────────────────────────

    # ── hotkey assistant ─────────────────────────────────────────────────

    def _on_back_hotkey(self) -> None:
        if self.link.bridged:
            self.link.command("back")
            return
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
        # The desktop cannot see Genius here, so it cannot check the suggestion: it waits, then takes the first one.
        if kind not in flow.CLIPBOARD_ONLY_KINDS:
            time.sleep(settings.autocomplete_wait)
            keyboard.press_and_release("enter")
        for key, pause in flow.autotab_steps(kind, next_kind):
            time.sleep(pause)
            keyboard.press_and_release(key)

        # Re-read pos - F7 may have decremented it during the paste window
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
        finished = pos >= total

        self._prog_lbl.configure(text="All steps done" if finished else f"Step {pos + 1} of {total}")
        if not finished:
            kind, value = self._queue[pos]
            self._hero_badge.configure(text=_FIELD_LABELS.get(kind, kind))
            self._hero_value_lbl.configure(text=value)
        else:
            self._hero_badge.configure(text="Done")
            self._hero_value_lbl.configure(text="✓")
        self._card_instr_lbl.configure(text=self._instruction_text())
        self._render_controls()
        self._render_steps()

    def _render_steps(self) -> None:
        """Rows done / here / left, the two disclosures between them, and the list scrolled to the current step."""
        total = len(self._queue)
        pos = min(self._pos, total)
        if self._queue_sf is not None and self._queue_sf.winfo_exists():
            # Row 0 is the 'done' header, row 2i+2 is step i, and the 'left' header sits just above step pos.
            heads = self._steps_heads
            for key, count, row in (("done", pos, 0), ("left", total - pos, 2 * pos + 1)):
                head = heads[key]
                if count == 0:
                    head.grid_remove()
                    continue
                mark = "▾" if self._steps_open[key] else "▸"
                title = "Steps done" if key == "done" else "Steps left"
                head.configure(text=f"{mark}  {title} ({count})")
                head.grid(row=row, column=0, sticky="ew", pady=(theme.SPACE_1, 0))
            fraction = 0.0 if not self._steps_open["done"] else max(0.0, (pos - 2) / max(1, total))
            self._queue_sf._parent_canvas.yview_moveto(fraction)

        # Full row sweep - avoids a race where scheduled renders see a stale _prev_pos
        for i, (row_frame, m, t, v, _kind) in enumerate(self._row_widgets):
            shown = self._steps_open["done" if i < pos else "left"]
            if shown:
                row_frame.grid(row=2 * i + 2, column=0, sticky="ew")
            else:
                row_frame.grid_remove()
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

    def _render_controls(self) -> None:
        """Button states, as in the extension: Auto-paste (only with the extension), Next (only while auto is off)."""
        ctl = self._ctl
        if not ctl or not ctl["auto"].winfo_exists():
            return
        link = self.link
        finished = self._pos >= len(self._queue)
        bridged = link.bridged
        on = self._auto_on()
        auto = ctl["auto"]
        auto.configure(text="Auto-paste: ON" if on else "Auto-paste: OFF")
        if on:
            auto.configure(
                state="normal", fg_color=theme.ACCENT, hover_color=theme.ACCENT_HOVER, text_color=theme.ACCENT_INK
            )
        else:
            auto.configure(
                state="normal" if bridged else "disabled",
                fg_color=theme.SURFACE if bridged else theme.SURFACE_HI,
                hover_color=theme.SURFACE_HI,
                text_color=theme.TEXT,
            )
        nxt = ctl["next"]
        nxt.configure(
            text=f"Next ({settings.hotkey.upper()})",
            state="disabled" if finished or (bridged and bool(link.status and link.status.busy)) else "normal",
        )
        if on or not bridged:  # without the extension the hotkeys are the only way: no Next button, no window tricks
            nxt.pack_forget()
        elif not nxt.winfo_ismapped():
            nxt.pack(side="left", padx=(0, theme.SPACE_2), before=ctl["back"])
        ctl["back"].configure(
            text=f"Previous ({settings.back_hotkey.upper()})", state="disabled" if self._pos == 0 else "normal"
        )
        ctl["skip"].configure(state="disabled" if finished else "normal")
        card = self._manual_card
        if card is not None:
            if link.connected:
                card.pack_forget()
            elif not card.winfo_manager():
                card.pack(fill="x", padx=theme.SPACE_4, pady=(0, theme.SPACE_2), after=self._card_instr_lbl)
        compact_notice = settings.compact_mode and card is not None and bool(card.winfo_manager())
        hint = "" if bridged or compact_notice else (_AUTO_HINT_IDLE if link.connected else _AUTO_HINT_OFFLINE)
        if self._auto_hint_lbl is not None:
            if hint:
                self._auto_hint_lbl.configure(text=hint)
                self._auto_hint_lbl.pack(fill="x", padx=theme.SPACE_4, pady=(0, theme.SPACE_1), after=auto.master)
            else:
                self._auto_hint_lbl.pack_forget()

    def _instruction_text(self) -> str:
        if self._auto_on():
            return "Auto-paste is filling the form. It pauses if you use Genius; press Auto-paste to take over."
        if self.link.bridged:
            return f"Press Next here, or {settings.hotkey.upper()} on the Genius page, to fill this step."
        text = flow.instruction_text(self._queue, self._pos, settings.hotkey)
        if (
            not settings.compact_mode  # compact mode has no room: its notice line says it
            and self._pos < len(self._queue)
            and self._queue[self._pos][0] not in flow.CLIPBOARD_ONLY_KINDS
        ):
            hk = settings.hotkey.upper()
            text += "\n" + f"Click the field on Genius first: {hk} pastes wherever your cursor is."
        return text

    # ── companion link ───────────────────────────────────────────────────

    def _wait_esc(self) -> None:
        while True:
            keyboard.wait("esc")
            if self._app_focused:
                self.after(0, lambda: self._show_esc_confirm(from_key=True))
                return

    def _show_esc_confirm(self, *, from_key: bool = False, to_credits: bool = False) -> None:
        if self._screen != "assistant" or self._esc_overlay_open():
            return  # an Esc from a screen already left, or a second one
        self._esc_from_key = from_key  # the Esc listener is used up by a key press, not by the button
        # Unhook the assistant hotkeys so they don't fire during confirmation
        self._clear_kb_hooks()

        # Dark overlay frame on top of everything
        self._esc_overlay = ctk.CTkFrame(
            self, fg_color=theme.SURFACE, corner_radius=12, border_width=1, border_color=theme.BORDER
        )
        self._esc_overlay.place(relx=0.5, rely=0.5, anchor="center", relwidth=0.85)

        ctk.CTkLabel(
            self._esc_overlay,
            text="Back to the credits?" if to_credits else "End pasting for this song?",
            font=theme.display(22),
            text_color=theme.TEXT,
        ).pack(pady=(theme.SPACE_5, theme.SPACE_4))

        btn_row = ctk.CTkFrame(self._esc_overlay, fg_color="transparent")
        btn_row.pack(pady=(0, theme.SPACE_5))

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
        ).pack(side="left", padx=(0, theme.SPACE_3))
        ctk.CTkButton(
            btn_row,
            text="Back to credits" if to_credits else "End and start over",
            width=160,
            height=38,
            fg_color=theme.DANGER_DIM,
            hover_color=theme.DANGER_HOVER,
            text_color=theme.DANGER,
            border_width=1,
            border_color=theme.DANGER,
            command=self._back_to_credits if to_credits else self._confirm_esc_quit,
            font=_f(13, "bold"),
        ).pack(side="left")

    def _esc_overlay_open(self) -> bool:
        overlay = getattr(self, "_esc_overlay", None)
        return overlay is not None and overlay.winfo_exists()

    def _dismiss_esc_confirm(self) -> None:
        """User chose to resume - remove overlay and re-register hotkeys."""
        if hasattr(self, "_esc_overlay") and self._esc_overlay.winfo_exists():
            self._esc_overlay.destroy()
        # Re-register assistant hotkeys
        self._register_assistant_keys()
        if self._esc_from_key:
            threading.Thread(target=self._wait_esc, daemon=True).start()

    def _confirm_esc_quit(self) -> None:
        """User confirmed quit - clean up and go to main menu."""
        self._clear_kb_hooks()
        if hasattr(self, "_esc_overlay") and self._esc_overlay.winfo_exists():
            self._esc_overlay.destroy()
        self._go_to_main()


def run() -> None:
    App().mainloop()
