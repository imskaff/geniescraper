import asyncio
import io
import threading

import httpx
from PIL import Image as PILImage

from gui import theme
from gui.chrome import ChromeMixin
from gui.logic import (
    friendly_error,
    prefetch_plan,
)
from scraper import pipeline
from scraper.apple_music import AlbumTrackInfo
from scraper.models import SongCredits
from utils.config import settings


class QueueControllerMixin(ChromeMixin):
    """Fetching songs and the album queue: scrape threads, stale-job checks and the read-ahead cache."""

    @staticmethod
    def _download_cover(url: str) -> PILImage.Image | None:
        if not url:
            return None
        try:
            resp = httpx.get(url, timeout=8.0)
            resp.raise_for_status()
            return PILImage.open(io.BytesIO(resp.content))
        except (httpx.HTTPError, OSError):
            return None

    def _scrape_track_thread(self, url: str, track_index: int, track_title: str, job: int | None = None) -> None:
        job = self._job if job is None else job
        try:
            artist = self._album_info.artist if self._album_info else ""
            song = asyncio.run_coroutine_threadsafe(
                pipeline.fetch_track(url, track_index, track_title, artist), self._loop
            ).result()
            cover_image = self._download_cover(song.cover_art_url) or getattr(self, "_album_cover_image", None)
            self.after(0, self._scrape_done, song, cover_image, job)
        except Exception as exc:
            self.after(0, self._scrape_error, str(exc), job)

    def _scrape_done(self, song: SongCredits, cover_image: PILImage.Image | None, job: int | None = None) -> None:
        if job is not None and job != self._job:
            return
        self._song = song
        self._cover_image = cover_image
        self._show_credits_screen()

    def _scrape_error(self, message: str, job: int | None = None) -> None:
        if job is not None and job != self._job:
            return
        self._is_album_queue_mode = False
        self._album_queue_pending = []
        self._album_queue_current = 0
        self._album_queue_position = 0
        self._album_queue_total = 0
        with self._prefetch_cache_lock:
            self._prefetch_cache.clear()
        if self._screen != "start":
            if self._album_info is not None and self._album_info.track_count > 1:
                self._show_track_select_screen()
            else:
                self._show_scrape_screen()
        self._set_busy(False)
        if self._screen == "start":
            self._status_lbl.configure(text=friendly_error(message), text_color=theme.DANGER)
        else:
            self._toast(friendly_error(message), error=True)

    def _detect_thread(self, url: str, job: int) -> None:
        try:
            info = asyncio.run_coroutine_threadsafe(pipeline.detect(url), self._loop).result()
            cover_image = self._download_cover(info.cover_art_url)
            self.after(0, self._detect_done, info, cover_image, job)
        except Exception as exc:
            self.after(0, self._scrape_error, str(exc), job)

    def _detect_done(self, info: AlbumTrackInfo, cover_image: PILImage.Image | None = None, job: int = 0) -> None:
        if job != self._job:
            return
        # Always store so _scrape_track_thread can access artist + cover fallback
        self._album_info = info
        self._album_cover_image = cover_image
        if info.track_count <= 1:
            self._status_lbl.configure(text="Reading the credits…")
            threading.Thread(
                target=self._scrape_track_thread,
                args=(info.url, 1, info.album_title, job),
                daemon=True,
            ).start()
        else:
            self._show_track_select_screen()

    def _start_selected_queue(self) -> None:
        info = self._album_info
        assert info is not None
        selected = [
            (i + 1, title)
            for i, (title, var) in enumerate(zip(info.track_titles, self._track_vars, strict=False))
            if var.get()
        ]
        if not selected:
            return
        self._is_album_queue_mode = True
        self._album_queue_total = len(selected)
        self._album_queue_position = 1
        self._album_queue_pending = selected[:]
        track_index, track_title = self._album_queue_pending.pop(0)
        self._album_queue_current = track_index
        self._on_track_selected(track_index, track_title)
        self._prefetch_tracks(2)

    def _start_album_queue(self) -> None:
        info = self._album_info
        assert info is not None
        self._is_album_queue_mode = True
        self._album_queue_total = info.track_count
        self._album_queue_position = 1
        self._album_queue_pending = [(i + 1, title) for i, title in enumerate(info.track_titles)]
        track_index, track_title = self._album_queue_pending.pop(0)
        self._album_queue_current = track_index
        self._on_track_selected(track_index, track_title)
        self._prefetch_tracks(2)

    def _on_track_selected(self, track_index: int, track_title: str) -> None:
        with self._prefetch_cache_lock:
            cached = self._prefetch_cache.pop(track_index, None)
        if cached is not None:
            self._clear()
            self.after(0, self._scrape_done, *cached)
            return

        album_info = self._album_info
        assert album_info is not None
        self._show_loading_screen(track_title)
        threading.Thread(
            target=self._scrape_track_thread,
            args=(album_info.url, track_index, track_title, self._job),
            daemon=True,
        ).start()

    def _advance_album_queue(self) -> None:
        self.link.end_run()
        self._clear_kb_hooks()
        self.geometry("620x700")
        if not self._album_queue_pending:
            self._is_album_queue_mode = False
            self._show_done_screen()
            return
        track_index, track_title = self._album_queue_pending.pop(0)
        self._album_queue_current = track_index
        self._album_queue_position += 1
        self._song = None
        self._cover_image = None
        self._queue = []
        self._pos = 0
        self._on_track_selected(track_index, track_title)
        self._prefetch_tracks(2)

    def _prefetch_tracks(self, n: int = 2) -> None:
        if not self._is_album_queue_mode or self._album_info is None:
            return
        # "Parallel reads" in the settings: how many tracks are read at once, and so how many are started ahead.
        limit, lookahead = prefetch_plan(settings.parallel_reads)
        if limit != self._prefetch_limit:
            # Reads already running keep the semaphore they took, so a change never frees or blocks them wrongly.
            self._prefetch_limit = limit
            self._prefetch_semaphore = threading.Semaphore(limit)
        n = max(n, lookahead)
        semaphore = self._prefetch_semaphore
        with self._prefetch_cache_lock:
            cached = set(self._prefetch_cache)
            running = set(self._prefetch_running)
        count = 0
        for track_index, track_title in self._album_queue_pending:
            if count >= n:
                break
            if track_index in cached:
                continue
            count += 1
            if track_index in running:  # already on its way: reading it twice at once would only double the requests
                continue
            with self._prefetch_cache_lock:
                self._prefetch_running.add(track_index)
            threading.Thread(
                target=self._prefetch_worker,
                args=(track_index, track_title, semaphore),
                daemon=True,
            ).start()

    def _prefetch_worker(self, track_index: int, track_title: str, semaphore: threading.Semaphore) -> None:
        album_info = self._album_info
        if album_info is None:
            with self._prefetch_cache_lock:
                self._prefetch_running.discard(track_index)
            return
        url, artist = album_info.url, album_info.artist

        if not semaphore.acquire(timeout=120):
            with self._prefetch_cache_lock:
                self._prefetch_running.discard(track_index)
            return
        try:
            with self._prefetch_cache_lock:
                if track_index in self._prefetch_cache:
                    return

            song = asyncio.run_coroutine_threadsafe(
                pipeline.fetch_track(url, track_index, track_title, artist),
                self._loop,
            ).result()
            cover_url = song.cover_art_url

            cover_image: PILImage.Image | None = None
            if cover_url:
                try:
                    resp = httpx.get(cover_url, timeout=8.0)
                    cover_image = PILImage.open(io.BytesIO(resp.content))
                except Exception:
                    pass
            if cover_image is None:
                cover_image = getattr(self, "_album_cover_image", None)

            with self._prefetch_cache_lock:
                self._prefetch_cache[track_index] = (song, cover_image)
        except Exception:
            pass
        finally:
            with self._prefetch_cache_lock:
                self._prefetch_running.discard(track_index)
            semaphore.release()
