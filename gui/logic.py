"""
Pure GUI decisions: link validation, wording and hotkey rules.

Kept free of Tk so every user-facing rule here is unit tested.
"""

import re

# music.apple.com/<storefront>/(album|song)/<optional slug>/<numeric id>
_APPLE_URL = re.compile(
    r"^https?://music\.apple\.com/[a-z]{2}/(album|song)/(?:[^/?#]+/)?(\d+)/?(?:[?#].*)?$",
    re.IGNORECASE,
)

# Keys the assistant presses itself, or that end the assistant.
_RESERVED_KEYS = frozenset({"esc", "tab", "enter", "space", "backspace", "delete"})
_MODIFIER_KEYS = frozenset({"shift", "ctrl", "alt", "alt gr", "windows", "left windows", "right windows", "unknown"})

STEPS = ("Link", "Tracks", "Review", "Paste")

#: The start screen's card of Apple Music pages open in the browser (the extension's own wording).
OPEN_PAGES_EMPTY = "Open an album or song on Apple Music in your browser and it shows up here."
OPEN_PAGES_PICK = "Pick one to get its credits."
MAX_OPEN_ROWS = 4
_MAX_TITLE_SHOWN = 56


def detector_title(count: int) -> str:
    """The detector's headline: listening while nothing is open, then what was found."""
    if count == 0:
        return "Listening for Apple Music pages…"
    return "Apple Music page detected" if count == 1 else f"{count} Apple Music pages detected"


def open_page_rows(pages, limit: int = MAX_OPEN_ROWS) -> tuple[list[tuple[str, str, str]], str]:
    """(tag, title, note) for each page shown, and a line for the ones that do not fit ('' when all do)."""
    rows = []
    for page in list(pages)[:limit]:
        title = page.title if len(page.title) <= _MAX_TITLE_SHOWN else page.title[: _MAX_TITLE_SHOWN - 1] + "…"
        rows.append(("Album" if page.kind == "album" else "Song", title, "this page" if page.current else ""))
    rest = len(pages) - len(rows)
    return rows, (f"and {rest} more open" if rest > 0 else "")


def classify_url(url: str) -> str | None:
    """'album' or 'song' for an Apple Music link the scraper understands, else None."""
    m = _APPLE_URL.match(url.strip())
    return m.group(1).lower() if m else None


def url_hint(url: str) -> tuple[bool, str]:
    """(can scrape, message to show under the link field)."""
    text = url.strip()
    if not text:
        return False, "Paste a link to an album or song on music.apple.com."
    kind = classify_url(text)
    if kind == "album":
        return True, "Album link. Copyright lines (℗ and ©) are included."
    if kind == "song":
        return True, "Song link. Use the album link instead to also get the ℗ and © lines."
    if "music.apple.com" in text.lower():
        return False, "This Apple Music link is not an album or song page."
    return False, "This is not an Apple Music link. It should start with https://music.apple.com/"


def friendly_error(message: str) -> str:
    """Rewrite a scrape failure into what happened and what to do next."""
    lower = message.lower()
    if "executable doesn't exist" in lower or "playwright install" in lower:
        # Playwright's own box of text hides the one useful part: where it looked, which names the browser revision.
        looked = re.search(r"Executable doesn't exist at\s+(\S.*)", message)
        where = f" (it looked for {looked.group(1).strip()})" if looked else ""
        return (
            f"The browser Géniescraper reads Apple Music with is missing or out of date{where}. "
            "Close the app, run  uv run playwright install chromium  in the project folder, then start it again."
        )
    if "page not found" in lower:
        return "Apple Music has no page at this link. Check the link and try again."
    if "timeout" in lower or "timed out" in lower:
        return "Apple Music took too long to answer. Check your connection and try again."
    if "net::" in lower or "connect" in lower or "network" in lower:
        return "Could not reach Apple Music. Check your internet connection and try again."
    return f"Scraping failed: {message}"


def _count(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def queue_summary(queue: list[tuple[str, str]]) -> str:
    """One-line description of what the assistant will paste, in Genius's terms."""
    kinds = [k for k, _ in queue]
    parts: list[str] = []
    if n := kinds.count("written_by"):
        parts.append(_count(n, "writer", "writers"))
    if n := kinds.count("produced_by"):
        parts.append(_count(n, "producer", "producers"))
    if n := kinds.count("role"):
        parts.append(_count(n, "additional role", "additional roles"))
    if n := kinds.count("copyright_role"):
        parts.append(_count(n, "copyright line", "copyright lines"))
    if "youtube_url" in kinds:
        parts.append("YouTube link")
    if "cover_art" in kinds:
        parts.append("cover art")
    if not parts:
        return "Nothing to paste. Check which fields are turned on in Settings."
    return f"{_count(len(queue), 'step', 'steps')}: " + ", ".join(parts)


def hotkey_error(key: str, other_key: str) -> str | None:
    """Why `key` cannot be used as an assistant hotkey, or None if it can."""
    k = key.lower()
    if k in _MODIFIER_KEYS:
        return "Press a single key, not a modifier like Shift or Ctrl."
    if k in _RESERVED_KEYS:
        return f"{k.upper()} is used by the assistant itself. Pick another key."
    if len(k) == 1:
        return "Letters, digits and symbols are needed for typing in Genius. Pick a function key such as F8."
    if k == other_key.lower():
        return f"{k.upper()} is already the other hotkey."
    return None


def prefetch_plan(parallel_reads: int) -> tuple[int, int]:
    """(tracks read at once, tracks started ahead) for the "parallel reads" setting; 0 reads every pending track.

    The default is 3, as in the extension; 1 reads one track at a time with two started ahead, as the app used to.
    """
    limit = parallel_reads if parallel_reads > 0 else 1000
    return limit, max(2, limit)
