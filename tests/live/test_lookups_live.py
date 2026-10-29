"""
Live YouTube and cover art lookups against the hand-verified truth.

    uv run pytest -m live tests/live/test_lookups_live.py

Runs one lookup at a time, like a single user. A failure here while the offline
replay in tests/offline/test_lookups.py passes means the services changed:
recapture with `uv run python -m bench.capture_lookups` and look at the diff.
"""

import pytest

from bench.cases import load_cases, load_golden
from bench.lookups import cover_correct, load_youtube_golden, video_id
from scraper import pipeline, youtube

pytestmark = [pytest.mark.live, pytest.mark.timeout(60)]


@pytest.mark.parametrize("entry", load_youtube_golden(), ids=lambda e: e["id"])
async def test_youtube_pick_matches_truth(entry):
    url, kind = await youtube.fetch_youtube_url(entry["title"], entry["artist"])

    assert video_id(url) in entry["accept"], url
    assert kind == entry["kind"]


@pytest.mark.parametrize("case", load_cases(), ids=lambda c: c.id)
async def test_cover_matches_golden_artwork(case):
    golden = load_golden(case.id)

    url = await pipeline.fetch_cover(case.url, golden.title, golden.artist)

    assert cover_correct(url, golden.cover_art_url), url
