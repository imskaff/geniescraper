"""
Settings window: opens over any screen and applies and saves what was changed when it closes.

There is no Save button, so leaving the window by any route can never lose a change, and the
assistant keeps running underneath while settings are adjusted. The layout follows the
browser extension's Settings: a bordered card per section, with titled groups inside a card.
"""

import os
import tkinter as tk
from collections.abc import Callable

import customtkinter as ctk
import keyboard

from gui import theme
from gui.link import LinkController, LinkState, state_hint, state_label
from gui.logic import hotkey_error
from utils import config
from utils.config import settings

_AUTO_START_DELAYS = ("5", "10", "15", "30")
_COPY = "Copy"
_COPIED = "Copied ✓"
_READS_ALL = "All at once"
_READS_ONE = "1 (one by one)"
_AUTO_PASTE_HINT_ON = (
    "The extension fills the whole track by itself, one field after another, and pauses if you touch Genius. "
    "Off, you press the key or Next for each step."
)
_AUTO_PASTE_HINT_OFF = "Needs the browser extension: connect it below to turn this on."
_COLLECT = (
    ("scrape_core", "Songwriters and producers", "Written By and Produced By"),
    ("scrape_additional", "Additional credits", "Every other role, such as engineers and musicians"),
    ("scrape_copyright", "Copyright lines (℗ and ©)", "The labels, from album links"),
    ("scrape_youtube", "YouTube link", "Pasted into Genius's YouTube field"),
    ("scrape_cover_art", "PNG cover art link", "1000×1000 PNG of the exact release"),
)


def _reads_label(n: int) -> str:
    return _READS_ALL if n == 0 else _READS_ONE if n == 1 else str(n)


def _reads_value(label: str) -> int:
    return 0 if label == _READS_ALL else 1 if label == _READS_ONE else int(label)


class SettingsWindow(ctk.CTkToplevel):
    def __init__(self, master: ctk.CTk, on_change: Callable[[], None], link: LinkController) -> None:
        super().__init__(master)
        self._on_change = on_change
        self._link = link
        self._capture_hook: object | None = None
        self._reset_armed = False
        self._pending: dict[str, object] = {}  # changes made here, applied together when the window closes
        self.title("Géniescraper settings")
        theme.set_icon(self)
        self.geometry(f"480x660+{master.winfo_rootx() + 70}+{master.winfo_rooty() + 20}")
        self.minsize(440, 420)
        self.configure(fg_color=theme.BG)
        self.transient(master)
        self.attributes("-topmost", True)
        theme.dark_title_bar(self)  # after transient(), which replaces the window frame
        self.protocol("WM_DELETE_WINDOW", self.close)
        self.bind("<Escape>", lambda _: self.close())
        self._build()
        self.after(100, self.focus_force)

    # ── layout ───────────────────────────────────────────────────────────

    def _build(self) -> None:
        for w in self.winfo_children():
            w.destroy()
        footer = ctk.CTkFrame(self, fg_color=theme.SURFACE, corner_radius=0)
        footer.pack(side="bottom", fill="x")
        body = theme.scroll_frame(self, fg_color="transparent")
        body.pack(fill="both", expand=True, padx=theme.SPACE_2, pady=(theme.SPACE_2, 0))
        body.grid_columnconfigure(0, weight=1)
        self._body = body
        self._body_row = 0
        self._box: ctk.CTkFrame | ctk.CTkScrollableFrame = body  # where the current card's rows go
        self._row = 0
        self.headings: list[str] = []

        # The extension's Settings, in the same order: what to collect, then pasting (with the link to the browser
        # extension that does the pasting for you), reading, and the desktop-only window options last.
        self._card("What to paste")
        for key, label, hint in _COLLECT:
            self._switch(key, label, hint)

        self._card("Pasting on Genius")
        self._auto_paste()
        self._link_area()
        self._subgroup("Keys")
        self._hotkeys()
        self._subgroup("Typing into Genius")
        self._switch(
            "auto_tab",
            "Auto-tab",
            "Moves to the next Genius field for you after each paste, so you only press the hotkey.",
        )
        self._switch(
            "auto_enter",
            "Auto-confirm",
            "Presses Enter after each paste to pick Genius's autocomplete suggestion.",
        )
        self._wait_slider()

        self._card("Reading credits")
        self._parallel_reads()

        self._card("YouTube links")
        self._switch(
            "find_youtube",
            "Find a YouTube link for each track (recommended)",
            "Searches YouTube for the music video, lyric video or official audio. "
            "It needs the YouTube link ticked above to be pasted.",
        )

        self._card("Cover art look-up")
        self._switch(
            "deezer_covers",
            "Search Deezer for a cover when Apple has none",
            "Only asked when Apple Music has no cover of its own for the release.",
        )

        self._card("Window")
        self._switch("always_on_top", "Always on top", "Keeps this window above the browser while you paste.")
        self._switch(
            "compact_mode",
            "Compact assistant",
            "Hides the step list while pasting and shrinks the window.",
        )
        self._auto_start()
        self._end_card()

        self._footer(footer)

    def _place(self, widget: ctk.CTkBaseClass, pady: tuple[int, int] = (0, 0), padx: int = theme.SPACE_4) -> None:
        widget.grid(row=self._row, column=0, sticky="ew", padx=padx, pady=pady)
        self._row += 1

    def _card(self, title: str) -> None:
        """A section, drawn as in the extension: a bordered card with its own heading."""
        self._end_card()
        self.headings.append(title)
        card = ctk.CTkFrame(
            self._body, fg_color=theme.SURFACE, border_width=1, border_color=theme.BORDER, corner_radius=8
        )
        card.grid(row=self._body_row, column=0, sticky="ew", padx=theme.SPACE_3, pady=(0, theme.SPACE_5))
        card.grid_columnconfigure(0, weight=1)
        self._body_row += 1
        ctk.CTkLabel(card, text=title, font=theme.font(15, "bold"), text_color=theme.TEXT, anchor="w").grid(
            row=0, column=0, sticky="w", padx=theme.SPACE_4, pady=(theme.SPACE_4, theme.SPACE_2)
        )
        self._box = card
        self._row = 1

    def _end_card(self) -> None:
        """Room under the last row, so a card's bottom edge is as far from its content as its top edge is."""
        if self._box is not self._body:
            self._place(ctk.CTkFrame(self._box, height=theme.SPACE_2, fg_color="transparent", corner_radius=0))

    def _subgroup(self, title: str) -> None:
        """A titled group inside a card, set off from the one before it by a line."""
        self._place(ctk.CTkFrame(self._box, height=1, fg_color=theme.BORDER, corner_radius=0), (theme.SPACE_2, 0))
        self._place(
            ctk.CTkLabel(
                self._box, text=title.upper(), font=theme.font(11, "bold"), text_color=theme.MUTED, anchor="w"
            ),
            (theme.SPACE_4, theme.SPACE_2),
        )

    def _setting_row(self, label: str, hint: str, wrap: int = 300) -> tuple[ctk.CTkFrame, ctk.CTkFrame]:
        row = ctk.CTkFrame(self._box, fg_color="transparent", corner_radius=0)
        row.grid_columnconfigure(0, weight=1)
        text = ctk.CTkFrame(row, fg_color="transparent")
        text.grid(row=0, column=0, sticky="ew", padx=(0, theme.SPACE_2), pady=theme.SPACE_2)
        ctk.CTkLabel(text, text=label, font=theme.font(13, "bold"), text_color=theme.TEXT, anchor="w", height=0).pack(
            anchor="w"
        )
        self._last_hint = ctk.CTkLabel(
            text,
            text=hint,
            font=theme.font(11),
            text_color=theme.MUTED,
            anchor="w",
            justify="left",
            wraplength=wrap,
            height=0,
        )
        self._last_hint.pack(anchor="w", pady=(theme.SPACE_1, 0))
        control = ctk.CTkFrame(row, fg_color="transparent")
        control.grid(row=0, column=1, sticky="e")
        self._place(row)
        return row, control

    def _switch(self, key: str, label: str, hint: str) -> None:
        _, control = self._setting_row(label, hint)
        value = getattr(settings, key)
        var = ctk.BooleanVar(value=value)
        ctk.CTkSwitch(
            control,
            text="",
            width=46,
            variable=var,
            progress_color=theme.ACCENT,
            command=lambda: self._set(key, var.get()),
        ).pack()

    def _wait_slider(self) -> None:
        _, control = self._setting_row(
            "Wait for suggestions to settle",
            "Raise this if Genius is slow to show suggestions.",
            wrap=220,
        )
        value = ctk.CTkLabel(control, text=f"{settings.autocomplete_wait:.1f} s", width=44, font=theme.font(12))
        slider = ctk.CTkSlider(
            control,
            from_=0.2,  # pyright: ignore[reportArgumentType] - CTkSlider accepts floats; its stub says int
            to=2.0,  # pyright: ignore[reportArgumentType]
            number_of_steps=18,
            width=110,
            progress_color=theme.ACCENT,
            button_color=theme.ACCENT,
            command=lambda v: value.configure(text=f"{v:.1f} s"),
        )
        slider.set(settings.autocomplete_wait)
        slider.bind("<ButtonRelease-1>", lambda _: self._set("autocomplete_wait", round(slider.get(), 1)))
        slider.pack(side="left")
        value.pack(side="left", padx=(theme.SPACE_2, 0))

    def _parallel_reads(self) -> None:
        _, control = self._setting_row(
            "Tracks read at the same time",
            "More at once is faster for an album, but opens that many Apple Music pages together. "
            "One by one is the gentlest; three is the default.",
            wrap=230,
        )
        menu = ctk.CTkOptionMenu(
            control,
            values=[_reads_label(n) for n in config.PARALLEL_CHOICES],
            width=130,
            font=theme.font(12),
            command=lambda v: self._set("parallel_reads", _reads_value(v)),
        )
        menu.set(_reads_label(settings.parallel_reads))
        menu.pack()

    def _hotkeys(self) -> None:
        box = ctk.CTkFrame(self._box, fg_color="transparent", corner_radius=0)
        box.grid_columnconfigure(1, weight=1)
        self._hk_buttons: dict[str, ctk.CTkButton] = {}
        for i, (key, label) in enumerate(
            (("hotkey", "Key that fills the next step"), ("back_hotkey", "Key that goes back one step"))
        ):
            ctk.CTkLabel(box, text=label, font=theme.font(13, "bold"), text_color=theme.TEXT, anchor="w").grid(
                row=i, column=0, sticky="w", padx=0, pady=theme.SPACE_2
            )
            btn = ctk.CTkButton(
                box,
                text=str(getattr(settings, key)).upper(),
                width=120,
                height=30,
                font=theme.font(13, "bold"),
                fg_color=theme.SURFACE_HI,
                hover_color=theme.BORDER,
                text_color=theme.TEXT,
                border_width=1,
                border_color=theme.BORDER,
                command=lambda k=key: self._capture(k),
            )
            btn.grid(row=i, column=1, sticky="e", padx=0, pady=theme.SPACE_2)
            self._hk_buttons[key] = btn
        self._hk_msg = ctk.CTkLabel(
            box,
            text="Click a key, then press the new key. Esc cancels.",
            font=theme.font(11),
            text_color=theme.MUTED,
            anchor="w",
            justify="left",
            wraplength=400,
        )
        self._hk_msg.grid(row=2, column=0, columnspan=2, sticky="w", padx=0, pady=(0, theme.SPACE_2))
        self._place(box)

    def _auto_paste(self) -> None:
        """The Auto-paste switch; it only works through the extension, so it stays grayed out until one is connected."""
        _, control = self._setting_row("Auto-paste", _AUTO_PASTE_HINT_OFF, wrap=300)
        self._auto_hint = self._last_hint
        self._auto_var = ctk.BooleanVar(value=settings.link_mode == "auto")
        self._auto_switch = ctk.CTkSwitch(
            control,
            text="",
            width=46,
            variable=self._auto_var,
            progress_color=theme.ACCENT,
            command=lambda: self._set("link_mode_auto", self._auto_var.get()),
        )
        self._auto_switch.pack()

    def _link_area(self) -> None:
        """Pair with the browser extension and show the link's state; the pairing secret is never displayed."""
        box = ctk.CTkFrame(self._box, fg_color=theme.SURFACE_HI, corner_radius=8)
        box.grid_columnconfigure(0, weight=1)
        head = ctk.CTkFrame(box, fg_color="transparent")
        head.grid(row=0, column=0, columnspan=2, sticky="ew", padx=theme.SPACE_4, pady=(theme.SPACE_4, 0))
        self._link_dot = ctk.CTkLabel(head, text="●", font=theme.font(14), text_color=theme.FAINT, width=16)
        self._link_dot.pack(side="left")
        self._link_state_lbl = ctk.CTkLabel(
            head, text="", font=theme.font(13, "bold"), text_color=theme.TEXT, anchor="w"
        )
        self._link_state_lbl.pack(side="left", padx=(theme.SPACE_1, 0))
        self._link_hint_lbl = ctk.CTkLabel(
            box, text="", font=theme.font(11), text_color=theme.MUTED, anchor="w", justify="left", wraplength=360
        )
        self._link_hint_lbl.grid(
            row=1, column=0, columnspan=2, sticky="w", padx=theme.SPACE_4, pady=(theme.SPACE_2, theme.SPACE_2)
        )
        self._link_code_box = ctk.CTkFrame(box, fg_color=theme.SURFACE, corner_radius=8)
        self._link_code_lbl = ctk.CTkLabel(
            self._link_code_box, text="", font=theme.display(30), text_color=theme.ACCENT, anchor="center"
        )
        self._link_code_lbl.pack(side="left", padx=(theme.SPACE_4, theme.SPACE_2), pady=theme.SPACE_2)
        self._link_copy_btn = ctk.CTkButton(
            self._link_code_box,
            text=_COPY,
            width=80,
            height=30,
            font=theme.font(12),
            fg_color="transparent",
            border_width=1,
            border_color=theme.BORDER,
            text_color=theme.TEXT,
            hover_color=theme.SURFACE_HI,
            command=lambda: self._copy_code(self._link.pairing_code or ""),
        )
        self._link_copy_btn.pack(side="left", padx=(0, theme.SPACE_4), pady=theme.SPACE_2)
        self._copied_code: str | None = None  # the code the button last copied; a new code resets the button
        self._link_code_row = 2
        buttons = ctk.CTkFrame(box, fg_color="transparent")
        buttons.grid(row=3, column=0, columnspan=2, sticky="w", padx=theme.SPACE_4, pady=(theme.SPACE_2, theme.SPACE_4))
        self._link_connect_btn = ctk.CTkButton(
            buttons,
            text="Connect browser extension",
            height=32,
            font=theme.font(12, "bold"),
            fg_color=theme.ACCENT,
            text_color=theme.ACCENT_INK,
            command=self._link_connect,
        )
        self._link_connect_btn.pack(side="left", padx=(0, theme.SPACE_2))
        self._link_forget_btn = ctk.CTkButton(
            buttons,
            text="Forget pairing",
            height=32,
            font=theme.font(12),
            fg_color="transparent",
            border_width=1,
            border_color=theme.BORDER,
            text_color=theme.MUTED,
            hover_color=theme.SURFACE_HI,
            command=self._link_forget,
        )
        self._link_forget_btn.pack(side="left")
        self._place(box, (theme.SPACE_1, theme.SPACE_2))  # directly under the Auto-paste switch it belongs to
        self.refresh_link()

    def refresh_link(self) -> None:
        link = self._link
        if not self._link_state_lbl.winfo_exists():
            return
        state = link.state
        code = link.pairing_code
        left = link.pairing_seconds_left()
        colour = {
            LinkState.CONNECTED: theme.DONE,
            LinkState.LOST: theme.WARN,
            LinkState.WAITING: theme.ACCENT,
        }.get(state, theme.FAINT)
        self._link_dot.configure(text_color=colour)
        self._link_state_lbl.configure(text=state_label(state), text_color=theme.TEXT)
        if link.unavailable:
            hint = "Ports 47831 to 47835 are all in use, so the extension cannot connect. The hotkeys still work."
        else:
            hint = state_hint(state, code=code, seconds_left=left)
        self._link_hint_lbl.configure(text=hint)
        self._link_code_lbl.configure(text=code or "")
        if code != self._copied_code:
            self._link_copy_btn.configure(text=_COPY)
        if code:
            self._link_code_box.grid(row=self._link_code_row, column=0, columnspan=2, sticky="w", padx=theme.SPACE_4)
        else:
            self._link_code_box.grid_remove()
        self._link_connect_btn.configure(
            text="New code" if code else "Connect browser extension",
            state="disabled" if link.unavailable or state is LinkState.CONNECTED else "normal",
        )
        self._link_forget_btn.configure(state="normal" if link.paired or code else "disabled")
        self._refresh_auto_paste()
        if code:
            self.after(1000, self.refresh_link)  # the countdown; stops by itself once the code is gone

    def _refresh_auto_paste(self) -> None:
        """Auto-paste is the extension's doing: usable only while connected, and it says what is missing otherwise."""
        if not self._auto_switch.winfo_exists():
            return
        connected = self._link.state is LinkState.CONNECTED
        self._auto_switch.configure(
            state="normal" if connected else "disabled",
            progress_color=theme.ACCENT if connected else theme.BORDER,  # a disabled switch must not look on
            button_color=theme.TEXT if connected else theme.FAINT,
        )
        self._auto_hint.configure(text=_AUTO_PASTE_HINT_ON if connected else _AUTO_PASTE_HINT_OFF)

    def _copy_code(self, code: str) -> None:
        """Put the pairing code on the clipboard, so it can be pasted into the extension."""
        if not code:
            return
        self.clipboard_clear()
        self.clipboard_append(code)
        self.update()  # hands the text to Windows now, not when the app next idles
        self._copied_code = code
        self._link_copy_btn.configure(text=_COPIED)

    def _link_connect(self) -> None:
        self._link.begin_pairing()
        self.refresh_link()

    def _link_forget(self) -> None:
        self._link.forget()
        self.refresh_link()

    def _auto_start(self) -> None:
        _, control = self._setting_row(
            "Start the assistant automatically",
            "After the review screen opens, start pasting mode on its own after a countdown.",
            wrap=230,
        )
        var = ctk.BooleanVar(value=settings.auto_start_assistant)
        delay = ctk.CTkOptionMenu(
            control,
            values=[f"{d} s" for d in _AUTO_START_DELAYS],
            width=70,
            font=theme.font(12),
            command=lambda v: self._set("auto_start_delay", int(v.removesuffix(" s"))),
        )
        delay.set(f"{settings.auto_start_delay} s")
        delay.pack(side="left", padx=(0, theme.SPACE_2))
        ctk.CTkSwitch(
            control,
            text="",
            width=46,
            variable=var,
            progress_color=theme.ACCENT,
            command=lambda: self._set("auto_start_assistant", var.get()),
        ).pack(side="left")

    def _footer(self, footer: ctk.CTkFrame) -> None:
        ctk.CTkLabel(
            footer,
            text="Changes apply when you close this window.",
            font=theme.font(11),
            text_color=theme.MUTED,
            anchor="w",
        ).pack(side="left", padx=theme.SPACE_4, pady=theme.SPACE_3)
        self._reset_btn = ctk.CTkButton(
            footer,
            text="Reset to defaults",
            width=130,
            height=30,
            font=theme.font(12),
            fg_color="transparent",
            border_width=1,
            border_color=theme.BORDER,
            text_color=theme.MUTED,
            hover_color=theme.SURFACE_HI,
            command=self._reset,
        )
        ctk.CTkButton(
            footer,
            text="Done",
            width=80,
            height=30,
            font=theme.font(12, "bold"),
            fg_color=theme.ACCENT,
            text_color=theme.ACCENT_INK,
            command=self.close,
        ).pack(side="right", padx=(theme.SPACE_2, theme.SPACE_4), pady=theme.SPACE_3)
        self._reset_btn.pack(side="right", padx=(theme.SPACE_2, 0), pady=theme.SPACE_3)
        ctk.CTkButton(
            footer,
            text="Open settings folder",
            width=150,
            height=30,
            font=theme.font(12),
            fg_color="transparent",
            border_width=1,
            border_color=theme.BORDER,
            text_color=theme.MUTED,
            hover_color=theme.SURFACE_HI,
            command=self._open_folder,
        ).pack(side="right", pady=theme.SPACE_3)

    # ── actions ──────────────────────────────────────────────────────────

    def _set(self, key: str, value: object) -> None:
        """Remember a change; nothing is applied or saved until the window closes, so the app behind it stays still."""
        if key == "link_mode_auto":  # the switch is a boolean, the setting is a word
            key, value = "link_mode", "auto" if value else "manual"
        self._pending[key] = value

    def _value(self, key: str) -> object:
        """A setting as it will be once this window closes."""
        return self._pending[key] if key in self._pending else getattr(settings, key)

    def _apply(self) -> bool:
        """Write the remembered changes to the settings and the file; True when there was something to apply."""
        if not self._pending:
            return False
        for key, value in self._pending.items():
            setattr(settings, key, value)
        self._pending.clear()
        settings.save()
        return True

    def _capture(self, key: str) -> None:
        self._stop_capture()
        other = "back_hotkey" if key == "hotkey" else "hotkey"
        btn = self._hk_buttons[key]
        btn.configure(text="Press a key…", border_color=theme.WARN, text_color=theme.WARN)
        self._hk_msg.configure(text="Press the new key now. Esc cancels.", text_color=theme.MUTED)

        def on_key(event: keyboard.KeyboardEvent) -> None:
            name = (event.name or "").lower()
            if name in ("shift", "ctrl", "alt", "windows", "unknown"):
                return
            self.after(0, self._finish_capture, key, name, str(self._value(other)))

        self._capture_hook = keyboard.on_press(on_key, suppress=False)

    def _finish_capture(self, key: str, name: str, other_value: str) -> None:
        self._stop_capture()
        btn = self._hk_buttons[key]
        btn.configure(border_color=theme.BORDER, text_color=theme.TEXT)
        if name == "esc":
            btn.configure(text=str(self._value(key)).upper())
            self._hk_msg.configure(text="Cancelled. The hotkey is unchanged.", text_color=theme.MUTED)
            return
        error = hotkey_error(name, other_value)
        if error:
            btn.configure(text=str(self._value(key)).upper())
            self._hk_msg.configure(text=error, text_color=theme.DANGER)
            return
        btn.configure(text=name.upper())
        self._hk_msg.configure(text=f"{name.upper()} is the new hotkey.", text_color=theme.ACCENT)
        self._set(key, name)

    def _stop_capture(self) -> None:
        if self._capture_hook is not None:
            try:
                keyboard.unhook(self._capture_hook)  # pyright: ignore[reportArgumentType]
            except (KeyError, ValueError):
                pass
            self._capture_hook = None

    def _reset(self) -> None:
        if not self._reset_armed:
            self._reset_armed = True
            self._reset_btn.configure(text="Click again to reset", text_color=theme.DANGER, border_color=theme.DANGER)
            self.after(3000, self._disarm_reset)
            return
        keep = {
            "win_x": settings.win_x,
            "win_y": settings.win_y,
            "bridge_secret": settings.bridge_secret,  # a reset of preferences is not "Forget pairing"
            "bridge_origin": settings.bridge_origin,
        }
        for name, field in config.Settings.model_fields.items():
            setattr(settings, name, keep.get(name, field.default))
        self._pending.clear()
        settings.save()
        self._on_change()
        self._reset_armed = False
        self._build()

    def _disarm_reset(self) -> None:
        self._reset_armed = False
        if self._reset_btn.winfo_exists():
            self._reset_btn.configure(text="Reset to defaults", text_color=theme.MUTED, border_color=theme.BORDER)

    def _open_folder(self) -> None:
        folder = config._ENV_PATH.parent
        folder.mkdir(parents=True, exist_ok=True)
        os.startfile(folder)  # opens the user's own settings folder in Explorer

    def close(self) -> None:
        self.destroy()

    def destroy(self) -> None:
        """Closing, however it happens, applies what was changed here: once, after the window is gone."""
        self._stop_capture()
        changed = self._apply()
        super().destroy()
        if changed:
            try:
                self._on_change()
            except tk.TclError:  # the whole app is closing
                pass
