"""
End-to-end fetch pipeline shared by the GUI, tests and benchmarks.

Combines the Apple Music scrape with the best-effort Deezer/iTunes cover art
and YouTube lookups, running them concurrently.
"""

import asyncio

from scraper import apple_music, deezer, youtube
from scraper.apple_music import AlbumTrackInfo
from scraper.models import SongCredits


async def detect(url: str) -> AlbumTrackInfo:
    """Detect album/track info and upgrade the cover URL via Deezer/iTunes when possible."""
    info = await apple_music.detect_album(url)
    if not (info.album_title and info.artist):
        return info
    deezer_cover, itunes_cover = await asyncio.gather(
        deezer.fetch_cover_url(info.album_title, info.artist),
        deezer.fetch_itunes_cover_url(info.album_title, info.artist),
    )
    cover_url = deezer_cover or itunes_cover or info.cover_art_url
    if cover_url == info.cover_art_url:
        return info
    return AlbumTrackInfo(
        url=info.url,
        album_title=info.album_title,
        artist=info.artist,
        track_count=info.track_count,
        track_titles=info.track_titles,
        cover_art_url=cover_url,
    )


async def fetch_cover(url: str, title: str, artist: str) -> str:
    """Best-effort 1000x1000 PNG cover for a track, or '' when no source has one."""
    deezer_cover, itunes_cover = await asyncio.gather(
        deezer.fetch_cover_url(title, artist),
        deezer.fetch_itunes_cover_url(title, artist),
    )
    return deezer_cover or itunes_cover


async def fetch_track(url: str, track_index: int, track_title: str, artist: str) -> SongCredits:
    """Full scrape pipeline: Apple Music + Deezer + YouTube, all concurrent.

    The returned SongCredits carries the best cover URL found and the YouTube link.
    """
    search_title = track_title or "Unknown"
    scrape_task = asyncio.create_task(apple_music.scrape(url, track_index=track_index, track_title=track_title))
    if artist and search_title != "Unknown":
        cover_task = asyncio.create_task(fetch_cover(url, search_title, artist))
        youtube_task = asyncio.create_task(youtube.fetch_youtube_url(search_title, artist))
        song, cover_url, yt_result = await asyncio.gather(scrape_task, cover_task, youtube_task)
        yt_url, yt_is_mv = yt_result
    else:
        song = await scrape_task
        cover_url, yt_url, yt_is_mv = "", "", False

    yt_title = song.title or search_title
    yt_artist = song.artist or artist
    if not yt_url and yt_title and yt_artist and yt_title != "Unknown":
        try:
            yt_url, yt_is_mv = await youtube.fetch_youtube_url(yt_title, yt_artist)
        except Exception:
            pass

    if not cover_url and song.title and song.artist:
        try:
            cover_url = await fetch_cover(url, song.title, song.artist)
        except Exception:
            pass

    cover_url = cover_url or song.cover_art_url
    return song.model_copy(update={"cover_art_url": cover_url, "youtube_url": yt_url, "youtube_is_mv": yt_is_mv})
