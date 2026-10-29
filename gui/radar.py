"""
The detector's radar, as in the extension's panel: a beating yellow dot with three rings that ping outward while it
listens for Apple Music pages, and one burst of a ring when something is found.

`frame` is the pure part (what to draw at a given time); `Radar` draws it on a canvas. Tk has no transparency, so a
fading ring is drawn by blending its color toward the card's own color.
"""

import math
import time
import tkinter as tk
from collections.abc import Callable
from dataclasses import dataclass

LISTENING = "listening"
FOUND = "found"

SIZE = 40  # px, the same as the extension's radar
_RADIUS = SIZE / 2 - 1
_RING_PERIOD = 2.7  # s for a ring to travel out and fade
_RING_DELAY = 0.9  # s between the three rings
_BEAT_PERIOD = 1.4  # s for the dot to swell and shrink once
_BURST = 0.9  # s the single ring takes when something is found
_FRAME_MS = 40


@dataclass(frozen=True)
class Shape:
    """A circle about the middle of the radar; `width` 0 is a filled disc, anything else an outline."""

    radius: float
    color: str
    width: int = 0


def blend(foreground: str, ground: str, alpha: float) -> str:
    """`foreground` at `alpha` (0 to 1) over `ground`, both '#rrggbb'."""
    alpha = max(0.0, min(1.0, alpha))
    fg = [int(foreground[i : i + 2], 16) for i in (1, 3, 5)]
    bg = [int(ground[i : i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(b + (f - b) * alpha):02x}" for f, b in zip(fg, bg, strict=True))


def animating(state: str, t: float) -> bool:
    """Whether anything is still moving: listening never stops, a find stops after its one burst."""
    return state == LISTENING or t < _BURST


def frame(state: str, t: float, *, accent: str, ground: str) -> list[Shape]:
    """What to draw `t` seconds after the radar appeared, back to front."""
    shapes: list[Shape] = []
    if state == LISTENING:
        for k in range(3):
            elapsed = t - _RING_DELAY * k
            if elapsed < 0:
                continue  # a ring starts only after its delay
            progress = (elapsed % _RING_PERIOD) / _RING_PERIOD
            shapes.append(Shape(_RADIUS * (0.3 + 0.7 * progress), blend(accent, ground, 0.8 * (1 - progress)), 2))
        swell = 0.5 - 0.5 * math.cos(2 * math.pi * t / _BEAT_PERIOD)  # 0 at rest, 1 at the fullest
        radius = 7 * (0.8 + 0.7 * swell)
        shapes.append(Shape(radius + 4, blend(accent, ground, 0.25 * swell), 3))
        shapes.append(Shape(radius, blend(accent, ground, 0.6 + 0.4 * swell)))
        return shapes
    if t < _BURST:
        progress = t / _BURST
        shapes.append(Shape(_RADIUS * (0.3 + 0.7 * progress), blend(accent, ground, 0.8 * (1 - progress)), 2))
    shapes.append(Shape(11, blend(accent, ground, 0.3), 3))  # the glow around a found page
    shapes.append(Shape(8, accent))
    return shapes


class Radar(tk.Canvas):
    def __init__(
        self, master: tk.Misc, *, state: str, accent: str, ground: str, clock: Callable[[], float] = time.monotonic
    ) -> None:
        super().__init__(master, width=SIZE, height=SIZE, bg=ground, highlightthickness=0, bd=0)
        self._state, self._accent, self._ground, self._clock = state, accent, ground, clock
        self._started = clock()
        self._job: str | None = None
        self._tick()

    def _tick(self) -> None:
        self._job = None
        if not self.winfo_exists():
            return
        t = self._clock() - self._started
        self.delete("all")
        mid = SIZE / 2
        for shape in frame(self._state, t, accent=self._accent, ground=self._ground):
            box = (mid - shape.radius, mid - shape.radius, mid + shape.radius, mid + shape.radius)
            if shape.width:
                self.create_oval(*box, outline=shape.color, width=shape.width)
            else:
                self.create_oval(*box, fill=shape.color, outline="")
        if animating(self._state, t):
            self._job = self.after(_FRAME_MS, self._tick)

    def destroy(self) -> None:
        if self._job is not None:
            self.after_cancel(self._job)
            self._job = None
        super().destroy()
