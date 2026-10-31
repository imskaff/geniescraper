"""Remember the Genius browser window and hand the keyboard back to it.

The Next button of the manual mode is pressed inside this app, so the paste has to go to the Genius window the user was
in. Alt+Tab is not a safe way to get there: it goes to whatever window was used last, which can be anything. This keeps
the last window whose title says it is a Genius page, and refuses to paste when there is none.
"""

import ctypes
import ctypes.wintypes as wt
import re
import threading
import time
from typing import Protocol

# Browser titles read "Artist - Song Lyrics | Genius Lyrics - Google Chrome"; the bar is what marks a Genius page.
_GENIUS_TITLE = re.compile(r"\|\s*Genius\b", re.IGNORECASE)
_POLL_SECONDS = 0.15
_ACTIVATE_WAIT = 1.0


class WindowApi(Protocol):
    """The few window calls needed, behind an interface so the logic is testable without a desktop."""

    def foreground(self) -> int: ...
    def title(self, hwnd: int) -> str: ...
    def process_id(self, hwnd: int) -> int: ...
    def exists(self, hwnd: int) -> bool: ...
    def activate(self, hwnd: int) -> None: ...


class Win32Api:
    """`WindowApi` on Windows, through user32."""

    _SW_RESTORE = 9

    def __init__(self) -> None:
        user32 = ctypes.windll.user32
        user32.GetForegroundWindow.restype = wt.HWND
        user32.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
        user32.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(wt.DWORD)]
        user32.IsWindow.argtypes = [wt.HWND]
        user32.IsIconic.argtypes = [wt.HWND]
        user32.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
        user32.SetForegroundWindow.argtypes = [wt.HWND]
        self._user32 = user32

    def foreground(self) -> int:
        return self._user32.GetForegroundWindow() or 0

    def title(self, hwnd: int) -> str:
        buffer = ctypes.create_unicode_buffer(512)
        self._user32.GetWindowTextW(hwnd, buffer, len(buffer))
        return buffer.value

    def process_id(self, hwnd: int) -> int:
        pid = wt.DWORD(0)
        self._user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        return pid.value

    def exists(self, hwnd: int) -> bool:
        return bool(self._user32.IsWindow(hwnd))

    def activate(self, hwnd: int) -> None:
        if self._user32.IsIconic(hwnd):
            self._user32.ShowWindow(hwnd, self._SW_RESTORE)
        self._user32.SetForegroundWindow(hwnd)


def is_genius_title(title: str) -> bool:
    return bool(_GENIUS_TITLE.search(title))


class GeniusWindowTracker:
    """Polls the foreground window and keeps the last one that is a Genius page of another program."""

    def __init__(self, api: WindowApi, own_pid: int) -> None:
        self._api = api
        self._own_pid = own_pid
        self._last = 0
        self._lock = threading.Lock()
        self._started = False

    def start(self) -> None:
        if self._started:
            return
        self._started = True
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        while True:
            self.poll_once()
            time.sleep(_POLL_SECONDS)

    def poll_once(self) -> None:
        hwnd = self._api.foreground()
        if not hwnd or self._api.process_id(hwnd) == self._own_pid:
            return
        if is_genius_title(self._api.title(hwnd)):
            with self._lock:
                self._last = hwnd

    def hand_back(self) -> bool:
        """Bring the remembered Genius window forward. False means nothing was changed and nothing should be pasted."""
        with self._lock:
            hwnd = self._last
        if not hwnd or not self._api.exists(hwnd) or not is_genius_title(self._api.title(hwnd)):
            return False  # never seen one, it was closed, or its tab has moved to another site
        self._api.activate(hwnd)
        deadline = time.monotonic() + _ACTIVATE_WAIT
        while time.monotonic() < deadline:
            if self._api.foreground() == hwnd:
                return True
            time.sleep(0.02)
        return False
