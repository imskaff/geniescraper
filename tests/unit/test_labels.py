import asyncio
from pathlib import Path

import httpx
import pytest

from scraper import deezer
from scraper.labels import derive_label_info
from scraper.models import Credit, SongCredits, _extract_labels  # pyright: ignore[reportPrivateUsage]


def _info(line: str):
    return derive_label_info(line, _extract_labels(line))


def test_acceptance_trade_places_atlantic_warner():
    info = _info("℗ 2026 Atlantic Recording Corporation")
    assert (info.label, info.distributor) == ("Atlantic Records", "Warner Music Group")
    assert info.label_source and info.distributor_source


def test_licensee_after_exclusive_license_is_the_label():
    info = _info("℗ 2022 Top Dawg Entertainment, under exclusive license to RCA Records")
    assert (info.label, info.distributor) == ("RCA Records", "Sony Music Entertainment")


def test_slash_joined_name_and_umg_division():
    assert _info("℗ 2024 Darkroom/Interscope Records").label == "Interscope Records"
    info = _info("℗ 2023 Island Records, a division of UMG Recordings, Inc.")
    assert (info.label, info.distributor) == ("Island Records", "Universal Music Group")


def test_stated_distributor_is_used_verbatim_when_unknown():
    info = _info("℗ 2021 Chance the Rapper LLC, distributed by Ditto Music")
    assert (info.label, info.distributor) == ("", "Ditto Music")


def test_stated_distributor_that_is_a_known_group_uses_the_group():
    assert _info("℗ 2021 Some Label, distributed by Universal Music Group").distributor == "Universal Music Group"


def test_two_labels_of_different_groups_leave_both_empty_of_a_guess():
    info = _info("℗ 2020 Warner Records Inc., marketed by Republic Records")
    assert (info.label, info.distributor) == ("", "")


def test_unknown_or_empty_line_stays_empty():
    for line in ("℗ 2024 Taylor Swift", "℗ 2024", ""):
        assert _info(line).label == "" and _info(line).distributor == ""


def test_queue_puts_label_and_distributor_before_copyright_and_skips_credited_roles():
    song = SongCredits(
        title="t",
        artist="a",
        apple_music_url="u",
        credits=[Credit(role="Distributor", artists=["Already"])],
        phonographic_copyright="℗ 2026 Atlantic Recording Corporation",
    )
    queue = song.typed_queue(include_additional=False)
    assert queue[:3] == [
        ("role", "Label"),
        ("artist", "Atlantic Records"),
        ("copyright_role", "Phonographic Copyright"),
    ]
    assert ("artist", "Warner Music Group") not in queue
    assert song.typed_queue(include_copyright=False) == [("role", "Distributor"), ("artist", "Already")]


def test_song_page_copyright_comes_from_the_albums_itunes_record(monkeypatch: pytest.MonkeyPatch):
    """A /song/ page has no footer: the song's lookup names the album, and the album's record holds the line."""
    fixtures = Path(__file__).resolve().parent.parent / "fixtures" / "lookups"
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(str(request.url))
        name = (
            "itunes-song-trade-places.json" if request.url.params["id"] == "1878823464" else "itunes-album-monica.json"
        )
        return httpx.Response(200, content=(fixtures / name).read_bytes())

    real = httpx.AsyncClient
    monkeypatch.setattr(deezer.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    lines = asyncio.run(deezer.fetch_itunes_copyright("https://music.apple.com/us/song/trade-places/1878823464"))
    assert lines == ("℗ 2026 Atlantic Recording Corporation", "")
    assert [u.split("?")[1] for u in asked] == ["id=1878823464&country=us", "id=1878823462&country=us"]
    info = derive_label_info(lines[0], _extract_labels(lines[0]))
    assert (info.label, info.distributor) == ("Atlantic Records", "Warner Music Group")


def test_song_page_copyright_is_empty_when_the_lookup_fails(monkeypatch: pytest.MonkeyPatch):
    real = httpx.AsyncClient
    monkeypatch.setattr(
        deezer.httpx,
        "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(lambda request: httpx.Response(500)), **kw),
    )
    assert asyncio.run(deezer.fetch_itunes_copyright("https://music.apple.com/us/song/x/1")) == ("", "")
