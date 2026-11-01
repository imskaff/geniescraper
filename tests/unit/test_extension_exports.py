"""The browser extension's generated data files must match the Python reference implementation."""

from pathlib import Path

from tools import export_labels, export_roles, export_vectors


def _committed(path: Path) -> str:
    """File text with LF endings, so a Windows checkout with autocrlf compares equal."""
    return path.read_bytes().decode("utf-8").replace("\r\n", "\n")


_STALE = "stale: run `uv run python -m tools.{tool}` and commit the result"


def test_roles_json_matches_role_map():
    committed = _committed(export_roles.OUTPUT)
    assert committed == export_roles.build(), _STALE.format(tool="export_roles")


def test_labels_json_matches_label_table():
    committed = _committed(export_labels.OUTPUT)
    assert committed == export_labels.build(), _STALE.format(tool="export_labels")


def test_vectors_json_matches_reference_implementation():
    committed = _committed(export_vectors.OUTPUT)
    assert committed == export_vectors.build(), _STALE.format(tool="export_vectors")


def test_vectors_cover_every_queue_kind():
    vectors = export_vectors.build_vectors()
    kinds = {kind for case in vectors["typed_queue"] for kind, _ in case["queue"]}
    assert kinds == set(export_vectors.QUEUE_KINDS)
