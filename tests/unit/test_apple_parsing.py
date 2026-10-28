import pytest

from scraper import apple_music as am
from scraper.models import Credit


class TestExtractTitleArtist:
    @pytest.mark.parametrize(
        ("page_title", "expected"),
        [
            ("‎SOS - Album by SZA - Apple Music", ("SOS", "SZA")),
            ("Shabang – Single – Drake – Apple Music", ("Shabang", "Drake")),
            ("Slime You Out (feat. SZA) - Single by Drake on Apple Music", ("Slime You Out (feat. SZA)", "Drake")),
            ("‎UTOPIA - Album by Travis Scott - Apple Music", ("UTOPIA", "Travis Scott")),
            ("", ("", "")),
            ("Nothing useful here", ("", "")),
        ],
    )
    def test_known_formats(self, page_title, expected):
        assert am._extract_title_artist(page_title) == expected

    def test_song_with_lyrics_prefix(self):
        title = "‎Not Like Us - Song with Lyrics by Kendrick Lamar - Apple Music"
        assert am._extract_title_artist(title) == ("Not Like Us", "Kendrick Lamar")


class TestCreditsFromCards:
    def test_pairs_names_with_comma_separated_roles(self):
        credits = am.credits_from_cards(
            ["FINNEAS", "Billie Eilish", "Dale Becker"],
            ["Producer, Bass", "Vocals, songwriter", "Mastering Engineer"],
        )
        assert credits == [
            Credit(role="Producer", artists=["FINNEAS"]),
            Credit(role="Bass", artists=["FINNEAS"]),
            Credit(role="Vocals", artists=["Billie Eilish"]),
            Credit(role="Songwriter", artists=["Billie Eilish"]),
            Credit(role="Mastering Engineer", artists=["Dale Becker"]),
        ]

    def test_mismatched_lengths_yield_nothing(self):
        assert am.credits_from_cards(["A", "B"], ["Producer"]) == []

    def test_skips_genius_incompatible_roles(self):
        assert am.credits_from_cards(["A"], ["Performer, Producer"]) == [Credit(role="Producer", artists=["A"])]

    def test_unknown_role_kept_verbatim(self):
        assert am.credits_from_cards(["A"], ["Theremin Wrangler"]) == [Credit(role="Theremin Wrangler", artists=["A"])]


class TestCreditsFromText:
    def test_walks_role_headers(self):
        text = "\n".join(["Credits", "Producer", "Rick Rubin", "Mixing Engineer:", "A & B", "℗ 2024 Label"])
        assert am.credits_from_text(text) == [
            Credit(role="Producer", artists=["Rick Rubin"]),
            Credit(role="Mixing Engineer", artists=["A", "B"]),
        ]

    def test_ignores_noise_lines(self):
        text = "Producer\nMore By Someone\n" + "x" * 81 + "\nReal Name"
        assert am.credits_from_text(text) == [Credit(role="Producer", artists=["Real Name"])]


class TestSmallHelpers:
    def test_split_copyright_same_line(self):
        assert am.split_copyright("℗ 2023 X Records © 2023 Y Ltd") == ("℗ 2023 X Records", "© 2023 Y Ltd")

    def test_split_copyright_from_footer(self):
        raw = "December 9, 2022\n23 songs, 1 hour 8 minutes\n℗ 2022 Top Dawg Entertainment"
        assert am.split_copyright(raw) == ("℗ 2022 Top Dawg Entertainment", "")

    def test_split_copyright_empty(self):
        assert am.split_copyright("") == ("", "")

    @pytest.mark.parametrize(
        "url",
        [
            "https://is1-ssl.mzstatic.com/image/thumb/A/b.jpg/600x600bb.jpg",
            "https://is1-ssl.mzstatic.com/image/thumb/A/b.jpg/1200x630wp-60.jpg?x=1",
            "https://is1-ssl.mzstatic.com/image/thumb/A/b.jpg/296x296.webp",
        ],
    )
    def test_normalise_cover_url(self, url):
        assert am.normalise_cover_url(url) == "https://is1-ssl.mzstatic.com/image/thumb/A/b.jpg/1000x1000bb.png"

    @pytest.mark.parametrize(
        ("url", "expected"),
        [
            ("https://music.apple.com/us/album/sour/1560734944", ("1560734944", "us")),
            ("https://music.apple.com/gb/album/sour/1560734944?i=1560735551", ("1560734944", "gb")),
            ("https://music.apple.com/us/song/not-like-us/1781353929", ("1781353929", "us")),
            ("https://music.apple.com/us/album/no-id", ("", "")),
            ("https://example.com/us/album/x/123", ("", "")),
        ],
    )
    def test_catalog_id(self, url, expected):
        assert am.catalog_id(url) == expected

    def test_cover_from_lookup(self):
        art = "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/02/ed/8c/x/21UMGIM26093.rgb.jpg"
        data = {"resultCount": 1, "results": [{"wrapperType": "collection", "artworkUrl100": f"{art}/100x100bb.jpg"}]}
        assert am.cover_from_lookup(data) == f"{art}/1000x1000bb.png"

    @pytest.mark.parametrize("data", [{}, {"results": []}, {"results": [{"artworkUrl100": ""}]}, {"results": None}])
    def test_cover_from_lookup_empty(self, data):
        assert am.cover_from_lookup(data) == ""

    @pytest.mark.parametrize(
        ("urls", "expected"),
        [
            (
                [
                    "https://x/image/thumb/Video1/a.png/296x296bb.webp",
                    "https://x/image/thumb/Music1/b.jpg/296x296bb.webp",
                ],
                "https://x/image/thumb/Music1/b.jpg/1000x1000bb.png",
            ),
            (
                [
                    "https://x/image/thumb/Features1/a.png/296x296bb.webp",
                    "https://x/image/thumb/Video1/b.png/1x1bb.webp",
                ],
                "",
            ),
            ([], ""),
        ],
    )
    def test_pick_cover_url_only_accepts_music_artwork(self, urls, expected):
        assert am.pick_cover_url(urls) == expected

    @pytest.mark.parametrize(("raw", "count"), [("23 songs, 1 hour 8 minutes", 23), ("1 song, 2 minutes", 1), ("", 1)])
    def test_track_count_from_footer(self, raw, count):
        assert am.track_count_from_footer(raw) == count

    def test_parse_artists(self):
        assert am._parse_artists("A, B & C • D") == ["A", "B", "C", "D"]

    def test_normalise_role_maps_aliases(self):
        assert am._normalise_role(" written by: ") == "Writer"
        assert am._normalise_role("Unmapped Role:") == "Unmapped Role"

    @pytest.mark.parametrize(
        ("apple_role", "genius_role"),
        [
            ("Programming", "Programmer"),
            (" programming: ", "Programmer"),
            ("Drum Programming", "Drum Programmer"),
            ("Assistant Programming", "Assistant Programmer"),
            ("Rhythm Programming", "Rhythm Programmer"),
            ("Synthesizer Programming", "Synthesizer Programmer"),
            ("Vocal Programming", "Vocal Programmer"),
        ],
    )
    def test_programming_roles_are_typed_as_genius_names_them(self, apple_role, genius_role):
        # Genius has "Programmer" and "Drum Programmer" and no "Programming": typing the Apple name finds nothing.
        assert am._normalise_role(apple_role) == genius_role
