"""Pins every Genius role name the Apple Music mapping can produce to Genius's official list.

genius-standardized-roles.json is Genius's "Standardized Additional Roles" page; genius-unlisted-role-targets.json is
the reviewed set of names Genius does not list, which are left for the user to pick. A target in neither fails here.
"""

import json
import re
import unicodedata
from pathlib import Path

import pytest

from scraper.apple_music import _SKIP_ROLES
from scraper.roles import ROLE_MAP

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
OFFICIAL = json.loads((FIXTURES / "genius-standardized-roles.json").read_text(encoding="utf-8"))
REVIEWED = json.loads((FIXTURES / "genius-unlisted-role-targets.json").read_text(encoding="utf-8"))

REMOVED_SECTION = "Major Roles Removed"
LISTED = {r["name"] for s in OFFICIAL["sections"] if s["section"] != REMOVED_SECTION for r in s["roles"]}
REMOVED = {r["name"] for s in OFFICIAL["sections"] if s["section"] == REMOVED_SECTION for r in s["roles"]}
UNLISTED = set(REVIEWED["unlisted"])
TARGETS = set(ROLE_MAP.values())


def _loose(name: str) -> str:
    """Case, accents, hyphens, plural s and word order ignored: two names with one key are the same role spelled twice."""
    plain = "".join(c for c in unicodedata.normalize("NFD", name) if unicodedata.category(c) != "Mn")
    words = re.sub(r"[^a-z0-9 ]", " ", plain.lower()).split()
    return " ".join(sorted(w[:-1] if w.endswith("s") and len(w) > 3 and not w.endswith("ss") else w for w in words))


def test_fixture_reads_like_the_official_page():
    assert OFFICIAL["source"].startswith("https://genius.com/")
    assert len(LISTED) > 1500
    assert {"Bass Vocals", "Assistant Engineer", "Programmer", "Zills"} <= LISTED


def test_every_target_is_listed_or_reviewed_as_unlisted():
    unknown = sorted(t for t in TARGETS - LISTED - UNLISTED - REMOVED)
    assert not unknown, f"not on Genius's list and not reviewed as unlisted: {unknown}"


def test_reviewed_set_has_no_stale_entries():
    assert not sorted(UNLISTED & LISTED), "now listed on Genius; drop from genius-unlisted-role-targets.json"
    assert not sorted(UNLISTED - TARGETS), "no longer a ROLE_MAP target; drop from genius-unlisted-role-targets.json"


def test_removed_roles_are_never_typed():
    removed_targets = TARGETS & REMOVED
    assert removed_targets <= _SKIP_ROLES, sorted(removed_targets - _SKIP_ROLES)


def test_unlisted_targets_are_not_a_respelling_of_a_listed_role():
    by_key = {_loose(n): n for n in LISTED}
    near = {t: by_key[_loose(t)] for t in UNLISTED if _loose(t) in by_key}
    assert near == REVIEWED["nearMissProposals"]


@pytest.mark.parametrize(
    ("apple", "genius"),
    [
        ("bass (vocal)", "Bass Vocals"),
        ("soprano (vocal)", "Soprano Vocals"),
        ("cajon", "Cajón"),
        ("orchestrator", "Orchestration"),
        ("recorder", "Recorder (Woodwind)"),
        ("horn arranger", "Horns Arranger"),
        ("violoncello", "Cello"),
        ("cornetto", "Cornett"),
        ("steel drum", "Steelpan"),
        ("vibes", "Vibraphone"),
        ("moog", "Moog Synthesizer"),
        ("chitarrone", "Theorbo"),
        ("bukkehorn", "Goat Horn"),
        ("choral conductor", "Choir Conductor"),
        ("music supervisor", "Musical Supervision"),
        ("cover art", "Artwork"),
        ("tanpura", "Tambura"),
        ("immersive audio engineer", "Immersive Engineer"),
    ],
)
def test_corrected_targets(apple, genius):
    assert ROLE_MAP[apple] == genius
