"""The desktop spacing follows the extension's scale, and every padding in the GUI code uses it."""

import ast
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent.parent
GUI_FILES = sorted((ROOT / "gui").glob("*.py"))
PADDING_KEYS = {"padx", "pady", "ipadx", "ipady"}


def _theme_scale() -> dict[int, int]:
    source = (ROOT / "gui" / "theme.py").read_text(encoding="utf-8")
    return {int(n): int(px) for n, px in re.findall(r"^SPACE_(\d)\s*=\s*(\d+)", source, re.MULTILINE)}


def test_the_scale_matches_the_extensions_first_five_steps():
    css = (ROOT / "extension" / "src" / "ui" / "panel.css").read_text(encoding="utf-8")
    extension = {int(n): int(px) for n, px in re.findall(r"--space-(\d):\s*(\d+)px", css)}
    scale = _theme_scale()
    assert {n: scale[n] for n in extension} == extension


def _raw_numbers(node: ast.AST) -> list[int | float]:
    """Numeric literals other than 0 inside a padding value, however it is written (a number, a tuple, a conditional)."""
    return [
        n.value
        for n in ast.walk(node)
        if isinstance(n, ast.Constant) and isinstance(n.value, int | float) and n.value != 0
    ]


@pytest.mark.parametrize("path", GUI_FILES, ids=lambda p: p.name)
def test_every_padding_uses_a_step_of_the_scale(path):
    offenders = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.keyword) and node.arg in PADDING_KEYS and _raw_numbers(node.value):
            offenders.append(f"line {node.value.lineno}: {node.arg}={ast.unparse(node.value)}")
    assert not offenders, "use theme.SPACE_1 to theme.SPACE_6 instead of numbers:\n" + "\n".join(offenders)
