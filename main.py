"""
Géniescraper — CLI entry point


Usage:
  py main.py "https://music.apple.com/us/song/..."
  py main.py "https://music.apple.com/us/song/..." --debug
"""

import asyncio
import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from scraper import apple_music
from assistant import hotkey_queue
from utils.config import settings

app = typer.Typer(add_completion=False, pretty_exceptions_show_locals=False)
console = Console()


@app.command()
def main(
    apple_url: str = typer.Argument(..., help="Apple Music song page URL"),
    debug: bool = typer.Option(
        False, "--debug", help="Save page HTML + screenshot to ./debug/ if credits aren't found"
    ),
) -> None:
    """Scrape credits from Apple Music and launch the hotkey assistant for Genius."""

    # ── 1. Scrape Apple Music ──────────────────────────────────────────
    console.print(Panel(
        f"[cyan]Scraping[/cyan] {apple_url}",
        title="[bold]Step 1 — Apple Music[/bold]",
        border_style="cyan",
    ))
    with console.status("Launching browser and scraping credits..."):
        song = asyncio.run(apple_music.scrape(apple_url, debug=debug))

    if not song.credits:
        console.print(
            "[bold red]No credits found.[/bold red] "
            "The page structure may have changed — check the URL and try again."
        )
        raise typer.Exit(1)

    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Role")
    table.add_column("Artists")
    merged = song.merged_credits()
    for credit in merged:
        table.add_row(credit.role, ", ".join(credit.artists))
    console.print(f"\n[bold green]Found {len(merged)} roles, {len(song.typed_queue())} total entries:[/bold green]")
    console.print(table)

    # ── 2. Hotkey assistant ────────────────────────────────────────────
    console.print(Panel(
        "The assistant will type each value for you.\n\n"
        f"  [bold]Songwriters[/bold]  → click [bold]Written By[/bold], press [bold cyan]{settings.hotkey.upper()}[/bold cyan] for each name.\n"
        f"  [bold]Producers[/bold]    → click [bold]Produced By[/bold], press [bold cyan]{settings.hotkey.upper()}[/bold cyan] for each name.\n"
        f"  [bold]Other roles[/bold]  → click [bold]Add additional credits[/bold], click the role field,\n"
        f"                  press [bold cyan]{settings.hotkey.upper()}[/bold cyan], Tab to artists field,\n"
        f"                  press [bold cyan]{settings.hotkey.upper()}[/bold cyan] for each artist.\n\n"
        f"The terminal will tell you exactly what to do before each press.\n"
        f"Press [bold red]ESC[/bold red] to quit the assistant at any time.",
        title="[bold]Step 2 — Hotkey Assistant[/bold]",
        border_style="green",
    ))
    typer.confirm("Ready to start the assistant?", abort=True)

    hotkey_queue.run(song)


if __name__ == "__main__":
    app()
