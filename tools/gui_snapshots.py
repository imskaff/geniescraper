"""
Screenshot every GUI screen with sample data, for visual review of UI changes.

    uv run python -m tools.gui_snapshots out/dir

Opens the real App window (Windows only), drives it into each screen with the
golden HMHAS track, and saves one PNG per screen. Global keyboard hooks, the
.env file and the network are stubbed, so it never touches the user's settings,
keys or Apple Music.
"""

import sys
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import keyboard
from PIL import Image, ImageDraw, ImageGrab

from bench.cases import load_golden
from scraper.apple_music import AlbumTrackInfo
from utils import config

TRACKS = [
    "SKINNY", "LUNCH", "CHIHIRO", "BIRDS OF A FEATHER", "WILDFLOWER",
    "THE GREATEST", "L'AMOUR DE MA VIE", "THE DINER", "BITTERSUITE", "BLUE",
]  # fmt: skip


@contextmanager
def _stubbed_side_effects() -> Iterator[None]:
    """Stub keyboard hooks and settings writes for the duration of the walk, then restore them."""
    stubs = [
        (keyboard, "hook_key", lambda *a, **k: object()),
        (keyboard, "on_press", lambda *a, **k: object()),
        (keyboard, "unhook", lambda *a, **k: None),
        (keyboard, "wait", lambda *a, **k: threading.Event().wait()),
        (config.Settings, "save", lambda self: None),
    ]
    originals = [(obj, name, getattr(obj, name)) for obj, name, _ in stubs]
    saved_settings = config.settings.model_dump()
    for obj, name, stub in stubs:
        setattr(obj, name, stub)
    try:
        yield
    finally:
        for obj, name, original in originals:
            setattr(obj, name, original)
        for key, value in saved_settings.items():
            setattr(config.settings, key, value)


def _cover() -> Image.Image:
    img = Image.new("RGB", (600, 600), "#1d4e89")
    draw = ImageDraw.Draw(img)
    for y in range(600):
        draw.line([(0, y), (600, y)], fill=(29 + y // 12, 78 - y // 20, 137 - y // 10))
    return img


def walk_screens(on_screen: Callable[[Any, str], None]) -> None:
    """Open the App and drive it through every screen, calling on_screen(app, name) on each."""
    with _stubbed_side_effects():
        _walk(on_screen)


def _walk(on_screen: Callable[[Any, str], None]) -> None:
    from gui.app import App

    song = load_golden("eilish-hmhas-t3").model_copy(
        update={"youtube_url": "https://www.youtube.com/watch?v=example", "youtube_is_mv": True}
    )
    album = AlbumTrackInfo(
        url="https://music.apple.com/us/album/hit-me-hard-and-soft/1739659134",
        album_title="HIT ME HARD AND SOFT",
        artist="Billie Eilish",
        track_count=len(TRACKS),
        track_titles=TRACKS,
        cover_art_url=song.cover_art_url,
    )
    errors: list[BaseException] = []
    app = App()
    app.report_callback_exception = lambda exc, val, tb: errors.append(val)

    def screen(name: str, window: Any = None) -> None:
        for _ in range(5):
            app.update()
            time.sleep(0.05)
        if errors:
            raise RuntimeError(f"Tk callback failed on {name}") from errors[0]
        on_screen(window or app, name)

    try:
        screen("01-start")
        app._url_entry.insert(0, album.url)
        screen("02-start-url")
        app._scrape_error("Page not found. Check the URL and try again.")
        screen("03-start-error")

        app._open_settings()
        settings_win = app._settings_win
        assert settings_win is not None
        time.sleep(0.3)  # the window grabs focus after 100 ms
        screen("04-settings", settings_win)
        settings_win.close()

        app._album_info, app._album_cover_image = album, _cover()
        app._show_track_select_screen()
        app._track_vars[2].set(True)
        app._update_selection_btn()
        screen("05-tracks")

        app._is_album_queue_mode = True
        app._album_queue_position, app._album_queue_total = 1, 1
        app._scrape_track_thread = lambda url, track_index, track_title, job=None: None  # keep loading up, offline
        app._on_track_selected(3, "CHIHIRO")
        screen("06-loading")

        app._song, app._cover_image = song, _cover()
        app._show_credits_screen()
        screen("07-credits")

        app._clear_kb_hooks()
        app._show_assistant_screen()
        screen("08-assistant-start")
        app._pos = 21
        app._render_assistant()
        screen("09-assistant-middle")
        app._show_esc_confirm()
        screen("10-esc-confirm")

        config.settings.compact_mode = True
        app._show_assistant_screen()
        app._pos = 1
        app._render_assistant()
        screen("11-assistant-compact")
        config.settings.compact_mode = False

        app._show_done_screen()
        screen("12-done")
    finally:
        app._in_countdown = False
        app._credits_in_countdown = False
        app.quit()
        app.update()
        tk_destroy(app)
        app._loop.call_soon_threadsafe(app._loop.stop)  # the app's background asyncio thread


def tk_destroy(app: Any) -> None:
    """Close the window without App.destroy, which saves settings and closes the browser."""
    import customtkinter as ctk

    ctk.CTk.destroy(app)


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    def shot(app: Any, name: str) -> None:
        app.attributes("-topmost", True)
        app.lift()
        app.update()
        x, y = app.winfo_rootx(), app.winfo_rooty()
        bbox = (x, y, x + app.winfo_width(), y + app.winfo_height())
        ImageGrab.grab(bbox=bbox, all_screens=True).save(out / f"{name}.png")
        print("saved", name)

    walk_screens(shot)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "gui-snapshots")
