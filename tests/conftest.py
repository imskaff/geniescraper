from pathlib import Path

import pytest

FIXTURE_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
async def browser():
    """Plain headless Chromium for offline fixture tests (no stealth, no network)."""
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        b = await pw.chromium.launch(headless=True)
        yield b
        await b.close()


@pytest.fixture
async def load_fixture(browser):
    """Return a coroutine that opens tests/fixtures/<name> in a fresh offline page."""
    context = await browser.new_context(offline=True, java_script_enabled=False)

    async def _load(name: str):
        page = await context.new_page()
        await page.set_content((FIXTURE_DIR / name).read_text(encoding="utf-8"), wait_until="domcontentloaded")
        return page

    yield _load
    await context.close()
