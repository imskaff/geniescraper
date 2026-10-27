import pytest

from gui.logic import classify_url, friendly_error, hotkey_error, queue_summary, url_hint


@pytest.mark.parametrize(
    ("url", "kind"),
    [
        ("https://music.apple.com/us/album/sos/1658650093", "album"),
        ("https://music.apple.com/gb/album/sour/1560734944?i=1560735414", "album"),
        ("  https://music.apple.com/us/song/not-like-us/1781353929  ", "song"),
        ("https://music.apple.com/us/album/1560734944", "album"),
        ("https://music.apple.com/us/artist/sza/605800394", None),
        ("https://open.spotify.com/album/abc", None),
        ("music.apple.com/us/album/sos/1658650093", None),
        ("", None),
    ],
)
def test_classify_url(url, kind):
    assert classify_url(url) == kind


def test_url_hint_guides_each_case():
    assert url_hint("") == (False, "Paste a link to an album or song on music.apple.com.")
    ok, msg = url_hint("https://music.apple.com/us/album/sos/1658650093")
    assert ok and "℗" in msg
    ok, msg = url_hint("https://music.apple.com/us/song/not-like-us/1781353929")
    assert ok and "album link" in msg
    assert url_hint("https://music.apple.com/us/artist/sza/605800394")[0] is False
    assert url_hint("https://example.com")[1].startswith("This is not an Apple Music link")


@pytest.mark.parametrize(
    ("raw", "starts"),
    [
        ("Page not found — check the URL and try again.", "Apple Music has no page"),
        ("Timeout 30000ms exceeded.", "Apple Music took too long"),
        ("net::ERR_INTERNET_DISCONNECTED", "Could not reach Apple Music"),
        ("something odd", "Scraping failed: something odd"),
    ],
)
def test_friendly_error(raw, starts):
    assert friendly_error(raw).startswith(starts)


def test_queue_summary_counts_in_genius_terms():
    queue = [
        ("written_by", "A"),
        ("written_by", "B"),
        ("produced_by", "C"),
        ("role", "Mixing Engineer"),
        ("artist", "D"),
        ("copyright_role", "Phonographic Copyright"),
        ("phonographic_copyright", "Label"),
        ("youtube_url", "https://youtu.be/x"),
        ("cover_art", "https://img"),
    ]
    assert queue_summary(queue) == (
        "9 steps: 2 writers, 1 producer, 1 additional role, 1 copyright line, YouTube link, cover art"
    )


def test_queue_summary_empty():
    assert queue_summary([]).startswith("Nothing to paste")


@pytest.mark.parametrize(
    ("key", "other", "ok"),
    [
        ("f9", "f7", True),
        ("page down", "f7", True),
        ("f7", "f7", False),
        ("esc", "f7", False),
        ("tab", "f7", False),
        ("a", "f7", False),
        ("5", "f7", False),
        ("shift", "f7", False),
    ],
)
def test_hotkey_rules(key, other, ok):
    assert (hotkey_error(key, other) is None) is ok
