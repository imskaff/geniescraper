"""Serve captured YouTube, Deezer and iTunes responses through httpx.MockTransport.

Fixtures come from `uv run python -m bench.capture_lookups`. Requests the
fixture has no answer for get the response the real service gives for an
unknown resource, so a lookup that asks something new degrades as it would live.
"""

import json
from pathlib import Path

import httpx

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "lookups"
YOUTUBE_DIR = FIXTURE_DIR / "youtube"
COVERS_DIR = FIXTURE_DIR / "covers"


def load(directory: Path, case_id: str) -> dict:
    return json.loads((directory / f"{case_id}.json").read_text(encoding="utf-8"))


def youtube_handler(fixture: dict, log: list[httpx.Request] | None = None):
    def handle(request: httpx.Request) -> httpx.Response:
        if log is not None:
            log.append(request)
        # YouTube's JSON endpoints (what the lookup asks first): the same captured data, as JSON.
        if request.method == "POST" and request.url.path == "/youtubei/v1/search":
            data = fixture["searches"].get(json.loads(request.content).get("query", ""))
            return httpx.Response(404) if data is None else httpx.Response(200, json=data)
        if request.method == "POST" and request.url.path == "/youtubei/v1/player":
            player = fixture["watch"].get(json.loads(request.content).get("videoId", ""))
            return httpx.Response(404) if player is None else httpx.Response(200, json=player)
        if request.url.path == "/results":
            data = fixture["searches"].get(request.url.params.get("search_query", ""))
            if data is None:
                return httpx.Response(404)
            return httpx.Response(200, text=f"<script>var ytInitialData = {json.dumps(data)};</script>")
        if request.url.path == "/watch":
            player = fixture["watch"].get(request.url.params.get("v", ""))
            if player is None:
                return httpx.Response(404)
            return httpx.Response(200, text=f"<script>var ytInitialPlayerResponse = {json.dumps(player)};</script>")
        return httpx.Response(404)

    return handle


def covers_handler(fixture: dict, log: list[httpx.Request] | None = None):
    def handle(request: httpx.Request) -> httpx.Response:
        if log is not None:
            log.append(request)
        params = request.url.params
        if request.url.host == "api.deezer.com" and request.url.path == "/search":
            return httpx.Response(200, json=fixture["deezer"].get(params.get("q", ""), {"data": [], "total": 0}))
        if request.url.host == "itunes.apple.com" and request.url.path == "/search":
            empty = {"resultCount": 0, "results": []}
            return httpx.Response(200, json=fixture["itunes_search"].get(params.get("term", ""), empty))
        if request.url.host == "itunes.apple.com" and request.url.path == "/lookup":
            empty = {"resultCount": 0, "results": []}
            return httpx.Response(200, json=fixture["itunes_lookup"].get(params.get("id", ""), empty))
        return httpx.Response(404)

    return handle


def route_clients(monkeypatch, module, handler) -> None:
    """Make every httpx.AsyncClient that `module` creates use `handler`."""
    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(module.httpx, "AsyncClient", factory)
