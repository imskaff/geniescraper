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
_AUDIO_INDICATORS = ("official audio", "(audio)", "audio only", "audio stream")

# Description-based MV signals — two separate arrays so they can be weighted differently
_MV_CREW_KEYWORDS = (
    "directed by", "director:", "director,", "d.p.", "dp:", "dop:",
    "cinematography by", "cinematographer", "shot by", "filmed by",
    "edited by", "editor:", "color by", "colorist",
    "visual director", "creative director", "production company",
)
_MV_DESC_INDICATORS = (
    "music video", "official video", "official music video",
    "official visual", "visual video", "watch the video",
    "stream & watch", "listen & watch",
)


# ── helpers ───────────────────────────────────────────────────────────────────

def _clean(text: str) -> str:
    """Lowercase, strip non-alphanumeric (keep spaces), collapse whitespace."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", "", text.lower())).strip()


def _sig_present(video_title: str, song_title: str) -> bool:
    """True if at least one significant word (>=3 chars) from the song title appears in
    the video title. Falls back to a collapsed-string check for very short/special-char
    titles like 'FE!N'."""
    t = video_title.lower()
    sig = [w for w in re.split(r"\W+", song_title.lower()) if len(w) >= 3]
    if sig:
        return any(w in t for w in sig)
    # e.g. "FE!N" -> collapsed "fen"; check against collapsed video title
    ct = re.sub(r"[^a-z0-9]", "", song_title.lower())
    cv = re.sub(r"[^a-z0-9]", "", t)
    return bool(ct) and ct in cv


def _title_matches_song(video_title: str, song_title: str, artist: str) -> bool:
    """True when the video title looks like a plain song upload.

    Accepts:
      "Song Title"
      "Artist - Song Title"
      "Artist Song Title ..."       (after punctuation is stripped)
      any of the above with "(Official Audio)" or feat. suffix appended
    """
    vt = _clean(video_title)
    st = _clean(song_title)
    ar = _clean(artist)

    if vt == st or vt.startswith(st + " "):
        return True
    if vt.startswith(f"{ar} {st}"):
        return True
    # All significant words from the song title present (handles feat. variants)
    sig = [w for w in st.split() if len(w) >= 3]
    return bool(sig) and all(w in vt for w in sig)


_COLLAB_SEP = re.compile(r"\s*[&,]\s*|\s+(?:ft\.?|feat\.?|and|x)\s+", re.IGNORECASE)


def _is_artist_ch(channel: str, artist: str) -> bool:
    ch = channel.lower()
    is_vevo = "vevo" in ch
    ch_nospace = ch.replace(" ", "")

    def _one_matches(a: str) -> bool:
        a_nospace = a.replace(" ", "")
        vevo_ok = is_vevo and len(a_nospace) >= 3 and a_nospace in ch_nospace
        # Require >=6 chars for ch-in-a so short generic names don't false-match.
        return a in ch or (len(ch) >= 6 and ch in a) or vevo_ok

    ar = artist.lower()
    if _one_matches(ar):
        return True
    # For collaborative credits ("Drake & Central Cee"), check each artist separately
    # so a channel owned by any one of them still qualifies.
    for part in _COLLAB_SEP.split(ar):
        part = part.strip()
        if len(part) >= 3 and _one_matches(part):
            return True
    return False


# ── per-phase scorers ─────────────────────────────────────────────────────────

def _score_audio(video_title: str, channel: str, artist: str, song_title: str) -> int:
    """Phase 1 — find the canonical song upload (Topic channel or artist's own channel).

    2  — "Artist - Topic" auto-generated channel (title must match song)
    1  — artist's official channel with a matching plain title
   -1  — skip (is an MV, wrong title, unrelated channel, or skip-keyword hit)
    """
    t = video_title.lower()
    ch = channel.lower()

    if any(kw in t for kw in _SKIP_KEYWORDS):
        return -1

    # Explicit MV results belong to Phase 2
    if any(kw.lower() in t for kw in _MV_KEYWORDS):
        return -1

    if not _sig_present(video_title, song_title):
        return -1

    if "- topic" in ch:
        # Topic-channel titles are exactly the song name — require a close match
        return 2 if _title_matches_song(video_title, song_title, artist) else -1

    if _is_artist_ch(channel, artist):
        return 1 if _title_matches_song(video_title, song_title, artist) else -1

    return -1


def _score_mv(video_title: str, channel: str, artist: str, song_title: str) -> int:
    """Phase 2 — find the official music video.

    Channel identity is the primary gate; title keywords are secondary.

    3  — VEVO or artist channel + MV signal in title (confirmed)
    1  — artist channel + matching title, no MV title keywords (provisional; needs description check)
   -1  — skip (unrecognised channel, wrong title, or skip-keyword)
    """
    t = video_title.lower()
    ch = channel.lower()

    if any(kw in t for kw in _SKIP_KEYWORDS):
        return -1

    if not _sig_present(video_title, song_title):
        return -1

    artist_ch = _is_artist_ch(channel, artist)
    is_vevo = "vevo" in ch

    # Require a trusted channel — random uploads with "Official Video" in the title
    # are ignored entirely.
    if not (artist_ch or is_vevo):
        return -1

    has_mv_kw = any(kw.lower() in t for kw in _MV_KEYWORDS) or bool(re.search(r"\bm/?v\b", t))
    is_official = "official" in t and not any(kw in t for kw in _AUDIO_INDICATORS)
    is_mv = has_mv_kw or is_vevo or is_official

    if is_mv:
        return 3
    # Artist channel, plain title — provisional; description check will decide
    if artist_ch:
        return 1
    return -1


# ── YouTube page parsing ──────────────────────────────────────────────────────

def _extract_data(html: str) -> dict | None:
    match = re.search(r"var ytInitialData\s*=\s*", html)
    if not match:
        return None
    try:
        obj, _ = json.JSONDecoder().raw_decode(html, match.end())
        return obj
    except (json.JSONDecodeError, ValueError):
        return None


async def _fetch_description(client: httpx.AsyncClient, video_id: str) -> str:
    """Return the description text of a YouTube video, or '' on failure."""
    try:
        r = await client.get("https://www.youtube.com/watch", params={"v": video_id})
        r.raise_for_status()
    except Exception:
        return ""
    m = re.search(r"var ytInitialPlayerResponse\s*=\s*", r.text)
    if not m:
        return ""
    try:
        obj, _ = json.JSONDecoder().raw_decode(r.text, m.end())
        return obj.get("videoDetails", {}).get("shortDescription", "")
    except (json.JSONDecodeError, ValueError):
        return ""


def _iter_videos(data: dict):
    """Yield (video_id, title, channel) tuples from a YouTube search-results page."""
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
            yield vr["videoId"], title, channel


# ── public API ────────────────────────────────────────────────────────────────

async def fetch_youtube_url(title: str, artist: str) -> tuple[str, bool]:
    """Search YouTube for a song. Returns (url, is_music_video).

    Phase 1 — canonical audio:
      Searches for the plain song, prioritising the "Artist - Topic" auto-channel
      (title = exactly the song name) then the artist's own channel with a clean
      title ("Song" or "Artist - Song").  Explicit MV results are excluded here.

    Phase 2 — official music video:
      Searches specifically for the MV.  VEVO and artist-channel uploads with MV
      signals (keywords, "official" without audio tag) score highest.

    Returns the MV URL (is_music_video=True) when Phase 2 succeeds, otherwise
    the audio URL (is_music_video=False).  Returns ("", False) if neither phase
    finds a reliable match.
    """
    if not title or not artist:
        return "", False

    audio_candidates: list[tuple[int, int, str]] = []
    mv_candidates: list[tuple[int, int, str]] = []
    provisional_mv: list[tuple[int, int, str]] = []  # artist ch, plain title; needs description
    seen_ids: set[str] = set()

    async with httpx.AsyncClient(
        timeout=12.0, headers=_HEADERS, follow_redirects=True
    ) as client:

        # ── Phase 1: canonical audio / Topic channel ───────────────────
        for query in (
            f'"{artist}" "{title}"',
            f'{artist} {title}',
        ):
            try:
                r = await client.get(
                    "https://www.youtube.com/results",
                    params={"search_query": query},
                )
                r.raise_for_status()
            except Exception:
                continue

            data = _extract_data(r.text)
            if not data:
                continue

            for rank, (vid_id, vtitle, channel) in enumerate(
                list(_iter_videos(data))[:10]
            ):
                if vid_id in seen_ids:
                    continue
                seen_ids.add(vid_id)
                score = _score_audio(vtitle, channel, artist, title)
                if score > 0:
                    audio_candidates.append(
                        (score, rank, f"https://www.youtube.com/watch?v={vid_id}")
                    )

            # Topic-channel hit (score 2) is definitive — skip remaining queries
            if any(s >= 2 for s, _, _ in audio_candidates):
                break

        # ── Phase 2: music video ───────────────────────────────────────
        for query in (
            f'"{artist}" "{title}" official music video',
            f'{artist} {title} official music video',
        ):
            try:
                r = await client.get(
                    "https://www.youtube.com/results",
                    params={"search_query": query},
                )
                r.raise_for_status()
            except Exception:
                continue

            data = _extract_data(r.text)
            if not data:
                continue

            for rank, (vid_id, vtitle, channel) in enumerate(
                list(_iter_videos(data))[:10]
            ):
                if vid_id in seen_ids:
                    continue
                seen_ids.add(vid_id)
                score = _score_mv(vtitle, channel, artist, title)
                url = f"https://www.youtube.com/watch?v={vid_id}"
                if score == 3:
                    mv_candidates.append((score, rank, url))
                elif score == 1:
                    provisional_mv.append((score, rank, url))

            # High-confidence MV found — stop
            if any(s >= 3 for s, _, _ in mv_candidates):
                break

        # ── Description boost for MV candidates ───────────────────────
        # Fetch descriptions for up to 3 top candidates and apply a score
        # bonus when the description confirms this is a real music video.
        # Crew keywords (+2) outweigh generic MV indicator words (+1).
        for i, (score, rank, url) in enumerate(mv_candidates[:3]):
            vid_id = url.split("=")[-1]
            desc = (await _fetch_description(client, vid_id)).lower()
            if not desc:
                continue
            if any(kw in desc for kw in _MV_CREW_KEYWORDS):
                mv_candidates[i] = (score + 2, rank, url)
            elif any(kw in desc for kw in _MV_DESC_INDICATORS):
                mv_candidates[i] = (score + 1, rank, url)

        # ── Provisional promotion (Phase 2 plain-title hits) ──────────
        # Artist-channel videos found in Phase 2 with plain titles: only
        # add to mv_candidates when the description confirms MV.
        confirmed_ids = {u.split("=")[-1] for _, _, u in mv_candidates}
        for score, rank, url in provisional_mv[:3]:
            vid_id = url.split("=")[-1]
            if vid_id in confirmed_ids:
                continue
            desc = (await _fetch_description(client, vid_id)).lower()
            if not desc:
                continue
            if any(kw in desc for kw in _MV_CREW_KEYWORDS):
                mv_candidates.append((score + 2, rank, url))
            elif any(kw in desc for kw in _MV_DESC_INDICATORS):
                mv_candidates.append((score + 1, rank, url))

        # ── Audio-to-MV promotion (Phase 1 plain-title hits) ──────────
        # Artist-channel (score=1) audio hits are seen_ids-blocked from
        # Phase 2, so their descriptions are never checked. Do it here:
        # if the description confirms MV, reclassify them.
        mv_ids = {u.split("=")[-1] for _, _, u in mv_candidates}
        for score, rank, url in audio_candidates[:5]:
            if score != 1:  # Topic-channel (score=2) is canonical audio; skip
                continue
            vid_id = url.split("=")[-1]
            if vid_id in mv_ids:
                continue
            desc = (await _fetch_description(client, vid_id)).lower()
            if not desc:
                continue
            if any(kw in desc for kw in _MV_CREW_KEYWORDS):
                mv_candidates.append((score + 2, rank, url))
            elif any(kw in desc for kw in _MV_DESC_INDICATORS):
                mv_candidates.append((score + 1, rank, url))

    # MV takes priority; audio is the fallback
    if mv_candidates:
        mv_candidates.sort(key=lambda x: (-x[0], x[1]))
        return mv_candidates[0][2], True

    if audio_candidates:
        audio_candidates.sort(key=lambda x: (-x[0], x[1]))
        return audio_candidates[0][2], False

    return "", False
