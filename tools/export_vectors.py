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
from scraper.text import core_title_words, words

OUTPUT = Path(__file__).resolve().parent.parent / "extension" / "test" / "vectors.json"

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
    "media_only": _song(youtube_url="https://www.youtube.com/watch?v=abc", cover_art_url="https://example.com/c.png"),
}

QUEUE_FLAGS = ["include_core", "include_additional", "include_copyright", "include_youtube", "include_cover_art"]


def _typed_queue_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for name, song in SONGS.items():
        # All 32 flag combinations: the toggles are independent, so every one is a parity risk.
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
