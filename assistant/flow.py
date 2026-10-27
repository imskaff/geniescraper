"""
Pure assistant flow logic: what to tell the user before each hotkey press and
which keys Auto-Tab sends after a paste. Kept free of GUI and keyboard I/O so
it can be unit tested.
"""

# Queue kinds whose value is copied to the clipboard as-is (no autocomplete to confirm).
CLIPBOARD_ONLY_KINDS = frozenset({"cover_art", "youtube_url"})

# A key press with the pause (seconds) to wait before pressing it.
KeyStep = tuple[str, float]


def _tabs(n: int) -> list[KeyStep]:
    return [("tab", 0.15)] + [("tab", 0.05)] * (n - 1)


def autotab_steps(kind: str, next_kind: str | None) -> list[KeyStep]:
    """Keys Auto-Tab presses after pasting `kind` to land on the field for `next_kind`."""
    if kind in ("artist", "copyright_notice") and next_kind == "cover_art":
        return _tabs(6)
    if (kind in ("artist", "copyright_notice") and next_kind == "youtube_url") or (
        kind == "youtube_url" and next_kind == "cover_art"
    ):
        return _tabs(3)
    if kind == "written_by" and next_kind in ("role", "copyright_role"):
        # Skip the empty Produced By field, then open "Add additional credits".
        return [("tab", 0.15), ("tab", 0.1), ("enter", 0.1)]
    if kind == "written_by" and next_kind == "produced_by":
        return [("tab", 0.15)]
    if (kind in ("produced_by", "artist") and next_kind in ("role", "copyright_role")) or (
        kind in ("phonographic_copyright", "copyright_notice") and next_kind == "copyright_role"
    ):
        return [("tab", 0.15), ("enter", 0.1)]
    return []


def instruction_text(queue: list[tuple[str, str]], pos: int, hotkey: str) -> str:
    """Instruction shown to the user before they press the hotkey for queue[pos]."""
    if pos >= len(queue):
        return "All done. Save the page on Genius."
    kind, _ = queue[pos]
    hk = hotkey.upper()
    prev = queue[pos - 1][0] if pos > 0 else None

    if kind == "written_by":
        if prev != "written_by":
            return f"Click the Written By field, then press {hk}"
        return f"Field is ready. Press {hk} to add the next songwriter"
    if kind == "produced_by":
        if prev != "produced_by":
            return f"Click the Produced By field, then press {hk}"
        return f"Field is ready. Press {hk} to add the next producer"
    if kind in ("role", "copyright_role"):
        return f"1. Click Add additional credits\n2. Click inside the Additional role field\n3. Press {hk}"
    if kind in ("phonographic_copyright", "copyright_notice"):
        if prev == "copyright_role":
            return f"Field is ready. Press {hk} to add the label"
        return f"Field is ready. Press {hk} to add the next label"
    if kind == "cover_art":
        return f"Press {hk} to copy the 1000×1000 PNG cover art URL to clipboard"
    if kind == "youtube_url":
        return f"Press {hk} to copy the YouTube video URL to clipboard"
    if prev == "role":
        return f"Tab to Artists in this role, then press {hk}"
    return f"Field is ready. Press {hk} to add the next artist"
