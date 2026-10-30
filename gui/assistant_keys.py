import threading
import time

import customtkinter as ctk
import keyboard
import pyperclip

from assistant import flow
from gui import theme
from gui.chrome import ChromeMixin
from utils.config import settings

_f = theme.font

# How long Windows needs to bring the previous window forward after Alt+Tab, before the paste goes to it.
_FOCUS_RETURN_WAIT = 0.35


class AssistantKeysMixin(ChromeMixin):
    """The assistant's global hotkeys, the Esc listener and the confirm overlay."""

    def _register_assistant_keys(self) -> None:
        self._clear_kb_hooks()
        if self.link.bridged:
            return  # the extension owns the keys while it runs the paste; both at once would double-step

        def _on_fwd(e):
            if e.event_type == "down":
                threading.Thread(target=self._on_hotkey, daemon=True).start()

        def _on_back(e):
            if e.event_type == "down":
                threading.Thread(target=self._on_back_hotkey, daemon=True).start()

        self._kb_hooks.append(keyboard.hook_key(settings.hotkey, _on_fwd, suppress=True))
        self._kb_hooks.append(keyboard.hook_key(settings.back_hotkey, _on_back, suppress=True))

    def _on_back_hotkey(self) -> None:
        if self.link.bridged:
            self.link.command("back")
            return
        with self._lock:
            if self._pos > 0:
                self._pos -= 1
                self.after(0, self._render_assistant)

    def _fill_next_by_hand(self) -> None:
        """The Next button without the extension: pressing it moved focus here, so go back to Genius first.

        Alt+Tab returns to the window the user was in; after that it is exactly the F8 key.
        """
        keyboard.press_and_release("alt+tab")
        time.sleep(_FOCUS_RETURN_WAIT)
        self._on_hotkey()

    def _on_hotkey(self) -> None:
        with self._lock:
            if self._pos >= len(self._queue):
                return
            kind, value = self._queue[self._pos]
            self._pos += 1  # advance immediately so F7 can decrement during paste
            next_kind = self._queue[self._pos][0] if self._pos < len(self._queue) else None

        # Perform slow I/O outside the lock so F7 can always respond immediately
        time.sleep(0.15)
        pyperclip.copy(value)
        keyboard.press_and_release("ctrl+v")
        # The desktop cannot see Genius here, so it cannot check the suggestion: it waits, then takes the first one.
        if kind not in flow.CLIPBOARD_ONLY_KINDS:
            time.sleep(settings.autocomplete_wait)
            keyboard.press_and_release("enter")
        for key, pause in flow.autotab_steps(kind, next_kind):
            time.sleep(pause)
            keyboard.press_and_release(key)

        # Re-read pos - F7 may have decremented it during the paste window
        with self._lock:
            new_pos = self._pos
            queue_len = len(self._queue)

        if new_pos >= queue_len:
            self._finish_song()
        else:
            self.after(0, self._render_assistant)

    def _wait_esc(self) -> None:
        while True:
            keyboard.wait("esc")
            if self._app_focused:
                self.after(0, lambda: self._show_esc_confirm(from_key=True))
                return

    def _show_esc_confirm(self, *, from_key: bool = False, to_credits: bool = False) -> None:
        if self._screen != "assistant" or self._esc_overlay_open():
            return  # an Esc from a screen already left, or a second one
        self._esc_from_key = from_key  # the Esc listener is used up by a key press, not by the button
        # Unhook the assistant hotkeys so they don't fire during confirmation
        self._clear_kb_hooks()

        # Dark overlay frame on top of everything
        self._esc_overlay = ctk.CTkFrame(
            self, fg_color=theme.SURFACE, corner_radius=12, border_width=1, border_color=theme.BORDER
        )
        self._esc_overlay.place(relx=0.5, rely=0.5, anchor="center", relwidth=0.85)

        ctk.CTkLabel(
            self._esc_overlay,
            text="Back to the credits?" if to_credits else "End pasting for this song?",
            font=theme.display(22),
            text_color=theme.TEXT,
        ).pack(pady=(theme.SPACE_5, theme.SPACE_4))

        btn_row = ctk.CTkFrame(self._esc_overlay, fg_color="transparent")
        btn_row.pack(pady=(0, theme.SPACE_5))

        ctk.CTkButton(
            btn_row,
            text="Keep pasting",
            width=140,
            height=38,
            fg_color="transparent",
            border_width=1,
            border_color=theme.BORDER,
            text_color=theme.TEXT,
            hover_color=theme.SURFACE_HI,
            command=self._dismiss_esc_confirm,
            font=_f(13, "bold"),
        ).pack(side="left", padx=(0, theme.SPACE_3))
        ctk.CTkButton(
            btn_row,
            text="Back to credits" if to_credits else "End and start over",
            width=160,
            height=38,
            fg_color=theme.DANGER_DIM,
            hover_color=theme.DANGER_HOVER,
            text_color=theme.DANGER,
            border_width=1,
            border_color=theme.DANGER,
            command=self._back_to_credits if to_credits else self._confirm_esc_quit,
            font=_f(13, "bold"),
        ).pack(side="left")

    def _esc_overlay_open(self) -> bool:
        overlay = getattr(self, "_esc_overlay", None)
        return overlay is not None and overlay.winfo_exists()

    def _dismiss_esc_confirm(self) -> None:
        """User chose to resume - remove overlay and re-register hotkeys."""
        if hasattr(self, "_esc_overlay") and self._esc_overlay.winfo_exists():
            self._esc_overlay.destroy()
        # Re-register assistant hotkeys
        self._register_assistant_keys()
        if self._esc_from_key:
            threading.Thread(target=self._wait_esc, daemon=True).start()

    def _confirm_esc_quit(self) -> None:
        """User confirmed quit - clean up and go to main menu."""
        self._clear_kb_hooks()
        if hasattr(self, "_esc_overlay") and self._esc_overlay.winfo_exists():
            self._esc_overlay.destroy()
        self._go_to_main()
