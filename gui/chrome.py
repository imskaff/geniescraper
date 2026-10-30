import customtkinter as ctk
from PIL import Image as PILImage

from gui import theme
from gui.host import Host
from gui.logic import (
    STEPS,
)
from gui.settings_window import SettingsWindow
from utils.config import settings

_f = theme.font


class ChromeMixin(Host):
    """Widgets and window helpers every screen shares: header, buttons, toast, compact mode, Settings."""

    def _header(self, step: int | None) -> None:
        """Top bar on every screen: where you are in the flow, and Settings."""
        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.pack(fill="x", padx=theme.SPACE_4, pady=(theme.SPACE_3, theme.SPACE_2))
        crumbs = ctk.CTkFrame(bar, fg_color="transparent")
        crumbs.pack(side="left")
        for i, name in enumerate(STEPS):
            if i:
                ctk.CTkLabel(crumbs, text="›", font=_f(12), text_color=theme.DONE).pack(side="left", padx=theme.SPACE_2)
            if step is None:
                color, weight = theme.FAINT, "normal"
            elif i < step:
                color, weight = theme.MUTED, "normal"
            elif i == step:
                color, weight = theme.TEXT, "bold"
            else:
                color, weight = theme.DONE, "normal"
            ctk.CTkLabel(crumbs, text=name, font=_f(12, weight), text_color=color).pack(side="left")
        ctk.CTkButton(
            bar,
            text="⚙  Settings",
            width=104,
            height=28,
            font=_f(12),
            fg_color=theme.SURFACE,
            hover_color=theme.SURFACE_HI,
            text_color=theme.TEXT,
            border_width=1,
            border_color=theme.BORDER,
            command=self._open_settings,
        ).pack(side="right")

    def _open_settings(self) -> None:
        if self._settings_win is not None and self._settings_win.winfo_exists():
            self._settings_win.lift()
            self._settings_win.focus_force()
            return
        self._settings_win = SettingsWindow(self, on_change=self._settings_changed, link=self.link)

    def _set_compact(self, compact: bool) -> None:
        if compact:
            if self.winfo_height() > 320:
                self._normal_height = self.winfo_height()
            self.geometry("620x300")
        elif self.winfo_height() <= 320:
            self.geometry(f"620x{self._normal_height}")

    @staticmethod
    def _set_enabled(btn: ctk.CTkButton, enabled: bool) -> None:
        """Disabled primary buttons drop the yellow, so they never look clickable."""
        if enabled:
            btn.configure(state="normal", fg_color=theme.ACCENT, text_color=theme.ACCENT_INK)
        else:
            btn.configure(state="disabled", fg_color=theme.SURFACE_HI, text_color_disabled=theme.FAINT)

    def _button(self, master, text: str, command, *, primary: bool = False, width: int = 140, **kw) -> ctk.CTkButton:
        """Primary actions are filled; everything else is outlined, so the main step is obvious."""
        style = (
            {}
            if primary
            else {
                "fg_color": "transparent",
                "border_width": 1,
                "border_color": theme.BORDER,
                "text_color": theme.TEXT,
                "hover_color": theme.SURFACE_HI,
            }
        )
        return ctk.CTkButton(
            master,
            text=text,
            command=command,
            width=width,
            height=38,
            font=_f(13, "bold" if primary else "normal"),
            **(style | kw),
        )

    def _control(self, master, text: str, command, width: int) -> ctk.CTkButton:
        return ctk.CTkButton(
            master,
            text=text,
            width=width,
            height=30,
            font=_f(12),
            fg_color=theme.SURFACE,
            hover_color=theme.SURFACE_HI,
            text_color=theme.TEXT,
            text_color_disabled=theme.FAINT,
            command=command,
        )

    def _toast(self, text: str, *, error: bool = False) -> None:
        """Short message at the bottom of the window that disappears on its own."""
        lbl = ctk.CTkLabel(
            self,
            text=text,
            font=_f(12),
            text_color=theme.TEXT,
            fg_color=theme.DANGER_DIM if error else theme.SURFACE_HI,
            corner_radius=6,
            wraplength=520,
        )
        lbl.place(relx=0.5, rely=1.0, y=-16, anchor="s")
        lbl.lift()
        self.after(6000, lambda: lbl.destroy() if lbl.winfo_exists() else None)

    def _release_header(self, master, title: str, artist: str, cover: PILImage.Image | None, extra: str = "") -> None:
        top = ctk.CTkFrame(master, fg_color="transparent")
        top.pack(fill="x", padx=theme.SPACE_6, pady=(theme.SPACE_3, theme.SPACE_3))
        if cover is not None:
            thumb = ctk.CTkImage(cover, size=(88, 88))
            ctk.CTkLabel(top, image=thumb, text="").pack(side="left", padx=(0, theme.SPACE_4))
        info = ctk.CTkFrame(top, fg_color="transparent")
        info.pack(side="left", fill="both", expand=True)
        ctk.CTkLabel(
            info, text=title, font=theme.display(24), text_color=theme.TEXT, anchor="w", justify="left", wraplength=400
        ).pack(anchor="w")
        ctk.CTkLabel(info, text=artist, font=_f(14), text_color=theme.MUTED, anchor="w").pack(anchor="w")
        if extra:
            ctk.CTkLabel(info, text=extra, font=_f(12), text_color=theme.ACCENT, anchor="w").pack(
                anchor="w", pady=(theme.SPACE_2, 0)
            )

    def _settings_summary(self, master) -> ctk.CTkButton:
        """One clickable line with the hotkeys, which opens Settings."""
        text = f"Hotkeys {settings.hotkey.upper()} / {settings.back_hotkey.upper()}"
        return ctk.CTkButton(
            master,
            text=text,
            height=26,
            font=_f(12),
            fg_color="transparent",
            hover_color=theme.SURFACE,
            text_color=theme.MUTED,
            command=self._open_settings,
        )

    def _connect_extension(self) -> None:
        """Open Settings at the link card and start pairing, so the code is on screen to copy."""
        self._open_settings()
        win = self._settings_win
        if win is not None and win.winfo_exists():
            win.show_link()
