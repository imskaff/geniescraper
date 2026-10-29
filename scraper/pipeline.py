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
    """Detect album/track info; fall back to catalog lookup and title search when Apple has no cover.

    Apple's cover comes from a lookup by catalog id and is exact; title searches can return
    another edition of the album (for example SOUR vs SOUR (Video Version)).
    """
    info = await apple_music.detect_album(url)
    if info.cover_art_url or not (info.album_title and info.artist):
        return info
    cover_url = await fetch_cover(url, info.album_title, info.artist)
    if not cover_url:
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
    """Best-effort 1000x1000 PNG cover for an album or track, or '' when no source has one.

    The iTunes lookup of the URL's catalog ID returns the artwork of exactly the
    release the user opened. Only without it do the title searches run: iTunes
    first, being the same catalog as Apple Music, then Deezer.
    """
    exact = await deezer.fetch_itunes_lookup_cover_url(url)
    if exact:
        return exact
    itunes_cover, deezer_cover = await asyncio.gather(
        deezer.fetch_itunes_cover_url(title, artist),
        deezer.fetch_cover_url(title, artist),
    )
    return itunes_cover or deezer_cover


async def fetch_track(url: str, track_index: int, track_title: str, artist: str) -> SongCredits:
    """Full scrape pipeline: Apple Music + Deezer + YouTube, all concurrent.

    The returned SongCredits carries the best cover URL found and the YouTube link:
    Apple's exact cover first, then the Deezer/iTunes title-search results.
    """
    search_title = track_title or "Unknown"
    scrape_task = asyncio.create_task(apple_music.scrape(url, track_index=track_index, track_title=track_title))
    if artist and search_title != "Unknown":
        cover_task = asyncio.create_task(fetch_cover(url, search_title, artist))
        youtube_task = asyncio.create_task(youtube.fetch_youtube_url(search_title, artist))
        song, cover_url, yt_result = await asyncio.gather(scrape_task, cover_task, youtube_task)
        yt_url, yt_kind = yt_result
    else:
        song = await scrape_task
        cover_url, yt_url, yt_kind = "", "", None

    yt_title = song.title or search_title
    yt_artist = song.artist or artist
    if not yt_url and yt_title and yt_artist and yt_title != "Unknown":
        try:
            yt_url, yt_kind = await youtube.fetch_youtube_url(yt_title, yt_artist)
        except Exception:
            pass

    if not song.cover_art_url and not cover_url and song.title and song.artist:
        try:
            cover_url = await fetch_cover(url, song.title, song.artist)
        except Exception:
            pass

    cover_url = song.cover_art_url or cover_url
    return song.model_copy(update={"cover_art_url": cover_url, "youtube_url": yt_url, "youtube_kind": yt_kind})
