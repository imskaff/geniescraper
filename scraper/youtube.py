import asyncio
import json
import re

import httpx

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

_MV_KEYWORDS = ("official music video", "official video", "music video", "official visual")
_SKIP_KEYWORDS = (
    "lyrics", "lyric", "audio only", "visualizer", "cover by", "reaction", "reacts",
    "remix", "parody", "live", "performance", "interview", "behind the scenes",
    "dance practice", "choreography", "teaser", "trailer",
)
# Markers that explicitly label a video as audio-only, used to suppress the
# "official-without-qualifier → likely MV" heuristic below.
_AUDIO_INDICATORS = ("official audio", "(audio)", "audio only", "audio stream")

# Crew roles that strongly indicate a video production (avoids generic "producer" which could mean song producer).
_MV_CREW_KEYWORDS = (
    "directed by", "director", "dir.", "dir:", "director of photography",
    "creative director", "production company", "production design", 
    "editor", "edited by", "cinematography", "dp", " d.p.", 
    "gaffer", "colorist", "color grading", "colour grading", 
    "visual director", "video producer", "vfx", "visual effects",
    "wardrobe", "stylist", "choreographer", "production manager",
)


def _score(video_title: str, channel: str, artist: str, song_title: str = "") -> int:
    t = video_title.lower()
    ch = channel.lower()
    ar = artist.lower()

    if any(kw.lower() in t for kw in _SKIP_KEYWORDS):
        return -1

    # Require at least one significant word (≥4 chars) from the song title to appear
    # in the video title — prevents "Savage" (Megan Thee Stallion) scoring high when
    # searching for "Say Sumn" just because "savage" is in the artist name.
    if song_title:
        sig_words = [w for w in re.split(r"\W+", song_title.lower()) if len(w) >= 4]
        if sig_words and not any(w in t for w in sig_words):
            return -1

    is_topic = "- topic" in ch
    # VEVO channels use CamelCase artist names (e.g. "JamesSavageVEVO") — strip spaces
    # before comparing so "james savage" matches "jamesavagevevo".
    is_vevo = "vevo" in ch
    ar_nospace = ar.replace(" ", "")
    is_vevo_artist = is_vevo and len(ar_nospace) >= 3 and ar_nospace in ch.replace(" ", "")
    is_artist_ch = ar in ch or ch in ar or is_vevo_artist
    # VEVO = official MV platform; treat any VEVO upload as a music video.
    is_mv = any(kw.lower() in t for kw in _MV_KEYWORDS) or is_vevo or bool(re.search(r"\bm/?v\b", t))
    # "Official" in title without an explicit audio marker → most likely a video release.
    # Catches titles like "Artist - Song (Official)" that skip the full MV keyword.
    is_official_non_audio = "official" in t and not any(kw.lower() in t for kw in _AUDIO_INDICATORS)

    if is_mv and is_artist_ch:
        return 4
    if is_mv:
        return 3
    if is_artist_ch and is_official_non_audio and not is_topic:
        return 3  # "Official" on artist channel but no audio tag → treat as MV
    if is_artist_ch and not is_topic:
        return 2
    if is_topic:
        return 1
    return 0


def _has_mv_crew(text: str) -> bool:
    """Returns True if the text contains MV production crew credits."""
    t = text.lower()
    return any(kw.lower() in t for kw in _MV_CREW_KEYWORDS)


def _extract_data(html: str) -> dict | None:
    match = re.search(r"var ytInitialData\s*=\s*", html)
    if not match:
        return None
    try:
        obj, _ = json.JSONDecoder().raw_decode(html, match.end())
        return obj
    except (json.JSONDecodeError, ValueError):
        return None


def _iter_videos(data: dict):
    """Yield (video_id, title, channel, description_snippet) tuples from search results."""
    try:
        sections = (
            data["contents"]["twoColumnSearchResultsRenderer"]
            ["primaryContents"]["sectionListRenderer"]["contents"]
        )
    except (KeyError, TypeError):
        return
    for section in sections:
        for item in section.get("itemSectionRenderer", {}).get("contents", []):
            vr = item.get("videoRenderer")
            if not vr or not vr.get("videoId"):
                continue
            title = ""
            try:
                title = vr["title"]["runs"][0]["text"]
            except (KeyError, IndexError):
                pass
            channel = ""
            try:
                channel = vr["ownerText"]["runs"][0]["text"]
            except (KeyError, IndexError):
                pass
            # Extract the description snippet embedded in search results.
            snippet = ""
            try:
                runs = vr.get("descriptionSnippet", {}).get("runs", [])
                snippet = " ".join(r.get("text", "") for r in runs)
                if not snippet:
                    for s in vr.get("detailedMetadataSnippets", []):
                        runs2 = s.get("snippetText", {}).get("runs", [])
                        snippet += " ".join(r.get("text", "") for r in runs2)
            except Exception:
                pass
            yield vr["videoId"], title, channel, snippet


async def _fetch_description(client: httpx.AsyncClient, video_id: str) -> str:
    """Fetch the full description of a YouTube video from its watch page.
    Used as a fallback when the search-result snippet didn't contain crew credits."""
    try:
        r = await client.get(
            f"https://www.youtube.com/watch?v={video_id}",
            headers=_HEADERS,
            timeout=8.0,
        )
        r.raise_for_status()
        
        # Try to get the full description from ytInitialPlayerResponse first
        match = re.search(r"var ytInitialPlayerResponse\s*=\s*", r.text)
        if match:
            try:
                obj, _ = json.JSONDecoder().raw_decode(r.text, match.end())
                desc = obj.get("videoDetails", {}).get("shortDescription", "")
                if desc:
                    return desc
            except (json.JSONDecodeError, ValueError):
                pass

        # Fallback to ytInitialData microformat
        data = _extract_data(r.text)
        if not data:
            return ""
        return (
            data.get("microformat", {})
            .get("playerMicroformatRenderer", {})
            .get("description", {})
            .get("simpleText", "")
        )
    except Exception:
        return ""


async def fetch_youtube_url(title: str, artist: str) -> tuple[str, bool]:
    """Search YouTube; returns (url, is_music_video) or ('', False) on failure.

    Detection layers (in order):
      1. Title keywords (official music video / official video / music video / official visual)
      2. VEVO channel → always treated as MV
      3. Description snippet embedded in search results → crew credits boost score 2 → 3
      4. Full video description fetch (only when still no MV detected) → same boost
    is_music_video is True when the winning result scored >= 3.
    """
    if not title or not artist:
        return "", False

    candidates: list[tuple[int, int, str]] = []
    seen_ids: set[str] = set()

    async with httpx.AsyncClient(
        timeout=12.0, headers=_HEADERS, follow_redirects=True
    ) as client:
        for query in (
            f'"{artist}" "{title}" official music video',  # exact match + MV filter
            f'{artist} {title} official music video',      # loose match + MV filter (fallback)
            f'"{artist}" "{title}"',                       # exact match, no filter
        ):
            try:
                r = await client.get(
                    "https://www.youtube.com/results",
                    params={"search_query": query, "sp": "EgIQAQ=="},
                )
                r.raise_for_status()
            except Exception:
                continue

            data = _extract_data(r.text)
            if not data:
                continue

            for rank, (vid_id, vtitle, channel, snippet) in enumerate(
                list(_iter_videos(data))[:10]
            ):
                if vid_id in seen_ids:
                    continue
                seen_ids.add(vid_id)
                score = _score(vtitle, channel, artist, title)
                if score < 0:
                    continue
                # Layer 3: crew credits in the search-result snippet → treat as MV.
                if score == 2 and _has_mv_crew(snippet):
                    score = 3
                candidates.append((score, rank, f"https://www.youtube.com/watch?v={vid_id}"))

            # Stop only when we've confirmed an actual MV (score ≥ 3).
            # An artist-channel audio hit (score 2) isn't enough to skip the MV queries.
            if any(s >= 3 for s, _, _ in candidates):
                break

        # Layer 4: if still no MV detected, fetch full descriptions for the top
        # candidates and re-check for crew credits. Only fires when titles are ambiguous
        # (e.g. both MV and audio are simply titled "Artist - Song").
        if candidates and not any(s >= 3 for s, _, _ in candidates):
            best_score = max(s for s, _, _ in candidates)
            top = [(s, r, u) for s, r, u in candidates if s == best_score][:3]

            async def _check(entry: tuple[int, int, str]) -> tuple[int, int, str]:
                s, r, u = entry
                desc = await _fetch_description(client, u.split("=")[-1])
                return (s + 1, r, u) if _has_mv_crew(desc) else (s, r, u)

            boosted = list(await asyncio.gather(*[_check(e) for e in top]))
            rest = [(s, r, u) for s, r, u in candidates if s < best_score]
            candidates = boosted + rest

    if not candidates:
        return "", False

    # Sort: highest score first; among equal scores, lowest rank (= top of results) first
    candidates.sort(key=lambda x: (-x[0], x[1]))
    best_score, _, best_url = candidates[0]
    return best_url, best_score >= 3
