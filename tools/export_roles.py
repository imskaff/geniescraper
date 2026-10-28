"""
Export the Apple Music role map for the browser extension.

    uv run python -m tools.export_roles

Writes extension/data/roles.json from scraper.roles.ROLE_MAP, the single source of truth.
tests/unit/test_extension_exports.py fails when the committed file is stale.
"""

import json
from pathlib import Path

from scraper.roles import ROLE_MAP

OUTPUT = Path(__file__).resolve().parent.parent / "extension" / "data" / "roles.json"


def build() -> str:
    """The exact file content: sorted keys, UTF-8 and LF endings, so diffs and the staleness test are stable."""
    return json.dumps(ROLE_MAP, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(build(), encoding="utf-8", newline="\n")
    print(f"wrote {OUTPUT} ({len(ROLE_MAP)} roles)")


if __name__ == "__main__":
    main()
