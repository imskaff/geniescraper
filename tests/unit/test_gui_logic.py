import pytest

from gui.link import OpenPage
from gui.logic import (
    MAX_OPEN_ROWS,
    classify_url,
    friendly_error,
    hotkey_error,
    open_page_rows,
    prefetch_plan,
    queue_summary,
    url_hint,
)


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
        ("Page not found. Check the URL and try again.", "Apple Music has no page"),
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


@pytest.mark.parametrize(
    ("reads", "limit", "lookahead"),
    [
        (1, 1, 2),  # the default: one track read at a time, two ahead of the one being pasted
        (2, 2, 2),
        (3, 3, 3),
        (5, 5, 5),
        (0, 1000, 1000),  # all of them at once
    ],
)
def test_prefetch_plan(reads, limit, lookahead):
    assert prefetch_plan(reads) == (limit, lookahead)


def test_open_page_rows_tag_name_and_mark_the_page_in_view():
    pages = [
        OpenPage("https://music.apple.com/us/album/a/1", "Album A", "album", True),
        OpenPage("https://music.apple.com/us/song/b/2", "Song B", "song", False),
    ]
    assert open_page_rows(pages) == ([("Album", "Album A", "this page"), ("Song", "Song B", "")], "")


def test_open_page_rows_cut_long_titles_and_say_how_many_more_there_are():
    pages = [
        OpenPage(f"https://music.apple.com/us/song/s/{n}", "t" * 120, "song", False) for n in range(MAX_OPEN_ROWS + 3)
    ]
    rows, more = open_page_rows(pages)
    assert len(rows) == MAX_OPEN_ROWS and all(len(title) <= 56 and title.endswith("…") for _, title, _ in rows)
    assert more == "and 3 more open"


PLAYWRIGHT_MISSING = (
    "BrowserType.launch: Executable doesn't exist at "
    r"C:\Users\skf\AppData\Local\ms-playwright\chromium_headless_shell-1248\chrome-headless-shell-win64\chrome-headless-shell.exe"
    "\n+------------------------------------------------+\n"
    "|| Looks like Playwright was just installed or updated. ||\n"
    "|| Please run the following command to download new browsers: ||\n"
    "||     playwright install ||\n"
    "+------------------------------------------------+"
)


def test_a_missing_playwright_browser_says_where_it_looked_and_how_to_fix_it():
    text = friendly_error(PLAYWRIGHT_MISSING)
    assert "chromium_headless_shell-1248" in text  # the revision is the clue to a version mismatch
    assert "uv run playwright install chromium" in text
    assert "+---" not in text and "||" not in text  # none of Playwright's box art


def test_a_playwright_message_without_a_path_still_gets_the_fix():
    text = friendly_error("Please run the following command to download new browsers: playwright install")
    assert "uv run playwright install chromium" in text and "it looked for" not in text
