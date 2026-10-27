"""
Capture trimmed YouTube, Deezer and iTunes responses for the offline lookup tests.

    uv run python -m bench.capture_lookups                  # every case
    uv run python -m bench.capture_lookups --cases sza-sos-t1

YouTube: for every entry in tests/golden/youtube.json, every search query the
lookup can issue and the descriptions of the videos it could check, reduced to
the fields the scorer reads.
Covers: for every case in bench/cases.json, the Deezer search, iTunes search and
iTunes lookup responses for that track.

Writes tests/fixtures/lookups/{youtube,covers}/<id>.json.
Requests run one at a time with a short pause, like a single user browsing.
Overwrites existing fixtures: re-run the offline tests and review the diff.
"""

import argparse
import asyncio
import json
import re

import httpx

from bench.cases import load_cases, load_golden
from bench.lookups import YOUTUBE_GOLDEN, load_youtube_golden
from scraper import deezer, youtube
from tests.lookup_fixtures import COVERS_DIR, YOUTUBE_DIR

PAUSE_S = 0.5
MAX_VIDEOS_PER_QUERY = 10


def _text(obj: dict | None) -> str:
    if not obj:
        return ""
    return obj.get("simpleText") or "".join(r.get("text", "") for r in obj.get("runs", []))


def trim_video(vr: dict) -> dict:
    """Keep only what _iter_videos and the scorers read from a videoRenderer."""
    owner = (vr.get("ownerText") or {}).get("runs", [{}])[0]
    snippets = vr.get("detailedMetadataSnippets") or []
    out: dict = {
        "videoId": vr["videoId"],
        "title": {"runs": [{"text": _text(vr.get("title"))}]},
        "ownerText": {"runs": [{"text": owner.get("text", "")}]},
    }
    badges = [
        {"metadataBadgeRenderer": {"style": b["metadataBadgeRenderer"].get("style", "")}}
        for b in vr.get("ownerBadges", [])
        if "metadataBadgeRenderer" in b
    ]
    if badges:
        out["ownerBadges"] = badges
    if vr.get("lengthText"):
        out["lengthText"] = {"simpleText": _text(vr["lengthText"])}
    if snippets:
        out["detailedMetadataSnippets"] = [{"snippetText": {"runs": [{"text": _text(snippets[0].get("snippetText"))}]}}]
    return out


def trim_search(data: dict) -> dict:
    videos = []
    for section in data["contents"]["twoColumnSearchResultsRenderer"]["primaryContents"]["sectionListRenderer"][
        "contents"
    ]:
        for item in section.get("itemSectionRenderer", {}).get("contents", []):
            vr = item.get("videoRenderer")
            if vr and vr.get("videoId") and len(videos) < MAX_VIDEOS_PER_QUERY:
                videos.append({"videoRenderer": trim_video(vr)})
    return {
        "contents": {
            "twoColumnSearchResultsRenderer": {
                "primaryContents": {
                    "sectionListRenderer": {"contents": [{"itemSectionRenderer": {"contents": videos}}]}
                }
            }
        }
    }


def _worth_describing(vr: dict, title: str, artist: str) -> bool:
    """Videos the lookup might fetch a description for: the song's title on a trusted-looking channel."""
    channel = vr["ownerText"]["runs"][0]["text"]
    trusted = bool(vr.get("ownerBadges")) or youtube._is_artist_ch(channel, artist)
    return trusted and youtube._sig_present(vr["title"]["runs"][0]["text"], title)


async def capture_youtube(client: httpx.AsyncClient, entry: dict) -> dict:
    title, artist = entry["title"], entry["artist"]
    searches: dict[str, dict] = {}
    for query in (*youtube._audio_queries(title, artist), *youtube._mv_queries(title, artist)):
        r = await client.get("https://www.youtube.com/results", params={"search_query": query})
        r.raise_for_status()
        data = youtube._extract_data(r.text)
        if data is None:
            raise RuntimeError(f"no ytInitialData for {query!r}")
        searches[query] = trim_search(data)
        await asyncio.sleep(PAUSE_S)

    to_describe: list[str] = []
    for data in searches.values():
        for item in data["contents"]["twoColumnSearchResultsRenderer"]["primaryContents"]["sectionListRenderer"][
            "contents"
        ][0]["itemSectionRenderer"]["contents"]:
            vr = item["videoRenderer"]
            if vr["videoId"] not in to_describe and _worth_describing(vr, title, artist):
                to_describe.append(vr["videoId"])
    for golden_id in entry["accept"]:
        if golden_id not in to_describe:
            to_describe.append(golden_id)

    watch: dict[str, dict] = {}
    for video_id in to_describe:
        r = await client.get("https://www.youtube.com/watch", params={"v": video_id})
        r.raise_for_status()
        m = re.search(r"var ytInitialPlayerResponse\s*=\s*", r.text)
        if m:
            obj, _ = json.JSONDecoder().raw_decode(r.text, m.end())
            vd = obj.get("videoDetails", {})
            watch[video_id] = {
                "videoDetails": {
                    k: vd.get(k, "") for k in ("videoId", "title", "author", "lengthSeconds", "shortDescription")
                }
            }
        await asyncio.sleep(PAUSE_S)
    return {"title": title, "artist": artist, "searches": searches, "watch": watch}


def _trim_deezer(data: dict) -> dict:
    return {
        "data": [
            {
                "title": t.get("title", ""),
                "artist": {"name": t.get("artist", {}).get("name", "")},
                "album": {
                    "title": t.get("album", {}).get("title", ""),
                    "cover_xl": t.get("album", {}).get("cover_xl", ""),
                },
            }
            for t in data.get("data", [])
        ]
    }


_ITUNES_KEYS = (
    "wrapperType",
    "kind",
    "artistName",
    "collectionName",
    "trackName",
    "collectionId",
    "trackId",
    "artworkUrl100",
)


def _trim_itunes(data: dict) -> dict:
    results = [{k: r[k] for k in _ITUNES_KEYS if k in r} for r in data.get("results", [])]
    return {"resultCount": len(results), "results": results}


async def capture_covers(client: httpx.AsyncClient, case_id: str, url: str) -> dict:
    golden = load_golden(case_id)
    title, artist = golden.title, golden.artist
    term = f"{artist} {title}"
    ref = deezer.catalog_ref(url)
    out: dict = {"title": title, "artist": artist, "url": url, "deezer": {}, "itunes_search": {}, "itunes_lookup": {}}

    r = await client.get("https://api.deezer.com/search", params={"q": term, "limit": 10})
    out["deezer"][term] = _trim_deezer(r.json())
    await asyncio.sleep(PAUSE_S)
    r = await client.get(
        "https://itunes.apple.com/search", params={"term": term, "media": "music", "entity": "song", "limit": 10}
    )
    out["itunes_search"][term] = _trim_itunes(r.json())
    await asyncio.sleep(PAUSE_S)
    if ref:
        country, catalog_id = ref
        r = await client.get("https://itunes.apple.com/lookup", params={"id": catalog_id, "country": country})
        out["itunes_lookup"][catalog_id] = _trim_itunes(r.json())
    return out


def _write(path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {path.name}")


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cases", nargs="*", default=[])
    parser.add_argument("--only", choices=("youtube", "covers"), default=None)
    args = parser.parse_args()

    async with httpx.AsyncClient(timeout=15.0, headers=youtube._HEADERS, follow_redirects=True) as client:
        if args.only in (None, "youtube"):
            for entry in load_youtube_golden():
                if args.cases and entry["id"] not in args.cases:
                    continue
                _write(YOUTUBE_DIR / f"{entry['id']}.json", await capture_youtube(client, entry))
        if args.only in (None, "covers"):
            for case in load_cases():
                if args.cases and case.id not in args.cases:
                    continue
                _write(COVERS_DIR / f"{case.id}.json", await capture_covers(client, case.id, case.url))
    print(f"source of truth: {YOUTUBE_GOLDEN.relative_to(YOUTUBE_GOLDEN.parents[2])}")


if __name__ == "__main__":
    asyncio.run(main())
