import httpx
import pytest

from scraper import deezer


@pytest.fixture
def mock_http(monkeypatch):
    """Route every httpx.AsyncClient the module creates through state['handler']."""
    state = {"handler": None}
    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(lambda req: state["handler"](req))
        return real_client(*args, **kwargs)

    monkeypatch.setattr(deezer.httpx, "AsyncClient", factory)
    return state


async def test_deezer_cover_rewritten_to_png(mock_http):
    cover = "https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg"
    mock_http["handler"] = lambda req: httpx.Response(200, json={"data": [{"album": {"cover_xl": cover}}]})
    assert await deezer.fetch_cover_url("SOS", "SZA") == cover.removesuffix(".jpg") + ".png"


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
                {"artistName": "Tribute Band", "artworkUrl100": "https://x/fake/100x100bb.jpg"},
                {"artistName": "SZA", "artworkUrl100": "https://x/real/100x100bb.jpg"},
            ]
        },
    )
    assert await deezer.fetch_itunes_cover_url("SOS", "SZA") == "https://x/real/1000x1000bb.png"


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
