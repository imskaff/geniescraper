"""
Settings window: opens over any screen, applies and saves each change immediately.

There is no Save button, so leaving the window can never lose a change, and the
assistant keeps running underneath while settings are adjusted.
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
_READS_ALL = "All"
_COLLECT = (
    ("scrape_core", "Writers and producers", "Written By and Produced By"),
    ("scrape_additional", "Additional credits", "Every other role, such as engineers and musicians"),
    ("scrape_copyright", "Copyright lines", "℗ and © labels, from album links"),
    (
        "scrape_youtube",
        "Find a YouTube link for each track (recommended)",
        "Official music video, lyric video or official audio",
    ),
    ("scrape_cover_art", "Cover art", "1000×1000 PNG of the exact release"),
)


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
        body.pack(fill="both", expand=True, padx=8, pady=(8, 0))
        body.grid_columnconfigure(0, weight=1)
        self._body = body
        self._row = 0
        self.headings: list[str] = []

        self._heading("What to collect")
        for key, label, hint in _COLLECT:
            self._switch(key, label, hint)

        self._heading("Pasting into Genius")
        self._auto_paste()
        self._hotkeys()
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

        self._heading("Reading tracks")
        self._parallel_reads()

        self._heading("Browser extension")
        self._link_area()

        self._heading("Window")
        self._switch("always_on_top", "Always on top", "Keeps this window above the browser while you paste.")
        self._switch(
            "compact_mode",
            "Compact assistant",
            "Hides the step list while pasting and shrinks the window.",
        )
        self._auto_start()

        self._footer(footer)

    def _place(self, widget: ctk.CTkBaseClass, pady: tuple[int, int] = (0, 0)) -> None:
        widget.grid(row=self._row, column=0, sticky="ew", padx=12, pady=pady)
        self._row += 1

    def _heading(self, text: str) -> None:
        self.headings.append(text)
        pad = (6, 6) if self._row == 0 else (22, 6)
        self._place(
            ctk.CTkLabel(
                self._body, text=text.upper(), font=theme.font(11, "bold"), text_color=theme.FAINT, anchor="w"
            ),
            pad,
        )

    def _setting_row(self, label: str, hint: str, wrap: int = 300) -> tuple[ctk.CTkFrame, ctk.CTkFrame]:
        row = ctk.CTkFrame(self._body, fg_color=theme.SURFACE, corner_radius=8)
        row.grid_columnconfigure(0, weight=1)
        text = ctk.CTkFrame(row, fg_color="transparent")
        text.grid(row=0, column=0, sticky="ew", padx=(14, 8), pady=10)
        ctk.CTkLabel(text, text=label, font=theme.font(13, "bold"), text_color=theme.TEXT, anchor="w").pack(anchor="w")
        self._last_hint = ctk.CTkLabel(
            text, text=hint, font=theme.font(11), text_color=theme.MUTED, anchor="w", justify="left", wraplength=wrap
        )
        self._last_hint.pack(anchor="w")
        control = ctk.CTkFrame(row, fg_color="transparent")
        control.grid(row=0, column=1, sticky="e", padx=(0, 14))
        self._place(row, (0, 6))
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
            "Autocomplete wait",
            "How long to wait for Genius's suggestions before confirming. Raise it if a wrong name gets picked.",
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
        value.pack(side="left", padx=(6, 0))

    def _parallel_reads(self) -> None:
        _, control = self._setting_row(
            "Parallel reads",
            "How many album tracks are read at once while you paste. 1 is the gentlest on Apple Music and YouTube.",
            wrap=230,
        )
        menu = ctk.CTkOptionMenu(
            control,
            values=[_READS_ALL if n == 0 else str(n) for n in config.PARALLEL_CHOICES],
            width=70,
            font=theme.font(12),
            command=lambda v: self._set("parallel_reads", 0 if v == _READS_ALL else int(v)),
        )
        menu.set(_READS_ALL if settings.parallel_reads == 0 else str(settings.parallel_reads))
        menu.pack()

    def _hotkeys(self) -> None:
        box = ctk.CTkFrame(self._body, fg_color=theme.SURFACE, corner_radius=8)
        box.grid_columnconfigure(1, weight=1)
        self._hk_buttons: dict[str, ctk.CTkButton] = {}
        for i, (key, label) in enumerate((("hotkey", "Paste next"), ("back_hotkey", "Go back one step"))):
            ctk.CTkLabel(box, text=label, font=theme.font(13, "bold"), text_color=theme.TEXT, anchor="w").grid(
                row=i, column=0, sticky="w", padx=14, pady=(10 if i == 0 else 4, 4)
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
            btn.grid(row=i, column=1, sticky="e", padx=14, pady=(10 if i == 0 else 4, 4))
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
        self._hk_msg.grid(row=2, column=0, columnspan=2, sticky="w", padx=14, pady=(2, 10))
        self._place(box, (0, 6))

    def _auto_paste(self) -> None:
        """The Auto-paste switch; it only works through the extension, so it stays grayed out until one is connected."""
        _, control = self._setting_row("Auto-paste", "", wrap=300)
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
        box = ctk.CTkFrame(self._body, fg_color=theme.SURFACE, corner_radius=8)
        box.grid_columnconfigure(0, weight=1)
        head = ctk.CTkFrame(box, fg_color="transparent")
        head.grid(row=0, column=0, columnspan=2, sticky="ew", padx=14, pady=(12, 0))
        self._link_dot = ctk.CTkLabel(head, text="●", font=theme.font(14), text_color=theme.FAINT, width=16)
        self._link_dot.pack(side="left")
        self._link_state_lbl = ctk.CTkLabel(
            head, text="", font=theme.font(13, "bold"), text_color=theme.TEXT, anchor="w"
        )
        self._link_state_lbl.pack(side="left", padx=(4, 0))
        self._link_hint_lbl = ctk.CTkLabel(
            box, text="", font=theme.font(11), text_color=theme.MUTED, anchor="w", justify="left", wraplength=400
        )
        self._link_hint_lbl.grid(row=1, column=0, columnspan=2, sticky="w", padx=14, pady=(4, 6))
        self._link_code_box = ctk.CTkFrame(box, fg_color=theme.SURFACE_HI, corner_radius=8)
        self._link_code_lbl = ctk.CTkLabel(
            self._link_code_box, text="", font=theme.display(30), text_color=theme.ACCENT, anchor="center"
        )
        self._link_code_lbl.pack(padx=18, pady=8)
        self._link_code_row = 2
        buttons = ctk.CTkFrame(box, fg_color="transparent")
        buttons.grid(row=3, column=0, columnspan=2, sticky="w", padx=14, pady=(8, 12))
        self._link_connect_btn = ctk.CTkButton(
            buttons,
            text="Connect browser extension",
            height=32,
            font=theme.font(12, "bold"),
            fg_color=theme.ACCENT,
            text_color=theme.ACCENT_INK,
            command=self._link_connect,
        )
        self._link_connect_btn.pack(side="left", padx=(0, 8))
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
        self._place(box, (0, 6))
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
        if code:
            self._link_code_box.grid(row=self._link_code_row, column=0, columnspan=2, sticky="w", padx=14)
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
        self._auto_switch.configure(state="normal" if connected else "disabled")
        self._auto_hint.configure(
            text=(
                "The extension fills every field by itself and pauses if you touch Genius. "
                "Off, you press Next or the key for each step."
                if connected
                else "Needs the browser extension. Connect it below to turn this on."
            )
        )

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
        delay.pack(side="left", padx=(0, 8))
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
        ).pack(side="left", padx=14, pady=12)
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
        ).pack(side="right", padx=(6, 14), pady=12)
        self._reset_btn.pack(side="right", padx=(6, 0), pady=12)
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
        ).pack(side="right", pady=12)

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
