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
