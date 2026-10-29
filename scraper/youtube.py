import asyncio
import json
import re
from collections.abc import Iterator
from typing import NamedTuple

import httpx

from scraper.models import VideoKind
from scraper.text import core_title_words, words

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
    "lyrics",
    "lyric",
    "audio only",
    "cover by",
    "reaction",
    "reacts",
    "remix",
    "parody",
    "live",
    "performance",
    "interview",
    "behind the scenes",
    "dance practice",
    "choreography",
    "teaser",
    "trailer",
)
# A lyric video's own words; every other skip word still rules a lyric video out.
_LYRIC_KEYWORDS = ("lyric video", "lyrics video", "official lyric", "lyrics", "lyric")
_LYRIC_FILLER = frozenset({"lyric", "lyrics"})
_AUDIO_INDICATORS = ("official audio", "(audio)", "audio only", "audio stream")

# Description-based MV signals - two separate arrays so they can be weighted differently
_MV_CREW_KEYWORDS = (
    "directed by",
    "director:",
    "director,",
    "d.p.",
    "dp:",
    "dop:",
    "cinematography by",
    "cinematographer",
    "shot by",
    "filmed by",
    "edited by",
    "editor:",
    "color by",
    "colorist",
    "visual director",
    "creative director",
    "production company",
)
_MV_DESC_INDICATORS = (
    "music video",
    "official video",
    "official music video",
    "official visual",
    "visual video",
    "watch the video",
    "stream & watch",
    "listen & watch",
)


# ── helpers ───────────────────────────────────────────────────────────────────


def _sig_present(video_title: str, song_title: str) -> bool:
    """True if at least one significant word (>=3 chars) from the song title is a whole
    word of the video title. Falls back to a collapsed-string check for very short/special-char
    titles like 'FE!N'. Whole words, not substrings: "the" is inside "feather", which let
    "THE GREATEST" match a video of "BIRDS OF A FEATHER"."""
    t = video_title.lower()
    sig = [w for w in re.split(r"\W+", song_title.lower()) if len(w) >= 3]
    if sig:
        present = set(re.split(r"\W+", t))
        return any(w in present for w in sig)
    # e.g. "FE!N" -> collapsed "fen"; check against collapsed video title
    ct = re.sub(r"[^a-z0-9]", "", song_title.lower())
    cv = re.sub(r"[^a-z0-9]", "", t)
    return bool(ct) and ct in cv


# Words a plain upload may add around "Artist - Song" without making it a different video.
_PLAIN_TITLE_FILLER = frozenset(
    {"official", "audio", "video", "music", "visualizer", "visualiser", "explicit", "clean", "hd", "hq", "4k"}
    | {"feat", "ft", "featuring", "with", "x", "and", "vevo", "topic"}
)


def _title_matches_song(
    video_title: str, song_title: str, artist: str, extra_filler: frozenset[str] = frozenset()
) -> bool:
    """True when the video title is just this song, as a plain upload titles it.

    Accepts "Song", "Artist - Song", "Song - Artist" and either with tags such as
    "(Official Audio)" or the featured artists, with or without the feat. part.
    Rejects any extra words: "SZA - SOS Where The Hell Have You Been ?" is a
    short film, not the song "SOS", even on the artist's channel.
    """
    core = core_title_words(song_title)
    if not core:
        return False
    title = words(video_title)
    allowed = set(words(song_title)) | set(words(artist)) | _PLAIN_TITLE_FILLER | extra_filler
    return set(core) <= set(title) and all(w in allowed for w in title)


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


def _names_artist(text: str, artist: str) -> bool:
    """True if the full artist credit, or one collaborator (>=3 chars), appears as whole words in text."""
    haystack = f" {' '.join(words(text))} "
    names = [artist, *_COLLAB_SEP.split(artist)]
    return any(len(name) >= 3 and f" {name} " in haystack for name in (" ".join(words(n)) for n in names if n.strip()))


def _is_topic_upload(channel: str, snippet: str, artist: str, trusted_channel: bool) -> bool:
    """True for the auto-generated "Artist - Topic" upload of a track.

    Search results now show Topic uploads under the artist's channel name, so the
    "Provided to YouTube by <label> / Song · Artist" description is the reliable
    marker. Reuploads copy that text, so it only counts on a trusted channel.
    """
    if "- topic" in channel.lower():
        return True
    return trusted_channel and snippet.lower().startswith("provided to youtube by") and _names_artist(snippet, artist)


# ── per-phase scorers ─────────────────────────────────────────────────────────


def _score_audio(
    video_title: str,
    channel: str,
    artist: str,
    song_title: str,
    *,
    official_artist: bool = False,
    snippet: str = "",
) -> int:
    """Phase 1 - find the song's audio, in Genius's order (music video, lyric video, official audio, auto-generated).

     2  - the artist's own channel with a matching plain title (the official audio)
     1  - Topic upload: "Artist - Topic" channel or "Provided to YouTube by" (title must match song), auto-generated
    -1  - skip (is an MV, wrong title, unrelated channel, or skip-keyword hit)

    `official_artist` is YouTube's Official Artist Channel badge. It identifies the
    artist's channel when its name differs from the credit (Frank Ocean posts as
    "Blonded"), provided the video title names the artist.
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

    artist_ch = _is_artist_ch(channel, artist)
    if _is_topic_upload(ch, snippet, artist, artist_ch or official_artist):
        # Topic-channel titles are exactly the song name - require a close match
        return 1 if _title_matches_song(video_title, song_title, artist) else -1

    if artist_ch or (official_artist and _names_artist(video_title, artist)):
        return 2 if _title_matches_song(video_title, song_title, artist) else -1

    return -1


def _score_lyric(video_title: str, channel: str, artist: str, song_title: str, *, official_artist: bool = False) -> int:
    """A lyric video, which Genius ranks just below a music video.

     3  - the artist's own channel (or the Official Artist badge, when the title names the artist)
          uploaded the song with "lyric" or "lyrics" in the title
    -1  - anything else: other channels, remixes, live versions, other songs
    """
    t = video_title.lower()
    if not any(kw in t for kw in _LYRIC_KEYWORDS):
        return -1
    if any(kw in t for kw in _SKIP_KEYWORDS if kw not in _LYRIC_KEYWORDS):
        return -1
    if not _sig_present(video_title, song_title):
        return -1
    own_channel = _is_artist_ch(channel, artist) or (official_artist and _names_artist(video_title, artist))
    if not own_channel:
        return -1
    return 3 if _title_matches_song(video_title, song_title, artist, _LYRIC_FILLER) else -1


def _score_mv(video_title: str, channel: str, artist: str, song_title: str, *, verified: bool = False) -> int:
    """Phase 2 - find the official music video.

     Channel identity is the primary gate; title keywords are secondary.

     3  - artist (or artist VEVO) channel + MV signal in title (confirmed)
     2  - verified non-artist channel (label) + MV keyword + artist in title (provisional; needs crew credits)
     1  - artist channel + matching title, no MV title keywords (provisional; needs description check)
    -1  - skip (unrecognised channel, wrong title, or skip-keyword)
    """
    t = video_title.lower()
    ch = channel.lower()

    if any(kw in t for kw in _SKIP_KEYWORDS):
        return -1

    if not _sig_present(video_title, song_title):
        return -1

    artist_ch = _is_artist_ch(channel, artist)
    is_vevo = "vevo" in ch
    has_mv_kw = any(kw.lower() in t for kw in _MV_KEYWORDS) or bool(re.search(r"\bm/?v\b", t))

    # Require the artist's own channel. "VEVO" in a channel name is not enough on its
    # own: reupload channels such as "YouTube VeVo" use it too.
    if not artist_ch:
        # Some official videos live on a verified label channel (BTS on HYBE LABELS).
        # Provisional: only a crew credit in the description makes it count.
        return 2 if verified and has_mv_kw and _names_artist(video_title, artist) else -1

    is_official = "official" in t and not any(kw in t for kw in _AUDIO_INDICATORS)
    is_mv = has_mv_kw or is_vevo or is_official

    if is_mv:
        return 3
    # Artist channel, plain title - provisional; description check will decide.
    # Only the song itself qualifies: other promo clips also carry crew credits.
    return 1 if _title_matches_song(video_title, song_title, artist) else -1


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


# YouTube's own website asks these JSON endpoints for a search and for a video's details. They answer in the shape of
# the page data below (videoRenderer, ownerBadges, videoDetails) at about a third of the size of the HTML page, and
# were not refused after a few requests the way the HTML page is. Unofficial: when one gives nothing, the HTML page
# is used instead.
_INNERTUBE = "https://www.youtube.com/youtubei/v1"
_INNERTUBE_CONTEXT = {"client": {"clientName": "WEB", "clientVersion": "2.20250101.00.00", "hl": "en", "gl": "US"}}


async def _innertube(client: httpx.AsyncClient, endpoint: str, body: dict) -> dict | None:
    """The JSON answer of one InnerTube endpoint, or None when it did not give one."""
    try:
        r = await client.post(
            f"{_INNERTUBE}/{endpoint}",
            params={"prettyPrint": "false"},
            json={"context": _INNERTUBE_CONTEXT, **body},
        )
        r.raise_for_status()
        data = r.json()
    except Exception:
        return None
    return data if isinstance(data, dict) else None


async def _fetch_description(client: httpx.AsyncClient, video_id: str) -> str:
    """Return the description text of a YouTube video, or '' on failure."""
    data = await _innertube(client, "player", {"videoId": video_id})
    if data and isinstance(data.get("videoDetails"), dict):
        return data["videoDetails"].get("shortDescription", "")
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


class _Video(NamedTuple):
    id: str
    title: str
    channel: str
    official_artist: bool  # Official Artist Channel badge
    verified: bool  # plain verified checkmark (labels, media companies)
    snippet: str  # description excerpt shown under the result


def _iter_videos(data: dict) -> Iterator[_Video]:
    """Yield the videos of a YouTube search-results page in result order."""
    try:
        sections = data["contents"]["twoColumnSearchResultsRenderer"]["primaryContents"]["sectionListRenderer"][
            "contents"
        ]
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
            styles = {b.get("metadataBadgeRenderer", {}).get("style", "") for b in vr.get("ownerBadges", [])}
            snippets = vr.get("detailedMetadataSnippets") or [{}]
            snippet = "".join(r.get("text", "") for r in snippets[0].get("snippetText", {}).get("runs", []))
            yield _Video(
                vr["videoId"],
                title,
                channel,
                official_artist="BADGE_STYLE_TYPE_VERIFIED_ARTIST" in styles,
                verified="BADGE_STYLE_TYPE_VERIFIED" in styles,
                snippet=snippet,
            )


def _audio_queries(title: str, artist: str) -> tuple[str, ...]:
    """Phase 1 search queries, most targeted first."""
    return (
        f'"{title}" "{artist} - Topic"',  # targeted Topic-channel lookup
        f'"{artist}" "{title}"',
        f"{artist} {title}",
    )


def _mv_queries(title: str, artist: str) -> tuple[str, ...]:
    """Phase 2 search queries, most targeted first."""
    return (
        f'"{artist}" "{title}" official music video',
        f"{artist} {title} official music video",
    )


# Watch pages fetched at once for description checks. The searches run one after the other, so YouTube never sees
# more than three requests at the same time.
_MAX_PARALLEL_DESCRIPTIONS = 3

# Descriptions read per kind of candidate: the best few are enough to confirm a video, and every page read is a
# request Google may answer with its "sorry" page. The same numbers as the extension's.
_MAX_MV_DESCRIPTIONS = 2
_MAX_PROVISIONAL_DESCRIPTIONS = 2
_MAX_LABEL_DESCRIPTIONS = 1
_MAX_AUDIO_DESCRIPTIONS = 2

# What an audio-phase score means: 3 a lyric video, 2 the artist's own audio, 1 the auto-generated upload.
_AUDIO_KINDS: dict[int, VideoKind] = {3: "lyric-video", 2: "official-audio", 1: "auto-generated"}

_Candidate = tuple[int, int, str]  # (score, rank, url)


def _watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def _video_id(url: str) -> str:
    return url.split("=")[-1]


async def _search(client: httpx.AsyncClient, query: str) -> list[_Video]:
    """Top 10 videos of a YouTube search, or [] on failure."""
    data = await _innertube(client, "search", {"query": query})
    if data is not None and "contents" in data:
        return list(_iter_videos(data))[:10]
    try:
        r = await client.get("https://www.youtube.com/results", params={"search_query": query})
        r.raise_for_status()
    except Exception:
        return []
    data = _extract_data(r.text)
    return list(_iter_videos(data))[:10] if data else []


async def _audio_phase(client: httpx.AsyncClient, title: str, artist: str) -> list[_Candidate]:
    """Phase 1: a lyric video (3), the artist's own audio (2) or the Topic upload (1), as scored candidates."""
    candidates: list[_Candidate] = []
    seen: set[str] = set()
    for query in _audio_queries(title, artist):
        for rank, video in enumerate(await _search(client, query)):
            if video.id in seen:
                continue
            seen.add(video.id)
            lyric = _score_lyric(video.title, video.channel, artist, title, official_artist=video.official_artist)
            score = (
                lyric
                if lyric > 0
                else _score_audio(
                    video.title,
                    video.channel,
                    artist,
                    title,
                    official_artist=video.official_artist,
                    snippet=video.snippet,
                )
            )
            if score > 0:
                candidates.append((score, rank, _watch_url(video.id)))

        # The artist's own audio or a lyric video outranks the Topic upload, so a Topic upload alone
        # does not end the search.
        if any(s >= 2 for s, _, _ in candidates):
            break
    return candidates


async def _mv_phase(
    client: httpx.AsyncClient, title: str, artist: str
) -> tuple[list[_Candidate], list[_Candidate], list[_Candidate]]:
    """Phase 2: music video. Returns (confirmed, provisional, label-channel) candidates.

    Uses its own seen-set so Phase 1 rejects (MV-keyword videos that scored -1
    in _score_audio) can still be evaluated here.
    """
    confirmed: list[_Candidate] = []
    provisional: list[_Candidate] = []  # artist ch, plain title; needs description
    label: list[_Candidate] = []  # verified label channel; needs crew credits
    seen: set[str] = set()
    for query in _mv_queries(title, artist):
        for rank, video in enumerate(await _search(client, query)):
            if video.id in seen:
                continue
            seen.add(video.id)
            score = _score_mv(video.title, video.channel, artist, title, verified=video.verified)
            if score == 3:
                confirmed.append((score, rank, _watch_url(video.id)))
            elif score == 2:
                label.append((score, rank, _watch_url(video.id)))
            elif score == 1:
                provisional.append((score, rank, _watch_url(video.id)))

        # High-confidence MV found - stop
        if confirmed:
            break
    return confirmed, provisional, label


async def _fetch_descriptions(client: httpx.AsyncClient, video_ids: list[str]) -> dict[str, str]:
    """Lowercased descriptions by video id, fetched concurrently ('' on failure)."""
    limit = asyncio.Semaphore(_MAX_PARALLEL_DESCRIPTIONS)

    async def one(video_id: str) -> str:
        async with limit:
            return (await _fetch_description(client, video_id)).lower()

    descriptions = await asyncio.gather(*(one(v) for v in video_ids))
    return dict(zip(video_ids, descriptions, strict=True))


def _description_bonus(desc: str) -> int:
    """Crew keywords (+2) outweigh generic MV indicator words (+1); 0 when neither appears."""
    if any(kw in desc for kw in _MV_CREW_KEYWORDS):
        return 2
    if any(kw in desc for kw in _MV_DESC_INDICATORS):
        return 1
    return 0


# ── public API ────────────────────────────────────────────────────────────────


async def fetch_youtube_url(title: str, artist: str) -> tuple[str, VideoKind | None]:
    """Search YouTube for a song. Returns (url, kind), kind being what the link is, in Genius's order:
    "music-video", "lyric-video", "official-audio" or "auto-generated".

    Phase 2 - official music video, searched first:
      Searches specifically for the MV.  VEVO and artist-channel uploads with MV
      signals (keywords, "official" without audio tag) score highest.

    Phase 1 - lyric video and audio, searched only when Phase 2 found no confirmed music video:
      Searches for the plain song.  A lyric video on the artist's channel ranks
      first, then the artist's own audio ("Song" or "Artist - Song"), then the
      auto-generated "Artist - Topic" upload.  Explicit MV results are excluded here.

    A music video wins over audio whatever the audio scores, so the audio search would change nothing when a
    confirmed one is found. Then the descriptions of the few candidates that need confirming are fetched together.

    Returns the MV URL ("music-video") when Phase 2 succeeds, otherwise the lyric video, the official audio or the
    Topic upload.  Returns ("", None) if nothing reliable is found.
    """
    if not title or not artist:
        return "", None

    async with httpx.AsyncClient(timeout=12.0, headers=_HEADERS, follow_redirects=True) as client:
        mv_candidates, provisional_mv, label_mv = await _mv_phase(client, title, artist)
        audio_candidates = [] if mv_candidates else await _audio_phase(client, title, artist)

        # Every description the checks below may read, each fetched once.
        mv_ids = {_video_id(u) for _, _, u in mv_candidates}
        wanted = [_video_id(u) for _, _, u in mv_candidates[:_MAX_MV_DESCRIPTIONS]]
        wanted += [i for _, _, u in provisional_mv[:_MAX_PROVISIONAL_DESCRIPTIONS] if (i := _video_id(u)) not in mv_ids]
        wanted += [_video_id(u) for _, _, u in label_mv[:_MAX_LABEL_DESCRIPTIONS]]
        wanted += [
            _video_id(u)
            for s, _, u in audio_candidates[:_MAX_AUDIO_DESCRIPTIONS]
            if s == 2 and _video_id(u) not in mv_ids
        ]
        descriptions = await _fetch_descriptions(client, list(dict.fromkeys(wanted)))

    def described(url: str) -> str:
        return descriptions.get(_video_id(url), "")

    # ── Description boost for MV candidates ───────────────────────
    # The top candidates get a bonus when the description confirms
    # this is a real music video.
    for i, (score, rank, url) in enumerate(mv_candidates[:_MAX_MV_DESCRIPTIONS]):
        mv_candidates[i] = (score + _description_bonus(described(url)), rank, url)

    # ── Provisional promotion (Phase 2 plain-title hits) ──────────
    # Artist-channel videos found in Phase 2 with plain titles: only
    # add to mv_candidates when the description confirms MV.
    for score, rank, url in provisional_mv[:_MAX_PROVISIONAL_DESCRIPTIONS]:
        if _video_id(url) in mv_ids:
            continue
        bonus = _description_bonus(described(url))
        if bonus:
            mv_candidates.append((score + bonus, rank, url))

    # ── Label-channel videos ──────────────────────────────────────
    # Kept at score 2, so any confirmed artist-channel video still wins.
    for score, rank, url in label_mv[:_MAX_LABEL_DESCRIPTIONS]:
        if any(kw in described(url) for kw in _MV_CREW_KEYWORDS):
            mv_candidates.append((score, rank, url))

    # ── Audio-to-MV promotion (Phase 1 plain-title hits) ──────────
    # An artist-channel (score=2) audio hit may not appear in Phase 2
    # search results at all; check its description and reclassify as MV
    # if confirmed.
    now_mv = {_video_id(u) for _, _, u in mv_candidates}
    for score, rank, url in audio_candidates[:_MAX_AUDIO_DESCRIPTIONS]:
        # Lyric videos (3) and Topic uploads (1) are not reclassified
        if score != 2 or _video_id(url) in now_mv or _video_id(url) not in descriptions:
            continue
        bonus = _description_bonus(described(url))
        if bonus:
            # Scored as it was before audio moved up a point, so an MV it turns out to be ranks the same.
            mv_candidates.append((score - 1 + bonus, rank, url))

    # MV takes priority; then the lyric video, the official audio and the Topic upload by score
    if mv_candidates:
        mv_candidates.sort(key=lambda x: (-x[0], x[1]))
        return mv_candidates[0][2], "music-video"

    if audio_candidates:
        audio_candidates.sort(key=lambda x: (-x[0], x[1]))
        best = audio_candidates[0]
        return best[2], _AUDIO_KINDS[best[0]]

    return "", None
