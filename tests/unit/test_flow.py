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
        ("role", "artist", []),
    ],
)
def test_autotab_transitions(kind, next_kind, expected):
    assert keys(kind, next_kind) == expected


def test_autotab_first_key_waits_for_paste_to_settle():
    for kind, nxt in [("written_by", "produced_by"), ("artist", "cover_art"), ("produced_by", "role")]:
        assert autotab_steps(kind, nxt)[0][1] >= 0.15


class TestInstructionText:
    queue = [
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
    ]

    @pytest.mark.parametrize(
        ("pos", "expected"),
        [
            (0, "Click the Written By field, then press F8"),
            (1, "Field is ready — press F8 to add the next songwriter"),
            (2, "Click the Produced By field, then press F8"),
            (4, "Tab to Artists in this role, then press F8"),
            (5, "Field is ready — press F8 to add the next artist"),
            (7, "Field is ready — press F8 to add the label"),
            (8, "Press F8 to copy the YouTube video URL to clipboard"),
            (9, "Press F8 to copy the 1000×1000 PNG cover art URL to clipboard"),
            (10, "All done — save the page."),
        ],
    )
    def test_messages(self, pos, expected):
        assert instruction_text(self.queue, pos, "f8") == expected

    def test_role_steps(self):
        assert instruction_text(self.queue, 3, "f9").endswith("3. Press F9")
