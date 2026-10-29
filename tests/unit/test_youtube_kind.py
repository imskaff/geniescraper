"""The four kinds of YouTube video a song's link can be, in Genius's order of preference."""

import pytest
from pydantic import ValidationError

from scraper.models import VIDEO_KINDS, SongCredits, youtube_label


def song(**kw) -> SongCredits:
    base = {"title": "T", "artist": "A", "apple_music_url": "u", "credits": []}
    return SongCredits(**(base | kw))


def test_the_kinds_are_in_genius_order():
    assert VIDEO_KINDS == ("music-video", "lyric-video", "official-audio", "auto-generated")


class TestYoutubeKind:
    def test_defaults_to_no_kind(self):
        assert song().youtube_kind is None

    @pytest.mark.parametrize("kind", VIDEO_KINDS)
    def test_accepts_the_four_kinds(self, kind):
        assert song(youtube_kind=kind).youtube_kind == kind

    def test_rejects_any_other_kind(self):
        with pytest.raises(ValidationError):
            song(youtube_kind="trailer")

    def test_a_song_saved_with_the_old_music_video_flag_is_a_music_video(self):
        assert song(youtube_is_mv=True).youtube_kind == "music-video"

    def test_a_song_saved_with_the_old_audio_flag_has_no_kind(self):
        """False never said which audio it was, so it stays unknown, as the extension treats an older link."""
        assert song(youtube_is_mv=False).youtube_kind is None

    def test_an_explicit_kind_wins_over_the_old_flag(self):
        assert song(youtube_is_mv=True, youtube_kind="lyric-video").youtube_kind == "lyric-video"

    def test_the_dump_has_the_kind_and_no_old_flag(self):
        dumped = song(youtube_kind="official-audio").model_dump()
        assert dumped["youtube_kind"] == "official-audio"
        assert "youtube_is_mv" not in dumped

    def test_old_dumps_load_back(self):
        old = song().model_dump() | {"youtube_url": "https://www.youtube.com/watch?v=abc", "youtube_is_mv": True}
        assert SongCredits.model_validate(old).youtube_kind == "music-video"


@pytest.mark.parametrize(
    ("kind", "label"),
    [
        ("music-video", "Music video"),
        ("lyric-video", "Lyric video"),
        ("official-audio", "Official audio"),
        ("auto-generated", "Auto-generated"),
        (None, "Official audio"),
    ],
)
def test_label(kind, label):
    assert youtube_label(kind) == label
