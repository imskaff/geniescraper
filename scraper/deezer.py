import re

import httpx

from scraper.text import core_title_words, words

_CATALOG_URL = re.compile(r"music\.apple\.com/([a-z]{2})/(?:album|song)/(?:[^/?#]+/)?(\d+)")
_TRACK_PARAM = re.compile(r"[?&]i=(\d+)")


def catalog_ref(url: str) -> tuple[str, str] | None:
    """(storefront, catalog id) of an Apple Music album or song URL, or None.

    Album URLs carrying ``?i=<track id>`` resolve to the track, so the artwork
    is that track's edition rather than a guess from a title search.
    """
    m = _CATALOG_URL.search(url)
    if not m:
        return None
    track = _TRACK_PARAM.search(url)
    return m.group(1), track.group(1) if track else m.group(2)


def _itunes_png(artwork_url: str) -> str:
    """Rewrite an iTunes artwork URL to the 1000x1000 PNG variant."""
    return re.sub(r"\d+x\d+bb\.\w+$", "1000x1000bb.png", artwork_url)


def _same_track(result_title: str, result_artist: str, title: str, artist: str) -> bool:
    """True when a search hit is this track by this artist, ignoring feat. parts and accents.

    A title search returns other songs by the artist too ("Kill Bill" for "SOS"),
    whose artwork belongs to a different release.
    """
    if core_title_words(result_title) != core_title_words(title):
        return False
    ar_words = [w for w in words(artist) if len(w) >= 3]
    result_words = set(words(result_artist))
    return not ar_words or any(w in result_words for w in ar_words)


async def fetch_itunes_lookup_cover_url(apple_music_url: str) -> str:
    """Artwork of the exact Apple Music album or song in the URL as a 1000x1000 PNG, or ''.

    The catalog ID identifies the release itself, so unlike a title search this
    never picks a deluxe, clean or single edition of the same song.
    """
    ref = catalog_ref(apple_music_url)
    if not ref:
        return ""
    country, catalog_id = ref
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get("https://itunes.apple.com/lookup", params={"id": catalog_id, "country": country})
            r.raise_for_status()
            data = r.json()
    except Exception:
        return ""
    for result in data.get("results", []):
        artwork = result.get("artworkUrl100", "")
        if artwork:
            return _itunes_png(artwork)
    return ""


async def fetch_cover_url(title: str, artist: str) -> str:
    """Search Deezer and return a 1000×1000 PNG cover URL, or '' on failure."""
    if not title or not artist:
        return ""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Deezer's field syntax (track:"..." artist:"...") returns no results for
            # combined fields, so search plainly and check each hit instead.
            r = await client.get("https://api.deezer.com/search", params={"q": f"{artist} {title}", "limit": 10})
            r.raise_for_status()
            data = r.json()
    except Exception:
        return ""

    for result in data.get("data", []):
        if not _same_track(result.get("title", ""), result.get("artist", {}).get("name", ""), title, artist):
            continue
        cover_xl: str = result.get("album", {}).get("cover_xl", "")
        if cover_xl:
            # Deezer CDN serves PNG when the extension is changed
            return re.sub(r"\.\w+$", ".png", cover_xl)
    return ""


async def fetch_itunes_cover_url(title: str, artist: str) -> str:
    """Search iTunes Search API; returns a 1000×1000 PNG cover URL, or '' on failure.
    Used when the Apple Music URL gives no catalog ID to look up."""
    if not title or not artist:
        return ""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://itunes.apple.com/search",
                params={"term": f"{artist} {title}", "media": "music", "entity": "song", "limit": 10},
            )
            r.raise_for_status()
            data = r.json()
    except Exception:
        return ""

    for result in data.get("results", []):
        if not _same_track(result.get("trackName", ""), result.get("artistName", ""), title, artist):
            continue
        artwork = result.get("artworkUrl100", "")
        if artwork:
            return _itunes_png(artwork)
    return ""
