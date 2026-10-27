"""Shared fonts and colors for the GUI."""

import ctypes
import sys
from pathlib import Path

import customtkinter as ctk

_FONT_FILE = Path(__file__).parent.parent / "Programme-Regular.ttf"
if sys.platform == "win32" and _FONT_FILE.exists():
    ctypes.windll.gdi32.AddFontResourceExW(str(_FONT_FILE), 0x10, 0)  # FR_PRIVATE: this process only
FONT_FAMILY = "Programme Regular"  # the family name inside Programme-Regular.ttf


def font(size: int = 13, weight: str = "normal") -> ctk.CTkFont:
    return ctk.CTkFont(family=FONT_FAMILY, size=size, weight=weight)  # pyright: ignore[reportArgumentType]


BG = "#1f1f22"
SURFACE = "#26262b"
SURFACE_HI = "#2f2f36"
BORDER = "#3a3a42"
TEXT = "#ececf1"
MUTED = "#a1a1aa"
FAINT = "#71717a"
DONE = "#52525b"
ACCENT = "#4ade80"  # progress, success
ACCENT_DIM = "#1f3a2a"
FOCUS = "#1a2535"  # current row
DANGER = "#f87171"
DANGER_DIM = "#7f1d1d"
WARN = "#fbbf24"
