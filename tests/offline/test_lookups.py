"""
YouTube and cover art lookups run offline against captured responses and are
checked against the hand-verified truth (tests/golden/youtube.json and the cover
artwork in the credit golden files).

Refresh the captures with `uv run python -m bench.capture_lookups`.
"""

import asyncio
import json

import httpx
import pytest

from bench.cases import load_cases, load_golden
from bench.lookups import cover_correct, load_youtube_golden, video_id
from scraper import pipeline, youtube
from tests import lookup_fixtures as lf

YOUTUBE_ENTRIES = load_youtube_golden()
YOUTUBE_BY_ID = {e["id"]: e for e in YOUTUBE_ENTRIES}
KNOWN_YOUTUBE_BUGS: dict[str, str] = {}
KNOWN_COVER_BUGS: dict[str, str] = {}


def _param(item, item_id: str, known: dict[str, str]):
    marks = [pytest.mark.xfail(strict=True, reason=known[item_id])] if item_id in known else []
    return pytest.param(item, id=item_id, marks=marks)


@pytest.mark.parametrize("entry", [_param(e, e["id"], KNOWN_YOUTUBE_BUGS) for e in YOUTUBE_ENTRIES])
async def test_youtube_pick_matches_truth(monkeypatch, entry):
    lf.route_clients(monkeypatch, youtube, lf.youtube_handler(lf.load(lf.YOUTUBE_DIR, entry["id"])))

    url, kind = await youtube.fetch_youtube_url(entry["title"], entry["artist"])

    assert (video_id(url), kind) in {(v, entry["kind"]) for v in entry["accept"]}


# What one song may cost, as in the extension (extension/test/lookups/youtube.test.ts): the audio search waits for the
# music video search and is skipped when that finds a confirmed video, so Google sees few requests.
MAX_REQUESTS_PER_SONG = 6
AVERAGE_REQUESTS_PER_SONG = 4.5


def _queries(log) -> list[str]:
    return [json.loads(r.content)["query"] for r in log if r.url.path == "/youtubei/v1/search"]


def _watched(log) -> list[str]:
    return [json.loads(r.content)["videoId"] for r in log if r.url.path == "/youtubei/v1/player"]


async def test_youtube_asks_for_the_music_video_first_and_skips_the_audio_when_it_is_found(monkeypatch):
    log = []
    lf.route_clients(monkeypatch, youtube, lf.youtube_handler(lf.load(lf.YOUTUBE_DIR, "eilish-hmhas-t3"), log))
    entry = YOUTUBE_BY_ID["eilish-hmhas-t3"]

    await youtube.fetch_youtube_url(entry["title"], entry["artist"])

    mv_queries = youtube._mv_queries(entry["title"], entry["artist"])  # pyright: ignore[reportPrivateUsage]
    audio_queries = youtube._audio_queries(entry["title"], entry["artist"])  # pyright: ignore[reportPrivateUsage]
    queries = _queries(log)
    assert queries[0] == mv_queries[0]
    assert not set(queries) & set(audio_queries)


async def test_youtube_asks_for_the_audio_only_after_the_music_video_search_found_nothing(monkeypatch):
    log = []
    lf.route_clients(monkeypatch, youtube, lf.youtube_handler(lf.load(lf.YOUTUBE_DIR, "sza-sos-t1"), log))
    entry = YOUTUBE_BY_ID["sza-sos-t1"]

    await youtube.fetch_youtube_url(entry["title"], entry["artist"])

    queries = _queries(log)
    mv_queries = list(youtube._mv_queries(entry["title"], entry["artist"]))  # pyright: ignore[reportPrivateUsage]
    assert queries[: len(mv_queries)] == mv_queries
    assert len(queries) > len(mv_queries)


async def test_youtube_never_has_two_searches_in_flight_and_reads_descriptions_politely(monkeypatch):
    in_flight = peak_searches = peak = 0

    async def run(case_id):
        nonlocal in_flight, peak_searches, peak
        sync_handler = lf.youtube_handler(lf.load(lf.YOUTUBE_DIR, case_id))
        searches = 0

        async def handler(request):
            nonlocal in_flight, peak_searches, peak, searches
            is_search = request.url.path.endswith("/search")
            in_flight += 1
            searches += is_search
            peak = max(peak, in_flight)
            peak_searches = max(peak_searches, searches)
            await asyncio.sleep(0.01)
            in_flight -= 1
            searches -= is_search
            return sync_handler(request)

        lf.route_clients(monkeypatch, youtube, handler)
        entry = YOUTUBE_BY_ID[case_id]
        await youtube.fetch_youtube_url(entry["title"], entry["artist"])

    for case_id in ("kendrick-nlu-single", "extra-frankocean-pink-white", "sza-sos-t1"):
        await run(case_id)

    assert peak_searches == 1
    assert peak <= 3


async def test_youtube_keeps_each_songs_requests_low_across_the_golden_set(monkeypatch):
    counts = []
    for entry in YOUTUBE_ENTRIES:
        log = []
        lf.route_clients(monkeypatch, youtube, lf.youtube_handler(lf.load(lf.YOUTUBE_DIR, entry["id"]), log))
        await youtube.fetch_youtube_url(entry["title"], entry["artist"])
        counts.append(len(log))
        watched = _watched(log)
        assert len(watched) == len(set(watched))
    assert max(counts) <= MAX_REQUESTS_PER_SONG
    assert sum(counts) / len(counts) <= AVERAGE_REQUESTS_PER_SONG


@pytest.mark.parametrize("entry", YOUTUBE_ENTRIES, ids=lambda e: e["id"])
async def test_youtube_asks_the_json_endpoints_first_and_never_the_pages(monkeypatch, entry):
    log = []
    lf.route_clients(monkeypatch, youtube, lf.youtube_handler(lf.load(lf.YOUTUBE_DIR, entry["id"]), log))

    url, kind = await youtube.fetch_youtube_url(entry["title"], entry["artist"])

    assert (video_id(url), kind) in {(v, entry["kind"]) for v in entry["accept"]}
    assert log
    assert all(r.method == "POST" and r.url.path.startswith("/youtubei/v1/") for r in log)


@pytest.mark.parametrize("case_id", ["sza-sos-t1", "eilish-hmhas-t3"])
async def test_youtube_falls_back_to_the_pages_when_the_json_endpoints_refuse(monkeypatch, case_id):
    sync_handler = lf.youtube_handler(lf.load(lf.YOUTUBE_DIR, case_id))
    paths = []

    def handler(request):
        paths.append(request.url.path)
        if request.url.path.startswith("/youtubei/"):
            return httpx.Response(403, text="<html>Sorry</html>")
        return sync_handler(request)

    lf.route_clients(monkeypatch, youtube, handler)
    entry = YOUTUBE_BY_ID[case_id]

    url, kind = await youtube.fetch_youtube_url(entry["title"], entry["artist"])

    assert (video_id(url), kind) in {(v, entry["kind"]) for v in entry["accept"]}
    assert "/results" in paths


async def test_youtube_gives_nothing_when_neither_the_endpoints_nor_the_pages_answer(monkeypatch):
    lf.route_clients(monkeypatch, youtube, lambda request: httpx.Response(403, text="<html>Sorry</html>"))

    assert await youtube.fetch_youtube_url("SOS", "SZA") == ("", None)


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
