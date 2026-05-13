import re

import httpx


async def fetch_cover_url(title: str, artist: str) -> str:
    """Search Deezer and return a 1000×1000 PNG cover URL, or '' on failure."""
    if not title or not artist:
        return ""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://api.deezer.com/search",
                params={"q": f'track:"{title}" artist:"{artist}"', "limit": 1},
            )
            r.raise_for_status()
            data = r.json()
    except Exception:
        return ""

    results = data.get("data", [])
    if not results:
        return ""

    cover_xl: str = results[0]["album"].get("cover_xl", "")
    if not cover_xl:
        return ""

    # Deezer CDN serves PNG when the extension is changed
    return re.sub(r"\.\w+$", ".png", cover_xl)


async def fetch_itunes_cover_url(title: str, artist: str) -> str:
    """Search iTunes Search API; returns a 1000×1000 PNG cover URL, or '' on failure.
    Used as a fallback when Deezer has no catalog entry for the track."""
    if not title or not artist:
        return ""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://itunes.apple.com/search",
                params={"term": f"{artist} {title}", "media": "music", "entity": "song", "limit": 5},
            )
            r.raise_for_status()
            data = r.json()
    except Exception:
        return ""

    ar_words = [w for w in re.split(r"\W+", artist.lower()) if len(w) >= 3]
    for result in data.get("results", []):
        result_artist = result.get("artistName", "").lower()
        if ar_words and not any(w in result_artist for w in ar_words):
            continue
        artwork = result.get("artworkUrl100", "")
        if artwork:
            # Replace the size suffix; request PNG explicitly
            return re.sub(r"\d+x\d+bb\.\w+$", "1000x1000bb.png", artwork)
    return ""
