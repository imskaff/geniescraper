import os
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def settings_path(appdata: str | None = None) -> Path:
    """Per-user settings file, shared by every copy of the app (checkout, worktree, release)."""
    base = appdata or os.environ.get("APPDATA") or str(Path.home())
    return Path(base) / "Geniescraper" / "settings.env"


# Before v0.5 settings lived in a .env next to the code, so each checkout had its own.
# It is still read (the per-user file wins) so existing settings carry over until the first save.
_LEGACY_ENV_PATH = Path(__file__).parent.parent / ".env"
_ENV_PATH = settings_path()


# Tracks read at once, as the extension offers them; 0 is all of them.
PARALLEL_CHOICES = (1, 2, 3, 5, 0)
PARALLEL_DEFAULT = 3  # the extension's default too


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(_LEGACY_ENV_PATH), str(_ENV_PATH)), env_file_encoding="utf-8", extra="ignore"
    )

    hotkey: str = "f8"
    back_hotkey: str = "f7"
    typing_delay: float = 0.04
    autocomplete_wait: float = 0.6

    # Scrape feature toggles
    scrape_core: bool = True  # Songwriters & producers
    scrape_additional: bool = True  # Additional credits (roles beyond core)
    scrape_copyright: bool = True  # ℗ and ©
    scrape_youtube: bool = True  # YouTube URL
    scrape_cover_art: bool = True  # Cover art URL
    scrape_release_date: bool = True  # Release date (month, day and year dropdowns)

    # Look-ups on other sites, as in the extension's Settings
    find_youtube: bool = True  # Search YouTube for each track's link
    deezer_covers: bool = True  # Search Deezer for a cover when Apple has none

    # Assistant behavior. Old files may still hold AUTO_TAB and AUTO_ENTER: both are ignored, the hotkeys always do both.
    compact_mode: bool = False  # Hide queue list and shrink window during scraping
    auto_start_assistant: bool = False  # Auto-start assistant after countdown on credits screen
    auto_start_delay: int = 15  # Seconds before auto-starting assistant
    always_on_top: bool = True  # Keep the window above the browser while pasting

    # Tracks of an album read at once while the one before is being pasted: 1 (the default), 2, 3, 5 or 0 for all
    parallel_reads: int = PARALLEL_DEFAULT

    # Companion link to the browser extension (assistant/bridge.py). The secret is written to this file only,
    # never logged or printed: repr=False keeps it out of repr(settings) and out of tracebacks.
    bridge_secret: str = Field(default="", repr=False)
    bridge_origin: str = ""  # the extension id it was paired with (trust on first use)
    link_mode: str = "auto"  # how the extension fills a run the desktop starts: "auto" (default) or "manual"

    # Window position (-1 = not yet saved, use default centering)
    win_x: int = -1
    win_y: int = -1

    @field_validator("parallel_reads", mode="before")
    @classmethod
    def _parallel_reads_choice(cls, value: object) -> int:
        """Only the choices the settings window offers; anything else is the default."""
        try:
            reads = int(str(value))
        except ValueError:
            return PARALLEL_DEFAULT
        return reads if reads in PARALLEL_CHOICES else PARALLEL_DEFAULT

    @field_validator("link_mode", mode="before")
    @classmethod
    def _link_mode_choice(cls, value: object) -> str:
        return "manual" if str(value).strip().lower() == "manual" else "auto"

    def save(self) -> None:
        """Persist current settings to the per-user settings file."""
        lines = [
            "# Hotkey to trigger next paste (default: f8)",
            f"HOTKEY={self.hotkey}",
            "",
            "# Hotkey to go back one step (default: f7)",
            f"BACK_HOTKEY={self.back_hotkey}",
            "",
            "# Delay between keystrokes when typing into autocomplete fields (seconds)",
            "# Increase if autocomplete is slow to respond",
            f"TYPING_DELAY={self.typing_delay}",
            "",
            "# How long the hotkeys wait for Genius's suggestions before pressing Enter (seconds)",
            f"AUTOCOMPLETE_WAIT={self.autocomplete_wait}",
            "",
            "# Scrape feature toggles (true/false)",
            f"SCRAPE_CORE={str(self.scrape_core).lower()}",
            f"SCRAPE_ADDITIONAL={str(self.scrape_additional).lower()}",
            f"SCRAPE_COPYRIGHT={str(self.scrape_copyright).lower()}",
            f"SCRAPE_YOUTUBE={str(self.scrape_youtube).lower()}",
            f"SCRAPE_COVER_ART={str(self.scrape_cover_art).lower()}",
            f"SCRAPE_RELEASE_DATE={str(self.scrape_release_date).lower()}",
            "",
            "# Look-ups on other sites (true/false)",
            f"FIND_YOUTUBE={str(self.find_youtube).lower()}",
            f"DEEZER_COVERS={str(self.deezer_covers).lower()}",
            "",
            "# Assistant behavior",
            f"COMPACT_MODE={str(self.compact_mode).lower()}",
            f"AUTO_START_ASSISTANT={str(self.auto_start_assistant).lower()}",
            f"AUTO_START_DELAY={self.auto_start_delay}",
            f"ALWAYS_ON_TOP={str(self.always_on_top).lower()}",
            "",
            "# Album tracks read at once while pasting: 1, 2, 3, 5, or 0 for all",
            f"PARALLEL_READS={self.parallel_reads}",
            "",
            "# Companion link to the browser extension. BRIDGE_SECRET is a password: do not share this file.",
            "# Use Forget in Settings to remove the pairing.",
            f"BRIDGE_SECRET={self.bridge_secret}",
            f"BRIDGE_ORIGIN={self.bridge_origin}",
            f"LINK_MODE={self.link_mode}",
            "",
            "# Last window position (set automatically on close)",
            f"WIN_X={self.win_x}",
            f"WIN_Y={self.win_y}",
        ]
        _ENV_PATH.parent.mkdir(parents=True, exist_ok=True)
        _ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


settings = Settings()
