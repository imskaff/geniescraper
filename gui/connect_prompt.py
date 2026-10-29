"""
The start screen's call to connect the browser extension: an accent-edged card whose button and title glow while
nothing is connected.

Tk has no transparency, so the glow is the accent blended toward another color (`radar.blend`). Each frame updates two
small widgets (the button and the title), and none when the quantised level did not change; nothing is ever rebuilt.
The card's own border stays still: recoloring it repaints the whole card, which costs more than the rest together.
The card cancels its own timer when it is destroyed, so no `after` job outlives it.
"""

import math
import time
import tkinter as tk
from collections.abc import Callable

import customtkinter as ctk

from gui import theme
from gui.radar import blend

TITLE = "Connect your browser extension"
BODY = (
    "Auto-paste, the list of Apple Music pages you have open, and exact artist matching all need it. "
    "It takes about a minute."
)
BUTTON = "Connect browser extension"

PERIOD = 1.6  # s for the glow to swell and fade once
FRAME_MS = 66  # about 15 frames a second
_STEPS = 12  # distinct glow levels: a frame whose level did not change touches no widget
_BUTTON_DIM = 0.5  # the button's fill at its dimmest, as a share of the accent; its dark text stays readable


def level(t: float) -> int:
    """Where the glow is `t` seconds in, as a whole step from 0 (dimmest) to _STEPS (brightest)."""
    swell = 0.5 - 0.5 * math.cos(2 * math.pi * t / PERIOD)
    return round(swell * _STEPS)


class ConnectPrompt(ctk.CTkFrame):
    def __init__(
        self,
        master: tk.Misc,
        command: Callable[[], None],
        *,
        ground: str = theme.SURFACE,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        super().__init__(
            master,
            fg_color=ground,
            corner_radius=10,
            border_width=2,
            border_color=theme.ACCENT,
        )
        self._ground, self._clock = ground, clock
        self._started = clock()
        self._job: str | None = None
        self._level = -1
        self.title = ctk.CTkLabel(
            self, text=TITLE, font=theme.font(15, "bold"), text_color=theme.TEXT, anchor="w", height=0
        )
        self.title.pack(anchor="w", padx=theme.SPACE_4, pady=(theme.SPACE_3, 0))
        ctk.CTkLabel(
            self,
            text=BODY,
            font=theme.font(12),
            text_color=theme.MUTED,
            anchor="w",
            justify="left",
            wraplength=500,
            height=0,
        ).pack(anchor="w", padx=theme.SPACE_4, pady=(theme.SPACE_1, theme.SPACE_2))
        self.button = ctk.CTkButton(
            self,
            text=BUTTON,
            command=command,
            width=220,
            height=32,
            font=theme.font(13, "bold"),
            fg_color=theme.ACCENT,
            hover_color=theme.ACCENT,
            text_color=theme.ACCENT_INK,
        )
        self.button.pack(anchor="w", padx=theme.SPACE_4, pady=(0, theme.SPACE_3))
        self._tick()

    def _tick(self) -> None:
        self._job = None
        if not self.winfo_exists():
            return
        self.frame(self._clock() - self._started)
        self._job = self.after(FRAME_MS, self._tick)

    def frame(self, t: float) -> bool:
        """Draw the glow at `t` seconds; False when it looked the same as the frame before and nothing was touched."""
        now = level(t)
        if now == self._level:
            return False
        self._level = now
        share = now / _STEPS
        self.title.configure(text_color=blend(theme.ACCENT, theme.TEXT, share))  # white at rest, yellow at the peak
        self.button.configure(fg_color=blend(theme.ACCENT, self._ground, _BUTTON_DIM + (1 - _BUTTON_DIM) * share))
        return True

    def destroy(self) -> None:
        if self._job is not None:
            self.after_cancel(self._job)
            self._job = None
        super().destroy()
