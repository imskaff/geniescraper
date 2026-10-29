"""A track's health; the cases are those of the extension's trackHealth.test.ts."""

import pytest

from scraper.models import Credit, SongCredits
from scraper.track_health import Health, track_health

SONG = SongCredits(
    title="One",
    artist="A",
    apple_music_url="https://music.apple.com/x",
    credits=[Credit(role="Songwriter", artists=["W"])],
    phonographic_copyright="℗ 2024 Records",
    cover_art_url="https://example.com/c.png",
    youtube_url="https://www.youtube.com/watch?v=abcDEF_-123",
    youtube_kind="music-video",
)


def health(song: SongCredits | None = SONG, status="done", **kw) -> Health:
    return track_health(status, song, **kw)


def test_ok_when_everything_asked_for_was_found():
    assert health() == Health("ok", "All found", ())


def test_attention_when_there_are_no_credits():
    result = health(SONG.model_copy(update={"credits": []}))
    assert (result.level, result.missing) == ("attention", ("credits",))


def test_names_each_thing_that_is_missing():
    song = SONG.model_copy(update={"phonographic_copyright": "", "cover_art_url": "", "youtube_url": ""})
    result = health(song)
    assert result.level == "attention"
    assert result.missing == ("copyright", "cover art", "YouTube link")
    assert result.label == "Needs a look: copyright, cover art, YouTube link"


def test_either_copyright_line_counts_as_the_copyright():
    song = SONG.model_copy(update={"phonographic_copyright": "", "copyright_notice": "© 2024"})
    assert health(song).level == "ok"


def test_never_all_found_while_the_youtube_link_is_still_being_looked_for():
    song = SONG.model_copy(update={"youtube_url": ""})
    assert health(song, youtube_searching=True) == Health("working", "Finding YouTube link", ())


def test_asks_for_a_look_once_the_link_was_looked_for_and_not_found():
    song = SONG.model_copy(update={"youtube_url": ""})
    assert health(song).missing == ("YouTube link",)


def test_reports_other_missing_things_while_the_link_is_still_being_looked_for():
    song = SONG.model_copy(update={"youtube_url": "", "cover_art_url": ""})
    result = health(song, youtube_searching=True)
    assert (result.level, result.missing) == ("attention", ("cover art",))


def test_does_not_count_a_step_the_user_switched_off():
    song = SONG.model_copy(update={"phonographic_copyright": "", "cover_art_url": "", "youtube_url": ""})
    result = health(song, wants_copyright=False, wants_cover_art=False, wants_youtube=False)
    assert result.level == "ok"


@pytest.mark.parametrize(
    ("status", "level", "label"),
    [
        ("pending", "waiting", "Waiting"),
        ("loading", "working", "Reading"),
        ("error", "error", "Failed"),
        ("unavailable", "none", "No page"),
    ],
)
def test_reports_an_unfinished_track_by_its_status(status, level, label):
    assert health(None, status=status) == Health(level, label, ())


def test_a_finished_track_with_no_song_failed():
    assert health(None).level == "error"
