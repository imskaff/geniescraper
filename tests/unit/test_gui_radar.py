"""The detector's radar: what it draws over time, and the headline the card shows."""

from gui.logic import detector_title
from gui.radar import FOUND, LISTENING, SIZE, Shape, animating, blend, frame

ACCENT = "#f3c003"
GROUND = "#171715"


def shapes(state: str, t: float) -> list[Shape]:
    return frame(state, t, accent=ACCENT, ground=GROUND)


def test_blend_runs_from_the_ground_to_the_foreground():
    assert blend(ACCENT, GROUND, 0) == GROUND
    assert blend(ACCENT, GROUND, 1) == ACCENT
    assert blend(ACCENT, GROUND, 5) == ACCENT  # clamped
    assert blend("#ffffff", "#000000", 0.5) == "#808080"


def test_listening_starts_with_one_ring_and_a_resting_dot():
    first = shapes(LISTENING, 0.0)
    assert [s.width for s in first] == [2, 3, 0]  # the first ring, the dot's glow, the dot; the others wait
    assert first[-1].color != ACCENT  # at rest the dot is dimmer than the accent


def test_the_rings_start_one_after_another_and_stay_inside_the_radar():
    assert sum(s.width == 2 for s in shapes(LISTENING, 0.5)) == 1  # the second waits until 0.9 s
    assert sum(s.width == 2 for s in shapes(LISTENING, 1.2)) == 2
    assert sum(s.width == 2 for s in shapes(LISTENING, 2.5)) == 3
    for t in (0.3, 1.1, 2.0, 5.0, 9.9):
        assert all(s.radius <= SIZE / 2 for s in shapes(LISTENING, t))


def test_the_dot_swells_and_comes_back_each_beat():
    rest, full = shapes(LISTENING, 0.0)[-1], shapes(LISTENING, 0.7)[-1]
    assert full.radius > rest.radius
    assert shapes(LISTENING, 1.4)[-1].radius == rest.radius


def test_a_ring_fades_as_it_travels():
    early, late = shapes(LISTENING, 0.3)[0], shapes(LISTENING, 2.4)[0]
    assert late.radius > early.radius
    assert late.color == blend(ACCENT, GROUND, 0.8 * (1 - 2.4 / 2.7))
    assert late.color != early.color


def test_a_find_bursts_one_ring_then_holds_still():
    during = shapes(FOUND, 0.3)
    after = shapes(FOUND, 2.0)
    assert [s.width for s in during] == [2, 3, 0]
    assert [s.width for s in after] == [3, 0]
    assert after[-1].color == ACCENT
    assert shapes(FOUND, 2.0) == shapes(FOUND, 60.0)


def test_only_listening_animates_for_ever():
    assert animating(LISTENING, 1000.0)
    assert animating(FOUND, 0.2)
    assert not animating(FOUND, 1.0)


def test_the_headline_says_what_was_found():
    assert detector_title(0) == "Listening for Apple Music pages…"
    assert detector_title(1) == "Apple Music page detected"
    assert detector_title(3) == "3 Apple Music pages detected"
