import pytest

from scraper import youtube as yt


class TestTitleMatching:
    @pytest.mark.parametrize(
        "video_title",
        ["Not Like Us", "Kendrick Lamar - Not Like Us", "Not Like Us (Official Audio)", "Not Like Us - Kendrick Lamar"],
    )
    def test_matches(self, video_title):
        assert yt._title_matches_song(video_title, "Not Like Us", "Kendrick Lamar")

    def test_rejects_other_song(self):
        assert not yt._title_matches_song("Euphoria", "Not Like Us", "Kendrick Lamar")

    def test_short_special_char_title(self):
        assert yt._sig_present("Travis Scott - FE!N ft. Playboi Carti", "FE!N")


class TestArtistChannel:
    @pytest.mark.parametrize(
        ("channel", "artist"),
        [
            ("Kendrick Lamar", "Kendrick Lamar"),
            ("KendrickLamarVEVO", "Kendrick Lamar"),
            ("Drake", "Drake & Central Cee"),
            ("Kendrick Lamar - Topic", "Kendrick Lamar"),
        ],
    )
    def test_recognised(self, channel, artist):
        assert yt._is_artist_ch(channel, artist)

    def test_unrelated_channel(self):
        assert not yt._is_artist_ch("Lyrics Hub", "Kendrick Lamar")


class TestScoring:
    def test_topic_channel_audio_is_best(self):
        assert yt._score_audio("Not Like Us", "Kendrick Lamar - Topic", "Kendrick Lamar", "Not Like Us") == 2

    def test_lyric_video_skipped(self):
        assert yt._score_audio("Not Like Us (Lyrics)", "Lyrics Hub", "Kendrick Lamar", "Not Like Us") == -1

    def test_vevo_music_video_confirmed(self):
        title = "Kendrick Lamar - Not Like Us (Official Video)"
        assert yt._score_mv(title, "KendrickLamarVEVO", "Kendrick Lamar", "Not Like Us") == 3

    def test_untrusted_channel_mv_ignored(self):
        assert yt._score_mv("Not Like Us (Official Video)", "Random Uploads", "Kendrick Lamar", "Not Like Us") == -1

    def test_artist_channel_plain_title_is_provisional(self):
        assert yt._score_mv("Not Like Us", "Kendrick Lamar", "Kendrick Lamar", "Not Like Us") == 1

    def test_extract_data(self):
        assert yt._extract_data('xx var ytInitialData = {"a": 1}; more') == {"a": 1}
        assert yt._extract_data("nothing") is None
