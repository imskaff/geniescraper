import threading

import customtkinter as ctk
import pyperclip

from gui import theme
from gui.chrome import ChromeMixin
from gui.connect_prompt import ConnectPrompt
from gui.link import OpenPage
from gui.logic import (
    OPEN_PAGES_EMPTY,
    OPEN_PAGES_PICK,
    detector_title,
    open_page_rows,
    url_hint,
)
from gui.radar import FOUND, LISTENING, Radar
from utils.config import settings

_f = theme.font


class StartScreenMixin(ChromeMixin):
    """The start screen: link entry, the open-pages detector, and cancelling a scrape."""

    def _show_scrape_screen(self) -> None:
        self._screen = "start"
        self._busy = False
        self._set_compact(False)
        self._clear()
        self._header(0)

        body = ctk.CTkFrame(self, fg_color="transparent")
        body.pack(fill="both", expand=True, padx=theme.SPACE_6)

        ctk.CTkLabel(
            body,
            text="Géniescraper",
            font=theme.display(34),
            text_color=theme.ACCENT_INK,
            fg_color=theme.ACCENT,
            corner_radius=4,
        ).pack(anchor="w", pady=(theme.SPACE_2, theme.SPACE_2), ipadx=theme.SPACE_3, ipady=theme.SPACE_1)
        ctk.CTkLabel(
            body,
            text="Collect a song's credits from Apple Music and paste them into Genius.",
            font=_f(13),
            text_color=theme.MUTED,
        ).pack(anchor="w", pady=(0, theme.SPACE_4))

        ctk.CTkLabel(body, text="Apple Music link", font=_f(13, "bold"), text_color=theme.TEXT).pack(anchor="w")
        url_field = ctk.CTkFrame(
            body, height=40, fg_color=theme.SURFACE, border_color=theme.BORDER, border_width=1, corner_radius=6
        )
        url_field.pack(fill="x", pady=(theme.SPACE_2, theme.SPACE_2))
        url_field.pack_propagate(False)
        self._url_entry = ctk.CTkEntry(
            url_field,
            border_width=0,
            corner_radius=0,
            fg_color="transparent",
            placeholder_text="https://music.apple.com/us/album/...",
            font=_f(13),
        )
        self._url_entry.pack(side="left", fill="both", expand=True, padx=(theme.SPACE_2, 0), pady=theme.SPACE_1)
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
        ).pack(side="right", padx=(0, theme.SPACE_2), pady=theme.SPACE_1)
        self._hint_lbl = ctk.CTkLabel(body, text="", font=_f(12), text_color=theme.MUTED, anchor="w", justify="left")
        self._hint_lbl.pack(anchor="w", fill="x")

        actions = ctk.CTkFrame(body, fg_color="transparent")
        actions.pack(fill="x", pady=(theme.SPACE_4, 0))
        self._scrape_btn = self._button(actions, "Get credits", self._start_scrape, primary=True, width=150)
        self._set_enabled(self._scrape_btn, False)
        self._scrape_btn.pack(side="left")
        self._cancel_btn = self._button(actions, "Cancel", self._cancel_scrape, width=100)

        self._progress = ctk.CTkProgressBar(body, mode="indeterminate", height=4, progress_color=theme.ACCENT)
        self._status_lbl = ctk.CTkLabel(body, text="", font=_f(12), text_color=theme.MUTED, anchor="w", justify="left")
        self._status_lbl.pack(anchor="w", fill="x", pady=(theme.SPACE_2, 0))

        how = ctk.CTkFrame(body, fg_color=theme.SURFACE, corner_radius=8)
        how.pack(fill="x", pady=(theme.SPACE_3, 0))
        self._pages_card, self._connect_card, self._how_card, self._pages_shown = None, None, how, None
        self._render_open_pages()
        ctk.CTkLabel(how, text="HOW IT WORKS", font=_f(11, "bold"), text_color=theme.FAINT).pack(
            anchor="w", padx=theme.SPACE_4, pady=(theme.SPACE_2, theme.SPACE_1)
        )
        hk = settings.hotkey.upper()
        for n, text in enumerate(
            (
                "Paste an album or song link and press Get credits.",
                "Choose the tracks, then check the credits that were found.",
                f"Open the song's edit page on Genius, click Written By, and press {hk} once per field.",
            ),
            start=1,
        ):
            row = ctk.CTkFrame(how, fg_color="transparent")
            row.pack(fill="x", padx=theme.SPACE_4, pady=(0, theme.SPACE_1))
            ctk.CTkLabel(row, text=str(n), width=22, font=_f(13, "bold"), text_color=theme.ACCENT, anchor="w").pack(
                side="left", anchor="n"
            )
            ctk.CTkLabel(
                row, text=text, font=_f(13), text_color=theme.TEXT, anchor="w", justify="left", wraplength=470
            ).pack(side="left", fill="x")
        ctk.CTkFrame(how, height=theme.SPACE_1, fg_color="transparent").pack()

        self._settings_summary(self).pack(side="bottom", pady=(0, theme.SPACE_4))
        self._check_url_loop()

    def _render_open_pages(self) -> None:
        """The 'Open in your browser' card: only while an extension is connected, and only this card is redrawn."""
        how = self._how_card
        if self._screen != "start" or how is None or not how.winfo_exists():
            return
        link = self.link
        shown = (link.connected, link.pages if link.connected else ())
        if shown == self._pages_shown:
            return
        self._pages_shown = shown
        if self._pages_card is not None:
            self._pages_card.destroy()
            self._pages_card = None
        if self._connect_card is not None:
            self._connect_card.destroy()  # cancels its glow timer
            self._connect_card = None
        if not link.connected:
            # No extension: a glowing call to connect one, in the slot the detector takes once it is connected.
            self._connect_card = ConnectPrompt(how.master, self._connect_extension)
            self._connect_card.pack(fill="x", pady=(theme.SPACE_3, 0), after=self._status_lbl)
            how.pack(fill="x", pady=(theme.SPACE_3, 0))
            return
        # The card takes the place of 'How it works', which a user with the extension connected no longer needs.
        how.pack_forget()
        found = bool(link.pages)
        card = ctk.CTkFrame(
            how.master,
            fg_color=theme.SURFACE,
            corner_radius=10,
            border_width=1,
            border_color=theme.ACCENT if found else theme.BORDER,  # a find lights the card's edge, as in the extension
        )
        card.pack(fill="x", pady=(theme.SPACE_4, 0), after=self._status_lbl)
        self._pages_card = card
        # The detector: a radar that listens while nothing is open and pings once when something is found.
        head = ctk.CTkFrame(card, fg_color="transparent")
        head.pack(fill="x", padx=theme.SPACE_3, pady=theme.SPACE_3)
        Radar(head, state=FOUND if found else LISTENING, accent=theme.ACCENT, ground=theme.SURFACE).pack(
            side="left", padx=(0, theme.SPACE_3)
        )
        text = ctk.CTkFrame(head, fg_color="transparent")
        text.pack(side="left", fill="x", expand=True)
        ctk.CTkLabel(
            text, text=detector_title(len(link.pages)), font=_f(14, "bold"), text_color=theme.TEXT, anchor="w", height=0
        ).pack(anchor="w")
        ctk.CTkLabel(
            text,
            text=OPEN_PAGES_PICK if found else OPEN_PAGES_EMPTY,
            font=_f(12),
            text_color=theme.MUTED,
            anchor="w",
            justify="left",
            wraplength=420,
            height=0,
        ).pack(anchor="w", pady=(theme.SPACE_1, 0))
        rows, more = open_page_rows(link.pages)
        if not rows:
            return
        for page, (tag, title, note) in zip(link.pages, rows, strict=False):
            self._open_page_row(card, page, tag, title, note)
        if more:
            ctk.CTkLabel(card, text=more, font=_f(12), text_color=theme.FAINT, anchor="w").pack(
                anchor="w", padx=theme.SPACE_4, pady=(0, theme.SPACE_2)
            )
        ctk.CTkFrame(card, height=theme.SPACE_2, fg_color="transparent").pack()

    def _open_page_row(self, card: ctk.CTkFrame, page: OpenPage, tag: str, title: str, note: str) -> None:
        """One open page: its kind, its title and 'this page' for the one in view. Clicking it gets its credits."""
        row = ctk.CTkFrame(card, fg_color="transparent", corner_radius=6, cursor="hand2")
        row.pack(fill="x", padx=theme.SPACE_2, pady=(0, theme.SPACE_1))
        parts = [
            ctk.CTkLabel(row, text=tag, width=52, font=_f(11, "bold"), text_color=theme.FAINT, anchor="w"),
            ctk.CTkLabel(row, text=title, font=_f(13), text_color=theme.TEXT, anchor="w"),
            ctk.CTkLabel(row, text=note, font=_f(12), text_color=theme.ACCENT, anchor="e"),
        ]
        parts[0].pack(side="left", padx=(theme.SPACE_2, 0), pady=theme.SPACE_1)
        parts[1].pack(side="left", fill="x", expand=True, pady=theme.SPACE_1)
        parts[2].pack(side="right", padx=(theme.SPACE_2, theme.SPACE_2), pady=theme.SPACE_1)
        for widget in (row, *parts):
            widget.bind("<Button-1>", lambda _, url=page.url: self._get_credits_for(url))
            widget.bind("<Enter>", lambda _, r=row: r.configure(fg_color=theme.SURFACE_HI))
            widget.bind("<Leave>", lambda _, r=row: r.configure(fg_color="transparent"))

    def _get_credits_for(self, url: str) -> None:
        """Same path as typing the link and pressing Get credits."""
        if self._busy or self._screen != "start":
            return
        self._url_entry.delete(0, "end")
        self._url_entry.insert(0, url)
        self._start_scrape()

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
        """Start-screen state while detecting: progress bar and Cancel instead of Get credits."""
        self._busy = busy
        if not self._scrape_btn.winfo_exists():
            return
        if busy:
            self._set_enabled(self._scrape_btn, False)
            self._url_entry.configure(state="disabled")
            self._cancel_btn.pack(side="left", padx=(theme.SPACE_2, 0))
            self._progress.pack(fill="x", pady=(theme.SPACE_4, 0), before=self._status_lbl)
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

    def _start_scrape(self) -> None:
        url = self._url_entry.get().strip()
        if self._busy or not url_hint(url)[0]:
            return
        self._job += 1
        self._set_busy(True, "Opening the Apple Music page…")
        threading.Thread(target=self._detect_thread, args=(url, self._job), daemon=True).start()
