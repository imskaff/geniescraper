from gui.foreground import GeniusWindowTracker, is_genius_title

OWN = 100
GENIUS = 1
CHAT = 2
APP = 3


class FakeWindows:
    """A desktop of three windows: a Genius tab, a chat and this app."""

    def __init__(self) -> None:
        self.front = 0
        self.titles = {
            GENIUS: "CHIHIRO Lyrics | Genius Lyrics - Google Chrome",
            CHAT: "Claude",
            APP: "Géniescraper",
        }
        self.pids = {GENIUS: 7, CHAT: 8, APP: OWN}
        self.activated: list[int] = []
        self.activation_works = True

    def foreground(self) -> int:
        return self.front

    def title(self, hwnd: int) -> str:
        return self.titles[hwnd]

    def process_id(self, hwnd: int) -> int:
        return self.pids[hwnd]

    def exists(self, hwnd: int) -> bool:
        return hwnd in self.titles

    def activate(self, hwnd: int) -> None:
        self.activated.append(hwnd)
        if self.activation_works:
            self.front = hwnd


def _tracker(windows: FakeWindows) -> GeniusWindowTracker:
    return GeniusWindowTracker(windows, OWN)


def test_titles_with_the_genius_bar_count_and_others_do_not():
    assert is_genius_title("Song Lyrics | Genius Lyrics - Google Chrome")
    assert is_genius_title("Song Lyrics | Genius - Microsoft Edge")
    assert not is_genius_title("Genius navigation step 1 - Claude")
    assert not is_genius_title("Géniescraper")


def test_it_hands_back_to_the_last_genius_window_not_the_last_window_used():
    windows = FakeWindows()
    tracker = _tracker(windows)
    windows.front = GENIUS
    tracker.poll_once()
    windows.front = CHAT  # the chat was used after Genius, as Alt+Tab would have found it
    tracker.poll_once()
    windows.front = APP
    tracker.poll_once()

    assert tracker.hand_back()
    assert windows.activated == [GENIUS] and windows.front == GENIUS


def test_it_never_hands_back_when_no_genius_window_was_seen():
    windows = FakeWindows()
    tracker = _tracker(windows)
    windows.front = CHAT
    tracker.poll_once()

    assert not tracker.hand_back()
    assert windows.activated == []


def test_it_ignores_this_apps_own_windows_even_with_a_genius_title():
    windows = FakeWindows()
    windows.titles[APP] = "Song | Genius"
    tracker = _tracker(windows)
    windows.front = APP
    tracker.poll_once()

    assert not tracker.hand_back()


def test_it_refuses_when_the_tab_moved_to_another_site_or_the_window_closed():
    windows = FakeWindows()
    tracker = _tracker(windows)
    windows.front = GENIUS
    tracker.poll_once()

    windows.titles[GENIUS] = "Apple Music - Google Chrome"
    assert not tracker.hand_back()

    windows.titles[GENIUS] = "Song | Genius"
    del windows.titles[GENIUS]
    assert not tracker.hand_back()
    assert windows.activated == []


def test_it_reports_failure_when_the_window_does_not_come_forward(monkeypatch):
    monkeypatch.setattr("gui.foreground._ACTIVATE_WAIT", 0.05)
    windows = FakeWindows()
    tracker = _tracker(windows)
    windows.front = GENIUS
    tracker.poll_once()
    windows.front = APP
    windows.activation_works = False

    assert not tracker.hand_back()
