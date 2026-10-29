"""
Run the real page parsers against saved Apple Music HTML (tests/fixtures, from bench.capture).

Catches selector and parsing regressions without network access. Refresh fixtures with
`uv run python -m bench.capture` when Apple changes its markup.
"""

import pytest

from bench.cases import artwork_key, credit_map, load_cases, load_golden
from scraper import apple_music as am
from scraper.models import SongCredits

pytestmark = pytest.mark.browser

CASES = load_cases()
ALBUM_CASES = [c for c in CASES if "/album/" in c.url]
SONG_CASES = [c for c in CASES if "/song/" in c.url]


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.id)
async def test_credits_parse_matches_golden(case, load_fixture):
    page = await load_fixture(f"{case.id}.credits.html")
    credits = await am._parse_credits_page(page, strategy_0_only="/song/" in case.url)
    actual = SongCredits(title="", artist="", apple_music_url=case.url, credits=credits)
    assert credit_map(actual) == credit_map(load_golden(case.id))


@pytest.mark.parametrize("case", ALBUM_CASES, ids=lambda c: c.id)
async def test_copyright_matches_golden(case, load_fixture):
    page = await load_fixture(f"{case.id}.page.html")
    golden = load_golden(case.id)
    assert await am._extract_copyright(page) == (golden.phonographic_copyright, golden.copyright_notice)


@pytest.mark.parametrize("case", ALBUM_CASES, ids=lambda c: c.id)
async def test_album_artist_from_title(case, load_fixture):
    page = await load_fixture(f"{case.id}.page.html")
    _, artist = am._extract_title_artist(await page.title())
    assert artist == load_golden(case.id).artist


@pytest.mark.parametrize("case", SONG_CASES, ids=lambda c: c.id)
async def test_song_title_artist_from_title(case, load_fixture):
    page = await load_fixture(f"{case.id}.page.html")
    golden = load_golden(case.id)
    assert am._extract_title_artist(await page.title()) == (golden.title, golden.artist)


@pytest.mark.parametrize("case", ALBUM_CASES, ids=lambda c: c.id)
async def test_album_track_title(case, load_fixture):
    page = await load_fixture(f"{case.id}.page.html")
    assert await am._extract_track_title(page, case.track_index) == load_golden(case.id).title


# Albums whose page header shows only motion artwork and an editorial still, never the album artwork.
HEADER_WITHOUT_ARTWORK = {"rodrigo-sour-t6"}


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.id)
async def test_cover_from_page(case, load_fixture):
    """The header album artwork, never motion artwork (sza-sos-t1) or editorial images (rodrigo-sour-t6)."""
    page = await load_fixture(f"{case.id}.page.html")
    url = await am._extract_cover_url(page)
    if case.id in HEADER_WITHOUT_ARTWORK:
        assert url == ""
    else:
        assert url.endswith("/1000x1000bb.png")
        assert artwork_key(url) == artwork_key(load_golden(case.id).cover_art_url)


# What each saved album page's footer says: the album's date, which a track need not share (Good 4 U is
# May 14 on a May 21 album).
ALBUM_FOOTER_DATE = {
    "eilish-hmhas-t3": "2024-05-17",
    "kendrick-nlu-single": "2024-05-04",
    "rodrigo-sour-t6": "2021-05-21",
    "rosalia-con-altura": "2019-03-28",
    "swift-ttpd-t1": "2024-04-19",
    "sza-sos-t1": "2022-12-09",
}


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.id)
async def test_release_date_from_song_page_matches_golden(case, load_fixture):
    """The song page's meta tag (or, for kendrick-nlu-song, its visible date line) gives the track's own date."""
    page = await load_fixture(f"{case.id}.credits.html")
    assert await am._extract_release_date(page) == load_golden(case.id).release_date


async def test_release_date_from_the_visible_line_when_there_is_no_meta(load_fixture):
    page = await load_fixture("kendrick-nlu-song.page.html")
    assert await page.locator('meta[property="music:release_date"]').count() == 0
    assert await am._extract_release_date(page) == "2024-05-04"


@pytest.mark.parametrize("case", ALBUM_CASES, ids=lambda c: c.id)
async def test_release_date_from_album_footer(case, load_fixture):
    page = await load_fixture(f"{case.id}.page.html")
    assert await am._extract_release_date(page) == ALBUM_FOOTER_DATE[case.id]


async def test_release_date_is_empty_for_a_page_without_one(browser):
    context = await browser.new_context(offline=True)
    try:
        page = await context.new_page()
        await page.set_content('<meta property="music:release_date" content="2024-02-31T00:00:00.000Z"><p>no date</p>')
        assert await am._extract_release_date(page) == ""
    finally:
        await context.close()


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.id)
async def test_page_ready_marker_present(case, load_fixture):
    """_wait_for_page waits for this marker instead of networkidle; it must exist on real pages."""
    page = await load_fixture(f"{case.id}.page.html")
    assert await page.locator(am._READY_SELECTOR).count() > 0
    await am._wait_for_page(page)


async def test_credits_wait_is_bounded(browser, monkeypatch):
    """A page without credit cards (track with no credits) must not hang the scrape."""
    monkeypatch.setattr(am, "_CREDITS_TIMEOUT_MS", 300)
    context = await browser.new_context(offline=True)
    try:
        page = await context.new_page()
        await page.set_content("<p>no credits here</p>")
        assert await am._parse_credits_page(page, strategy_0_only=True) == []
    finally:
        await context.close()


@pytest.mark.parametrize("testid", ["not-found-heading", "page-error-title"])
async def test_not_found_view_raises(testid, browser):
    context = await browser.new_context(offline=True)
    try:
        page = await context.new_page()
        await page.set_content(f'<h1 data-testid="{testid}">Page Not Found</h1>')
        with pytest.raises(am.PageNotFoundError):
            await am._wait_for_page(page)
    finally:
        await context.close()
