"""
Scrapes song credits from Apple Music.  Album tracks are read from the track's own song page
(direct, the default); the fallback is the UI navigation path:
  Album/song page → MORE button (aria-label="MORE") → "View Credits"

This is more reliable than API interception because the dedicated credits
page has a clean, structured layout purpose-built for credit display.

Accepted URL formats:
  https://music.apple.com/us/song/<slug>/<song-id>
  https://music.apple.com/us/album/<slug>/<album-id>
"""

import asyncio
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from playwright.async_api import Page
from playwright.async_api import TimeoutError as PWTimeout
from playwright_stealth import Stealth

from scraper.models import Credit, SongCredits
from scraper.roles import ALL_ROLE_KEYS, ROLE_MAP, genius_role_name


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
    return genius_role_name(ROLE_MAP.get(key, raw.strip().rstrip(":").strip()))


def _parse_artists(raw: str) -> list[str]:
    parts = re.split(r"\s*[,&•]\s*", raw)
    return [p.strip() for p in parts if p.strip()]


# ---------------------------------------------------------------------------
# Credits page parser - used after "View Credits" navigation
# ---------------------------------------------------------------------------

_NOISE_PREFIXES = ("more by", "© ", "℗ ", "all rights", "℗©", "apple music")

# Roles that exist on Apple Music credits pages but are not accepted on Genius.
_SKIP_ROLES: frozenset[str] = frozenset({"Performer", "Mixed Artist"})

_SECTION_HEADERS = frozenset(
    {
        "composition, lyrics",
        "production, engineering",
        "performance",
        "audio",
        "arranging",
        "management",
        "visual",
        "liner notes",
        "additional credits",
        "credits",
        "performers",
        "personnel",
        "recording information",
    }
)


def _is_noise(line: str) -> bool:
    """Returns True for lines that are page chrome, not artist names."""
    lower = line.lower()
    if lower in _SECTION_HEADERS:
        return True
    for prefix in _NOISE_PREFIXES:
        if lower.startswith(prefix):
            return True
    # Lines longer than 80 chars are almost certainly not an artist name.
    return len(line) > 80


_CREDITS_TIMEOUT_MS = 10_000
_CREDITS_SETTLE_S = 0.15


async def _wait_for_credits(page: Page) -> None:
    """Wait until the credit cards have rendered, bounded by _CREDITS_TIMEOUT_MS.

    Apple Music renders all cards in one batch, so one short recheck that the card
    count is unchanged guards against reading a half-rendered list.  Returns quietly
    on timeout (a track without credits) so the text fallback can still run.
    """
    cards = page.locator(".artist-name")
    try:
        await cards.first.wait_for(state="attached", timeout=_CREDITS_TIMEOUT_MS)
    except PWTimeout:
        return
    count = await cards.count()
    for _ in range(10):
        await asyncio.sleep(_CREDITS_SETTLE_S)
        new_count = await cards.count()
        if new_count == count:
            return
        count = new_count


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
    await _wait_for_credits(page)

    # Strategy 0 - CSS selector pairs
    names = await page.locator(".artist-name").all_text_contents()
    roles_texts = await page.locator(".artist-roles").all_text_contents()
    credits = credits_from_cards(names, roles_texts)
    if credits or strategy_0_only:
        return credits

    # Strategy 1 - innerText line-by-line walk (fallback)
    body_text: str = await page.evaluate("() => document.body.innerText")
    return credits_from_text(body_text)


def credits_from_cards(names: list[str], roles_texts: list[str]) -> list[Credit]:
    """Strategy 0: pair each .artist-name with its comma-separated .artist-roles."""
    if not names or not roles_texts or len(names) != len(roles_texts):
        return []
    role_artists: dict[str, list[str]] = {}
    for name_raw, roles_raw in zip(names, roles_texts, strict=True):
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
    return [Credit(role=r, artists=a) for r, a in role_artists.items() if r not in _SKIP_ROLES]


def credits_from_text(body_text: str) -> list[Credit]:
    """Strategy 1: walk page innerText; a known role line starts a new credit."""
    lines = [line.strip() for line in body_text.splitlines() if line.strip()]

    credits: list[Credit] = []
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

    return [c for c in credits if c.role not in _SKIP_ROLES]


async def _extract_copyright(page: Page) -> tuple[str, str]:
    """Extract ℗ and © from the album tracklist footer description.
    Only meaningful on /album/ pages before navigating to credits view.
    Returns (phonographic, copyright_notice) - copyright_notice may be empty."""
    raw = ""
    try:
        raw = await page.locator('[data-testid="tracklist-footer-description"]').first.inner_text(timeout=3_000)
    except Exception:
        pass
    return split_copyright(raw)


def split_copyright(raw: str) -> tuple[str, str]:
    """Return the first ℗ line and first © line from a tracklist footer description."""
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


# Artwork URLs from the page header (album or song), in DOM order, then the legacy meta tags.
# Only the header is searched: shelves further down hold other albums and editorial banners.
_HEADER_ARTWORK_JS = """() => {
    const header = document.querySelector('[data-testid="container-detail-header"]')
        || document.querySelector('.song-header-page')
        || document.querySelector('[data-testid="section-content"]');
    const urls = [];
    if (header) {
        for (const el of header.querySelectorAll('[data-testid="artwork-component"] source, [data-testid="artwork-component"] img')) {
            const raw = el.getAttribute('srcset') || el.getAttribute('src') || '';
            const url = raw.trim().split(/\\s+/)[0];
            if (url) urls.push(url);
        }
    }
    for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
        const content = document.querySelector(sel)?.getAttribute('content');
        if (content) urls.push(content);
    }
    return urls;
}"""


async def _extract_cover_url(page: Page) -> str:
    """Extract the album cover URL from the page header artwork, upgraded to 1000x1000 PNG."""
    try:
        urls: list[str] = await page.evaluate(_HEADER_ARTWORK_JS)
    except Exception:
        return ""
    return pick_cover_url(urls)


def pick_cover_url(urls: list[str]) -> str:
    """Pick the album artwork among header image URLs, normalised to 1000x1000 PNG ('' if none).

    Album artwork lives under /image/thumb/Music...  Headers of albums with motion artwork
    carry only /image/thumb/Video... stills and /image/thumb/Features... editorial images;
    those are never the album cover, so no cover beats a wrong one.
    """
    music = [u for u in urls if "/image/thumb/Music" in u]
    return normalise_cover_url(music[0]) if music else ""


_CATALOG_URL_RE = re.compile(r"^https://music\.apple\.com/([a-z]{2})/(?:album|song)/(?:[^/?#]+/)?(\d+)(?:[/?#]|$)")
_LOOKUP_URL = "https://itunes.apple.com/lookup"


def catalog_id(url: str) -> tuple[str, str]:
    """Return (catalog id, storefront) of an Apple Music album or song URL, or ('', '')."""
    m = _CATALOG_URL_RE.match(url)
    return (m.group(2), m.group(1)) if m else ("", "")


def cover_from_lookup(data: dict) -> str:
    """1000x1000 PNG artwork URL from an iTunes lookup response ('' if absent)."""
    results = data.get("results") or []
    art = results[0].get("artworkUrl100", "") if results else ""
    return normalise_cover_url(art) if art else ""


async def _lookup_cover_url(url: str) -> str:
    """Exact cover art for an album or song URL via Apple's iTunes lookup by catalog id.

    Pages of albums with motion artwork never show the cover itself, so the page DOM alone
    cannot find it.  Best-effort: returns '' on any failure.
    """
    item_id, storefront = catalog_id(url)
    if not item_id:
        return ""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(_LOOKUP_URL, params={"id": item_id, "country": storefront})
            r.raise_for_status()
            return cover_from_lookup(r.json())
    except Exception:
        return ""


def normalise_cover_url(url: str) -> str:
    """Rewrite an Apple Music artwork URL to its 1000x1000 PNG variant."""
    base = url.split("?")[0]
    # Replace trailing /{w}x{h}[flags][-quality].{ext}
    # Handles: /600x600bb.jpg  /1200x630wp-60.jpg  /296x296.webp
    return re.sub(r"/\d+x\d+[a-z]*(?:-\d+)?\.[a-z]+$", "/1000x1000bb.png", base, flags=re.IGNORECASE)


# ---------------------------------------------------------------------------
# Navigation: MORE → View Credits
# ---------------------------------------------------------------------------


_VIEW_CREDITS_RE = re.compile(r"view credits", re.IGNORECASE)


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
                # nth_index=0 means the song page's own button - no track row to hover.
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

    # Wait for the context menu and click "View Credits".  The menu entries are plain
    # buttons inside <amp-contextual-menu-item>; older markup used role="menuitem".
    try:
        view_credits = (
            page.locator('amp-contextual-menu-item button, [role="menuitem"]').filter(has_text=_VIEW_CREDITS_RE).first
        )
        await view_credits.wait_for(state="visible", timeout=5_000)
        await view_credits.click()
        return True
    except PWTimeout:
        # Fallback: look for any element with "Credits" text in the menu.
        try:
            await page.get_by_text(_VIEW_CREDITS_RE).first.click(timeout=3_000)
            return True
        except PWTimeout:
            return False


# ---------------------------------------------------------------------------
# Direct song-page reading: album row -> that track's own /song/ page
# ---------------------------------------------------------------------------

# Which path reads album-track credits: the song page of each row (True) or MORE -> View Credits (False).
# GENIESCRAPER_CREDITS_PATH=direct|click overrides it; scrape(direct=...) overrides both.
# Direct is the default: bench.compare matched the golden files 18/18 on both paths and was ~6-9% faster.
DIRECT_DEFAULT = True


class TrackUnavailableError(Exception):
    """The album row has no song page (Apple lists the track but gives it no link)."""


def use_direct_song_pages(direct: bool | None = None) -> bool:
    if direct is not None:
        return direct
    choice = os.environ.get("GENIESCRAPER_CREDITS_PATH", "").strip().lower()
    if choice in ("direct", "click"):
        return choice == "direct"
    return DIRECT_DEFAULT


# One entry per tracklist row, in order: the row's own song link, or '' for a row without one.
_ROW_SONG_LINKS_JS = """() => {
    const rows = document.querySelectorAll('[data-testid="track-list-item"]');
    return Array.from(rows, (row) => {
        const a = row.querySelector('a[href*="/song/"]');
        return a ? a.href : '';
    });
}"""


async def _extract_song_links(page: Page) -> list[str]:
    """Song-page URL of every album row ('' for unavailable rows); [] when the page has no tracklist."""
    try:
        links: list[str] = await page.evaluate(_ROW_SONG_LINKS_JS)
    except Exception:
        return []
    return [u if catalog_id(u)[0] else "" for u in links]


def pick_song_link(links: list[str], track_index: int) -> str:
    """Song-page URL of the 1-based track_index row; raises TrackUnavailableError if it has none."""
    if not 1 <= track_index <= len(links) or not links[track_index - 1]:
        raise TrackUnavailableError(f"Track {track_index} has no song page on Apple Music.")
    return links[track_index - 1]


# ---------------------------------------------------------------------------
# Shared browser context helper
# ---------------------------------------------------------------------------

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"


class PageNotFoundError(Exception):
    pass


# Apple Music has used both markers for its "Page Not Found" view.
_NOT_FOUND_SELECTOR = '[data-testid="not-found-heading"], [data-testid="page-error-title"]'
_NOT_FOUND_MESSAGE = "Page not found. Check the URL and try again."


async def _open(page: Page, url: str) -> None:
    """Navigate to an Apple Music page and wait until it is usable.

    Raises PageNotFoundError as soon as Apple answers 404 or renders its not-found view.
    """
    response = await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
    if response is not None and response.status == 404:
        raise PageNotFoundError(_NOT_FOUND_MESSAGE)
    await _wait_for_page(page)


# The page is usable once the hydrated tracklist (album) or the song header (song) is there.
# Before the tracklist hydrates, the page holds fewer MORE buttons, so nth() would pick
# the wrong track's button.
_READY_SELECTOR = '[data-testid="track-list-item"], .song-header-page'
_READY_TIMEOUT_MS = 15_000


async def _wait_for_page(page: Page) -> None:
    """Race the page-ready marker against the Apple Music 404 error element.

    For invalid URLs the error element is rendered by JS within ~1-2 s; racing
    lets us bail out the moment it appears.  If neither shows up within the
    bounded timeout the scrape carries on with whatever has rendered.
    """
    error_task = asyncio.create_task(
        page.wait_for_selector(_NOT_FOUND_SELECTOR, state="visible", timeout=_READY_TIMEOUT_MS)
    )
    ready_task = asyncio.create_task(page.wait_for_selector(_READY_SELECTOR, timeout=_READY_TIMEOUT_MS))
    await asyncio.wait({error_task, ready_task}, return_when=asyncio.FIRST_COMPLETED)
    for t in (error_task, ready_task):
        if not t.done():
            t.cancel()
        try:
            await t
        except (Exception, asyncio.CancelledError):
            pass
    if await page.locator(_NOT_FOUND_SELECTOR).first.is_visible():
        raise PageNotFoundError(_NOT_FOUND_MESSAGE)


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
            # GENIESCRAPER_BROWSER_CHANNEL=chrome|msedge uses an installed browser instead of Playwright's Chromium.
            channel = os.environ.get("GENIESCRAPER_BROWSER_CHANNEL") or None
            _global_browser = await _global_playwright.chromium.launch(headless=True, channel=channel)
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
    await context.route("**/*", _block_heavy_resources)
    page = await context.new_page()
    await Stealth().apply_stealth_async(page)
    return context, page


# Scraping reads text and image URLs only; the bytes of images, audio/video and fonts are never used.
_BLOCKED_RESOURCE_TYPES = frozenset({"image", "media", "font"})


async def _block_heavy_resources(route) -> None:
    if route.request.resource_type in _BLOCKED_RESOURCE_TYPES:
        await route.abort()
    else:
        await route.continue_()


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
        if clean_title.endswith(suffix) or clean_title.lower().endswith(suffix.lower()):
            clean_title = clean_title[: -len(suffix)]

    for sep in (" – ", " - "):
        parts = [p.strip() for p in clean_title.split(sep)]
        if len(parts) >= 2:
            raw_title = parts[0].strip("‎‏")
            raw_artist = parts[1]

            # Skip type labels Apple Music inserts between the title and the artist name
            if raw_artist.lower() in _TYPE_LABELS and len(parts) >= 3:
                raw_artist = parts[2]

            # Clean up artist (remove "Song by", "Album by", "Song with Lyrics by", etc.)
            raw_artist = re.sub(
                r"^(?:album|ep|single|song)(?:\s+with\s+lyrics)?\s+by\s+", "", raw_artist, flags=re.IGNORECASE
            ).strip()

            # Clean up title (remove " - Single" etc. at the end of the title part)
            title = re.sub(
                r"\s*[-–—]\s*(?:single|ep|deluxe|expanded|remastered"
                r"|reissue|bonus track|live|acoustic|remix|radio edit|version|edition)\s*$",
                "",
                raw_title,
                flags=re.IGNORECASE,
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
    for sel in ('[data-testid="album-title"]', '[data-testid="song-name-value"]', "h1"):
        try:
            val = await page.locator(sel).first.inner_text(timeout=2000)
            if val and val.strip():
                title = val.strip()
                break
        except Exception:
            continue

    # Try artist selectors
    for sel in ('[data-testid="artist-name"]', ".product-creator a", ".song-name-row__artist-name"):
        try:
            val = await page.locator(sel).first.inner_text(timeout=2000)
            if val and val.strip():
                artist = val.strip()
                break
        except Exception:
            continue

    return title, artist


async def _extract_track_title(page: Page, track_index: int) -> str:
    """Title of the 1-based track_index row in an album tracklist ('' if there is no such row).

    The page <title> names the album, so album tracks must take their title from the tracklist row.
    """
    for selector in ('[data-testid="track-list-item"] [data-testid="track-title"]', ".songs-list-row__song-name"):
        titles = await page.locator(selector).all_text_contents()
        if len(titles) >= track_index:
            return titles[track_index - 1].strip()
    return ""


def track_count_from_footer(raw: str) -> int:
    """Parse '12 songs, 45 minutes' style footers; defaults to 1."""
    m = re.search(r"(\d+)\s+songs?", raw)
    return int(m.group(1)) if m else 1


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def detect_album(url: str) -> AlbumTrackInfo:
    """Navigate to an Apple Music album page and return track count + titles.

    For single-track albums or /song/ URLs, track_count == 1 and track_titles is empty.
    """
    title, artist = "", ""

    lookup_task = asyncio.create_task(_lookup_cover_url(url))
    context, page = await _new_stealth_page()
    try:
        await _open(page, url)

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
            raw = await page.locator('[data-testid="tracklist-footer-description"]').first.inner_text(timeout=3_000)
            track_count = track_count_from_footer(raw)
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

        cover_art_url = await lookup_task or await _extract_cover_url(page)
    finally:
        lookup_task.cancel()
        await context.close()

    return AlbumTrackInfo(
        url=url,
        album_title=title,
        artist=artist,
        track_count=track_count,
        track_titles=track_titles,
        cover_art_url=cover_art_url,
    )


def _write_debug_html(debug_dir: Path, html: str) -> None:
    debug_dir.mkdir(exist_ok=True)
    (debug_dir / "page.html").write_text(html, encoding="utf-8")


async def scrape(
    url: str, *, track_index: int = 1, track_title: str = "", debug: bool = False, direct: bool | None = None
) -> SongCredits:
    """
    Scrape credits from an Apple Music page.

    Accepts both /us/song/ and /us/album/ URLs.
    track_index (1-based) selects which song's MORE button to click on album pages.
    track_title overrides the title extracted from page.title() when already known.
    direct selects the album-track path (see use_direct_song_pages): read the track's own song page
    instead of clicking MORE -> View Credits.  If the song page yields no credits the click path runs.
    """
    title, artist = "", ""

    lookup_task = asyncio.create_task(_lookup_cover_url(url))
    context, page = await _new_stealth_page()
    try:
        await _open(page, url)

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
        # Otherwise album pages name the album in <title>, so read the track's row instead.
        if track_title:
            title = track_title
        elif "/album/" in url:
            title = await _extract_track_title(page, track_index) or title

        # Header artwork + copyright both live on the album/song page - extract before navigating away.
        page_cover_url = await _extract_cover_url(page)
        phonographic_copyright, copyright_notice = "", ""
        if "/album/" in url:
            phonographic_copyright, copyright_notice = await _extract_copyright(page)

        credits: list[Credit] = []
        if "/album/" in url:
            credits_ready = False
            if use_direct_song_pages(direct):
                # Raises TrackUnavailableError for a row without a song page.
                song_url = pick_song_link(await _extract_song_links(page), track_index)
                await _open(page, song_url)
                credits = await _parse_credits_page(page, strategy_0_only=True)
                credits_ready = bool(credits)
                if not credits:
                    # Song page gave nothing: go back to the album and use the click path.
                    await _open(page, url)
            if not credits_ready:
                # Album pages need MORE -> View Credits navigation.
                if not await _click_view_credits(page, nth_index=track_index):
                    print("[warn] Could not find/click 'View Credits'. Saving debug files.")
                    debug = True
                credits = await _parse_credits_page(page)
        else:
            # Song pages expose credits directly via CSS selectors; only that strategy is safe there
            # (the body holds lyrics and navigation that the text walk would misparse as credits).
            credits = await _parse_credits_page(page, strategy_0_only=True)

        if debug or not credits:
            debug_dir = Path("debug")
            html = await page.content()
            await asyncio.to_thread(_write_debug_html, debug_dir, html)
            await page.screenshot(path=str(debug_dir / "page.png"), full_page=True)
            if not credits:
                print(
                    "[debug] No credits found after 'View Credits' navigation.\n"
                    "        Saved debug/page.html and debug/page.png for inspection."
                )
        cover_art_url = await lookup_task or page_cover_url
    finally:
        lookup_task.cancel()
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
