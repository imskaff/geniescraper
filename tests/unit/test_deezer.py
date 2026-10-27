from collections.abc import Callable

import httpx
import pytest

from scraper import deezer


@pytest.fixture
def mock_http(monkeypatch):
    """Route every httpx.AsyncClient the module creates through state['handler']."""

    def unset(req: httpx.Request) -> httpx.Response:
        raise AssertionError(f"mock_http['handler'] not set for {req.url}")

    state: dict[str, Callable[[httpx.Request], httpx.Response]] = {"handler": unset}
    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(lambda req: state["handler"](req))
        return real_client(*args, **kwargs)

    monkeypatch.setattr(deezer.httpx, "AsyncClient", factory)
    return state


def _deezer_hit(title: str, artist: str, cover_xl: str) -> dict:
    return {"title": title, "artist": {"name": artist}, "album": {"cover_xl": cover_xl}}


async def test_deezer_cover_rewritten_to_png(mock_http):
    cover = "https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg"
    mock_http["handler"] = lambda req: httpx.Response(200, json={"data": [_deezer_hit("SOS", "SZA", cover)]})
    assert await deezer.fetch_cover_url("SOS", "SZA") == cover.removesuffix(".jpg") + ".png"


async def test_deezer_uses_plain_query_and_skips_other_tracks(mock_http):
    # Deezer returns nothing for track:"..." artist:"..." field queries.
    seen: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req.url.params["q"])
        hits = [_deezer_hit("Kill Bill", "SZA", "https://x/kill.jpg"), _deezer_hit("SOS", "SZA", "https://x/sos.jpg")]
        return httpx.Response(200, json={"data": hits})

    mock_http["handler"] = handler
    assert await deezer.fetch_cover_url("SOS", "SZA") == "https://x/sos.png"
    assert seen == ["SZA SOS"]


async def test_deezer_server_error_returns_empty(mock_http):
    mock_http["handler"] = lambda req: httpx.Response(500)
    assert await deezer.fetch_cover_url("SOS", "SZA") == ""


async def test_deezer_no_results_returns_empty(mock_http):
    mock_http["handler"] = lambda req: httpx.Response(200, json={"data": []})
    assert await deezer.fetch_cover_url("SOS", "SZA") == ""


async def test_missing_inputs_short_circuit():
    assert await deezer.fetch_cover_url("", "SZA") == ""
    assert await deezer.fetch_itunes_cover_url("SOS", "") == ""


async def test_itunes_skips_other_artists_and_requests_png(mock_http):
    mock_http["handler"] = lambda req: httpx.Response(
        200,
        json={
            "results": [
                {"trackName": "SOS", "artistName": "Tribute Band", "artworkUrl100": "https://x/fake/100x100bb.jpg"},
                {"trackName": "SOS", "artistName": "SZA", "artworkUrl100": "https://x/real/100x100bb.jpg"},
            ]
        },
    )
    assert await deezer.fetch_itunes_cover_url("SOS", "SZA") == "https://x/real/1000x1000bb.png"


async def test_itunes_skips_other_songs_by_the_artist(mock_http):
    mock_http["handler"] = lambda req: httpx.Response(
        200,
        json={
            "results": [
                {"trackName": "Kill Bill", "artistName": "SZA", "artworkUrl100": "https://x/kill/100x100bb.jpg"},
                {"trackName": "SOS", "artistName": "SZA", "artworkUrl100": "https://x/sos/100x100bb.jpg"},
            ]
        },
    )
    assert await deezer.fetch_itunes_cover_url("SOS", "SZA") == "https://x/sos/1000x1000bb.png"


async def test_itunes_title_match_ignores_feat_part_and_accents(mock_http):
    hit = {"trackName": "Fortnight", "artistName": "Taylor Swift", "artworkUrl100": "https://x/f/100x100bb.jpg"}
    mock_http["handler"] = lambda req: httpx.Response(200, json={"results": [hit]})
    assert await deezer.fetch_itunes_cover_url("Fortnight (feat. Post Malone)", "Taylor Swift") != ""
    hit = {"trackName": "DAKITI", "artistName": "Bad Bunny & Jhay Cortez", "artworkUrl100": "https://x/d/100x100bb.jpg"}
    mock_http["handler"] = lambda req: httpx.Response(200, json={"results": [hit]})
    assert await deezer.fetch_itunes_cover_url("DÁKITI", "Bad Bunny & Jhay Cortez") != ""


async def test_itunes_lookup_uses_catalog_id_and_storefront(mock_http):
    seen: list[dict] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(dict(req.url.params))
        return httpx.Response(200, json={"results": [{"artworkUrl100": "https://x/album/100x100bb.jpg"}]})

    mock_http["handler"] = handler
    url = "https://music.apple.com/gb/album/sour/1560734944?i=1560735414"
    assert await deezer.fetch_itunes_lookup_cover_url(url) == "https://x/album/1000x1000bb.png"
    assert seen == [{"id": "1560735414", "country": "gb"}]


async def test_itunes_lookup_without_catalog_id_or_result_returns_empty(mock_http):
    mock_http["handler"] = lambda req: httpx.Response(200, json={"resultCount": 0, "results": []})
    assert await deezer.fetch_itunes_lookup_cover_url("https://music.apple.com/us/album/sos/1") == ""
    assert await deezer.fetch_itunes_lookup_cover_url("not a url") == ""
    mock_http["handler"] = lambda req: httpx.Response(503)
    assert await deezer.fetch_itunes_lookup_cover_url("https://music.apple.com/us/album/sos/1") == ""


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://music.apple.com/us/album/sos/1658650093", ("us", "1658650093")),
        ("https://music.apple.com/us/song/not-like-us/1781353929", ("us", "1781353929")),
        ("https://music.apple.com/gb/album/sour/1560734944?i=1560735414", ("gb", "1560735414")),
        ("https://music.apple.com/us/album/1560734944", ("us", "1560734944")),
        ("https://example.com/us/album/sour/1560734944", None),
        ("", None),
    ],
)
def test_catalog_ref(url, expected):
    assert deezer.catalog_ref(url) == expected
