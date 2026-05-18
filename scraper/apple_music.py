"""
Scrapes song credits from Apple Music using the UI navigation path:
  Album/song page → MORE button (aria-label="MORE") → "View Credits"

This is more reliable than API interception because the dedicated credits
page has a clean, structured layout purpose-built for credit display.

Accepted URL formats:
  https://music.apple.com/us/song/<slug>/<song-id>
  https://music.apple.com/us/album/<slug>/<album-id>
"""

import asyncio
import re
from dataclasses import dataclass, field
from pathlib import Path
from playwright.async_api import async_playwright, Page, TimeoutError as PWTimeout
from playwright_stealth import Stealth
from scraper.models import Credit, SongCredits
from scraper.roles import ROLE_MAP, ALL_ROLE_KEYS


@dataclass
class AlbumTrackInfo:
    url: str
    album_title: str
    artist: str
    track_count: int
    track_titles: list[str] = field(default_factory=list)
    cover_art_url: str = ""


def _normalise_role(raw: str) -> str:
    key = raw.strip().lower().rstrip(":").strip()
    return ROLE_MAP.get(key, raw.strip().rstrip(":").strip())


def _parse_artists(raw: str) -> list[str]:
    parts = re.split(r"\s*[,&•]\s*", raw)
    return [p.strip() for p in parts if p.strip()]


# ---------------------------------------------------------------------------
# Credits page parser — used after "View Credits" navigation
# ---------------------------------------------------------------------------

_NOISE_PREFIXES = ("more by", "© ", "℗ ", "all rights", "℗©", "apple music")

_SECTION_HEADERS = frozenset({
    "composition, lyrics", "production, engineering", "performance",
    "audio", "arranging", "management", "visual", "liner notes",
    "additional credits", "credits", "performers", "personnel",
    "recording information",
})


def _is_noise(line: str) -> bool:
    """Returns True for lines that are page chrome, not artist names."""
    lower = line.lower()
    if lower in _SECTION_HEADERS:
        return True
    for prefix in _NOISE_PREFIXES:
        if lower.startswith(prefix):
            return True
    # Lines longer than 80 chars are almost certainly not an artist name.
    if len(line) > 80:
        return True
    return False


async def _parse_credits_page(page: Page, *, strategy_0_only: bool = False) -> list[Credit]:
    """
    Parses credits from an Apple Music page.

    Strategy 0 (preferred): .artist-name / .artist-roles CSS selectors.
    Each credit card on the page has an artist-name div and an artist-roles
    div (comma-separated when one artist holds multiple roles).

    Falls back to body.innerText line-by-line walk if the selectors yield
    nothing (e.g. page structure changes in the future).

    Pass strategy_0_only=True for /song/ pages: the page body contains lyrics
    and navigation that Strategy 1 would misparse as credit data.
    """
    await asyncio.sleep(1.5)

    # Strategy 0 — CSS selector pairs
    names = await page.locator(".artist-name").all_text_contents()
    roles_texts = await page.locator(".artist-roles").all_text_contents()
    if names and roles_texts and len(names) == len(roles_texts):
        role_artists: dict[str, list[str]] = {}
        for name_raw, roles_raw in zip(names, roles_texts):
            artist = name_raw.strip()
            if not artist:
                continue
            for role_raw in roles_raw.split(","):
                role = _normalise_role(role_raw)
                if not role:
                    continue
                if role not in role_artists:
                    role_artists[role] = []
                if artist not in role_artists[role]:
                    role_artists[role].append(artist)
        credits = [Credit(role=r, artists=a) for r, a in role_artists.items()]
        if credits:
            return credits

    if strategy_0_only:
        return []

    # Strategy 1 — innerText line-by-line walk (fallback)
    body_text: str = await page.evaluate("() => document.body.innerText")
    lines = [l.strip() for l in body_text.splitlines() if l.strip()]

    credits = []
    current_role: str | None = None
    current_artists: list[str] = []

    for line in lines:
        lower = line.lower().rstrip(":").strip()
        if lower in ALL_ROLE_KEYS:
            if current_role and current_artists:
                credits.append(Credit(role=current_role, artists=current_artists))
            current_role = ROLE_MAP.get(lower, line.rstrip(":").strip())
            current_artists = []
        elif current_role:
            if _is_noise(line):
                continue
            current_artists.extend(_parse_artists(line))

    if current_role and current_artists:
        credits.append(Credit(role=current_role, artists=current_artists))

    return credits


async def _extract_copyright(page: Page) -> tuple[str, str]:
    """Extract ℗ and © from the album tracklist footer description.
    Only meaningful on /album/ pages before navigating to credits view.
    Returns (phonographic, copyright_notice) — copyright_notice may be empty."""
    raw = ""
    try:
        raw = await page.locator(
            '[data-testid="tracklist-footer-description"]'
        ).first.inner_text(timeout=3_000)
    except Exception:
        pass

    # Split at every ℗/© boundary so they're found even when on the same line.
    phonographic = ""
    copyright_ = ""
    for part in re.split(r"(?=℗|©)", raw):
        part = part.strip()
        if not part:
            continue
        if part.startswith("℗") and not phonographic:
            phonographic = part.splitlines()[0].strip()
        elif part.startswith("©") and not copyright_:
            copyright_ = part.splitlines()[0].strip()
        if phonographic and copyright_:
            break

    # Do NOT copy ℗ → © here; the GUI shows "Not found - copied from ℗" instead.
    return phonographic, copyright_


async def _extract_cover_url(page: Page) -> str:
    """Extract album cover URL from Apple Music OG/Twitter meta tags, upgraded to 1000×1000 PNG."""
    for selector in (
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
    ):
        try:
            url = await page.locator(selector).first.get_attribute("content", timeout=2_000)
            if not url:
                continue
            base = url.split("?")[0]
            # Replace trailing /{w}x{h}[flags][-quality].{ext}
            # Handles: /600x600bb.jpg  /1200x630wp-60.jpg  /296x296.webp
            normalised = re.sub(
                r"/\d+x\d+[a-z]*(?:-\d+)?\.[a-z]+$", "/1000x1000bb.png", base, flags=re.IGNORECASE
            )
            return normalised
        except Exception:
            continue
    return ""


# ---------------------------------------------------------------------------
# Navigation: MORE → View Credits
# ---------------------------------------------------------------------------

async def _click_view_credits(page: Page, nth_index: int = 1) -> bool:
    """
    Finds the nth MORE button (aria-label="MORE") and clicks "View Credits".

    nth_index is 1-based: song 1 → nth(1), song 3 → nth(3).
    Returns True if successfully navigated to the credits view.
    """
    more_selector = '[aria-label="MORE"]'

    for attempt in range(2):
        try:
            if attempt == 1:
                # Hover the target song row (0-based) to reveal its MORE button.
                # nth_index=0 means the song page's own button — no track row to hover.
                try:
                    if nth_index > 0:
                        await page.locator(".songs-list-row, .track-list__item").nth(nth_index - 1).hover(timeout=3_000)
                    await asyncio.sleep(0.4)
                except PWTimeout:
                    pass

            more_btn = page.locator(more_selector).nth(nth_index)
            await more_btn.wait_for(state="visible", timeout=5_000)
            await more_btn.click()
            break
        except PWTimeout:
            if attempt == 1:
                return False

    # Wait for the context menu and click "View Credits".
    try:
        view_credits = page.get_by_role("menuitem", name=re.compile(r"view credits", re.IGNORECASE))
        await view_credits.wait_for(state="visible", timeout=5_000)
        await view_credits.click()
        return True
    except PWTimeout:
        # Fallback: look for any element with "Credits" text in the menu.
        try:
            await page.get_by_text(re.compile(r"view credits", re.IGNORECASE)).first.click(timeout=3_000)
            return True
        except PWTimeout:
            return False


# ---------------------------------------------------------------------------
# Shared browser context helper
# ---------------------------------------------------------------------------

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

class PageNotFoundError(Exception):
    pass


async def _wait_for_page(page: Page) -> None:
    """Race networkidle against the Apple Music 404 error element.

    For invalid URLs the error element is rendered by JS within ~1-2 s, long
    before the page ever reaches networkidle.  Racing lets us bail out the
    moment the error appears instead of waiting the full 25 s timeout.
    """
    error_task = asyncio.create_task(
        page.wait_for_selector(
            '[data-testid="page-error-title"]', state="visible", timeout=25_000
        )
    )
    idle_task = asyncio.create_task(
        page.wait_for_load_state("networkidle", timeout=25_000)
    )
    await asyncio.wait({error_task, idle_task}, return_when=asyncio.FIRST_COMPLETED)
    for t in (error_task, idle_task):
        if not t.done():
            t.cancel()
            try:
                await t
            except (Exception, asyncio.CancelledError):
                pass
    if await page.locator('[data-testid="page-error-title"]').is_visible():
        raise PageNotFoundError("Page not found — check the URL and try again.")


_global_playwright = None
_global_browser = None
_browser_lock = asyncio.Lock()

async def _get_browser():
    global _global_playwright, _global_browser
    async with _browser_lock:
        if _global_playwright is None:
            from playwright.async_api import async_playwright
            _global_playwright = await async_playwright().start()
        if _global_browser is None:
            _global_browser = await _global_playwright.chromium.launch(headless=True)
        return _global_browser


async def close_browser() -> None:
    """Close the shared Playwright browser and stop the Playwright instance."""
    global _global_browser, _global_playwright
    async with _browser_lock:
        if _global_browser is not None:
            await _global_browser.close()
            _global_browser = None
        if _global_playwright is not None:
            await _global_playwright.stop()
            _global_playwright = None

async def _new_stealth_page():
    """Create a new stealth context and page on the global browser."""
    browser = await _get_browser()
    context = await browser.new_context(
        user_agent=_UA,
        viewport={"width": 1440, "height": 900},
        locale="en-US",
        timezone_id="America/New_York",
        geolocation={"latitude": 40.7128, "longitude": -74.0060},
        permissions=["geolocation"],
    )
    page = await context.new_page()
    await Stealth().apply_stealth_async(page)
    return context, page


_TYPE_LABELS = frozenset({"single", "ep", "album", "soundtrack", "deluxe edition", "live"})


def _extract_title_artist(page_title: str) -> tuple[str, str]:
    """Parse 'Title – Artist – Apple Music' into (title, artist). Returns ('', '') on failure.

    Handles various Apple Music title formats:
      'Shabang – Single – Drake – Apple Music'  →  ('Shabang', 'Drake')
      '‎UTOPIA - Album by Travis Scott - Apple Music'  →  ('UTOPIA', 'Travis Scott')
      'Slime You Out (feat. SZA) - Single by Drake on Apple Music' -> ('Slime You Out (feat. SZA)', 'Drake')
    """
    if not page_title:
        return "", ""

    # Strip LRM/RLM and Apple Music suffix
    clean_title = page_title.strip("‎‏")
    for suffix in (" - Apple Music", " – Apple Music", " on Apple Music"):
        if clean_title.endswith(suffix):
            clean_title = clean_title[: -len(suffix)]
        elif clean_title.lower().endswith(suffix.lower()):
            clean_title = clean_title[: -len(suffix)]

    for sep in (" – ", " - "):
        parts = [p.strip() for p in clean_title.split(sep)]
        if len(parts) >= 2:
            raw_title = parts[0].strip("‎‏")
            raw_artist = parts[1]

            # Skip type labels Apple Music inserts between the title and the artist name
            if raw_artist.lower() in _TYPE_LABELS and len(parts) >= 3:
                raw_artist = parts[2]

            # Clean up artist (remove "Song by", "Album by", etc.)
            raw_artist = re.sub(
                r"^(?:album|ep|single|song)\s+by\s+", "", raw_artist, flags=re.IGNORECASE
            ).strip()
            
            # Clean up title (remove " - Single" etc. at the end of the title part)
            title = re.sub(
                r"\s*[-–—]\s*(?:single|ep|deluxe|expanded|remastered"
                r"|reissue|bonus track|live|acoustic|remix|radio edit|version|edition)\s*$",
                "", raw_title, flags=re.IGNORECASE,
            ).strip()
            return title, raw_artist

    # Last resort: if no separator found but has " by ", try splitting there
    if " by " in clean_title:
        title, artist = clean_title.split(" by ", 1)
        return title.strip(), artist.strip()

    return "", ""


async def _extract_from_dom(page: Page) -> tuple[str, str]:
    """Fallback: try to extract title and artist from the page content."""
    title, artist = "", ""
    
    # Try title selectors
    for sel in ('[data-testid="album-title"]', '[data-testid="song-name-value"]', 'h1'):
        try:
            val = await page.locator(sel).first.inner_text(timeout=2000)
            if val and val.strip():
                title = val.strip()
                break
        except Exception:
            continue
            
    # Try artist selectors
    for sel in ('[data-testid="artist-name"]', '.product-creator a', '.song-name-row__artist-name'):
        try:
            val = await page.locator(sel).first.inner_text(timeout=2000)
            if val and val.strip():
                artist = val.strip()
                break
        except Exception:
            continue
            
    return title, artist


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def detect_album(url: str) -> AlbumTrackInfo:
    """Navigate to an Apple Music album page and return track count + titles.

    For single-track albums or /song/ URLs, track_count == 1 and track_titles is empty.
    """
    album_title, artist = "", ""

    context, page = await _new_stealth_page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        await _wait_for_page(page)

        try:
            title, artist = _extract_title_artist(await page.title())
            if not title or not artist:
                # Fallback to DOM extraction
                d_title, d_artist = await _extract_from_dom(page)
                title = title or d_title
                artist = artist or d_artist
        except Exception:
            pass

        # Song count from tracklist footer (only present on /album/ pages)
        track_count = 1
        try:
            raw = await page.locator(
                '[data-testid="tracklist-footer-description"]'
            ).first.inner_text(timeout=3_000)
            m = re.search(r"(\d+)\s+songs?", raw)
            if m:
                track_count = int(m.group(1))
        except Exception:
            pass

        track_titles: list[str] = []
        if track_count > 1:
            try:
                titles = await page.locator(".songs-list-row__song-name").all_text_contents()
                if not titles:
                    titles = await page.locator('[data-testid="song-name-value"]').all_text_contents()
                titles = [t.strip() for t in titles if t.strip()]
            except Exception:
                titles = []
            while len(titles) < track_count:
                titles.append(f"Track {len(titles) + 1}")
            track_titles = titles[:track_count]

        # Extract cover art URL before closing the context
        cover_art_url = await _extract_cover_url(page)
    finally:
        await context.close()

    return AlbumTrackInfo(
        url=url,
        album_title=title,
        artist=artist,
        track_count=track_count,
        track_titles=track_titles,
        cover_art_url=cover_art_url,
    )


async def scrape(url: str, *, track_index: int = 1, track_title: str = "", debug: bool = False) -> SongCredits:
    """
    Scrape credits from an Apple Music page.

    Accepts both /us/song/ and /us/album/ URLs.
    track_index (1-based) selects which song's MORE button to click on album pages.
    track_title overrides the title extracted from page.title() when already known.
    """
    title, artist = "", ""

    context, page = await _new_stealth_page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        await _wait_for_page(page)

        # Extract title/artist from page <title> or DOM before we navigate away.
        try:
            title, artist = _extract_title_artist(await page.title())
            if not title or not artist:
                d_title, d_artist = await _extract_from_dom(page)
                title = title or d_title
                artist = artist or d_artist
        except Exception:
            pass

        # If caller already knows the track title (from album track list), use it.
        if track_title:
            title = track_title

        # Cover art + copyright both live on the album/song page — extract before navigating away.
        cover_art_url = await _extract_cover_url(page)
        phonographic_copyright, copyright_notice = "", ""
        if "/album/" in url:
            phonographic_copyright, copyright_notice = await _extract_copyright(page)

        # Album pages require MORE → View Credits navigation.
        # Song pages expose credits directly via CSS selectors on the page.
        if "/album/" in url:
            navigated = await _click_view_credits(page, nth_index=track_index)
            if not navigated:
                print("[warn] Could not find/click 'View Credits'. Saving debug files.")
                debug = True

        # Wait for the new page/modal to settle.
        await page.wait_for_load_state("networkidle", timeout=15_000)

        # For /song/ pages only use the CSS-selector strategy — the page body
        # contains lyrics and navigation that Strategy 1 would misparse as credits.
        credits = await _parse_credits_page(page, strategy_0_only="/song/" in url)

        if debug or not credits:
            debug_dir = Path("debug")
            debug_dir.mkdir(exist_ok=True)
            html = await page.content()
            (debug_dir / "page.html").write_text(html, encoding="utf-8")
            await page.screenshot(path=str(debug_dir / "page.png"), full_page=True)
            if not credits:
                print(
                    "[debug] No credits found after 'View Credits' navigation.\n"
                    "        Saved debug/page.html and debug/page.png for inspection."
                )
    finally:
        await context.close()

    return SongCredits(
        title=title,
        artist=artist,
        apple_music_url=url,
        credits=credits,
        phonographic_copyright=phonographic_copyright,
        copyright_notice=copyright_notice,
        cover_art_url=cover_art_url,
    )
