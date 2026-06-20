"""normalize enum columns to lowercase values

Las columnas enum (``native_enum=False``) deben guardar el *valor* del enum
(minúscula: ``cash``, ``taxi``, ``driver``…), no su nombre (``CASH``, ``TAXI``…).
Filas creadas por el ORM habían quedado en mayúscula; esta migración las
normaliza con ``LOWER`` (idempotente: en nuestros enums ``value == name.lower()``).

Revision ID: 0006_normalize_enum_values
Revises: 0005_drivers_and_offers
Create Date: 2026-05-31

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0006_normalize_enum_values"
down_revision: str | None = "0005_drivers_and_offers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (tabla, columna) de cada enum almacenado como texto.
_ENUM_COLUMNS: list[tuple[str, str]] = [
    ("users", "auth_provider"),
    ("users", "role"),
    ("users", "vehicle_type"),
    ("ride_requests", "service_type"),
    ("ride_requests", "payment_method"),
    ("ride_requests", "status"),
    ("offers", "status"),
    ("saved_places", "category"),
]


def upgrade() -> None:
    for table, column in _ENUM_COLUMNS:
        op.execute(
            f"UPDATE {table} SET {column} = LOWER({column}) WHERE {column} IS NOT NULL"
        )


def downgrade() -> None:
    # No se revierte: los nombres en mayúscula eran un estado inconsistente.
    pass
