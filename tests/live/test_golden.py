"""
End-to-end checks against live Apple Music, the closest thing to a real user run.

    uv run pytest -m live

Each case runs the same flow the GUI uses (detect, then fetch the selected track) and
compares every scraper-owned field with the hand-reviewed golden file.
"""

import pytest

from bench.cases import diff, load_cases, load_golden
from bench.run import INVALID_URL, run_once
from scraper import apple_music

pytestmark = [pytest.mark.live, pytest.mark.timeout(180)]


@pytest.fixture(scope="module", autouse=True)
async def shared_browser():
    yield
    await apple_music.close_browser()


@pytest.mark.parametrize("case", load_cases(), ids=lambda c: c.id)
async def test_flow_matches_golden(case):
    song = await run_once(case, "flow")
    assert diff(song, load_golden(case.id)) == []
    assert song.youtube_url.startswith("https://www.youtube.com/watch?v=")


async def test_invalid_url_fails_fast():
    import time

    start = time.perf_counter()
    with pytest.raises(apple_music.PageNotFoundError):
        await apple_music.detect_album(INVALID_URL)
    assert time.perf_counter() - start < 10
