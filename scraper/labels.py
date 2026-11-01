"""
Label and Distributor for the Genius form, derived from the song's ℗ line.

Apple Music and Spotify publish the ℗ owner, never the distributor (docs/research-distributors.md). Genius credits the
label by its imprint name and the distributor as the owning group for major releases. So a value is filled only when
the ℗ line clearly names a known imprint or group, or says "distributed by" outright; anything else stays empty.
Reviewed table: LABEL_GROUPS. The extension reads the same table from extension/data/labels.json (tools/export_labels).
"""

import re
from dataclasses import dataclass

SONY = "Sony Music Entertainment"
UNIVERSAL = "Universal Music Group"
WARNER = "Warner Music Group"

# An empty group means an independent label; an empty label means the name only identifies a group or distributor.
# Phrase found in a ℗ name (lowercase, letters and digits only, words joined by one space) -> (Genius label or "", group).
# An empty label means the name only identifies the group ("UMG Recordings"), so no label is claimed.
# Phrases match whole words anywhere in the name, so "Darkroom/Interscope Records" still finds Interscope.
LABEL_GROUPS: dict[str, tuple[str, str]] = {
    # Warner Music Group
    "atlantic recording corporation": ("Atlantic Records", WARNER),
    "atlantic records": ("Atlantic Records", WARNER),
    "warner records": ("Warner Records", WARNER),
    "warner bros records": ("Warner Records", WARNER),
    "warner music latina": ("Warner Music Latina", WARNER),
    "elektra entertainment": ("Elektra Records", WARNER),
    "elektra records": ("Elektra Records", WARNER),
    "parlophone records": ("Parlophone Records", WARNER),
    "parlophone": ("Parlophone Records", WARNER),
    "reprise records": ("Reprise Records", WARNER),
    "rhino entertainment": ("Rhino Records", WARNER),
    "rhino records": ("Rhino Records", WARNER),
    "asylum records": ("Asylum Records", WARNER),
    "sire records": ("Sire Records", WARNER),
    "300 entertainment": ("300 Entertainment", WARNER),
    "fueled by ramen": ("Fueled by Ramen", WARNER),
    "roadrunner records": ("Roadrunner Records", WARNER),
    "big beat records": ("Big Beat Records", WARNER),
    "warner music group": ("", WARNER),
    "warner music": ("", WARNER),
    # Universal Music Group
    "interscope": ("Interscope Records", UNIVERSAL),
    "geffen records": ("Geffen Records", UNIVERSAL),
    "republic records": ("Republic Records", UNIVERSAL),
    "island records": ("Island Records", UNIVERSAL),
    "def jam recordings": ("Def Jam Recordings", UNIVERSAL),
    "capitol records": ("Capitol Records", UNIVERSAL),
    "motown records": ("Motown Records", UNIVERSAL),
    "polydor records": ("Polydor Records", UNIVERSAL),
    "polydor": ("Polydor Records", UNIVERSAL),
    "mercury records": ("Mercury Records", UNIVERSAL),
    "virgin records": ("Virgin Records", UNIVERSAL),
    "decca records": ("Decca Records", UNIVERSAL),
    "deutsche grammophon": ("Deutsche Grammophon", UNIVERSAL),
    "decca classics": ("Decca Classics", UNIVERSAL),
    "island def jam music group": ("", UNIVERSAL),
    "universal music": ("", UNIVERSAL),
    "umg recordings": ("", UNIVERSAL),
    # Sony Music Entertainment
    "columbia records": ("Columbia Records", SONY),
    "rca records": ("RCA Records", SONY),
    "epic records": ("Epic Records", SONY),
    "arista records": ("Arista Records", SONY),
    "legacy recordings": ("Legacy Recordings", SONY),
    "sony bmg": ("", SONY),
    "sony music entertainment": ("", SONY),
    "sony music": ("", SONY),
    # Independent labels: the label is named, but no major owns it, so no distributor is claimed.
    "xl recordings": ("XL Recordings", ""),
    "domino recording": ("Domino Recording Company", ""),
    "sub pop": ("Sub Pop", ""),
    "epitaph": ("Epitaph Records", ""),
    "dead oceans": ("Dead Oceans", ""),
    "dirty hit": ("Dirty Hit", ""),
    "ato records": ("ATO Records", ""),
    "big loud records": ("Big Loud Records", ""),
    "rimas entertainment": ("Rimas Entertainment", ""),
    "88rising": ("88rising", ""),
    # Distribution services: the line names the service, so it is the distributor and no label is claimed.
    "awal": ("", "AWAL"),
    "the orchard": ("", "The Orchard"),
    "ingrooves": ("", "Ingrooves Music Group"),
    "alternative distribution alliance": ("", "Alternative Distribution Alliance"),
    "believe sas": ("", "Believe"),
    "believe music": ("", "Believe"),
    "believe distribution": ("", "Believe"),
    "tunecore": ("", "TuneCore"),
    "cd baby": ("", "CD Baby"),
    "distrokid": ("", "DistroKid"),
    "empire distribution": ("", "EMPIRE"),
}
MAJORS = frozenset({SONY, UNIVERSAL, WARNER})

_DISTRIBUTED_BY = re.compile(r"\bdistributed\s+(?:by|through)\s+", re.IGNORECASE)
_NEXT_CONNECTOR = re.compile(
    r",?\s+(?:under\s+(?:exclusive\s+)?licen[sc]e\s+(?:to|from)|a\s+division\s+of|an?\s+(?:imprint|label)\s+of"
    r"|released\s+by|marketed\s+by|distributed\s+(?:by|through))\s+",
    re.IGNORECASE,
)

_SECONDARY = re.compile(
    r"(?:marketed\s+(?:and\s+distributed\s+)?by|released\s+by|(?:a|an)\s+(?:division|imprint|label)\s+of)\s+",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class LabelInfo:
    label: str = ""
    distributor: str = ""
    # Where each value came from, in words for the review screen; "" when the value is empty.
    label_source: str = ""
    distributor_source: str = ""


def _normalise(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def _matches(name: str) -> list[tuple[str, str]]:
    """Every distinct (label, group) the name contains: "Mercury Records/Republic Records" names two labels."""
    padded = f" {_normalise(name)} "
    found: list[tuple[str, str]] = []
    for phrase, hit in LABEL_GROUPS.items():
        if f" {phrase} " in padded and hit not in found:
            found.append(hit)
    return found


def _match(name: str) -> tuple[str, str] | None:
    hits = _matches(name)
    return hits[0] if hits else None


def _is_distributor(line: str, name: str) -> bool:
    """True for a name that follows "distributed by" or "distributed through": it distributes, it is not the label."""
    return bool(re.search(_DISTRIBUTED_BY.pattern + re.escape(name), line, re.IGNORECASE))


def _is_secondary(line: str, name: str) -> bool:
    """True for a name that follows "marketed by" or "a division of": the parent or marketer, not the label itself."""
    return bool(re.search(_SECONDARY.pattern + re.escape(name), line, re.IGNORECASE))


def _strip_year(line: str) -> str:
    return re.sub(r"^[℗©]\s*\d{4}\s*", "", line).strip()


def _stated_distributor(line: str) -> str:
    """The name after 'distributed by' in the ℗ line, or ''."""
    found = _DISTRIBUTED_BY.search(line)
    if not found:
        return ""
    return _NEXT_CONNECTOR.split(line[found.end() :])[0].strip().strip(",").strip()


def derive_label_info(phonographic: str, names: list[str]) -> LabelInfo:
    """`names` are the labels of the ℗ line (scraper.models._extract_labels). Empty when the evidence is not clear."""
    if not phonographic or not names:
        return LabelInfo()
    labels: dict[str, tuple[str, str, bool]] = {}  # label -> (name, group, secondary)
    groups: dict[str, str] = {}
    # "X, distributed through Y" arrives as one name: X can be the label, Y only distributes.
    parts: list[tuple[str, bool]] = []
    for name in names:
        found = _DISTRIBUTED_BY.search(name)
        if found:
            parts += [(name[: found.start()].strip(" ,"), False), (name[found.end() :], True)]
        else:
            parts.append((name, _is_distributor(phonographic, name)))
    for name, distributing in parts:
        secondary = _is_secondary(phonographic, name)
        for label, group in _matches(name):
            if label and not distributing:
                labels.setdefault(label, (name, group, secondary))
            if group:
                groups.setdefault(group, name)
    # A marketer or parent of the same group as a primary label (Rhino for Atlantic, Atlantic UK for Asylum) is not
    # a second candidate; across groups the line stays ambiguous.
    primary_groups = {group for _, group, secondary in labels.values() if not secondary}
    candidates = {k: v for k, v in labels.items() if not (v[2] and v[1] in primary_groups)}

    label = next(iter(candidates)) if len(candidates) == 1 else ""
    label_source = f"matched “{candidates[label][0]}” in the ℗ line" if label else ""

    distributor = next(iter(groups)) if len(groups) == 1 else ""
    distributor_source = ""
    if distributor:
        who = "owning group of" if distributor in MAJORS else "distributor"
        distributor_source = f"{who} “{groups[distributor]}” in the ℗ line"
    if stated := _stated_distributor(_strip_year(phonographic)):
        hit = _match(stated)
        distributor = (hit[1] if hit else "") or stated
        distributor_source = "named after “distributed by” in the ℗ line"
    return LabelInfo(label, distributor, label_source, distributor_source)
