"""Benchmark/golden case definitions and result comparison shared by tests and bench."""

import json
import re
from dataclasses import dataclass
from pathlib import Path

from scraper.models import SongCredits

ROOT = Path(__file__).resolve().parent.parent
CASES_FILE = ROOT / "bench" / "cases.json"
GOLDEN_DIR = ROOT / "tests" / "golden"


@dataclass(frozen=True)
class Case:
    id: str
    url: str
    track_index: int = 1
    note: str = ""


def load_cases() -> list[Case]:
    return [Case(**c) for c in json.loads(CASES_FILE.read_text(encoding="utf-8"))]


def load_golden(case_id: str) -> SongCredits:
    return SongCredits.model_validate_json((GOLDEN_DIR / f"{case_id}.json").read_text(encoding="utf-8"))


def artwork_key(url: str) -> str:
    """Host- and size-independent identity of an mzstatic artwork URL ('' if not one)."""
    m = re.search(r"/image/thumb/(.+)/[^/]+$", url)
    return m.group(1) if m else ""


def credit_map(song: SongCredits) -> dict[str, set[str]]:
    """Role -> artists, order-insensitive, after merging duplicate roles."""
    return {c.role: set(c.artists) for c in song.merged_credits()}


def credit_accuracy(actual: SongCredits, expected: SongCredits) -> float:
    """F1 over (role, artist) pairs; 1.0 means identical credits."""
    exp = {(r, a) for r, artists in credit_map(expected).items() for a in artists}
    act = {(r, a) for r, artists in credit_map(actual).items() for a in artists}
    if not exp and not act:
        return 1.0
    tp = len(exp & act)
    if tp == 0:
        return 0.0
    precision, recall = tp / len(act), tp / len(exp)
    return 2 * precision * recall / (precision + recall)


def diff(actual: SongCredits, expected: SongCredits) -> list[str]:
    """Human-readable differences on every field the scraper is responsible for."""
    problems: list[str] = []
    for field in ("title", "artist", "phonographic_copyright", "copyright_notice", "release_date"):
        a, e = getattr(actual, field), getattr(expected, field)
        if a != e:
            problems.append(f"{field}: got {a!r}, expected {e!r}")
    if artwork_key(actual.cover_art_url) != artwork_key(expected.cover_art_url):
        problems.append(f"cover_art_url: got {actual.cover_art_url!r}, expected artwork {expected.cover_art_url!r}")
    if actual.cover_art_url and not actual.cover_art_url.endswith("/1000x1000bb.png"):
        problems.append(f"cover_art_url is not the 1000x1000 PNG variant: {actual.cover_art_url!r}")
    act, exp = credit_map(actual), credit_map(expected)
    for role in sorted(exp.keys() - act.keys()):
        problems.append(f"missing role {role!r}: {sorted(exp[role])}")
    for role in sorted(act.keys() - exp.keys()):
        problems.append(f"unexpected role {role!r}: {sorted(act[role])}")
    for role in sorted(act.keys() & exp.keys()):
        if act[role] != exp[role]:
            problems.append(
                f"role {role!r}: missing {sorted(exp[role] - act[role])}, extra {sorted(act[role] - exp[role])}"
            )
    return problems
