"""Release dates as read from Apple Music pages: ISO 'YYYY-MM-DD', or '' when unknown.

Sources, best first: the page's `music:release_date` meta tag (locale independent, and the song's own date), the
song page's visible release-date line, the album footer (the album's date, which a track may not share). The visible
texts are English; text in another language, or a date that is not on the calendar, gives '' instead of a guess.
The TypeScript port (extension/src/core/releaseDate.ts) must give the same answers: see tools/export_vectors.py.
"""

import re
from datetime import date

MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)

# Lower-case names and the usual abbreviations, to the month number.
_MONTH_NUMBER: dict[str, int] = {name.lower(): n for n, name in enumerate(MONTHS, start=1)}
_MONTH_NUMBER.update({name[:3].lower(): n for n, name in enumerate(MONTHS, start=1)})
_MONTH_NUMBER["sept"] = 9

_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?![0-9])", re.ASCII)
_MONTH_FIRST = re.compile(r"([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?![0-9])", re.ASCII)
_DAY_FIRST = re.compile(r"(?<![0-9])(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})(?![0-9])", re.ASCII)


def _iso(year: int, month: int, day: int) -> str:
    """'YYYY-MM-DD' for a real calendar date, else ''."""
    try:
        date(year, month, day)
    except ValueError:
        return ""
    return f"{year:04d}-{month:02d}-{day:02d}"


def date_from_meta(content: str) -> str:
    """The date of a `music:release_date` value such as '2024-05-17T00:00:00.000Z' ('' if it is not a real date).

    Only the date part is taken: the time of day is midnight UTC and must not shift the day.
    """
    m = _ISO.match(content.strip())
    return _iso(int(m[1]), int(m[2]), int(m[3])) if m else ""


def date_from_text(text: str) -> str:
    """The first English date in a text, 'May 17, 2024' or '17 May 2024' style ('' if none, or not a real date)."""
    for m in _MONTH_FIRST.finditer(text):
        month = _MONTH_NUMBER.get(m[1].lower())
        if month:
            return _iso(int(m[3]), month, int(m[2]))
    for m in _DAY_FIRST.finditer(text):
        month = _MONTH_NUMBER.get(m[2].lower())
        if month:
            return _iso(int(m[3]), month, int(m[1]))
    return ""


def pick_release_date(meta: str, subtitle: str, footer: str) -> str:
    """The best date among the meta tag, the song page's release-date line and the album footer text."""
    return date_from_meta(meta) or date_from_text(subtitle) or date_from_text(footer)


def split_release_date(iso: str) -> tuple[int, int, int] | None:
    """(year, month, day) of a stored 'YYYY-MM-DD', or None when it is empty or not a real date."""
    m = _ISO.match(iso)
    if not m or len(iso) != 10:
        return None
    year, month, day = int(m[1]), int(m[2]), int(m[3])
    return (year, month, day) if _iso(year, month, day) else None


def format_release_date(iso: str) -> str:
    """'May 17, 2024' for a stored date; '' when there is none."""
    parts = split_release_date(iso)
    if parts is None:
        return ""
    year, month, day = parts
    return f"{MONTHS[month - 1]} {day}, {year}"
