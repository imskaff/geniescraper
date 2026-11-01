"""Direct song-page reading: per-row song links from saved album pages, and the credits of a saved song page."""

import pytest

from bench.cases import credit_map, load_cases, load_golden
from scraper import apple_music as am
from scraper.models import SongCredits

pytestmark = pytest.mark.browser

ALBUM_CASES = [c for c in load_cases() if "/album/" in c.url]


@pytest.mark.parametrize("case", ALBUM_CASES, ids=lambda c: c.id)
async def test_row_link_of_golden_track_is_its_song_page(case, load_fixture):
    page = await load_fixture(f"{case.id}.page.html")
    links = await am._extract_song_links(page)
    link = links[case.track_index - 1]
    assert "/song/" in link
    assert am.catalog_id(link)[0] != am.catalog_id(case.url)[0]  # a song id, not the album id


async def test_rows_without_a_song_link_are_empty_strings(load_fixture):
    eilish = await am._extract_song_links(await load_fixture("eilish-hmhas-t3.page.html"))
    assert len(eilish) == 11 and all(eilish[:10]) and eilish[10] == ""
    swift = await am._extract_song_links(await load_fixture("swift-ttpd-t1.page.html"))
    assert len(swift) == 17 and all(swift[:16]) and swift[16] == ""


async def test_song_page_has_no_rows(load_fixture):
    assert await am._extract_song_links(await load_fixture("kendrick-nlu-song.page.html")) == []


@pytest.mark.parametrize("case", ALBUM_CASES, ids=lambda c: c.id)
async def test_credits_of_song_page_match_golden(case, load_fixture):
    """The saved *.credits.html is the song page the direct path reads; strategy 0 alone must reproduce the golden."""
    page = await load_fixture(f"{case.id}.credits.html")
    credits = await am._parse_credits_page(page, strategy_0_only=True)
    actual = SongCredits(title="", artist="", apple_music_url=case.url, credits=credits)
    assert credit_map(actual) == credit_map(load_golden(case.id))


def test_pick_song_link():
    links = ["https://music.apple.com/us/song/a/1", "", "https://music.apple.com/us/song/c/3"]
    assert am.pick_song_link(links, 1) == "https://music.apple.com/us/song/a/1"
    assert am.pick_song_link(links, 3) == "https://music.apple.com/us/song/c/3"
    for bad in (2, 4, 0):
        with pytest.raises(am.TrackUnavailableError):
            am.pick_song_link(links, bad)


@pytest.mark.parametrize(
    ("env", "default", "expected"),
    [("", False, False), ("click", True, False), ("direct", False, True), ("DIRECT", False, True), ("", True, True)],
)
def test_direct_mode_selection(env, default, expected, monkeypatch):
    monkeypatch.setenv("GENIESCRAPER_CREDITS_PATH", env)
    monkeypatch.setattr(am, "DIRECT_DEFAULT", default)
    assert am.use_direct_song_pages() is expected


def test_explicit_argument_beats_env(monkeypatch):
    monkeypatch.setenv("GENIESCRAPER_CREDITS_PATH", "click")
    assert am.use_direct_song_pages(True) is True
    monkeypatch.setenv("GENIESCRAPER_CREDITS_PATH", "direct")
    assert am.use_direct_song_pages(False) is False


def test_direct_is_the_default(monkeypatch):
    monkeypatch.delenv("GENIESCRAPER_CREDITS_PATH", raising=False)
    assert am.use_direct_song_pages() is True


@pytest.mark.parametrize("case", ALBUM_CASES, ids=lambda c: c.id)
async def test_catalog_page_snapshot_matches_golden(case, load_fixture):
    """One read of the saved album page yields what scrape() needs from it, ready for every track."""
    golden = load_golden(case.id)
    snap = await am._read_catalog_page(await load_fixture(f"{case.id}.page.html"), case.url)
    assert am._pick_row_title(snap.row_titles, case.track_index) == golden.title
    assert snap.artist == golden.artist
    assert (snap.phonographic_copyright, snap.copyright_notice) == (
        golden.phonographic_copyright,
        golden.copyright_notice,
    )
    assert "/song/" in snap.song_links[case.track_index - 1]


def _snapshot(links=("https://music.apple.com/us/song/a/1",)):
    return am._CatalogPage("Album", "Artist", ("A",), links, "", "", "", "2020-01-01")


def test_remember_album_skips_pages_without_tracklist():
    am._ALBUM_CACHE.clear()
    am._remember_album("https://music.apple.com/us/album/x/1", _snapshot(links=()))
    assert am._ALBUM_CACHE == {}


def test_remember_album_is_bounded_and_drops_the_oldest():
    am._ALBUM_CACHE.clear()
    for i in range(am._ALBUM_CACHE_MAX + 2):
        am._remember_album(f"https://music.apple.com/us/album/x/{i}", _snapshot())
    assert len(am._ALBUM_CACHE) == am._ALBUM_CACHE_MAX
    assert "https://music.apple.com/us/album/x/0" not in am._ALBUM_CACHE
    am._ALBUM_CACHE.clear()


class _FakeContext:
    async def close(self):
        pass


async def test_cached_album_is_not_loaded_again(monkeypatch):
    """With the album remembered, a track opens its song page only: no album page load per track."""
    album_url = "https://music.apple.com/us/album/x/1"
    song_url = "https://music.apple.com/us/song/a/1"
    am._ALBUM_CACHE.clear()
    am._remember_album(album_url, _snapshot(links=(song_url,)))
    opened: list[str] = []

    async def fake_open(page, url):
        opened.append(url)

    async def fake_page():
        return _FakeContext(), object()

    async def fake_parse(page, *, strategy_0_only=False):
        return [am.Credit(role="Songwriter", artists=["Someone"])]

    async def no_date(page):
        return ""

    async def no_cover(url):
        return ""

    monkeypatch.setattr(am, "_open", fake_open)
    monkeypatch.setattr(am, "_new_stealth_page", fake_page)
    monkeypatch.setattr(am, "_parse_credits_page", fake_parse)
    monkeypatch.setattr(am, "_extract_release_date", no_date)
    monkeypatch.setattr(am, "_lookup_cover_url", no_cover)

    song = await am.scrape(album_url, track_index=1, direct=True)

    assert opened == [song_url]
    assert (song.title, song.artist, song.release_date) == ("A", "Artist", "2020-01-01")
    am._ALBUM_CACHE.clear()
