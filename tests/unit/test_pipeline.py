import pytest

from scraper import pipeline
from scraper.apple_music import AlbumTrackInfo
from scraper.models import SongCredits

URL = "https://music.apple.com/us/album/sour/1560734944"
APPLE = "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/02/ed/8c/a/21UMGIM26093.rgb.jpg/1000x1000bb.png"
WRONG_EDITION = "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/76/46/48/b/21UMGIM26093.rgb.jpg/1000x1000bb.png"
DEEZER = "https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.png"


@pytest.fixture
def lookups(monkeypatch):
    """Stub every network call the pipeline makes; tests set the Apple cover and the search covers."""
    state = {"apple": APPLE, "deezer": DEEZER, "itunes": WRONG_EDITION}

    async def detect_album(url):
        return AlbumTrackInfo(
            url=url, album_title="SOUR", artist="Olivia Rodrigo", track_count=11, cover_art_url=state["apple"]
        )

    async def scrape(url, *, track_index=1, track_title=""):
        return SongCredits(
            title=track_title, artist="Olivia Rodrigo", apple_music_url=url, credits=[], cover_art_url=state["apple"]
        )

    async def deezer_cover(title, artist):
        return state["deezer"]

    async def itunes_cover(title, artist):
        return state["itunes"]

    async def itunes_lookup_cover(url):
        return ""

    async def youtube_url(title, artist):
        return "https://www.youtube.com/watch?v=x", "lyric-video"

    monkeypatch.setattr(pipeline.apple_music, "detect_album", detect_album)
    monkeypatch.setattr(pipeline.apple_music, "scrape", scrape)
    monkeypatch.setattr(pipeline.deezer, "fetch_cover_url", deezer_cover)
    monkeypatch.setattr(pipeline.deezer, "fetch_itunes_cover_url", itunes_cover)
    monkeypatch.setattr(pipeline.deezer, "fetch_itunes_lookup_cover_url", itunes_lookup_cover)
    monkeypatch.setattr(pipeline.youtube, "fetch_youtube_url", youtube_url)
    return state


async def test_fetch_track_prefers_exact_apple_cover_over_title_search(lookups):
    """Title searches can return another edition (SOUR vs SOUR (Video Version)); Apple's id lookup cannot."""
    song = await pipeline.fetch_track(URL, 6, "good 4 u", "Olivia Rodrigo")
    assert song.cover_art_url == APPLE


async def test_fetch_track_falls_back_to_itunes_then_deezer_without_apple_cover(lookups):
    lookups["apple"] = ""
    song = await pipeline.fetch_track(URL, 6, "good 4 u", "Olivia Rodrigo")
    assert song.cover_art_url == WRONG_EDITION  # iTunes is the same catalog as Apple Music, so it goes first
    lookups["itunes"] = ""
    song = await pipeline.fetch_track(URL, 6, "good 4 u", "Olivia Rodrigo")
    assert song.cover_art_url == DEEZER


async def test_fetch_track_carries_the_kind_of_the_youtube_video(lookups):
    song = await pipeline.fetch_track(URL, 6, "good 4 u", "Olivia Rodrigo")
    assert (song.youtube_url, song.youtube_kind) == ("https://www.youtube.com/watch?v=x", "lyric-video")


async def test_detect_prefers_exact_apple_cover(lookups):
    info = await pipeline.detect(URL)
    assert info.cover_art_url == APPLE


async def test_detect_falls_back_to_itunes_then_deezer_without_apple_cover(lookups):
    lookups["apple"] = ""
    info = await pipeline.detect(URL)
    assert info.cover_art_url == WRONG_EDITION
    lookups["itunes"] = ""
    info = await pipeline.detect(URL)
    assert info.cover_art_url == DEEZER


async def test_deezer_is_not_asked_when_the_setting_is_off(lookups, monkeypatch):
    monkeypatch.setattr(pipeline.settings, "deezer_covers", False)
    lookups["apple"] = ""
    lookups["itunes"] = ""
    song = await pipeline.fetch_track(URL, 6, "good 4 u", "Olivia Rodrigo")
    assert song.cover_art_url == ""  # only Deezer had one
    lookups["itunes"] = WRONG_EDITION
    song = await pipeline.fetch_track(URL, 6, "good 4 u", "Olivia Rodrigo")
    assert song.cover_art_url == WRONG_EDITION  # the iTunes search still runs


async def test_youtube_is_not_searched_when_the_setting_is_off(lookups, monkeypatch):
    asked: list[str] = []

    async def youtube_url(title, artist):
        asked.append(title)
        return "https://www.youtube.com/watch?v=x", "lyric-video"

    monkeypatch.setattr(pipeline.youtube, "fetch_youtube_url", youtube_url)
    monkeypatch.setattr(pipeline.settings, "find_youtube", False)
    song = await pipeline.fetch_track(URL, 6, "good 4 u", "Olivia Rodrigo")
    assert asked == []
    assert (song.youtube_url, song.youtube_kind) == ("", None)
    monkeypatch.setattr(pipeline.settings, "find_youtube", True)
    song = await pipeline.fetch_track(URL, 6, "good 4 u", "Olivia Rodrigo")
    assert asked and song.youtube_url
