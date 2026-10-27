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


@pytest.fixture(autouse=True)
def no_settle_sleep(monkeypatch):
    """_parse_credits_page sleeps for live rendering; fixtures are already rendered."""

    async def instant(_):
        return None

    monkeypatch.setattr(am.asyncio, "sleep", instant)


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


@pytest.mark.xfail(strict=True, reason="known bug: og:image meta is gone from hydrated Apple Music pages")
@pytest.mark.parametrize("case", ALBUM_CASES[:1], ids=lambda c: c.id)
async def test_cover_from_page(case, load_fixture):
    page = await load_fixture(f"{case.id}.page.html")
    url = await am._extract_cover_url(page)
    assert artwork_key(url) == artwork_key(load_golden(case.id).cover_art_url)
