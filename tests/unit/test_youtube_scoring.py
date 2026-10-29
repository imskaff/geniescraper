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

    @pytest.mark.parametrize(
        ("video_title", "song", "artist"),
        [
            ("Taylor Swift - Fortnight", "Fortnight (feat. Post Malone)", "Taylor Swift"),
            ("Luis Fonsi - Despacito ft. Daddy Yankee", "Despacito (feat. Daddy Yankee)", "Luis Fonsi"),
            ("BAD BUNNY x JHAY CORTEZ - DÁKITI", "DÁKITI", "Bad Bunny & Jhay Cortez"),
            ("Frank Ocean - Pink + White", "Pink + White", "Frank Ocean"),
        ],
    )
    def test_matches_feat_and_accent_variants(self, video_title, song, artist):
        assert yt._title_matches_song(video_title, song, artist)

    @pytest.mark.parametrize(
        ("video_title", "song"),
        [("SZA - SOS Where The Hell Have You Been ?", "SOS"), ("Pink Matter", "Pink + White")],
    )
    def test_rejects_extra_words(self, video_title, song):
        assert not yt._title_matches_song(video_title, song, "SZA")

    def test_short_special_char_title(self):
        assert yt._sig_present("Travis Scott - FE!N ft. Playboi Carti", "FE!N")

    def test_matches_whole_words_not_pieces_of_words(self):
        # "the" is inside "feather": THE GREATEST must not match a video of BIRDS OF A FEATHER.
        video = "Billie Eilish - BIRDS OF A FEATHER (Official Music Video)"
        assert not yt._sig_present(video, "THE GREATEST")
        assert yt._sig_present(video, "BIRDS OF A FEATHER")
        assert yt._score_mv(video, "BillieEilishVEVO", "Billie Eilish", "THE GREATEST") == -1


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
    def test_topic_channel_audio_ranks_last_of_the_audio(self):
        # Genius ranks the auto-generated upload below the artist's own official audio.
        assert yt._score_audio("Not Like Us", "Kendrick Lamar - Topic", "Kendrick Lamar", "Not Like Us") == 1

    def test_artists_own_audio_outranks_the_topic_upload(self):
        assert yt._score_audio("SZA - SOS (Official Audio)", "SZA", "SZA", "SOS") == 2

    def test_topic_upload_shown_under_artist_name_is_still_auto_generated(self):
        # Search results now label Topic uploads with the artist's channel name.
        snippet = "Provided to YouTube by Top Dawg Entertainment/RCA Records SOS · SZA SOS ℗ 2022 Top Dawg"
        assert yt._score_audio("SOS", "SZA", "SZA", "SOS", official_artist=True, snippet=snippet) == 1

    def test_copied_topic_description_on_untrusted_channel_is_ignored(self):
        snippet = "Provided to YouTube by Top Dawg Entertainment/RCA Records SOS · SZA"
        assert yt._score_audio("SOS", "Free Music Uploads", "SZA", "SOS", snippet=snippet) == -1

    def test_official_artist_channel_under_another_name(self):
        args = ("Frank Ocean - Pink + White", "Blonded", "Frank Ocean", "Pink + White")
        assert yt._score_audio(*args) == -1
        assert yt._score_audio(*args, official_artist=True) == 2

    def test_official_artist_badge_needs_artist_in_title(self):
        assert (
            yt._score_audio("Pink + White", "Some Other Artist", "Frank Ocean", "Pink + White", official_artist=True)
            == -1
        )

    def test_lyric_video_skipped(self):
        assert yt._score_audio("Not Like Us (Lyrics)", "Lyrics Hub", "Kendrick Lamar", "Not Like Us") == -1

    @pytest.mark.parametrize(
        "title", ["SZA - SOS (Lyric Video)", "SZA - SOS (Official Lyric Video)", "SZA - SOS (Lyrics)"]
    )
    def test_lyric_video_on_the_artists_channel_outranks_any_audio(self, title):
        assert yt._score_lyric(title, "SZA", "SZA", "SOS") == 3

    def test_lyric_video_through_the_official_artist_badge(self):
        title = "SZA - SOS (Lyric Video)"
        assert yt._score_lyric(title, "Blonded", "SZA", "SOS") == -1
        assert yt._score_lyric(title, "Blonded", "SZA", "SOS", official_artist=True) == 3
        assert yt._score_lyric("SOS (Lyric Video)", "Blonded", "SZA", "SOS", official_artist=True) == -1

    @pytest.mark.parametrize(
        ("title", "channel"),
        [
            ("SZA - SOS (Lyrics)", "Lyrics Daily"),
            ("SZA - Kill Bill (Lyric Video)", "SZA"),
            ("SZA - SOS (Lyrics) [Remix]", "SZA"),
            ("SZA - SOS (Live) (Lyrics)", "SZA"),
            ("SZA - SOS (Official Audio)", "SZA"),
            ("SZA - SOS (Official Video)", "SZA"),
        ],
    )
    def test_not_a_lyric_video_of_the_song(self, title, channel):
        assert yt._score_lyric(title, channel, "SZA", "SOS") == -1

    def test_vevo_music_video_confirmed(self):
        title = "Kendrick Lamar - Not Like Us (Official Video)"
        assert yt._score_mv(title, "KendrickLamarVEVO", "Kendrick Lamar", "Not Like Us") == 3

    def test_untrusted_channel_mv_ignored(self):
        assert yt._score_mv("Not Like Us (Official Video)", "Random Uploads", "Kendrick Lamar", "Not Like Us") == -1

    def test_vevo_in_unrelated_channel_name_is_not_trusted(self):
        title = "Luis Fonsi  Despacito ft  Justin Bieber Daddy Yankee (Official Video) -VEVO"
        assert yt._score_mv(title, "YouTube VeVo", "Luis Fonsi", "Despacito (feat. Daddy Yankee)") == -1

    def test_verified_label_channel_mv_is_provisional(self):
        title = "BTS (방탄소년단) 'Dynamite' Official MV"
        assert yt._score_mv(title, "HYBE LABELS", "BTS", "Dynamite") == -1
        assert yt._score_mv(title, "HYBE LABELS", "BTS", "Dynamite", verified=True) == 2

    def test_verified_channel_needs_mv_keyword_and_artist(self):
        assert yt._score_mv("BTS - Dynamite", "Some Label", "BTS", "Dynamite", verified=True) == -1
        assert yt._score_mv("Dynamite (Official MV)", "Some Label", "BTS", "Dynamite", verified=True) == -1

    def test_artist_channel_plain_title_is_provisional(self):
        assert yt._score_mv("Not Like Us", "Kendrick Lamar", "Kendrick Lamar", "Not Like Us") == 1

    def test_promo_film_on_artist_channel_is_not_provisional_mv(self):
        assert yt._score_mv("SZA - SOS Where The Hell Have You Been ?", "SZA", "SZA", "SOS") == -1
        assert yt._score_audio("SZA - SOS Where The Hell Have You Been ?", "SZA", "SZA", "SOS") == -1

    def test_iter_videos_reads_badges_and_snippet(self):
        vr = {
            "videoId": "abc",
            "title": {"runs": [{"text": "SOS"}]},
            "ownerText": {"runs": [{"text": "SZA"}]},
            "ownerBadges": [{"metadataBadgeRenderer": {"style": "BADGE_STYLE_TYPE_VERIFIED_ARTIST"}}],
            "detailedMetadataSnippets": [{"snippetText": {"runs": [{"text": "Provided to "}, {"text": "YouTube"}]}}],
        }
        data = {
            "contents": {
                "twoColumnSearchResultsRenderer": {
                    "primaryContents": {
                        "sectionListRenderer": {
                            "contents": [{"itemSectionRenderer": {"contents": [{"videoRenderer": vr}]}}]
                        }
                    }
                }
            }
        }
        assert list(yt._iter_videos(data)) == [yt._Video("abc", "SOS", "SZA", True, False, "Provided to YouTube")]

    def test_extract_data(self):
        assert yt._extract_data('xx var ytInitialData = {"a": 1}; more') == {"a": 1}
        assert yt._extract_data("nothing") is None


class TestGeniusOrder:
    """Music video, then lyric video, then official audio, then the auto-generated upload."""

    MV = ("mvvideo0001", "SZA - SOS (Official Music Video)", "SZA")
    LYRIC = ("lyricvid001", "SZA - SOS (Official Lyric Video)", "SZA")
    AUDIO = ("offaudio001", "SZA - SOS (Official Audio)", "SZA")
    TOPIC = ("topicupl001", "SOS", "SZA - Topic")

    @staticmethod
    async def pick(monkeypatch, *videos):
        results = [yt._Video(v[0], v[1], v[2], False, False, "") for v in videos]

        async def search(client, query):
            return results

        async def description(client, video_id):
            return ""

        monkeypatch.setattr(yt, "_search", search)
        monkeypatch.setattr(yt, "_fetch_description", description)
        url, kind = await yt.fetch_youtube_url("SOS", "SZA")
        return url.split("=")[-1], kind

    async def test_music_video_first(self, monkeypatch):
        got = await self.pick(monkeypatch, self.TOPIC, self.AUDIO, self.LYRIC, self.MV)
        assert got == (self.MV[0], "music-video")

    async def test_lyric_video_over_audio_and_topic(self, monkeypatch):
        got = await self.pick(monkeypatch, self.TOPIC, self.AUDIO, self.LYRIC)
        assert got == (self.LYRIC[0], "lyric-video")

    async def test_official_audio_over_topic_even_when_listed_after_it(self, monkeypatch):
        got = await self.pick(monkeypatch, self.TOPIC, self.AUDIO)
        assert got == (self.AUDIO[0], "official-audio")

    async def test_topic_only_when_nothing_better(self, monkeypatch):
        got = await self.pick(monkeypatch, self.TOPIC)
        assert got == (self.TOPIC[0], "auto-generated")

    async def test_no_kind_when_nothing_is_found(self, monkeypatch):
        assert await self.pick(monkeypatch) == ("", None)
