"""
A YouTube link the user pasted, reduced to the one form the paste queue uses.

Port of the extension's core/youtubeLink.ts. Anything that is not a link to a single YouTube video gives None, so the
queue can never receive another site's address or a markup-looking string. The extension reads links with the browser's
WHATWG URL parser; the few places where urllib differs (backslashes, tabs and newlines inside the text, an invalid
port) are handled here, and tools/export_vectors.py checks both against the same inputs.
"""

import re
from urllib.parse import parse_qsl, quote_plus, urlsplit

_VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")
_HOSTS = frozenset({"www.youtube.com", "youtube.com", "m.youtube.com", "music.youtube.com"})
_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*://", re.IGNORECASE)
_MAX_LENGTH = 300


def parse_youtube_link(raw: str) -> str | None:
    """The canonical https link of the video in `raw`, or None when it is not a link to one YouTube video."""
    text = raw.strip()
    if not text or len(text) > _MAX_LENGTH:
        return None
    # The URL parser of a browser ignores tabs and newlines anywhere in the text, and reads a backslash as a slash.
    text = re.sub(r"[\t\r\n]", "", text)
    # A link pasted without its scheme ("youtu.be/abc...") still counts.
    candidate = text if _SCHEME.match(text) else f"https://{text}"
    try:
        head, sep, tail = candidate.partition("?")
        parts = urlsplit(head.replace("\\", "/") + sep + tail)
        _ = parts.port  # raises ValueError for a port that is not a number up to 65535
    except ValueError:
        return None
    if parts.scheme.lower() not in ("https", "http") or parts.username or parts.password:
        return None
    host = (parts.hostname or "").lower()
    video_id: str | None = None
    if host == "youtu.be":
        segments = parts.path.split("/")
        video_id = segments[1] if len(segments) > 1 else None
    elif host in _HOSTS:
        segments = [s for s in parts.path.split("/") if s]
        if segments and segments[0] == "watch":
            video_id = next((v for k, v in parse_qsl(parts.query, keep_blank_values=True) if k == "v"), None)
        elif segments and segments[0] in ("shorts", "embed", "live"):
            video_id = segments[1] if len(segments) > 1 else None
    if video_id is not None and _VIDEO_ID.fullmatch(video_id):
        return f"https://www.youtube.com/watch?v={video_id}"
    return None


def youtube_search_url(title: str, artist: str) -> str:
    """Where to look for a song on YouTube: a results page the user reads and chooses from, nothing is fetched."""
    query = re.sub(r"\s+", " ", f"{artist} {title} official music video").strip()
    # Encoded as the browser's URLSearchParams does: a space is +, ~ is %7E and * stays.
    encoded = quote_plus(query, safe="*").replace("~", "%7E")
    return f"https://www.youtube.com/results?search_query={encoded}"
