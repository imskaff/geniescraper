import threading

import customtkinter as ctk

from assistant import flow
from gui import theme
from gui.chrome import ChromeMixin
from utils.config import settings

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


class AssistantScreenMixin(ChromeMixin):
    """The paste screen: the step card, controls, step list and their rendering."""

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
