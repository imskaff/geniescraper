from gui import theme
from gui.chrome import ChromeMixin
from gui.link import RunStatus, describe_status
from utils.config import settings


class LinkGlueMixin(ChromeMixin):
    """Callbacks from the browser extension link; they arrive on the Tk thread and redraw the assistant."""

    def _on_tk_thread(self, fn) -> None:
        self.after(0, fn)

    def _persist_pairing(self, secret: str, origin: str) -> None:
        settings.bridge_secret, settings.bridge_origin = secret, origin
        settings.save()

    def _erase_pairing(self) -> None:
        settings.bridge_secret = settings.bridge_origin = ""
        settings.save()

    def _begin_link_run(self, resume_at: int) -> None:
        """Give the current queue to the extension, when it is connected. Otherwise the hotkeys do the work."""
        self.link.end_run()
        song = self._song
        if song is not None and self.link.connected:
            self.link.start_run(f"{song.title} · {song.artist}", self._queue, settings.link_mode, resume_at)

    def _sync_hooks(self) -> None:
        """The extension owns F7/F8 while it runs the paste; otherwise the desktop's keys are registered."""
        if self._screen == "assistant" and not self._esc_overlay_open():
            self._register_assistant_keys()

    def _link_connection(self, up: bool) -> None:
        if up and self._screen == "assistant" and not self.link.run_active and not self._esc_overlay_open():
            self._begin_link_run(self._pos)  # it connected mid-song: carry on from the current step
        self._sync_hooks()
        self._render_link()
        self._render_open_pages()

    def _link_run_ended(self) -> None:
        """The extension refused or ended the run: the desktop's keys come back."""
        self._sync_hooks()
        self._render_link()
        if self.link.notice:
            self._toast(self.link.notice, error=True)

    def _link_status(self, status: RunStatus) -> None:
        if self._screen != "assistant":
            return
        with self._lock:
            self._pos = max(0, min(status.position, len(self._queue)))
        self._render_assistant()
        self._render_link()

    def _link_finished(self) -> None:
        if self._screen == "assistant":
            self._finish_song()

    def _link_changed(self) -> None:
        self._render_link()
        win = self._settings_win
        if win is not None and win.winfo_exists():
            win.refresh_link()

    def _render_link(self) -> None:
        """The status or error line above the step counter, and the buttons that follow the link."""
        lbl, before = self._link_lbl, self._link_before
        if self._screen != "assistant" or lbl is None or before is None or not lbl.winfo_exists():
            return
        link = self.link
        status = link.status
        if link.bridged:
            text, tone = describe_status(status) if status else ("", "info")
            text = link.notice or text or "Linked to the browser extension."
            tone = "attention" if link.notice else tone
        elif link.run_active:
            text, tone = "Link lost. The hotkeys work again until the extension reconnects.", "attention"
        else:
            text, tone = link.notice, "attention"
        colour = {"ok": theme.DONE, "attention": theme.WARN}.get(tone, theme.MUTED)
        if text:
            lbl.configure(text=text, text_color=colour)
            lbl.pack(fill="x", padx=theme.SPACE_4, pady=(0, theme.SPACE_1), before=before)
        else:
            lbl.pack_forget()
        self._card_instr_lbl.configure(text=self._instruction_text())
        self._render_controls()
