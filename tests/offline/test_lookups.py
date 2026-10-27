"""
YouTube and cover art lookups run offline against captured responses and are
checked against the hand-verified truth (tests/golden/youtube.json and the cover
artwork in the credit golden files).

Refresh the captures with `uv run python -m bench.capture_lookups`.
"""

import pytest

from bench.cases import load_cases, load_golden
from bench.lookups import cover_correct, load_youtube_golden, video_id
from scraper import pipeline, youtube
from tests import lookup_fixtures as lf

YOUTUBE_ENTRIES = load_youtube_golden()
KNOWN_YOUTUBE_BUGS: dict[str, str] = {}
KNOWN_COVER_BUGS: dict[str, str] = {}


def _param(item, item_id: str, known: dict[str, str]):
    marks = [pytest.mark.xfail(strict=True, reason=known[item_id])] if item_id in known else []
    return pytest.param(item, id=item_id, marks=marks)


@pytest.mark.parametrize("entry", [_param(e, e["id"], KNOWN_YOUTUBE_BUGS) for e in YOUTUBE_ENTRIES])
async def test_youtube_pick_matches_truth(monkeypatch, entry):
    lf.route_clients(monkeypatch, youtube, lf.youtube_handler(lf.load(lf.YOUTUBE_DIR, entry["id"])))

    url, is_mv = await youtube.fetch_youtube_url(entry["title"], entry["artist"])

    assert (video_id(url), is_mv) in {(v, entry["is_music_video"]) for v in entry["accept"]}


@pytest.mark.parametrize("case", [_param(c, c.id, KNOWN_COVER_BUGS) for c in load_cases()])
async def test_cover_matches_golden_artwork(monkeypatch, case):
    lf.route_clients(monkeypatch, pipeline.deezer, lf.covers_handler(lf.load(lf.COVERS_DIR, case.id)))
    golden = load_golden(case.id)

    url = await pipeline.fetch_cover(case.url, golden.title, golden.artist)

    assert cover_correct(url, golden.cover_art_url), url


@pytest.mark.parametrize("case", load_cases(), ids=lambda c: c.id)
async def test_cover_without_catalog_id_falls_back_to_title_search(monkeypatch, case):
    fixture = lf.load(lf.COVERS_DIR, case.id)
    lf.route_clients(monkeypatch, pipeline.deezer, lf.covers_handler(fixture))
    golden = load_golden(case.id)

    url = await pipeline.fetch_cover("", golden.title, golden.artist)

    # Some edition of the same track, from the same catalog as Apple Music.
    assert url.startswith("https://is1-ssl.mzstatic.com/") and url.endswith("/1000x1000bb.png"), url
