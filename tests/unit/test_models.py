from scraper.models import Credit, SongCredits, _extract_labels


def song(**kw) -> SongCredits:
    base = {"title": "T", "artist": "A", "apple_music_url": "u", "credits": []}
    return SongCredits(**(base | kw))


class TestExtractLabels:
    def test_plain_label(self):
        assert _extract_labels("℗ 2024 Taylor Swift") == ["Taylor Swift"]

    def test_exclusive_license_splits_into_two_labels(self):
        assert _extract_labels("℗ 2022 Top Dawg Entertainment, under exclusive license to RCA Records") == [
            "Top Dawg Entertainment",
            "RCA Records",
        ]

    def test_division_of(self):
        assert _extract_labels("℗ 2019 Columbia Records, a Division of Sony Music Entertainment") == [
            "Columbia Records",
            "Sony Music Entertainment",
        ]

    def test_copyright_symbol(self):
        assert _extract_labels("© 2023 Big Label") == ["Big Label"]

    def test_empty_after_year(self):
        assert _extract_labels("℗ 2024") == []


class TestMergedCredits:
    def test_merges_same_role_case_insensitively_and_dedupes(self):
        s = song(
            credits=[
                Credit(role="Producer", artists=["A", "B"]),
                Credit(role="Mixing Engineer", artists=["C"]),
                Credit(role="producer", artists=["B", "D"]),
            ]
        )
        assert [(c.role, c.artists) for c in s.merged_credits()] == [
            ("Producer", ["A", "B", "D"]),
            ("Mixing Engineer", ["C"]),
        ]

    def test_drops_roles_without_artists(self):
        assert song(credits=[Credit(role="Producer", artists=[])]).merged_credits() == []


class TestTypedQueue:
    @staticmethod
    def full_song() -> SongCredits:
        return song(
            credits=[
                Credit(role="Mixing Engineer", artists=["Mixer"]),
                Credit(role="Songwriter", artists=["W1", "W2"]),
                Credit(role="Producer", artists=["P1"]),
                Credit(role="Lyrics", artists=["W3"]),
            ],
            phonographic_copyright="℗ 2024 Label A, under exclusive license to Label B",
            copyright_notice="© 2024 Label C",
            youtube_url="https://youtu.be/x",
            cover_art_url="https://img/1000x1000bb.png",
            release_date="2024-12-01",
        )

    def test_order_matches_genius_form(self):
        assert self.full_song().typed_queue() == [
            ("written_by", "W1"),
            ("written_by", "W2"),
            ("written_by", "W3"),
            ("produced_by", "P1"),
            ("role", "Mixing Engineer"),
            ("artist", "Mixer"),
            ("copyright_role", "Phonographic Copyright"),
            ("phonographic_copyright", "Label A"),
            ("phonographic_copyright", "Label B"),
            ("copyright_role", "Copyright"),
            ("copyright_notice", "Label C"),
            ("youtube_url", "https://youtu.be/x"),
            ("cover_art", "https://img/1000x1000bb.png"),
            ("release_month", "December"),
            ("release_day", "1"),
            ("release_year", "2024"),
        ]

    def test_copyright_falls_back_to_phonographic_labels(self):
        assert song(phonographic_copyright="℗ 2024 Label A").typed_queue() == [
            ("copyright_role", "Phonographic Copyright"),
            ("phonographic_copyright", "Label A"),
            ("copyright_role", "Copyright"),
            ("copyright_notice", "Label A"),
        ]

    def test_toggles_exclude_categories(self):
        q = self.full_song().typed_queue(
            include_core=False,
            include_copyright=False,
            include_youtube=False,
            include_cover_art=False,
            include_release_date=False,
        )
        assert q == [("role", "Mixing Engineer"), ("artist", "Mixer")]

    def test_written_and_produced_helpers(self):
        s = self.full_song()
        assert s.written_by() == ["W1", "W2", "W3"]
        assert s.produced_by() == ["P1"]
        assert [c.role for c in s.additional_credits()] == ["Mixing Engineer"]
