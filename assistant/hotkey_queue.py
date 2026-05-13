"""
Hotkey Queue Assistant
======================
Manages a typed queue of ("role", value) / ("artist", value) items and types
them into whichever field the user has focused in the browser.

Genius UI contract
------------------
  - Each role is added ONCE via "Add additional credits".
  - Multiple artists for the same role are added sequentially in the
    "Artists in this role" field (tag/chip input — select one, field clears,
    type the next).

Flow per F8 press
-----------------
  ("role", "Mixing Engineer")  → types role, selects from dropdown
  ("artist", "Alex Tumay")     → types artist, selects from dropdown
  ("artist", "John Doe")       → types artist, selects from dropdown  ← same role
  ("role", "Producer")         → types role, selects from dropdown    ← user clicked "Add additional credits" first
  ("artist", "Rick Rubin")     → types artist, selects from dropdown
  ...

The terminal shows exactly what's coming next and what the user should do
before pressing F8 (e.g. "Click 'Add additional credits' first").
"""

import threading
import time
import keyboard
import pyperclip
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from scraper.models import SongCredits
from utils.config import settings

console = Console()


class HotkeyQueueAssistant:
    def __init__(self, song: SongCredits) -> None:
        self._queue: list[tuple[str, str]] = song.typed_queue()
        self._pos: int = 0
        self._lock = threading.Lock()
        self._song = song

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def start(self) -> None:
        if not self._queue:
            console.print("[bold red]No credits to process.[/bold red]")
            return

        keyboard.add_hotkey(settings.hotkey, self._on_hotkey, suppress=True)
        self._render()
        console.print(
            f"\n[bold green]Listening.[/bold green] "
            f"Press [bold cyan]{settings.hotkey.upper()}[/bold cyan] to type the next value. "
            f"Press [bold red]ESC[/bold red] to quit.\n"
        )
        keyboard.wait("esc")
        keyboard.remove_all_hotkeys()
        console.print("[dim]Assistant stopped.[/dim]")

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _on_hotkey(self) -> None:
        with self._lock:
            if self._pos >= len(self._queue):
                console.print("\n[bold green]All credits processed! Save the Genius page.[/bold green]")
                return

            _, value = self._queue[self._pos]

            # Brief pause so the key-up event fires before we paste.
            time.sleep(0.15)
            pyperclip.copy(value)
            keyboard.press_and_release("ctrl+v")

            # Wait for autocomplete dropdown then confirm the highlighted match.
            time.sleep(settings.autocomplete_wait)
            keyboard.press_and_release("enter")

            self._pos += 1
            self._render()

    def _next_instruction(self) -> str:
        """Returns the instruction shown to the user before they press F8."""
        if self._pos >= len(self._queue):
            return "All done — save the page."

        kind, _ = self._queue[self._pos]
        hotkey = f"[bold cyan]{settings.hotkey.upper()}[/bold cyan]"
        prev_kind = self._queue[self._pos - 1][0] if self._pos > 0 else None

        if kind == "written_by":
            if prev_kind != "written_by":
                return f"Click the [bold]Written By[/bold] field, then press {hotkey}"
            return f"Field is ready — press {hotkey} to add the next songwriter"

        if kind == "produced_by":
            if prev_kind != "produced_by":
                return f"Click the [bold]Produced By[/bold] field, then press {hotkey}"
            return f"Field is ready — press {hotkey} to add the next producer"

        if kind == "role":
            return (
                "1. Click [bold]Add additional credits[/bold]\n"
                "2. Click inside the [bold]Additional role[/bold] field\n"
                f"3. Press {hotkey}"
            )

        # kind == "artist"
        if prev_kind == "role":
            return f"Tab to [bold]Artists in this role[/bold], then press {hotkey}"
        return f"Field is ready — press {hotkey} to add the next artist"

    def _render(self) -> None:
        console.clear()

        console.print(Panel(
            f"[bold]{self._song.title}[/bold]  —  {self._song.artist}",
            title="[cyan]A Music to Genius[/cyan]",
            border_style="cyan",
        ))

        total = len(self._queue)

        if self._pos < total:
            kind, value = self._queue[self._pos]
            field_label = {
                "written_by": "Written By",
                "produced_by": "Produced By",
                "role": "Additional role",
                "artist": "Artists in this role",
            }.get(kind, kind)

            console.print(Panel(
                f"[dim]{field_label}[/dim]\n"
                f"[bold yellow]{value}[/bold yellow]\n\n"
                f"{self._next_instruction()}",
                title=f"[green]Next[/green]  ({self._pos + 1}/{total})",
                border_style="green",
            ))
        else:
            console.print(Panel(
                "[bold green]All credits entered! Save the Genius page.[/bold green]",
                border_style="green",
            ))

        # ── Full queue table ──────────────────────────────────────────
        table = Table(show_header=True, header_style="bold magenta", box=None)
        table.add_column("", width=2)
        table.add_column("Type", width=8)
        table.add_column("Value")

        for i, (kind, value) in enumerate(self._queue):
            if i < self._pos:
                style = "dim strike"
                marker = "✓"
            elif i == self._pos:
                style = "bold"
                marker = "▶"
            else:
                style = ""
                marker = ""

            type_display = {
                "written_by": "[green]written_by[/green]",
                "produced_by": "[blue]produced_by[/blue]",
                "role": "[magenta]ROLE[/magenta]",
                "artist": "[cyan]artist[/cyan]",
            }.get(kind, kind)
            # Indent artists under their role for readability
            display_value = value if kind == "role" else f"  {value}"
            table.add_row(marker, type_display, Text(display_value, style=style))

        console.print(table)


def run(song: SongCredits) -> None:
    HotkeyQueueAssistant(song).start()
