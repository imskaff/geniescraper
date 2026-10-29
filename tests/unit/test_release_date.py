import pytest

from scraper.models import SongCredits
from scraper.release_date import (
    date_from_meta,
    date_from_text,
    format_release_date,
    pick_release_date,
    split_release_date,
)


def song(**kw) -> SongCredits:
    base = {"title": "T", "artist": "A", "apple_music_url": "u", "credits": []}
    return SongCredits(**(base | kw))


class TestDateFromMeta:
    @pytest.mark.parametrize(
        ("content", "expected"),
        [
            ("2024-05-17T00:00:00.000Z", "2024-05-17"),
            ("2019-03-28T00:00:00.000Z", "2019-03-28"),
            ("2024-05-17", "2024-05-17"),
            ("  2024-05-17T00:00:00Z ", "2024-05-17"),
            ("2024-12-31T23:59:59-08:00", "2024-12-31"),
            ("2024-02-29T00:00:00.000Z", "2024-02-29"),
        ],
    )
    def test_takes_the_date_part(self, content, expected):
        assert date_from_meta(content) == expected

    @pytest.mark.parametrize(
        "content",
        [
            "",
            "   ",
            "2024-02-31T00:00:00.000Z",
            "2023-02-29",
            "2024-13-01",
            "2024-00-10",
            "2024-05-00",
            "2024-5-17",
            "May 17, 2024",
            "20240517",
            "12024-05-17",
            "2024-05-171",
            "not a date",
            "٢٠٢٤-٠٥-١٧",
        ],
    )
    def test_anything_else_is_unknown(self, content):
        assert date_from_meta(content) == ""


class TestDateFromText:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("May 4, 2024", "2024-05-04"),
            ("May 17, 2024 11 songs, 43 minutes ℗ 2024 Darkroom/Interscope Records", "2024-05-17"),
            ("March 28, 2019", "2019-03-28"),
            ("December 9, 2022\n1 song, 3 minutes\n℗ 2022 TDE", "2022-12-09"),
            ("  sept. 3, 2020  ", "2020-09-03"),
            ("Sep 3 2020", "2020-09-03"),
            ("JANUARY 1, 2000", "2000-01-01"),
            ("17 May 2024", "2024-05-17"),
            ("4 March, 2021", "2021-03-04"),
            ("28 Mar. 2019 · 12 songs", "2019-03-28"),
        ],
    )
    def test_english_dates(self, text, expected):
        assert date_from_text(text) == expected

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "   ",
            "17 mai 2024",
            "17 de mayo de 2024",
            "2024年5月17日",
            "17. Mai 2024",
            "Febuary 3, 2020",
            "February 31, 2024",
            "31 April 2024",
            "May 0, 2024",
            "May 17, 24",
            "May 17, 20245",
            "11 songs, 43 minutes ℗ 2024 Label",
            "Released soon",
        ],
    )
    def test_other_languages_and_bad_dates_are_unknown(self, text):
        assert date_from_text(text) == ""

    def test_unknown_words_are_skipped_not_guessed(self):
        assert date_from_text("Updated Tue 9, 2024 then May 3, 2024") == "2024-05-03"


class TestPick:
    def test_meta_wins(self):
        assert pick_release_date("2024-05-17T00:00:00Z", "May 4, 2024", "March 1, 2020") == "2024-05-17"

    def test_visible_song_line_beats_the_album_footer(self):
        assert pick_release_date("", "May 4, 2024", "May 21, 2021") == "2024-05-04"

    def test_album_footer_is_the_last_resort(self):
        assert pick_release_date("", "", "May 21, 2021 12 songs") == "2021-05-21"

    def test_a_bad_meta_falls_through(self):
        assert pick_release_date("2024-02-31", "May 4, 2024", "") == "2024-05-04"

    def test_nothing_gives_unknown(self):
        assert pick_release_date("", "", "") == ""
        assert pick_release_date("junk", "17 mai 2024", "") == ""


class TestStoredDate:
    def test_split(self):
        assert split_release_date("2024-05-17") == (2024, 5, 17)

    @pytest.mark.parametrize("value", ["", "2024-02-31", "2024-05-17T00:00:00Z", "May 17, 2024", "2024-5-7"])
    def test_split_rejects_the_rest(self, value):
        assert split_release_date(value) is None

    def test_display(self):
        assert format_release_date("2024-05-17") == "May 17, 2024"
        assert format_release_date("2019-03-08") == "March 8, 2019"
        assert format_release_date("") == ""
        assert format_release_date("2024-02-30") == ""


class TestSongModel:
    def test_defaults_to_unknown(self):
        s = song()
        assert s.release_date == ""
        assert (s.release_year(), s.release_month(), s.release_day()) == (None, None, None)
        assert s.release_date_text() == ""

    def test_helpers(self):
        s = song(release_date="2024-05-17")
        assert (s.release_year(), s.release_month(), s.release_day()) == (2024, 5, 17)
        assert s.release_date_text() == "May 17, 2024"

    def test_saved_without_the_field_still_loads(self):
        old = '{"title": "T", "artist": "A", "apple_music_url": "u", "credits": [], "youtube_is_mv": true}'
        assert SongCredits.model_validate_json(old).release_date == ""

    @pytest.mark.parametrize("bad", ["2024-02-31", "garbage", 20240517, None, "May 17, 2024"])
    def test_damaged_value_reads_as_unknown(self, bad):
        assert song(release_date=bad).release_date == ""

    def test_round_trips(self):
        s = song(release_date="2021-05-14")
        assert SongCredits.model_validate_json(s.model_dump_json()).release_date == "2021-05-14"

    def test_the_paste_queue_does_not_change(self):
        assert song(release_date="2024-05-17").typed_queue() == song().typed_queue()
