import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


_ENV_PATH = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_PATH), env_file_encoding="utf-8")

    hotkey: str = "f8"
    back_hotkey: str = "f7"
    typing_delay: float = 0.04
    autocomplete_wait: float = 0.6

    # Scrape feature toggles
    scrape_core: bool = True          # Songwriters & producers
    scrape_additional: bool = True    # Additional credits (roles beyond core)
    scrape_copyright: bool = True     # ℗ and ©
    scrape_youtube: bool = True       # YouTube URL
    scrape_cover_art: bool = True     # Cover art URL

    # Assistant behavior
    compact_mode: bool = False        # Hide queue list and shrink window during scraping
    auto_enter: bool = True           # Press Enter after pasting to confirm autocomplete
    auto_start_assistant: bool = False # Auto-start assistant after countdown on credits screen
    auto_start_delay: int = 15        # Seconds before auto-starting assistant
    auto_tab: bool = False            # Auto-press Tab after role/artist to navigate Genius fields

    # Window position (-1 = not yet saved, use default centering)
    win_x: int = -1
    win_y: int = -1

    def save(self) -> None:
        """Persist current settings back to .env file."""
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
            "# Delay after typing before pressing Down+Enter to select from dropdown (seconds)",
            f"AUTOCOMPLETE_WAIT={self.autocomplete_wait}",
            "",
            "# Scrape feature toggles (true/false)",
            f"SCRAPE_CORE={str(self.scrape_core).lower()}",
            f"SCRAPE_ADDITIONAL={str(self.scrape_additional).lower()}",
            f"SCRAPE_COPYRIGHT={str(self.scrape_copyright).lower()}",
            f"SCRAPE_YOUTUBE={str(self.scrape_youtube).lower()}",
            f"SCRAPE_COVER_ART={str(self.scrape_cover_art).lower()}",
            "",
            "# Assistant behavior",
            f"COMPACT_MODE={str(self.compact_mode).lower()}",
            f"AUTO_ENTER={str(self.auto_enter).lower()}",
            f"AUTO_START_ASSISTANT={str(self.auto_start_assistant).lower()}",
            f"AUTO_START_DELAY={self.auto_start_delay}",
            f"AUTO_TAB={str(self.auto_tab).lower()}",
            "",
            "# Last window position (set automatically on close)",
            f"WIN_X={self.win_x}",
            f"WIN_Y={self.win_y}",
        ]
        _ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


settings = Settings()
