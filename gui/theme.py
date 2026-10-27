"""
Géniescraper look: the logo's yellow on black, with Genius's own typeface for display text.

Colors are tokens used by both the app code and the customtkinter widget theme, so
every button, switch and scrollbar follows the same palette without per-widget colors.
"""

import ctypes
import sys
from pathlib import Path

import customtkinter as ctk

_FONT_FILE = Path(__file__).parent.parent / "Programme-Regular.ttf"
if sys.platform == "win32" and _FONT_FILE.exists():
    ctypes.windll.gdi32.AddFontResourceExW(str(_FONT_FILE), 0x10, 0)  # FR_PRIVATE: this process only

# ── Color tokens ─────────────────────────────────────────────────────────
BG = "#0d0d0c"  # window: the logo's black, a touch warm
SURFACE = "#171715"  # cards, lists
SURFACE_HI = "#22221f"  # hover, inputs
BORDER = "#33322d"
TEXT = "#f4f3ee"
MUTED = "#a9a69b"
FAINT = "#7a776d"
DONE = "#4d4b44"  # finished steps
ACCENT = "#f3c003"  # the logo's yellow
ACCENT_HOVER = "#ffd124"
ACCENT_INK = "#0d0d0c"  # text on yellow
ACCENT_DIM = "#2b2408"  # yellow-tinted surface: chips that are on, the current step
FOCUS = ACCENT_DIM
DANGER = "#ff6f5e"
DANGER_DIM = "#3d1712"
DANGER_HOVER = "#56211a"
WARN = "#ffa94d"  # a link that cannot be scraped; kept apart from the accent

# ── Type ─────────────────────────────────────────────────────────────────
# Programme ships in one weight, so it is only used where regular weight reads well:
# titles and the big value being pasted. Interface text uses Segoe UI, whose
# Semibold is a real face rather than a synthesized bold.
DISPLAY_FAMILY = "Programme Regular"
UI_FAMILY = "Segoe UI"
UI_SEMIBOLD_FAMILY = "Segoe UI Semibold"
MONO_FAMILY = "Cascadia Mono"

# Kept for code that predates the split; it is the display face.
FONT_FAMILY = DISPLAY_FAMILY


def font(size: int = 13, weight: str = "normal") -> ctk.CTkFont:
    """Interface text. weight='bold' selects the real Semibold face."""
    family = UI_SEMIBOLD_FAMILY if weight == "bold" else UI_FAMILY
    return ctk.CTkFont(family=family, size=size)


def display(size: int) -> ctk.CTkFont:
    """Titles and the value about to be pasted, in Genius's typeface."""
    return ctk.CTkFont(family=DISPLAY_FAMILY, size=size)


def mono(size: int = 12) -> ctk.CTkFont:
    """Keys and counters, where fixed-width digits keep things from jumping."""
    return ctk.CTkFont(family=MONO_FAMILY, size=size)


def apply() -> None:
    """Install the palette as the customtkinter widget theme. Call before creating any widget."""
    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("blue")
    t = ctk.ThemeManager.theme

    def both(color: str) -> list[str]:
        return [color, color]

    t["CTk"]["fg_color"] = both(BG)
    t["CTkToplevel"]["fg_color"] = both(BG)
    t["CTkFrame"].update(fg_color=both(SURFACE), top_fg_color=both(SURFACE_HI), border_color=both(BORDER))
    t["CTkButton"].update(
        fg_color=both(ACCENT),
        hover_color=both(ACCENT_HOVER),
        border_color=both(BORDER),
        text_color=both(ACCENT_INK),
        text_color_disabled=both(FAINT),
    )
    t["CTkLabel"]["text_color"] = both(TEXT)
    t["CTkEntry"].update(
        fg_color=both(SURFACE_HI),
        border_color=both(BORDER),
        text_color=both(TEXT),
        placeholder_text_color=both(FAINT),
    )
    t["CTkCheckBox"].update(
        fg_color=both(ACCENT),
        hover_color=both(ACCENT_HOVER),
        border_color=both(MUTED),
        checkmark_color=both(ACCENT_INK),
        text_color=both(TEXT),
    )
    t["CTkSwitch"].update(
        fg_color=both(BORDER),
        progress_color=both(ACCENT),
        button_color=both(TEXT),
        button_hover_color=both("#ffffff"),
        text_color=both(TEXT),
    )
    t["CTkProgressBar"].update(fg_color=both(BORDER), progress_color=both(ACCENT))
    t["CTkSlider"].update(
        fg_color=both(BORDER),
        progress_color=both(ACCENT),
        button_color=both(ACCENT),
        button_hover_color=both(ACCENT_HOVER),
    )
    t["CTkOptionMenu"].update(
        fg_color=both(SURFACE_HI),
        button_color=both(BORDER),
        button_hover_color=both(FAINT),
        text_color=both(TEXT),
    )
    t["CTkScrollbar"].update(button_color=both(BORDER), button_hover_color=both(FAINT))
    t["CTkScrollableFrame"]["label_fg_color"] = both(SURFACE_HI)
    t["DropdownMenu"].update(fg_color=both(SURFACE_HI), hover_color=both(BORDER), text_color=both(TEXT))
    t["CTkFont"]["family"] = UI_FAMILY  # ThemeManager keeps only the current platform's font entry
