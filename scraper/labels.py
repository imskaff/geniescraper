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
    "interscope records": ("Interscope Records", UNIVERSAL),
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
    "universal music": ("", UNIVERSAL),
    "umg recordings": ("", UNIVERSAL),
    # Sony Music Entertainment
    "columbia records": ("Columbia Records", SONY),
    "rca records": ("RCA Records", SONY),
    "epic records": ("Epic Records", SONY),
    "arista records": ("Arista Records", SONY),
    "legacy recordings": ("Legacy Recordings", SONY),
    "sony music entertainment": ("", SONY),
    "sony music": ("", SONY),
}

_DISTRIBUTED_BY = re.compile(r"\bdistributed\s+by\s+", re.IGNORECASE)
_NEXT_CONNECTOR = re.compile(
    r",?\s+(?:under\s+(?:exclusive\s+)?licen[sc]e\s+(?:to|from)|a\s+division\s+of|an?\s+(?:imprint|label)\s+of"
    r"|released\s+by|marketed\s+by|distributed\s+by)\s+",
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


def _match(name: str) -> tuple[str, str] | None:
    padded = f" {_normalise(name)} "
    for phrase, found in LABEL_GROUPS.items():
        if f" {phrase} " in padded:
            return found
    return None


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
    labels: dict[str, str] = {}
    groups: dict[str, str] = {}
    for name in names:
        if hit := _match(name):
            label, group = hit
            if label:
                labels.setdefault(label, name)
            groups.setdefault(group, name)

    label = next(iter(labels)) if len(labels) == 1 else ""
    label_source = f"matched “{labels[label]}” in the ℗ line" if label else ""

    distributor = next(iter(groups)) if len(groups) == 1 else ""
    distributor_source = f"owning group of “{groups[distributor]}” in the ℗ line" if distributor else ""
    if stated := _stated_distributor(_strip_year(phonographic)):
        hit = _match(stated)
        distributor = hit[1] if hit else stated
        distributor_source = "named after “distributed by” in the ℗ line"
    return LabelInfo(label, distributor, label_source, distributor_source)
