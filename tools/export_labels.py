"""
Export the label-to-group table for the browser extension.

    uv run python -m tools.export_labels

Writes extension/data/labels.json from scraper.labels.LABEL_GROUPS, the single source of truth.
tests/unit/test_extension_exports.py fails when the committed file is stale.
"""

import json
from pathlib import Path

from scraper.labels import LABEL_GROUPS

OUTPUT = Path(__file__).resolve().parent.parent / "extension" / "data" / "labels.json"


def build() -> str:
    """Entries keep their table order (the first matching phrase wins), as [phrase, label, group] rows."""
    rows = [[phrase, label, group] for phrase, (label, group) in LABEL_GROUPS.items()]
    return json.dumps(rows, ensure_ascii=False, indent=1) + "\n"


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(build(), encoding="utf-8", newline="\n")
    print(f"wrote {OUTPUT} ({len(LABEL_GROUPS)} entries)")


if __name__ == "__main__":
    main()
