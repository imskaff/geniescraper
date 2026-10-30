import webbrowser

import customtkinter as ctk
import keyboard

from assistant import flow
from gui import theme
from gui.chrome import ChromeMixin
from gui.logic import (
    queue_summary,
)
from scraper.models import youtube_label
from utils.config import settings

_f = theme.font


class CreditsScreenMixin(ChromeMixin):
    """The credits screen: what was found, plus the countdown that starts pasting."""

    def _current_queue(self) -> list[tuple[str, str]]:
        assert self._song is not None
        queue = self._song.typed_queue(
            include_core=settings.scrape_core,
            include_additional=settings.scrape_additional,
            include_copyright=settings.scrape_copyright,
            include_youtube=settings.scrape_youtube,
            include_cover_art=settings.scrape_cover_art,
            include_release_date=settings.scrape_release_date,
        )
        return flow.genius_queue(queue)  # roles typed under the names Genius uses

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
        bottom.pack(side="bottom", fill="x", padx=theme.SPACE_6, pady=(theme.SPACE_2, theme.SPACE_4))
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
        summary.pack(side="bottom", fill="x", padx=theme.SPACE_6)
        ctk.CTkLabel(
            summary, text=queue_summary(queue), font=_f(12), text_color=theme.MUTED, anchor="w", wraplength=540
        ).pack(anchor="w")
        self._settings_summary(summary).pack(anchor="w")

        sf = theme.scroll_frame(self, fg_color=theme.SURFACE, corner_radius=8)
        sf.pack(fill="both", expand=True, padx=theme.SPACE_6, pady=(0, theme.SPACE_2))
        sf.grid_columnconfigure(0, weight=0, minsize=170)
        sf.grid_columnconfigure(1, weight=1)
        row = 0

        def section(title: str) -> None:
            nonlocal row
            ctk.CTkLabel(sf, text=title.upper(), font=_f(11, "bold"), text_color=theme.FAINT, anchor="w").grid(
                row=row,
                column=0,
                columnspan=2,
                sticky="w",
                padx=theme.SPACE_3,
                pady=(theme.SPACE_3 if row else theme.SPACE_2, theme.SPACE_1),
            )
            row += 1

        def line(label: str, value: str, *, missing: bool = False, link: str = "", note: str = "") -> None:
            nonlocal row
            ctk.CTkLabel(sf, text=label, font=_f(13), text_color=theme.MUTED, anchor="w").grid(
                row=row, column=0, sticky="nw", padx=theme.SPACE_3, pady=theme.SPACE_1
            )
            color = theme.FAINT if missing else (theme.ACCENT if link else theme.TEXT)
            font = ctk.CTkFont(family=theme.UI_FAMILY, size=13, underline=True) if link else _f(13)
            val = ctk.CTkLabel(sf, text=value, font=font, text_color=color, anchor="w", justify="left", wraplength=330)
            val.grid(row=row, column=1, sticky="w", padx=(0, theme.SPACE_3), pady=theme.SPACE_1)
            if link:
                val.configure(cursor="hand2")
                val.bind("<Button-1>", lambda _, u=link: webbrowser.open(u))
            row += 1
            if note:
                ctk.CTkLabel(sf, text=note, font=_f(11), text_color=theme.FAINT, anchor="w").grid(
                    row=row, column=1, sticky="w", padx=(0, theme.SPACE_3), pady=(0, theme.SPACE_1)
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
        if released := song.release_date_text():
            line("Released", released)
        phono, notice = song.phonographic_copyright, song.copyright_notice
        line("℗ Phonographic", phono or "Not found", missing=not phono)
        if notice and notice != phono:
            line("© Copyright", notice)
        elif phono:
            line("© Copyright", "Same as ℗", note="Apple Music lists no separate © line")
        else:
            line("© Copyright", "Not found", missing=True)
        if song.youtube_url:
            line("YouTube", youtube_label(song.youtube_kind), link=song.youtube_url)
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
