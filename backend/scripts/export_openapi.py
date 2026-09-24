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


def serializar_openapi() -> str:
    """Return the current OpenAPI as stable JSON ending with a newline."""
    schema = create_app().openapi()
    return json.dumps(
        schema,
        ensure_ascii=False,
        allow_nan=False,
        indent=2,
        sort_keys=True,
    ) + "\n"


def snapshot_esta_actualizado(
    destino: Path = OPENAPI_SNAPSHOT,
    *,
    esperado: str | None = None,
) -> bool:
    """Compare the snapshot without writing to disk."""
    if esperado is None:
        esperado = serializar_openapi()
    try:
        actual = destino.read_text(encoding="utf-8")
    except FileNotFoundError:
        return False
    return actual == esperado


def escribir_snapshot(
    destino: Path = OPENAPI_SNAPSHOT,
    *,
    contenido: str | None = None,
) -> None:
    """Escribe el contrato OpenAPI serializado de forma determinista."""
    if contenido is None:
        contenido = serializar_openapi()
    destino.write_text(contenido, encoding="utf-8")


def _crear_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Genera o verifica el snapshot OpenAPI versionado del backend."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="falla si el snapshot difiere, sin modificarlo",
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    destino: Path = OPENAPI_SNAPSHOT,
) -> int:
    """Run the requested export or check."""
    args = _crear_parser().parse_args(argv)
    esperado = serializar_openapi()

    if args.check:
        if snapshot_esta_actualizado(destino, esperado=esperado):
            print(f"OpenAPI actualizado: {destino}")
            return 0
        print(
            "El snapshot OpenAPI está desactualizado. "
            "Ejecuta `python -m scripts.export_openapi` y versiona el resultado.",
            file=sys.stderr,
        )
        return 1

    escribir_snapshot(destino, contenido=esperado)
    print(f"OpenAPI exportado: {destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
