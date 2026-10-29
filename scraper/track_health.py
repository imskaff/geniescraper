"""
How a track is doing, at a glance: everything found, something the user should look at, or failed.

Port of the extension's core/trackHealth.ts, with the same levels and labels.
"""

from dataclasses import dataclass
from typing import Literal

from scraper.models import SongCredits

HealthLevel = Literal["waiting", "working", "ok", "attention", "error", "none"]
TrackStatus = Literal["pending", "loading", "done", "error", "unavailable"]


@dataclass(frozen=True)
class Health:
    level: HealthLevel
    label: str  # plain words for a list item and for a screen reader; never colour alone
    missing: tuple[str, ...] = ()  # what was expected but not found, for an "attention" track


_BY_STATUS: dict[str, Health] = {
    "pending": Health("waiting", "Waiting"),
    "loading": Health("working", "Reading"),
    "error": Health("error", "Failed"),
    "unavailable": Health("none", "No page"),
}


def track_health(
    status: TrackStatus,
    song: SongCredits | None,
    *,
    wants_copyright: bool = True,
    wants_cover_art: bool = True,
    wants_youtube: bool = True,
    youtube_searching: bool = False,
) -> Health:
    """Nothing is judged by what the track has not been asked for: only what was asked and is absent counts.

    `youtube_searching` is True while the YouTube look-up for this track is running or waiting its turn.
    """
    if status in _BY_STATUS:
        return _BY_STATUS[status]
    if song is None:
        return Health("error", "Failed")
    missing: list[str] = []
    if not song.credits:
        missing.append("credits")
    if wants_copyright and not song.phonographic_copyright and not song.copyright_notice:
        missing.append("copyright")
    if wants_cover_art and not song.cover_art_url:
        missing.append("cover art")
    awaiting_link = wants_youtube and not song.youtube_url
    if awaiting_link and not youtube_searching:
        missing.append("YouTube link")
    if not missing and awaiting_link:
        return Health("working", "Finding YouTube link")
    if not missing:
        return Health("ok", "All found")
    return Health("attention", f"Needs a look: {', '.join(missing)}", tuple(missing))
