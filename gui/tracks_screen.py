import customtkinter as ctk

from gui import theme
from gui.chrome import ChromeMixin

_f = theme.font


class TracksScreenMixin(ChromeMixin):
    """The album track list and the loading screen shown while a song is read."""

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
        tools.pack(fill="x", padx=theme.SPACE_6, pady=(theme.SPACE_1, theme.SPACE_1))
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

        # Bottom buttons - packed before the scrollable frame so they're always visible
        btn_row = ctk.CTkFrame(self, fg_color="transparent")
        btn_row.pack(side="bottom", fill="x", padx=theme.SPACE_6, pady=(theme.SPACE_2, theme.SPACE_4))
        self._button(btn_row, "Back", self._go_to_main_from_album, width=90).pack(side="left")
        self._scrape_selected_btn = self._button(
            btn_row, "Start with selected", self._start_selected_queue, primary=True, width=190
        )
        self._scrape_selected_btn.pack(side="right")
        self._button(btn_row, f"All {info.track_count} songs", self._start_album_queue, width=130).pack(
            side="right", padx=(0, theme.SPACE_2)
        )

        sf = theme.scroll_frame(self, fg_color=theme.SURFACE, corner_radius=8)
        sf.pack(fill="both", expand=True, padx=theme.SPACE_6, pady=(0, theme.SPACE_1))

        for i, title in enumerate(info.track_titles):
            n = i + 1
            var = ctk.BooleanVar(value=False)
            self._track_vars.append(var)

            row = ctk.CTkFrame(sf, fg_color="transparent", corner_radius=4)
            row.pack(fill="x", padx=theme.SPACE_1, pady=theme.SPACE_1)

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
            cb.pack(side="left", padx=(theme.SPACE_2, theme.SPACE_1))

            num_lbl = ctk.CTkLabel(row, text=str(n), width=28, text_color=theme.FAINT, anchor="e", font=_f(13))
            num_lbl.pack(side="left", padx=(0, theme.SPACE_3))
            title_lbl = ctk.CTkLabel(row, text=title, anchor="w", font=_f(13), text_color=theme.TEXT)
            title_lbl.pack(side="left", fill="x", expand=True, pady=theme.SPACE_1)

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
            pady=(theme.SPACE_1, theme.SPACE_4)
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
        ).pack(pady=(theme.SPACE_4, theme.SPACE_4))
        self._button(box, "Cancel", self._cancel_scrape, width=110).pack()
