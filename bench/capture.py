"""
Capture golden expectations and offline HTML fixtures from live Apple Music.

    uv run python -m bench.capture            # all cases
    uv run python -m bench.capture sza-sos-t1  # selected cases

Writes, per case:
  tests/golden/<id>.json          SongCredits from the current scraper, only when no golden exists yet;
                                  otherwise tests/golden/<id>.candidate.json for manual diffing.
                                  Golden files are hand-reviewed truth: never overwrite them blindly.
  tests/fixtures/<id>.page.html   album/song page, scripts stripped
  tests/fixtures/<id>.credits.html credits view, scripts stripped
"""

import asyncio
import json
import re
import sys
from pathlib import Path

from bench.cases import Case, load_cases
from scraper import apple_music

ROOT = Path(__file__).resolve().parent.parent
GOLDEN_DIR = ROOT / "tests" / "golden"
FIXTURE_DIR = ROOT / "tests" / "fixtures"

_SCRIPT_RE = re.compile(r"<script\b[^>]*>.*?</script>", re.IGNORECASE | re.DOTALL)


def strip_scripts(html: str) -> str:
    """Drop <script> blocks so fixtures are small and inert."""
    return _SCRIPT_RE.sub("", html)


async def capture_fixtures(case: Case) -> None:
    context, page = await apple_music._new_stealth_page()
    try:
        await apple_music._open(page, case.url)
        page_html = strip_scripts(await page.content())
        title = await page.title()
        if "/album/" in case.url and not await apple_music._click_view_credits(page, nth_index=case.track_index):
            raise RuntimeError(f"{case.id}: could not open View Credits")
        await page.wait_for_load_state("networkidle", timeout=15_000)
        await asyncio.sleep(1.5)
        credits_html = strip_scripts(await page.content())
    finally:
        await context.close()

    # Keep the live <title> so title parsing can be tested offline.
    page_html = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", page_html, count=1, flags=re.DOTALL)
    (FIXTURE_DIR / f"{case.id}.page.html").write_text(page_html, encoding="utf-8")
    (FIXTURE_DIR / f"{case.id}.credits.html").write_text(credits_html, encoding="utf-8")


async def capture_golden(case: Case) -> None:
    song = await apple_music.scrape(case.url, track_index=case.track_index)
    data = song.model_dump(exclude={"youtube_url", "youtube_kind"})
    target = GOLDEN_DIR / f"{case.id}.json"
    if target.exists():
        target = GOLDEN_DIR / f"{case.id}.candidate.json"
    target.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


async def main(ids: list[str]) -> None:
    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    cases = [c for c in load_cases() if not ids or c.id in ids]
    try:
        for case in cases:
            print(f"capturing {case.id} …", flush=True)
            await capture_golden(case)
            await capture_fixtures(case)
    finally:
        await apple_music.close_browser()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
