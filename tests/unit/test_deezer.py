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
