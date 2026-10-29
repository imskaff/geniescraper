from typing import ClassVar

import pytest

from assistant.flow import autotab_steps, instruction_text


def keys(kind, next_kind):
    return [k for k, _ in autotab_steps(kind, next_kind)]


@pytest.mark.parametrize(
    ("kind", "next_kind", "expected"),
    [
        ("written_by", "written_by", []),
        ("written_by", "produced_by", ["tab"]),
        ("written_by", "role", ["tab", "tab", "enter"]),
        ("written_by", "copyright_role", ["tab", "tab", "enter"]),
        ("produced_by", "produced_by", []),
        ("produced_by", "role", ["tab", "enter"]),
        ("artist", "artist", []),
        ("artist", "role", ["tab", "enter"]),
        ("artist", "copyright_role", ["tab", "enter"]),
        ("phonographic_copyright", "copyright_role", ["tab", "enter"]),
        ("copyright_notice", "youtube_url", ["tab"] * 3),
        ("artist", "youtube_url", ["tab"] * 3),
        ("youtube_url", "cover_art", ["tab"] * 3),
        ("copyright_notice", "cover_art", ["tab"] * 6),
        ("artist", "cover_art", ["tab"] * 6),
        ("cover_art", None, []),
        ("cover_art", "release_month", []),
        ("artist", "release_month", []),
        ("copyright_notice", "release_month", []),
        ("release_month", "release_day", []),
        ("release_day", "release_year", []),
        ("release_year", None, []),
        ("role", "artist", []),
    ],
)
def test_autotab_transitions(kind, next_kind, expected):
    assert keys(kind, next_kind) == expected


def test_autotab_first_key_waits_for_paste_to_settle():
    for kind, nxt in [("written_by", "produced_by"), ("artist", "cover_art"), ("produced_by", "role")]:
        assert autotab_steps(kind, nxt)[0][1] >= 0.15


class TestInstructionText:
    queue: ClassVar[list[tuple[str, str]]] = [
        ("written_by", "W1"),
        ("written_by", "W2"),
        ("produced_by", "P"),
        ("role", "Mixing Engineer"),
        ("artist", "M1"),
        ("artist", "M2"),
        ("copyright_role", "Phonographic Copyright"),
        ("phonographic_copyright", "L1"),
        ("youtube_url", "https://youtu.be/x"),
        ("cover_art", "https://img"),
        ("release_month", "May"),
        ("release_day", "7"),
        ("release_year", "2024"),
    ]

    @pytest.mark.parametrize(
        ("pos", "expected"),
        [
            (0, "Click the Written By field, then press F8"),
            (1, "Field is ready. Press F8 to add the next songwriter"),
            (2, "Click the Produced By field, then press F8"),
            (4, "Tab to Artists in this role, then press F8"),
            (5, "Field is ready. Press F8 to add the next artist"),
            (7, "Field is ready. Press F8 to add the label"),
            (8, "Press F8 to copy the YouTube video URL to clipboard"),
            (9, "Press F8 to copy the 1000×1000 PNG cover art URL to clipboard"),
            (
                10,
                "Open the Tags and Albums section if it is closed. "
                "Click the Release Date Month dropdown, then press F8 to enter the month",
            ),
            (11, "Click the Release Date Day dropdown, then press F8 to enter the day"),
            (12, "Click the Release Date Year dropdown, then press F8 to enter the year"),
            (13, "All done. Save the page on Genius."),
        ],
    )
    def test_messages(self, pos, expected):
        assert instruction_text(self.queue, pos, "f8") == expected

    def test_role_steps(self):
        assert instruction_text(self.queue, 3, "f9").endswith("3. Press F9")


class TestGeniusQueue:
    """The queue is typed under the names Genius uses, as the extension's panel does (geniusRole)."""

    @pytest.mark.parametrize(
        ("apple", "genius"),
        [
            ("Additional Producer", "Additional Production"),
            ("additional producer", "Additional Production"),
            ("Vocal Recording Engineer", "Vocal Engineer"),
            ("Programming", "Programmer"),
            ("Drum Programming", "Drum Programmer"),
            ("Mixing Engineer", "Mixing Engineer"),
            ("Editing Engineer", "Editing Engineer"),
        ],
    )
    def test_role_steps_use_genius_names(self, apple, genius):
        from assistant.flow import genius_queue

        assert genius_queue([("role", apple)]) == [("role", genius)]

    def test_only_role_steps_are_renamed(self):
        from assistant.flow import genius_queue

        queue = [
            ("written_by", "Additional Producer"),
            ("role", "Additional Producer"),
            ("artist", "Vocal Recording Engineer"),
            ("copyright_role", "Copyright"),
            ("youtube_url", "https://www.youtube.com/watch?v=abcdefghijk"),
        ]
        assert genius_queue(queue) == [
            ("written_by", "Additional Producer"),
            ("role", "Additional Production"),
            ("artist", "Vocal Recording Engineer"),
            ("copyright_role", "Copyright"),
            ("youtube_url", "https://www.youtube.com/watch?v=abcdefghijk"),
        ]

    def test_is_idempotent_and_keeps_length(self):
        from assistant.flow import genius_queue

        queue = [("role", "Additional Producer"), ("artist", "A"), ("role", "Vocal Recording Engineer")]
        once = genius_queue(queue)
        assert genius_queue(once) == once
        assert len(once) == len(queue)
