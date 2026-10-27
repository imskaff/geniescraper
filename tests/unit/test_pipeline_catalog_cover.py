import httpx

from scraper import apple_music, pipeline
from scraper.apple_music import AlbumTrackInfo
from tests import lookup_fixtures as lf

ALBUM_URL = "https://music.apple.com/us/album/hit-me-hard-and-soft/1739659134"


async def test_detect_takes_album_cover_from_catalog_lookup(monkeypatch):
    # No track is titled like the album, so a title search alone finds nothing.
    async def fake_detect(url: str) -> AlbumTrackInfo:
        return AlbumTrackInfo(url, "HIT ME HARD AND SOFT", "Billie Eilish", 10, ["SKINNY"], "")

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/lookup" and req.url.params["id"] == "1739659134":
            return httpx.Response(200, json={"results": [{"artworkUrl100": "https://x/hmhas/100x100bb.jpg"}]})
        return httpx.Response(200, json={"results": [], "data": []})

    monkeypatch.setattr(apple_music, "detect_album", fake_detect)
    lf.route_clients(monkeypatch, pipeline.deezer, handler)

    info = await pipeline.detect(ALBUM_URL)

    assert info.cover_art_url == "https://x/hmhas/1000x1000bb.png"
