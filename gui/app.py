import asyncio
import ctypes
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

from scraper import apple_music, deezer, youtube
from scraper.apple_music import AlbumTrackInfo
from scraper.models import SongCredits
from utils.config import settings

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

# Load custom font before the Tk window is created
_FONT_FILE = Path(__file__).parent.parent / "Programme-Regular.ttf"
if _FONT_FILE.exists():
    ctypes.windll.gdi32.AddFontResourceExW(str(_FONT_FILE), 0x10, 0)
_FF = "Programme"


def _f(size: int = 13, weight: str = "normal") -> ctk.CTkFont:
    return ctk.CTkFont(family=_FF, size=size, weight=weight)


_TYPE_COLORS = {
    "written_by":             "#4ade80",
    "produced_by":            "#60a5fa",
    "role":                   "#c084fc",
    "artist":                 "#67e8f9",
    "phonographic_copyright": "#fb923c",
    "copyright_notice":       "#fb923c",
    "cover_art":              "#f472b6",
    "youtube_url":            "#ef4444",
}

_FIELD_LABELS = {
    "written_by":             "Written By",
    "produced_by":            "Produced By",
    "role":                   "Additional role",
    "artist":                 "Artists in this role",
    "phonographic_copyright": "℗  Phonographic Copyright",
    "copyright_notice":       "©  Copyright",
    "cover_art":              "Cover Art URL",
    "youtube_url":            "YouTube URL",
}


class App(ctk.CTk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Géniescraper")
        self.geometry("620x700")
        self.resizable(False, True)
        self.attributes("-topmost", True)

        # Dedicated background event loop for Playwright/asyncio
        self._loop = asyncio.new_event_loop()
        threading.Thread(target=self._loop.run_forever, daemon=True).start()

        self._song: SongCredits | None = None
        self._cover_image: PILImage.Image | None = None
        self._album_info: AlbumTrackInfo | None = None
        self._queue: list[tuple[str, str]] = []
        self._pos: int = 0
        self._lock = threading.Lock()
        self._row_widgets: list[tuple] = []

        self._show_scrape_screen()

    # ── helpers ──────────────────────────────────────────────────────────

    def _clear(self) -> None:
        for w in self.winfo_children():
            w.destroy()

    # ── screens ──────────────────────────────────────────────────────────

    def _show_scrape_screen(self) -> None:
        self._clear()

        ctk.CTkLabel(self, text="Géniescraper", font=_f(22, "bold")).pack(pady=(32, 4))
        ctk.CTkLabel(
            self, text="Paste an Apple Music URL to scrape credits",
            text_color="gray", font=_f(13),
        ).pack(pady=(0, 4))
        ctk.CTkLabel(
            self,
            text="Recommended: use an /album/ URL — it includes copyright information",
            text_color="#fb923c", font=_f(11),
        ).pack(pady=(0, 20))

        self._url_var = ctk.StringVar()
        self._url_var.trace_add("write", self._on_url_change)

        ctk.CTkLabel(self, text="Apple Music URL", anchor="w", font=_f(13)).pack(anchor="w", padx=40)
        self._url_entry = ctk.CTkEntry(
            self, width=540, height=38,
            placeholder_text="https://music.apple.com/us/album/...",
            font=_f(13), textvariable=self._url_var,
        )
        self._url_entry.pack(padx=40, pady=(4, 12))
        self._url_entry.bind("<Return>", lambda _: self._start_scrape())
        self._url_entry.focus()

        self._scrape_btn = ctk.CTkButton(
            self, text="Scrape", width=160, height=38,
            command=self._start_scrape, font=_f(13, "bold"),
            state="disabled",
        )
        self._scrape_btn.pack(pady=4)

        self._status_lbl = ctk.CTkLabel(self, text="", text_color="gray", font=_f(12))
        self._status_lbl.pack(pady=8)

        # Options button — anchored at the bottom
        # Options button — anchored at the bottom
        self._options_btn = ctk.CTkButton(
            self, text="⚙  Options", width=120, height=32,
            fg_color="transparent", border_width=1,
            border_color="#6b7280", text_color="#9ca3af",
            hover_color="#2d2d2d",
            command=self._show_options_screen, font=_f(12),
        )
        self._options_btn.pack(side="bottom", pady=(0, 16))

    def _on_url_change(self, *args) -> None:
        if self._url_var.get().strip():
            self._scrape_btn.configure(state="normal")
        else:
            self._scrape_btn.configure(state="disabled")

    def _show_options_screen(self) -> None:
        self._clear()

        ctk.CTkLabel(self, text="Options", font=_f(22, "bold")).pack(pady=(28, 16))

        outer = ctk.CTkScrollableFrame(self, width=540)
        outer.pack(fill="both", expand=True, padx=40, pady=(0, 8))

        # ── Hotkey rebinding ────────────────────────────────────────────
        ctk.CTkLabel(outer, text="Hotkey Bindings", font=_f(15, "bold")).pack(anchor="w", pady=(4, 8))

        hk_frame = ctk.CTkFrame(outer, fg_color="transparent")
        hk_frame.pack(fill="x", pady=(0, 12))
        hk_frame.grid_columnconfigure(1, weight=1)

        # Stored key values (updated when user records a new key)
        self._next_hk_value = settings.hotkey
        self._back_hk_value = settings.back_hotkey

        ctk.CTkLabel(hk_frame, text="Next (paste & advance)", font=_f(13), anchor="w").grid(
            row=0, column=0, sticky="w", padx=(0, 12), pady=4,
        )
        self._next_hk_btn = ctk.CTkButton(
            hk_frame, text=settings.hotkey.upper(), width=140, height=32,
            font=_f(13, "bold"), fg_color="#2a3a20", hover_color="#3a4a30",
            border_width=1, border_color="#4ade80", text_color="#4ade80",
            command=lambda: self._record_hotkey("next"),
        )
        self._next_hk_btn.grid(row=0, column=1, sticky="w", pady=4)

        ctk.CTkLabel(hk_frame, text="Back (go back one step)", font=_f(13), anchor="w").grid(
            row=1, column=0, sticky="w", padx=(0, 12), pady=4,
        )
        self._back_hk_btn = ctk.CTkButton(
            hk_frame, text=settings.back_hotkey.upper(), width=140, height=32,
            font=_f(13, "bold"), fg_color="#1a2535", hover_color="#2a3545",
            border_width=1, border_color="#60a5fa", text_color="#60a5fa",
            command=lambda: self._record_hotkey("back"),
        )
        self._back_hk_btn.grid(row=1, column=1, sticky="w", pady=4)

        ctk.CTkLabel(
            outer, text="Click a button then press the desired key",
            text_color="#6b7280", font=_f(11),
        ).pack(anchor="w", pady=(0, 4))

        # ── Scrape feature toggles ──────────────────────────────────────
        sep = ctk.CTkFrame(outer, height=1, fg_color="#374151")
        sep.pack(fill="x", pady=(4, 12))

        ctk.CTkLabel(outer, text="Features to Scrape", font=_f(15, "bold")).pack(anchor="w", pady=(0, 8))

        toggle_defs = [
            ("Core metadata (songwriters & producers)", "scrape_core", "#4ade80"),
            ("Additional credits (other roles)",        "scrape_additional", "#c084fc"),
            ("Copyrights (℗ and ©)",                    "scrape_copyright", "#fb923c"),
            ("YouTube URL",                             "scrape_youtube", "#ef4444"),
            ("Cover art URL",                           "scrape_cover_art", "#f472b6"),
        ]

        self._toggle_vars: dict[str, ctk.BooleanVar] = {}
        for label, key, color in toggle_defs:
            var = ctk.BooleanVar(value=getattr(settings, key))
            self._toggle_vars[key] = var
            row = ctk.CTkFrame(outer, fg_color="transparent")
            row.pack(fill="x", pady=2)
            ctk.CTkSwitch(
                row, text=label, variable=var,
                font=_f(13), text_color=color,
                progress_color=color,
            ).pack(anchor="w")

        # ── Bottom buttons ──────────────────────────────────────────────
        btn_row = ctk.CTkFrame(self, fg_color="transparent")
        btn_row.pack(pady=12)
        ctk.CTkButton(
            btn_row, text="← Back", width=120, height=40,
            fg_color="transparent", border_width=1,
            border_color="#6b7280", text_color="#9ca3af",
            hover_color="#2d2d2d",
            command=self._show_scrape_screen, font=_f(13),
        ).pack(side="left", padx=(0, 12))
        ctk.CTkButton(
            btn_row, text="Save", width=160, height=40,
            command=self._save_options, font=_f(13, "bold"),
        ).pack(side="left")

    def _record_hotkey(self, which: str) -> None:
        """Put a hotkey button into 'listening' mode and capture the next key press."""
        btn = self._next_hk_btn if which == "next" else self._back_hk_btn
        original_text = btn.cget("text")
        btn.configure(text="Press a key…", text_color="#fbbf24", border_color="#fbbf24")

        def _on_key(event):
            key_name = event.name.lower()
            # Ignore modifier-only presses
            if key_name in ("shift", "ctrl", "alt", "windows", "unknown"):
                return
            keyboard.unhook(hook)
            if which == "next":
                self._next_hk_value = key_name
            else:
                self._back_hk_value = key_name
            self.after(0, _update_btn, key_name)

        def _update_btn(key_name: str):
            try:
                if which == "next":
                    btn.configure(text=key_name.upper(), text_color="#4ade80", border_color="#4ade80")
                else:
                    btn.configure(text=key_name.upper(), text_color="#60a5fa", border_color="#60a5fa")
            except Exception:
                pass

        hook = keyboard.on_press(_on_key, suppress=False)

    def _save_options(self) -> None:
        """Persist options and return to scrape screen."""
        settings.hotkey = getattr(self, "_next_hk_value", settings.hotkey)
        settings.back_hotkey = getattr(self, "_back_hk_value", settings.back_hotkey)
        for key, var in self._toggle_vars.items():
            setattr(settings, key, var.get())
        settings.save()
        self._show_scrape_screen()

    def _show_credits_screen(self) -> None:
        self._clear()
        song = self._song
        merged = song.merged_credits()
        queue = song.typed_queue(
            include_core=settings.scrape_core,
            include_additional=settings.scrape_additional,
            include_copyright=settings.scrape_copyright,
            include_youtube=settings.scrape_youtube,
            include_cover_art=settings.scrape_cover_art,
        )

        # Cover thumbnail + title block
        top = ctk.CTkFrame(self, fg_color="transparent")
        top.pack(fill="x", padx=40, pady=(20, 8))

        if self._cover_image is not None:
            thumb = ctk.CTkImage(self._cover_image, size=(100, 100))
            ctk.CTkLabel(top, image=thumb, text="").pack(side="left", padx=(0, 16))

        info = ctk.CTkFrame(top, fg_color="transparent")
        info.pack(side="left", fill="y", anchor="w")
        ctk.CTkLabel(info, text=song.title, font=_f(18, "bold"), anchor="w").pack(anchor="w")
        ctk.CTkLabel(info, text=song.artist, text_color="gray", font=_f(13), anchor="w").pack(anchor="w")
        ctk.CTkLabel(
            info,
            text=f"Found {len(merged)} roles · {len(queue)} total entries",
            text_color="#4ade80", font=_f(13), anchor="w",
        ).pack(anchor="w", pady=(6, 0))

        # Combined credits + metadata table
        sf = ctk.CTkScrollableFrame(self, width=540, height=500)
        sf.pack(padx=40, pady=(0, 8))
        sf.grid_columnconfigure(0, weight=0, minsize=190)
        sf.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(sf, text="Role", font=_f(13, "bold"), anchor="w").grid(
            row=0, column=0, sticky="w", padx=4, pady=(0, 6),
        )
        ctk.CTkLabel(sf, text="Details", font=_f(13, "bold"), anchor="w").grid(
            row=0, column=1, sticky="w", padx=4, pady=(0, 6),
        )

        row_idx = 1
        for credit in merged:
            ctk.CTkLabel(sf, text=credit.role, anchor="w", font=_f(13)).grid(
                row=row_idx, column=0, sticky="w", padx=4, pady=2,
            )
            ctk.CTkLabel(
                sf, text=", ".join(credit.artists), anchor="w",
                wraplength=300, font=_f(13),
            ).grid(row=row_idx, column=1, sticky="w", padx=4, pady=2)
            row_idx += 1

        # Separator before metadata rows
        sep = ctk.CTkFrame(sf, height=1, fg_color="#374151")
        sep.grid(row=row_idx, column=0, columnspan=2, sticky="ew", padx=4, pady=(6, 4))
        row_idx += 1

        # Phonographic copyright
        ctk.CTkLabel(
            sf, text="℗  Phonographic", anchor="w", font=_f(13), text_color="#fb923c",
        ).grid(row=row_idx, column=0, sticky="w", padx=4, pady=2)
        phono_text = song.phonographic_copyright if song.phonographic_copyright else "Not found"
        phono_color = "#fb923c" if song.phonographic_copyright else "#6b7280"
        ctk.CTkLabel(
            sf, text=phono_text, anchor="w", wraplength=300, font=_f(13), text_color=phono_color,
        ).grid(row=row_idx, column=1, sticky="w", padx=4, pady=2)
        row_idx += 1

        # Copyright notice
        ctk.CTkLabel(
            sf, text="©  Copyright", anchor="w", font=_f(13), text_color="#fb923c",
        ).grid(row=row_idx, column=0, sticky="w", padx=4, pady=2)
        phono = song.phonographic_copyright
        copy_notice = song.copyright_notice
        if copy_notice and copy_notice != phono:
            copy_text, copy_color = copy_notice, "#fb923c"
        elif phono:
            copy_text, copy_color = "Not found - copied from Phonographic Copyright", "#fb923c"
        else:
            copy_text, copy_color = "Not found", "#6b7280"
        ctk.CTkLabel(
            sf, text=copy_text, anchor="w", wraplength=300, font=_f(13), text_color=copy_color,
        ).grid(row=row_idx, column=1, sticky="w", padx=4, pady=2)
        row_idx += 1

        # Cover art
        ctk.CTkLabel(
            sf, text="Cover Art", anchor="w", font=_f(13), text_color="#f472b6",
        ).grid(row=row_idx, column=0, sticky="w", padx=4, pady=2)
        if song.cover_art_url:
            _link_font = ctk.CTkFont(family=_FF, size=13, underline=True)
            ca_lbl = ctk.CTkLabel(
                sf, text="✓  Found", anchor="w", font=_link_font,
                text_color="#4ade80", cursor="hand2",
            )
            ca_lbl.bind("<Button-1>", lambda _, u=song.cover_art_url: webbrowser.open(u))
        else:
            ca_lbl = ctk.CTkLabel(
                sf, text="✗  Not found", anchor="w", font=_f(13), text_color="#f87171",
            )
        ca_lbl.grid(row=row_idx, column=1, sticky="w", padx=4, pady=2)
        row_idx += 1

        # YouTube
        ctk.CTkLabel(
            sf, text="YouTube", anchor="w", font=_f(13), text_color="#ef4444",
        ).grid(row=row_idx, column=0, sticky="w", padx=4, pady=2)
        if song.youtube_url:
            yt_label = "✓  Found Music Video" if song.youtube_is_mv else "✓  Found"
            _link_font = ctk.CTkFont(family=_FF, size=13, underline=True)
            yt_lbl = ctk.CTkLabel(
                sf, text=yt_label, anchor="w", font=_link_font,
                text_color="#4ade80", cursor="hand2",
            )
            yt_lbl.bind("<Button-1>", lambda _, u=song.youtube_url: webbrowser.open(u))
        else:
            yt_lbl = ctk.CTkLabel(
                sf, text="✗  Not found", anchor="w", font=_f(13), text_color="#f87171",
            )
        yt_lbl.grid(row=row_idx, column=1, sticky="w", padx=4, pady=2)

        btn_row = ctk.CTkFrame(self, fg_color="transparent")
        btn_row.pack(pady=12)
        back_cmd = self._show_track_select_screen if self._album_info else self._show_scrape_screen
        ctk.CTkButton(
            btn_row, text="← Back", width=120, height=40,
            fg_color="transparent", border_width=1,
            border_color="#6b7280", text_color="#9ca3af",
            hover_color="#2d2d2d",
            command=back_cmd, font=_f(13),
        ).pack(side="left", padx=(0, 12))
        ctk.CTkButton(
            btn_row, text="Start Assistant", width=200, height=40,
            command=self._show_assistant_screen, font=_f(13, "bold"),
        ).pack(side="left")

    def _show_assistant_screen(self) -> None:
        self._clear()
        self._queue = self._song.typed_queue(
            include_core=settings.scrape_core,
            include_additional=settings.scrape_additional,
            include_copyright=settings.scrape_copyright,
            include_youtube=settings.scrape_youtube,
            include_cover_art=settings.scrape_cover_art,
        )
        self._pos = 0
        self._prev_pos = -1
        self._row_widgets = []

        total = len(self._queue)

        # ── Top bar: song title + progress ──────────────────────────────
        hdr = ctk.CTkFrame(self, fg_color="transparent")
        hdr.pack(fill="x", padx=20, pady=(12, 2))
        ctk.CTkLabel(
            hdr,
            text=f"{self._song.title}  —  {self._song.artist}",
            font=_f(12), text_color="#9ca3af", anchor="w",
        ).pack(side="left")
        self._prog_lbl = ctk.CTkLabel(hdr, text="", text_color="gray", font=_f(12))
        self._prog_lbl.pack(side="right")

        # Progress bar
        self._progress_bar = ctk.CTkProgressBar(self, width=560, height=4, progress_color="#4ade80")
        self._progress_bar.pack(padx=20, pady=(0, 6))
        self._progress_bar.set(0)

        # ── Hero card: the main focus ───────────────────────────────────
        self._hero_card = ctk.CTkFrame(self, corner_radius=12, fg_color="#1a1a2e", border_width=1, border_color="#2d2d4a")
        self._hero_card.pack(fill="x", padx=20, pady=(0, 4))

        # Badge row inside hero (field type label + step counter)
        badge_row = ctk.CTkFrame(self._hero_card, fg_color="transparent")
        badge_row.pack(fill="x", padx=16, pady=(14, 0))

        self._hero_badge = ctk.CTkLabel(
            badge_row, text="", font=_f(12, "bold"),
            text_color="#1a1a2e", fg_color="#4ade80",
            corner_radius=4, width=10,
        )
        self._hero_badge.pack(side="left", padx=(0, 8), ipadx=8, ipady=2)

        self._hero_step_lbl = ctk.CTkLabel(
            badge_row, text="", font=_f(11), text_color="#6b7280",
        )
        self._hero_step_lbl.pack(side="left")

        # Value: the big text (artist name / role / URL)
        self._hero_value_lbl = ctk.CTkLabel(
            self._hero_card, text="", font=_f(26, "bold"),
            text_color="white", anchor="w", wraplength=540,
        )
        self._hero_value_lbl.pack(anchor="w", padx=16, pady=(8, 12))

        # ── Instruction bar ─────────────────────────────────────────────
        self._instr_frame = ctk.CTkFrame(self, fg_color="#111118", corner_radius=6)
        self._instr_frame.pack(fill="x", padx=20, pady=(0, 4))
        self._card_instr_lbl = ctk.CTkLabel(
            self._instr_frame, text="", anchor="w", justify="left",
            wraplength=540, font=_f(12), text_color="#9ca3af",
        )
        self._card_instr_lbl.pack(anchor="w", padx=12, pady=8)

        # ── Hotkey hint pills ───────────────────────────────────────────
        hint_bar = ctk.CTkFrame(self, fg_color="transparent")
        hint_bar.pack(fill="x", padx=20, pady=(0, 6))
        for key, label, color in [
            (settings.hotkey.upper(), "next",  "#4ade80"),
            (settings.back_hotkey.upper(), "back",  "#60a5fa"),
            ("ESC", "quit", "#f87171"),
        ]:
            pill = ctk.CTkFrame(hint_bar, fg_color="#1a1a1a", corner_radius=4)
            pill.pack(side="left", padx=(0, 6))
            ctk.CTkLabel(pill, text=key, font=_f(11, "bold"), text_color=color).pack(
                side="left", padx=(8, 3), pady=3,
            )
            ctk.CTkLabel(pill, text=label, font=_f(11), text_color="#6b7280").pack(
                side="left", padx=(0, 8), pady=3,
            )

        # ── Queue list ──────────────────────────────────────────────────
        self._queue_sf = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._queue_sf.pack(fill="both", expand=True, padx=20, pady=(0, 8))
        self._queue_sf.grid_columnconfigure(0, weight=1)

        for i, (kind, value) in enumerate(self._queue):
            row_frame = ctk.CTkFrame(self._queue_sf, fg_color="transparent", corner_radius=4, height=32)
            row_frame.grid(row=i, column=0, sticky="ew", padx=0, pady=1)
            row_frame.grid_columnconfigure(0, minsize=24)
            row_frame.grid_columnconfigure(1, minsize=150)
            row_frame.grid_columnconfigure(2, weight=1)

            m = ctk.CTkLabel(row_frame, text="", width=20, anchor="center", font=_f(11))
            m.grid(row=0, column=0, sticky="w", padx=(4, 0), pady=3)

            display_kind = _FIELD_LABELS.get(kind, kind)
            t = ctk.CTkLabel(row_frame, text=display_kind, width=140, anchor="w", font=_f(11), text_color=_TYPE_COLORS.get(kind, "#6b7280"))
            t.grid(row=0, column=1, sticky="w", padx=4, pady=3)

            display_value = f"  {value}" if kind == "artist" else value
            v = ctk.CTkLabel(row_frame, text=display_value, anchor="w", font=_f(11), text_color="#6b7280")
            v.grid(row=0, column=2, sticky="w", padx=4, pady=3)

            self._row_widgets.append((row_frame, m, t, v, kind))

        self._render_assistant()
        keyboard.add_hotkey(settings.hotkey, self._on_hotkey, suppress=True)
        keyboard.add_hotkey(settings.back_hotkey, self._on_back_hotkey, suppress=True)
        threading.Thread(target=self._wait_esc, daemon=True).start()

    # ── scrape ───────────────────────────────────────────────────────────

    def _start_scrape(self) -> None:
        url = self._url_entry.get().strip()
        if not url:
            return
        self._scrape_btn.configure(state="disabled")
        if hasattr(self, "_options_btn") and self._options_btn.winfo_exists():
            self._options_btn.configure(state="disabled")
        self._status_lbl.configure(text="Detecting album…", text_color="gray")
        threading.Thread(target=self._detect_thread, args=(url,), daemon=True).start()

    def _scrape_track_thread(self, url: str, track_index: int, track_title: str) -> None:
        try:
            artist = self._album_info.artist if hasattr(self, "_album_info") and self._album_info else ""
            search_title = track_title or "Unknown"

            async def _fetch_all(u: str) -> tuple[SongCredits, str, str, bool]:
                # We can run the APIs concurrently with the heavy Playwright scrape
                # because we already know the track title and artist from the detection phase!
                scrape_task = asyncio.create_task(
                    apple_music.scrape(u, track_index=track_index, track_title=track_title)
                )
                
                # Only run concurrent APIs if we have an artist
                if artist and search_title != "Unknown":
                    deezer_task = asyncio.create_task(deezer.fetch_cover_url(search_title, artist))
                    itunes_task = asyncio.create_task(deezer.fetch_itunes_cover_url(search_title, artist))
                    youtube_task = asyncio.create_task(youtube.fetch_youtube_url(search_title, artist))
                    
                    song, deezer_cover, itunes_cover, yt_result = await asyncio.gather(
                        scrape_task, deezer_task, itunes_task, youtube_task
                    )
                    yt_url, yt_is_mv = yt_result
                else:
                    song = await scrape_task
                    deezer_cover, itunes_cover, yt_url, yt_is_mv = "", "", "", False

                cover_url = deezer_cover or itunes_cover or song.cover_art_url
                return song.model_copy(update={"cover_art_url": cover_url, "youtube_url": yt_url, "youtube_is_mv": yt_is_mv}), cover_url

            song, cover_url = asyncio.run_coroutine_threadsafe(_fetch_all(url), self._loop).result()

            # Download thumbnail for the credits screen
            cover_image: PILImage.Image | None = None
            if cover_url:
                try:
                    resp = httpx.get(cover_url, timeout=8.0)
                    cover_image = PILImage.open(io.BytesIO(resp.content))
                except Exception:
                    pass

            self.after(0, self._scrape_done, song, cover_image)
        except Exception as exc:
            self.after(0, self._scrape_error, str(exc))

    def _scrape_done(self, song: SongCredits, cover_image: PILImage.Image | None) -> None:
        if not song.credits:
            if hasattr(self, "_status_lbl") and self._status_lbl.winfo_exists():
                self._status_lbl.configure(
                    text="No credits found. Check the URL and try again.",
                    text_color="#f87171",
                )
            if hasattr(self, "_scrape_btn") and self._scrape_btn.winfo_exists():
                self._scrape_btn.configure(state="normal")
            if hasattr(self, "_options_btn") and self._options_btn.winfo_exists():
                self._options_btn.configure(state="normal")
            elif self._album_info is not None:
                self._show_track_select_screen()
            return
        self._song = song
        self._cover_image = cover_image
        self._show_credits_screen()

    def _scrape_error(self, message: str) -> None:
        if hasattr(self, "_status_lbl") and self._status_lbl.winfo_exists():
            self._status_lbl.configure(text=f"Error: {message}", text_color="#f87171")
        if hasattr(self, "_scrape_btn") and self._scrape_btn.winfo_exists():
            self._scrape_btn.configure(state="normal")
        if hasattr(self, "_options_btn") and self._options_btn.winfo_exists():
            self._options_btn.configure(state="normal")
        elif self._album_info is not None:
            self._show_track_select_screen()
        else:
            self._show_scrape_screen()

    def _detect_thread(self, url: str) -> None:
        try:
            async def _detect_with_cover(u: str):
                info = await apple_music.detect_album(u)
                # Try to upgrade cover URL via Deezer/iTunes (same logic as scrape)
                cover_url = info.cover_art_url
                if info.album_title and info.artist:
                    deezer_cover, itunes_cover = await asyncio.gather(
                        deezer.fetch_cover_url(info.album_title, info.artist),
                        deezer.fetch_itunes_cover_url(info.album_title, info.artist),
                    )
                    cover_url = deezer_cover or itunes_cover or cover_url
                    if cover_url != info.cover_art_url:
                        info = AlbumTrackInfo(
                            url=info.url,
                            album_title=info.album_title,
                            artist=info.artist,
                            track_count=info.track_count,
                            track_titles=info.track_titles,
                            cover_art_url=cover_url,
                        )
                return info

            info = asyncio.run_coroutine_threadsafe(_detect_with_cover(url), self._loop).result()

            # Download cover thumbnail
            cover_image: PILImage.Image | None = None
            if info.cover_art_url:
                try:
                    resp = httpx.get(info.cover_art_url, timeout=8.0)
                    cover_image = PILImage.open(io.BytesIO(resp.content))
                except Exception:
                    pass

            self.after(0, self._detect_done, info, cover_image)
        except Exception as exc:
            self.after(0, self._scrape_error, str(exc))

    def _detect_done(self, info: AlbumTrackInfo, cover_image: PILImage.Image | None = None) -> None:
        if info.track_count <= 1:
            self._status_lbl.configure(text="Scraping metadata…", text_color="gray")
            threading.Thread(
                target=self._scrape_track_thread,
                args=(info.url, 1, ""),
                daemon=True,
            ).start()
        else:
            self._album_info = info
            self._album_cover_image = cover_image
            self._show_track_select_screen()

    def _show_track_select_screen(self) -> None:
        self._clear()
        info = self._album_info

        # Cover thumbnail + album info header
        top = ctk.CTkFrame(self, fg_color="transparent")
        top.pack(fill="x", padx=40, pady=(20, 8))

        album_cover = getattr(self, "_album_cover_image", None)
        if album_cover is not None:
            thumb = ctk.CTkImage(album_cover, size=(100, 100))
            ctk.CTkLabel(top, image=thumb, text="").pack(side="left", padx=(0, 16))

        info_frame = ctk.CTkFrame(top, fg_color="transparent")
        info_frame.pack(side="left", fill="y", anchor="w")
        ctk.CTkLabel(info_frame, text=info.album_title, font=_f(20, "bold"), anchor="w").pack(anchor="w")
        ctk.CTkLabel(info_frame, text=info.artist, text_color="gray", font=_f(13), anchor="w").pack(anchor="w")
        ctk.CTkLabel(
            info_frame, text=f"{info.track_count} songs — click one to scrape its credits",
            text_color="#4ade80", font=_f(13), anchor="w",
        ).pack(anchor="w", pady=(6, 0))

        sf = ctk.CTkScrollableFrame(self, width=540)
        sf.pack(fill="both", expand=True, padx=40, pady=(0, 8))

        for i, title in enumerate(info.track_titles):
            n = i + 1
            row = ctk.CTkFrame(sf, fg_color="transparent", corner_radius=4, cursor="hand2")
            row.pack(fill="x", padx=2, pady=2)

            num_lbl = ctk.CTkLabel(row, text=str(n), width=32, text_color="#6b7280",
                                   anchor="e", font=_f(13))
            num_lbl.pack(side="left", padx=(8, 8))
            title_lbl = ctk.CTkLabel(row, text=title, anchor="w", font=_f(13))
            title_lbl.pack(side="left", fill="x", expand=True)

            def _hover_on(_, r=row):  r.configure(fg_color="#1a2535")
            def _hover_off(_, r=row): r.configure(fg_color="transparent")
            def _click(_, n=n, t=title): self._on_track_selected(n, t)

            for w in (row, num_lbl, title_lbl):
                w.bind("<Enter>",    _hover_on)
                w.bind("<Leave>",    _hover_off)
                w.bind("<Button-1>", _click)

        ctk.CTkButton(
            self, text="← Back to main menu", width=160, height=38,
            fg_color="transparent", border_width=1,
            border_color="#6b7280", text_color="#9ca3af",
            hover_color="#2d2d2d",
            command=self._go_to_main_from_album, font=_f(13),
        ).pack(pady=8)

    def _on_track_selected(self, track_index: int, track_title: str) -> None:
        self._clear()
        ctk.CTkLabel(
            self, text=f'Scraping "{track_title}"…', font=_f(16),
        ).pack(pady=(200, 8))
        ctk.CTkLabel(self, text="Please wait", text_color="gray", font=_f(13)).pack()
        threading.Thread(
            target=self._scrape_track_thread,
            args=(self._album_info.url, track_index, track_title),
            daemon=True,
        ).start()

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
            time.sleep(0.15)
            pyperclip.copy(value)
            keyboard.press_and_release("ctrl+v")
            if kind not in ("cover_art", "youtube_url"):
                time.sleep(settings.autocomplete_wait)
                keyboard.press_and_release("enter")
            self._pos += 1
            if self._pos >= len(self._queue):
                self.after(500, self._show_done_screen)
            else:
                self.after(0, self._render_assistant)

    def _render_assistant(self) -> None:
        total = len(self._queue)
        pos = self._pos

        if pos < total:
            kind, value = self._queue[pos]
            color = _TYPE_COLORS.get(kind, "#9ca3af")
            field_label = _FIELD_LABELS.get(kind, kind)

            self._prog_lbl.configure(text=f"{pos + 1} / {total}")
            self._progress_bar.set((pos + 1) / total if total else 0)

            # Hero card updates
            self._hero_badge.configure(text=field_label, fg_color=color)
            self._hero_step_lbl.configure(text=f"Step {pos + 1} of {total}")
            self._hero_value_lbl.configure(text=value)
            self._hero_card.configure(border_color=color)
            self._card_instr_lbl.configure(text=self._instruction_text())

            # Auto-scroll the queue list to keep the current item visible
            # Leave 2 items above it for context
            if hasattr(self._queue_sf, "_parent_canvas"):
                fraction = max(0.0, (pos - 2) / max(1, total))
                self._queue_sf._parent_canvas.yview_moveto(fraction)

        # Optimization: only update the rows that actually changed state
        prev = getattr(self, "_prev_pos", -1)
        
        if prev != pos:
            # Demote previous row to "done"
            if 0 <= prev < len(self._row_widgets):
                row_frame, m, t, v, kind = self._row_widgets[prev]
                row_frame.configure(fg_color="transparent")
                if prev < pos:
                    m.configure(text="✓", text_color="#3f3f46")
                    t.configure(text_color="#3f3f46", font=_f(11))
                    v.configure(text_color="#3f3f46", font=_f(11))
                else: # user pressed back
                    m.configure(text="")
                    t.configure(text_color=_TYPE_COLORS.get(kind, "#6b7280"), font=_f(11))
                    v.configure(text_color="#6b7280", font=_f(11))
            
            # Promote current row to "active"
            if 0 <= pos < len(self._row_widgets):
                row_frame, m, t, v, kind = self._row_widgets[pos]
                row_frame.configure(fg_color="#1a2535")
                m.configure(text="▶", text_color="#4ade80")
                t.configure(text_color=_TYPE_COLORS.get(kind, "white"), font=_f(11, "bold"))
                v.configure(text_color="#fbbf24", font=_f(11, "bold"))
                
            self._prev_pos = pos

    def _instruction_text(self) -> str:
        pos = self._pos
        if pos >= len(self._queue):
            return "All done — save the page."
        kind, _ = self._queue[pos]
        hk = settings.hotkey.upper()
        prev = self._queue[pos - 1][0] if pos > 0 else None

        if kind == "written_by":
            if prev != "written_by":
                return f"Click the Written By field, then press {hk}"
            return f"Field is ready — press {hk} to add the next songwriter"
        if kind == "produced_by":
            if prev != "produced_by":
                return f"Click the Produced By field, then press {hk}"
            return f"Field is ready — press {hk} to add the next producer"
        if kind == "role":
            return (
                f"1. Click Add additional credits\n"
                f"2. Click inside the Additional role field\n"
                f"3. Press {hk}"
            )
        if kind in ("phonographic_copyright", "copyright_notice"):
            return f"Click the {_FIELD_LABELS.get(kind, kind)} field, then press {hk}"
        if kind == "cover_art":
            return f"Press {hk} to copy the 1000×1000 PNG cover art URL to clipboard"
        if kind == "youtube_url":
            return f"Press {hk} to copy the YouTube video URL to clipboard"
        if prev == "role":
            return f"Tab to Artists in this role, then press {hk}"
        return f"Field is ready — press {hk} to add the next artist"

    def _show_done_screen(self) -> None:
        keyboard.remove_all_hotkeys()
        self._clear()
        self._in_countdown = True
        self._countdown = 10
        self._countdown_paused = False

        ctk.CTkLabel(self, text="✓", font=_f(52, "bold"), text_color="#4ade80").pack(pady=(60, 6))
        ctk.CTkLabel(self, text="All credits entered!", font=_f(20, "bold")).pack()

        self._back_btn = ctk.CTkButton(
            self,
            text=f"Go back to main menu  ({self._countdown}s)",
            width=300, height=44,
            command=self._go_to_main,
            font=_f(13, "bold"),
        )
        self._back_btn.pack(pady=(0, 12))
        self._back_btn.bind("<Enter>", lambda _: self._pause_countdown())
        self._back_btn.bind("<Leave>", lambda _: self._resume_countdown())

        if self._album_info is not None:
            ctk.CTkButton(
                self, text="← Back to album list", width=200, height=38,
                fg_color="transparent", border_width=1,
                border_color="#4ade80", text_color="#4ade80",
                hover_color="#1a2d1a",
                command=self._back_to_album_list, font=_f(13),
            ).pack(pady=(0, 8))

        ctk.CTkButton(
            self, text="Quit", width=120, height=38,
            fg_color="transparent", border_width=1,
            border_color="#6b7280", text_color="#9ca3af",
            hover_color="#2d2d2d",
            command=self.destroy,
            font=_f(13),
        ).pack()

        self.after(1000, self._tick_countdown)

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
            self._back_btn.configure(text=f"Go back to main menu  ({self._countdown}s)")
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
        self._show_scrape_screen()

    def _wait_esc(self) -> None:
        keyboard.wait("esc")
        # First ESC: show confirmation (don't quit yet)
        self.after(0, self._show_esc_confirm)

    def _show_esc_confirm(self) -> None:
        """Show a confirmation overlay — press ESC again to quit, or resume."""
        # Unhook the assistant hotkeys so they don't fire during confirmation
        keyboard.remove_all_hotkeys()

        # Dark overlay frame on top of everything
        self._esc_overlay = ctk.CTkFrame(self, fg_color="#0d0d0d", corner_radius=12)
        self._esc_overlay.place(relx=0.5, rely=0.5, anchor="center", relwidth=0.85, relheight=0.35)

        ctk.CTkLabel(
            self._esc_overlay, text="Quit assistant?",
            font=_f(18, "bold"), text_color="#f87171",
        ).pack(pady=(24, 4))
        ctk.CTkLabel(
            self._esc_overlay,
            text="Press ESC again to quit to main menu",
            text_color="#9ca3af", font=_f(12),
        ).pack(pady=(0, 16))

        btn_row = ctk.CTkFrame(self._esc_overlay, fg_color="transparent")
        btn_row.pack(pady=(0, 16))

        ctk.CTkButton(
            btn_row, text="Resume", width=140, height=38,
            fg_color="transparent", border_width=1,
            border_color="#4ade80", text_color="#4ade80",
            hover_color="#1a2d1a",
            command=self._dismiss_esc_confirm, font=_f(13, "bold"),
        ).pack(side="left", padx=(0, 12))
        ctk.CTkButton(
            btn_row, text="Quit to menu", width=160, height=38,
            fg_color="#7f1d1d", hover_color="#991b1b",
            text_color="white",
            command=self._confirm_esc_quit, font=_f(13, "bold"),
        ).pack(side="left")

        # Listen for second ESC press to confirm quit
        threading.Thread(target=self._wait_esc_confirm, daemon=True).start()

    def _wait_esc_confirm(self) -> None:
        keyboard.wait("esc")
        self.after(0, self._confirm_esc_quit)

    def _dismiss_esc_confirm(self) -> None:
        """User chose to resume — remove overlay and re-register hotkeys."""
        if hasattr(self, "_esc_overlay") and self._esc_overlay.winfo_exists():
            self._esc_overlay.destroy()
        # Re-register assistant hotkeys
        keyboard.add_hotkey(settings.hotkey, self._on_hotkey, suppress=True)
        keyboard.add_hotkey(settings.back_hotkey, self._on_back_hotkey, suppress=True)
        threading.Thread(target=self._wait_esc, daemon=True).start()

    def _confirm_esc_quit(self) -> None:
        """User confirmed quit — clean up and go to main menu."""
        keyboard.remove_all_hotkeys()
        if hasattr(self, "_esc_overlay") and self._esc_overlay.winfo_exists():
            self._esc_overlay.destroy()
        self._go_to_main()


def run() -> None:
    App().mainloop()
