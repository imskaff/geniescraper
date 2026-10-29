"""
Settings window: opens over any screen, applies and saves each change immediately.

There is no Save button, so leaving the window can never lose a change, and the
assistant keeps running underneath while settings are adjusted.
"""

import os
from collections.abc import Callable

import customtkinter as ctk
import keyboard

from gui import theme
from gui.logic import hotkey_error
from utils import config
from utils.config import settings

_AUTO_START_DELAYS = ("5", "10", "15", "30")
_READS_ALL = "All"
_COLLECT = (
    ("scrape_core", "Writers and producers", "Written By and Produced By"),
    ("scrape_additional", "Additional credits", "Every other role, such as engineers and musicians"),
    ("scrape_copyright", "Copyright lines", "℗ and © labels, from album links"),
    ("scrape_youtube", "YouTube link", "Official music video, or the official audio"),
    ("scrape_cover_art", "Cover art", "1000×1000 PNG of the exact release"),
)


class SettingsWindow(ctk.CTkToplevel):
    def __init__(self, master: ctk.CTk, on_change: Callable[[], None]) -> None:
        super().__init__(master)
        self._on_change = on_change
        self._capture_hook: object | None = None
        self._reset_armed = False
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

        self._heading("Pasting into Genius")
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

        self._heading("Hotkeys")
        self._hotkeys()

        self._heading("What to collect")
        for key, label, hint in _COLLECT:
            self._switch(key, label, hint)

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
        ctk.CTkLabel(
            text, text=hint, font=theme.font(11), text_color=theme.MUTED, anchor="w", justify="left", wraplength=wrap
        ).pack(anchor="w")
        control = ctk.CTkFrame(row, fg_color="transparent")
        control.grid(row=0, column=1, sticky="e", padx=(0, 14))
        self._place(row, (0, 6))
        return row, control

    def _switch(self, key: str, label: str, hint: str) -> None:
        _, control = self._setting_row(label, hint)
        var = ctk.BooleanVar(value=getattr(settings, key))
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
                text=getattr(settings, key).upper(),
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
            text="Changes are saved automatically.",
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
        self._reset_btn.pack(side="right", padx=(6, 14), pady=12)
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
        setattr(settings, key, value)
        settings.save()
        self._on_change()

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
            self.after(0, self._finish_capture, key, name, getattr(settings, other))

        self._capture_hook = keyboard.on_press(on_key, suppress=False)

    def _finish_capture(self, key: str, name: str, other_value: str) -> None:
        self._stop_capture()
        btn = self._hk_buttons[key]
        btn.configure(border_color=theme.BORDER, text_color=theme.TEXT)
        if name == "esc":
            btn.configure(text=getattr(settings, key).upper())
            self._hk_msg.configure(text="Cancelled. The hotkey is unchanged.", text_color=theme.MUTED)
            return
        error = hotkey_error(name, other_value)
        if error:
            btn.configure(text=getattr(settings, key).upper())
            self._hk_msg.configure(text=error, text_color=theme.DANGER)
            return
        btn.configure(text=name.upper())
        self._hk_msg.configure(text=f"Saved. {name.upper()} is the new hotkey.", text_color=theme.ACCENT)
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
        keep = {"win_x": settings.win_x, "win_y": settings.win_y}
        for name, field in config.Settings.model_fields.items():
            setattr(settings, name, keep.get(name, field.default))
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
        self._stop_capture()
        self.destroy()
