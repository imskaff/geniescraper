"""A YouTube link the user pasted, reduced to one watch link; the cases are those of the extension's youtubeLink.test.ts."""

from urllib.parse import parse_qs, urlsplit

import pytest

from scraper.youtube_link import parse_youtube_link, youtube_search_url

ID = "BY_XwvKogC8"
WATCH = f"https://www.youtube.com/watch?v={ID}"


@pytest.mark.parametrize(
    "raw",
    [
        WATCH,
        f"  {WATCH}  ",
        f"http://www.youtube.com/watch?v={ID}",
        f"https://youtube.com/watch?v={ID}&t=42s&list=PL123",
        f"https://m.youtube.com/watch?v={ID}",
        f"https://music.youtube.com/watch?v={ID}&si=abc",
        f"https://youtu.be/{ID}",
        f"https://youtu.be/{ID}?si=xyz&t=3",
        f"youtu.be/{ID}",
        f"www.youtube.com/watch?v={ID}",
        f"https://www.youtube.com/shorts/{ID}",
        f"https://www.youtube.com/embed/{ID}",
        f"https://www.youtube.com/live/{ID}?feature=share",
        f"HTTPS://WWW.YOUTUBE.COM/watch?v={ID}",
        f"https://www.youtube.com:443/watch?v={ID}",
        f"https://www.youtube.com\\watch?v={ID}",
        f"https://www.youtube.com/watch?v={ID}\n",
        f"https://www.you\ttube.com/watch?v={ID}",
    ],
)
def test_turns_a_link_to_one_video_into_the_watch_link(raw):
    assert parse_youtube_link(raw) == WATCH


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "hello",
        "https://example.com/watch?v=BY_XwvKogC8",
        "https://www.youtube.com.evil.example/watch?v=BY_XwvKogC8",
        "https://evil.example/https://www.youtube.com/watch?v=BY_XwvKogC8",
        "https://user:pass@www.youtube.com/watch?v=BY_XwvKogC8",
        "https://www.youtube.com/watch",
        "https://www.youtube.com/watch?v=short",
        "https://www.youtube.com/watch?v=BY_XwvKogC8extra",
        "https://www.youtube.com/watch?v=BY_XwvKogC!",
        "https://www.youtube.com/playlist?list=PLabcdefghijk",
        "https://www.youtube.com/results?search_query=billie",
        "https://www.youtube.com/@BillieEilish",
        "https://youtu.be/",
        "https://youtu.be",
        "javascript:alert(1)",
        "ftp://www.youtube.com/watch?v=BY_XwvKogC8",
        '<script>alert("x")</script>',
        "https://www.youtube.com/watch?v=BY_XwvKogC8" + "a" * 400,
        "https://www.youtube.com:99999/watch?v=BY_XwvKogC8",
        "https://www.youtube.com:abc/watch?v=BY_XwvKogC8",
        "https://[::1/watch?v=BY_XwvKogC8",
        "https://www.youtube.com./watch?v=BY_XwvKogC8",
    ],
)
def test_rejects_anything_else(raw):
    assert parse_youtube_link(raw) is None


def test_the_search_url_is_a_results_page_for_the_artist_the_title_and_official_music_video():
    parts = urlsplit(youtube_search_url("Don't Smile & Go", "Billie  Eilish"))
    assert f"{parts.scheme}://{parts.netloc}{parts.path}" == "https://www.youtube.com/results"
    assert parse_qs(parts.query)["search_query"] == ["Billie Eilish Don't Smile & Go official music video"]


def test_the_search_url_stays_on_youtube_whatever_the_title_holds():
    parts = urlsplit(youtube_search_url("//evil.example/?x=1#", "a/b"))
    assert parts.hostname == "www.youtube.com"
    assert parts.fragment == ""


def test_the_search_url_is_encoded_as_the_extension_encodes_it():
    """URLSearchParams: a space is +, ~ is %7E, * stays."""
    assert youtube_search_url("a~b*c", "d e").endswith("search_query=d+e+a%7Eb*c+official+music+video")
