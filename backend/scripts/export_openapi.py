"""Generate and verify the backend's versioned OpenAPI contract.

Usage::

    python -m scripts.export_openapi
    python -m scripts.export_openapi --check

``--check`` mode only compares the current contract with the snapshot; it never modifies files.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from app.main import create_app

OPENAPI_SNAPSHOT = Path(__file__).resolve().parents[1] / "openapi.json"


def serialize_openapi() -> str:
    """Return the current OpenAPI as stable JSON ending with a newline."""
    schema = create_app().openapi()
    return json.dumps(
        schema,
        ensure_ascii=False,
        allow_nan=False,
        indent=2,
        sort_keys=True,
    ) + "\n"


def snapshot_is_current(
    destination: Path = OPENAPI_SNAPSHOT,
    *,
    expected: str | None = None,
) -> bool:
    """Compare the snapshot without writing to disk."""
    if expected is None:
        expected = serialize_openapi()
    try:
        current = destination.read_text(encoding="utf-8")
    except FileNotFoundError:
        return False
    return current == expected


def write_snapshot(
    destination: Path = OPENAPI_SNAPSHOT,
    *,
    content: str | None = None,
) -> None:
    """Escribe el contrato OpenAPI serializado de forma determinista."""
    if content is None:
        content = serialize_openapi()
    destination.write_text(content, encoding="utf-8")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate or verify the backend's versioned OpenAPI snapshot."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if the snapshot differs, without modifying it",
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    destination: Path = OPENAPI_SNAPSHOT,
) -> int:
    """Run the requested export or check."""
    args = _build_parser().parse_args(argv)
    expected = serialize_openapi()

    if args.check:
        if snapshot_is_current(destination, expected=expected):
            print(f"OpenAPI actualizado: {destination}")
            return 0
        print(
            "The OpenAPI snapshot is out of date. "
            "Run `python -m scripts.export_openapi` and commit the result.",
            file=sys.stderr,
        )
        return 1

    write_snapshot(destination, content=expected)
    print(f"OpenAPI exportado: {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
