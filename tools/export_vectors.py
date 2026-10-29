"""
Export parity test vectors for the browser extension.

    uv run python -m tools.export_vectors

Runs the reference Python functions over fixed inputs and writes inputs plus outputs to
extension/test/vectors.json. The TypeScript port must reproduce every output, so the two
implementations cannot drift apart silently. tests/unit/test_extension_exports.py fails
when the committed file is stale.
"""

import itertools
import json
from pathlib import Path
from typing import Any

from assistant.flow import autotab_steps, instruction_text
from scraper.apple_music import (
    _extract_title_artist,  # pyright: ignore[reportPrivateUsage]
    _normalise_role,  # pyright: ignore[reportPrivateUsage]
    catalog_id,
    credits_from_cards,
    credits_from_text,
    normalise_cover_url,
    pick_cover_url,
    split_copyright,
    track_count_from_footer,
)
from scraper.deezer import (
    _itunes_png,  # pyright: ignore[reportPrivateUsage]
    _same_track,  # pyright: ignore[reportPrivateUsage]
    catalog_ref,
)
from scraper.models import Credit, SongCredits, _extract_labels  # pyright: ignore[reportPrivateUsage]
from scraper.release_date import (
    date_from_meta,
    date_from_text,
    format_release_date,
    pick_release_date,
    split_release_date,
)
from scraper.text import core_title_words, words
from scraper.track_health import track_health
from scraper.youtube import (
    _iter_videos,  # pyright: ignore[reportPrivateUsage]
    _score_audio,  # pyright: ignore[reportPrivateUsage]
    _score_lyric,  # pyright: ignore[reportPrivateUsage]
    _score_mv,  # pyright: ignore[reportPrivateUsage]
)
from scraper.youtube_link import parse_youtube_link, youtube_search_url

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "extension" / "test" / "vectors.json"
YOUTUBE_GOLDEN = ROOT / "tests" / "golden" / "youtube.json"
YOUTUBE_FIXTURES = ROOT / "tests" / "fixtures" / "lookups" / "youtube"

QUEUE_KINDS = [
    "written_by",
    "produced_by",
    "role",
    "artist",
    "copyright_role",
    "phonographic_copyright",
    "copyright_notice",
    "youtube_url",
    "cover_art",
    "release_month",
    "release_day",
    "release_year",
]

COPYRIGHT_LINES = [
    "℗ 2024 Taylor Swift",
    "℗ 2022 Top Dawg Entertainment, under exclusive license to RCA Records",
    "℗ 2019 Columbia Records, a Division of Sony Music Entertainment",
    "© 2023 Big Label",
    "℗ 2024",
    "",
    "℗ 2021 Label A, distributed by Label B, released by Label C",
]

FOOTERS = [
    "℗ 2024 A Label\n© 2024 B Label\n12 songs, 45 minutes",
    "© 2020 Only Copyright",
    "℗ 2020 Only Phono © 2020 Same Line Copyright",
    "",
]

COVER_URLS = [
    "https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/ab/cd/ef/x.jpg/600x600bb.jpg",
    "https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/ab/cd/ef/x.jpg/1200x630wp-60.jpg?x=1",
    "https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/ab/cd/ef/x.jpg/296x296.webp",
    "https://example.com/no-size-suffix",
]

PICK_COVER_INPUTS = [
    [],
    ["https://x/image/thumb/Video126/v4/a/b.jpg/300x300.jpg"],
    [
        "https://x/image/thumb/Features126/v4/a/b.jpg/300x300.jpg",
        "https://x/image/thumb/Music126/v4/a/b.jpg/300x300bb.jpg",
    ],
]

CATALOG_URLS = [
    "https://music.apple.com/us/album/the-tortured-poets-department/1736268215",
    "https://music.apple.com/us/album/the-tortured-poets-department/1736268215?i=1736268220",
    "https://music.apple.com/gb/song/fortnight/1736268220",
    "https://music.apple.com/us/album/1736268215",
    "https://music.apple.com/us/playlist/x/pl.123",
    "https://example.com/album/1",
]

RAW_ROLES = ["songwriter", "Producer:", "  LEAD VOCALS ", "Unknown Role", "mixing engineer", ""]

CARD_CASES = [
    {"names": [], "roles": []},
    {"names": ["A", "B"], "roles": ["Songwriter"]},
    {
        "names": ["Taylor Swift", "Jack Antonoff", "  ", "Jack Antonoff"],
        "roles": ["Songwriter, Producer", "Producer, Drums", "Performer", "Drums"],
    },
    {"names": ["X"], "roles": ["Mixed Artist, Lead Vocals"]},
]

TEXT_CASES = [
    "",
    "Songwriter\nTaylor Swift, Jack Antonoff\nProducer\nJack Antonoff\n© 2024 Label\n",
    "Composition, Lyrics\nSongwriter:\nA & B\nMore by A\nPerformer\nC\nDrums\nD • E\n",
]

ARTWORK_URLS = [
    "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/6b/x.rgb.jpg/100x100bb.jpg",
    "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/6b/x.rgb.jpg/600x600bb.webp",
    "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/6b/x.rgb.jpg/1000x1000bb.png",
    "https://example.com/art.jpg",
    "",
]

# (result title, result artist, wanted title, wanted artist)
SAME_TRACK_CASES = [
    ("Fortnight", "Taylor Swift", "Fortnight (feat. Post Malone)", "Taylor Swift"),
    ("Fortnight (feat. Post Malone)", "Taylor Swift", "Fortnight", "Taylor Swift"),
    ("Kill Bill", "SZA", "SOS", "SZA"),
    ("D\u00c1KITI", "Bad Bunny", "Dakiti", "Bad Bunny & Jhay Cortez"),
    ("Fortnight", "The Lullabeats", "Fortnight", "Taylor Swift"),
    ("SOS", "Sza", "sos", "SZA"),
    ("X", "Someone", "X", "Ed"),
    ("Water (Remix)", "Tyla", "Water", "Tyla"),
]

PAGE_TITLES = [
    "Shabang – Single – Drake – Apple Music",
    "‎UTOPIA - Album by Travis Scott - Apple Music",
    "Slime You Out (feat. SZA) - Single by Drake on Apple Music",
    "SOS - Album by SZA - Apple Music",
    "Not Like Us - Single by Kendrick Lamar - Apple Music",
    "Not Like Us - Song by Kendrick Lamar - Apple Music",
    "Not Like Us – Song with Lyrics by Kendrick Lamar – Apple Music",
    "Good 4 U – Olivia Rodrigo – Apple Music",
    "Fortnight - Remix - Taylor Swift – Apple Music",
    "Heat Wave - Deluxe – Artist – Apple Music",
    "Title by Someone",
    "No separators here",
    "",
]

TITLES = ["Fortnight (feat. Post Malone)", "BAD BUNNY x DÁKITI (Audio)", "SOS", "FE!N", "Water ft. Someone [Remix]", ""]


RELEASE_META = [
    "2024-05-17T00:00:00.000Z",
    "2019-03-28",
    "  2024-12-31T23:59:59-08:00 ",
    "2024-02-29T00:00:00.000Z",
    "2024-02-31T00:00:00.000Z",
    "2023-02-29",
    "2024-13-01",
    "2024-5-17",
    "May 17, 2024",
    "12024-05-17",
    "",
    "junk",
]

RELEASE_TEXTS = [
    "May 4, 2024",
    "May 17, 2024 11 songs, 43 minutes ℗ 2024 Darkroom/Interscope Records",
    "December 9, 2022\n1 song, 3 minutes\n℗ 2022 TDE",
    "  sept. 3, 2020  ",
    "Sep 3 2020",
    "JANUARY 1, 2000",
    "17 May 2024",
    "4 March, 2021",
    "28 Mar. 2019 · 12 songs",
    "Updated Tue 9, 2024 then May 3, 2024",
    "17 mai 2024",
    "17 de mayo de 2024",
    "2024年5月17日",
    "Febuary 3, 2020",
    "February 31, 2024",
    "31 April 2024",
    "May 0, 2024",
    "May 17, 24",
    "May 17, 20245",
    "11 songs, 43 minutes ℗ 2024 Label",
    "",
]

# (meta, song page line, album footer)
RELEASE_PICKS = [
    ("2024-05-17T00:00:00.000Z", "May 4, 2024", "March 1, 2020"),
    ("", "May 4, 2024", "May 21, 2021"),
    ("", "", "May 21, 2021 12 songs"),
    ("2024-02-31", "May 4, 2024", ""),
    ("junk", "17 mai 2024", ""),
    ("", "", ""),
]

STORED_DATES = ["2024-05-17", "2019-03-08", "2024-02-29", "2024-02-30", "2024-5-7", "2024-05-17T00:00:00Z", ""]


def _song(**kw: Any) -> SongCredits:
    base: dict[str, Any] = {"title": "T", "artist": "A", "apple_music_url": "u", "credits": []}
    return SongCredits(**(base | kw))


SONGS: dict[str, SongCredits] = {
    "empty": _song(),
    "core_only": _song(
        credits=[
            Credit(role="Songwriter", artists=["W1", "W2"]),
            Credit(role="Producer", artists=["P1"]),
        ]
    ),
    "full": _song(
        credits=[
            Credit(role="Mixing Engineer", artists=["M1"]),
            Credit(role="Lyricist", artists=["W1", "W3"]),
            Credit(role="Songwriter", artists=["W1", "W2"]),
            Credit(role="producer", artists=["P1", "P2"]),
            Credit(role="Co-Producer", artists=["P2", "P3"]),
            Credit(role="Background Vocals", artists=["V1", "V2"]),
            Credit(role="Mixing Engineer", artists=["M2", "M1"]),
        ],
        phonographic_copyright="℗ 2022 Top Dawg Entertainment, under exclusive license to RCA Records",
        copyright_notice="© 2022 Top Dawg Entertainment",
        cover_art_url="https://example.com/cover.png",
        youtube_url="https://www.youtube.com/watch?v=abc",
        release_date="2024-05-17",
    ),
    # A padded role merges with its trimmed twin but then misses the Written By set; the port must keep that quirk.
    "padded_roles": _song(
        credits=[
            Credit(role=" Songwriter ", artists=["W1"]),
            Credit(role="songwriter", artists=["W2"]),
            Credit(role="Producer", artists=["P1"]),
        ]
    ),
    "phono_only": _song(
        credits=[Credit(role="Songwriter", artists=["W1"])],
        phonographic_copyright="℗ 2021 Label A",
    ),
    "media_only": _song(
        youtube_url="https://www.youtube.com/watch?v=abc",
        youtube_kind="music-video",
        cover_art_url="https://example.com/c.png",
    ),
}

QUEUE_FLAGS = [
    "include_core",
    "include_additional",
    "include_copyright",
    "include_youtube",
    "include_cover_art",
    "include_release_date",
]


def _typed_queue_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for name, song in SONGS.items():
        # All 64 flag combinations: the toggles are independent, so every one is a parity risk.
        for combo in itertools.product([True, False], repeat=len(QUEUE_FLAGS)):
            flags = dict(zip(QUEUE_FLAGS, combo, strict=True))
            cases.append(
                {
                    "song": name,
                    "flags": flags,
                    "queue": [list(item) for item in song.typed_queue(**flags)],
                }
            )
    return cases


def _instruction_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    queue = [list(item) for item in SONGS["full"].typed_queue()]
    for pos in range(len(queue) + 1):
        for hotkey in ("f8", "F9"):
            cases.append(
                {
                    "queue": queue,
                    "pos": pos,
                    "hotkey": hotkey,
                    "text": instruction_text([(k, v) for k, v in queue], pos, hotkey),
                }
            )
    return cases


_VIDEO = "BY_XwvKogC8"
YOUTUBE_LINKS = [
    f"https://www.youtube.com/watch?v={_VIDEO}",
    f"  https://www.youtube.com/watch?v={_VIDEO}  ",
    f"http://www.youtube.com/watch?v={_VIDEO}",
    f"https://youtube.com/watch?v={_VIDEO}&t=42s&list=PL123",
    f"https://m.youtube.com/watch?v={_VIDEO}",
    f"https://music.youtube.com/watch?v={_VIDEO}&si=abc",
    f"https://youtu.be/{_VIDEO}",
    f"https://youtu.be/{_VIDEO}?si=xyz&t=3",
    f"youtu.be/{_VIDEO}",
    f"www.youtube.com/watch?v={_VIDEO}",
    f"https://www.youtube.com/shorts/{_VIDEO}",
    f"https://www.youtube.com/embed/{_VIDEO}",
    f"https://www.youtube.com/live/{_VIDEO}?feature=share",
    f"HTTPS://WWW.YOUTUBE.COM/watch?v={_VIDEO}",
    f"https://www.youtube.com:443/watch?v={_VIDEO}",
    f"https://www.youtube.com\\watch?v={_VIDEO}",
    f"https://www.youtube.com/watch?v={_VIDEO}\n",
    f"https://www.you\ttube.com/watch?v={_VIDEO}",
    f"https://www.youtube.com/watch?v=&v={_VIDEO}",
    f"https://www.youtube.com/watch?x=1&v={_VIDEO}#t=3",
    "",
    "   ",
    "hello",
    f"https://example.com/watch?v={_VIDEO}",
    f"https://www.youtube.com.evil.example/watch?v={_VIDEO}",
    f"https://evil.example/https://www.youtube.com/watch?v={_VIDEO}",
    f"https://user:pass@www.youtube.com/watch?v={_VIDEO}",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=short",
    f"https://www.youtube.com/watch?v={_VIDEO}extra",
    "https://www.youtube.com/watch?v=BY_XwvKogC!",
    "https://www.youtube.com/playlist?list=PLabcdefghijk",
    "https://www.youtube.com/results?search_query=billie",
    "https://www.youtube.com/@BillieEilish",
    "https://youtu.be/",
    "https://youtu.be",
    "javascript:alert(1)",
    f"ftp://www.youtube.com/watch?v={_VIDEO}",
    '<script>alert("x")</script>',
    f"https://www.youtube.com/watch?v={_VIDEO}" + "a" * 400,
    f"https://www.youtube.com:99999/watch?v={_VIDEO}",
    f"https://www.youtube.com:abc/watch?v={_VIDEO}",
    f"https://[::1/watch?v={_VIDEO}",
    f"https://www.youtube.com./watch?v={_VIDEO}",
]

YOUTUBE_SEARCHES = [
    ("Don't Smile & Go", "Billie  Eilish"),
    ("//evil.example/?x=1#", "a/b"),
    ("a~b*c", "d e"),
    ("DÁKITI", "Bad Bunny & Jhay Cortez"),
    ("FE!N", "Travis Scott"),
    ("", ""),
]


def _track_health_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for status in ("pending", "loading", "error", "unavailable"):
        cases.append({"status": status, "song": None, "wants": [True, True, True], "searching": False})
    cases.append({"status": "done", "song": None, "wants": [True, True, True], "searching": False})
    for name in SONGS:
        for wants in itertools.product([True, False], repeat=3):
            for searching in (False, True):
                cases.append({"status": "done", "song": name, "wants": list(wants), "searching": searching})
    for case in cases:
        song = SONGS[case["song"]] if case["song"] else None
        copyright_on, cover_on, youtube_on = case["wants"]
        health = track_health(
            case["status"],
            song,
            wants_copyright=copyright_on,
            wants_cover_art=cover_on,
            wants_youtube=youtube_on,
            youtube_searching=case["searching"],
        )
        case["output"] = {"level": health.level, "label": health.label, "missing": list(health.missing)}
    return cases


def _youtube_scores() -> dict[str, dict[str, list[int]]]:
    """For every golden song, the [lyric, audio, music video] score of each video of its saved search results.

    The extension reads the same saved pages, so a scorer that drifts from the reference fails there. Inputs are not
    repeated here: they are the pages under tests/fixtures/lookups/youtube.
    """
    golden = json.loads(YOUTUBE_GOLDEN.read_text(encoding="utf-8"))
    scores: dict[str, dict[str, list[int]]] = {}
    for entry in golden:
        fixture = json.loads((YOUTUBE_FIXTURES / f"{entry['id']}.json").read_text(encoding="utf-8"))
        title, artist = entry["title"], entry["artist"]
        rows: dict[str, list[int]] = {}
        for query in sorted(fixture["searches"]):
            for video in list(_iter_videos(fixture["searches"][query]))[:10]:
                rows.setdefault(
                    video.id,
                    [
                        _score_lyric(video.title, video.channel, artist, title, official_artist=video.official_artist),
                        _score_audio(
                            video.title,
                            video.channel,
                            artist,
                            title,
                            official_artist=video.official_artist,
                            snippet=video.snippet,
                        ),
                        _score_mv(video.title, video.channel, artist, title, verified=video.verified),
                    ],
                )
        scores[entry["id"]] = rows
    return scores


def build_vectors() -> dict[str, Any]:
    return {
        "songs": {name: song.model_dump() for name, song in SONGS.items()},
        "typed_queue": _typed_queue_cases(),
        "extract_labels": [{"input": s, "output": _extract_labels(s)} for s in COPYRIGHT_LINES],
        "split_copyright": [{"input": s, "output": list(split_copyright(s))} for s in FOOTERS],
        "track_count_from_footer": [{"input": s, "output": track_count_from_footer(s)} for s in FOOTERS],
        "autotab_steps": [
            {"kind": kind, "next_kind": nxt, "steps": [list(step) for step in autotab_steps(kind, nxt)]}
            for kind in QUEUE_KINDS
            for nxt in [*QUEUE_KINDS, None]
        ],
        "instruction_text": _instruction_cases(),
        "normalise_cover_url": [{"input": u, "output": normalise_cover_url(u)} for u in COVER_URLS],
        "pick_cover_url": [{"input": urls, "output": pick_cover_url(urls)} for urls in PICK_COVER_INPUTS],
        "catalog_id": [{"input": u, "output": list(catalog_id(u))} for u in CATALOG_URLS],
        "catalog_ref": [{"input": u, "output": list(ref) if (ref := catalog_ref(u)) else None} for u in CATALOG_URLS],
        "normalise_role": [{"input": r, "output": _normalise_role(r)} for r in RAW_ROLES],
        "credits_from_cards": [
            {**case, "output": [c.model_dump() for c in credits_from_cards(case["names"], case["roles"])]}
            for case in CARD_CASES
        ],
        "credits_from_text": [
            {"input": t, "output": [c.model_dump() for c in credits_from_text(t)]} for t in TEXT_CASES
        ],
        "extract_title_artist": [{"input": t, "output": list(_extract_title_artist(t))} for t in PAGE_TITLES],
        "itunes_png": [{"input": u, "output": _itunes_png(u)} for u in ARTWORK_URLS],
        "same_track": [
            {"result_title": a, "result_artist": b, "title": c, "artist": d, "output": _same_track(a, b, c, d)}
            for a, b, c, d in SAME_TRACK_CASES
        ],
        "words": [{"input": t, "output": words(t)} for t in TITLES],
        "core_title_words": [{"input": t, "output": core_title_words(t)} for t in TITLES],
        "parse_youtube_link": [{"input": u, "output": parse_youtube_link(u)} for u in YOUTUBE_LINKS],
        "youtube_search_url": [
            {"title": title, "artist": artist, "output": youtube_search_url(title, artist)}
            for title, artist in YOUTUBE_SEARCHES
        ],
        "date_from_meta": [{"input": t, "output": date_from_meta(t)} for t in RELEASE_META],
        "date_from_text": [{"input": t, "output": date_from_text(t)} for t in RELEASE_TEXTS],
        "pick_release_date": [
            {"meta": m, "subtitle": s, "footer": f, "output": pick_release_date(m, s, f)} for m, s, f in RELEASE_PICKS
        ],
        "release_date_parts": [
            {
                "input": t,
                "split": list(parts) if (parts := split_release_date(t)) else None,
                "text": format_release_date(t),
            }
            for t in STORED_DATES
        ],
        "track_health": _track_health_cases(),
        "youtube_scores": _youtube_scores(),
    }


def build() -> str:
    """The exact file content: UTF-8, LF endings, insertion-ordered keys, trailing newline."""
    return json.dumps(build_vectors(), ensure_ascii=False, indent=1) + "\n"


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(build(), encoding="utf-8", newline="\n")
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
