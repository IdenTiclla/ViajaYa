"""Pruebas del metadata SQLAlchemy de la outbox durable."""

from __future__ import annotations

from sqlalchemy import CheckConstraint, UniqueConstraint
from sqlalchemy.dialects import postgresql, sqlite

from app.infrastructure.db.models import (
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
)


def test_contador_de_version_tiene_clave_compuesta_y_restriccion() -> None:
    table = RealtimeAggregateVersionModel.__table__

    assert table.name == "realtime_aggregate_versions"
    assert tuple(column.name for column in table.primary_key.columns) == (
        "aggregate_type",
        "aggregate_id",
    )
    checks = {
        constraint.name: str(constraint.sqltext)
        for constraint in table.constraints
        if isinstance(constraint, CheckConstraint)
    }
    assert checks == {
        "ck_realtime_aggregate_versions_version_nonnegative": "version >= 0"
    }
    assert table.c.version.server_default is not None
    assert table.c.updated_at.server_default is not None


def test_outbox_declara_columnas_jsonb_constraints_e_indice_pending() -> None:
    table = RealtimeOutboxModel.__table__

    assert tuple(table.columns.keys()) == (
        "id",
        "batch_id",
        "sequence",
        "event_type",
        "topic",
        "aggregate_type",
        "aggregate_id",
        "aggregate_version",
        "payload",
        "created_at",
        "next_attempt_at",
        "published_at",
        "attempts",
        "last_error",
    )
    assert str(table.c.payload.type.compile(dialect=postgresql.dialect())) == "JSONB"
    assert str(table.c.payload.type.compile(dialect=sqlite.dialect())) == "JSON"

    unique_columns = {
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    assert unique_columns == {
        ("batch_id", "sequence"),
        ("aggregate_type", "aggregate_id", "aggregate_version"),
    }

    checks = {
        constraint.name: str(constraint.sqltext)
        for constraint in table.constraints
        if isinstance(constraint, CheckConstraint)
    }
    assert checks == {
        "ck_realtime_outbox_sequence_nonnegative": "sequence >= 0",
        "ck_realtime_outbox_aggregate_version_positive": "aggregate_version >= 1",
        "ck_realtime_outbox_attempts_nonnegative": "attempts >= 0",
    }

    pending = next(index for index in table.indexes if index.name == "ix_realtime_outbox_pending")
    assert tuple(expression.name for expression in pending.expressions) == (
        "next_attempt_at",
        "created_at",
        "id",
    )
    assert str(pending.dialect_options["postgresql"]["where"]) == (
        "published_at IS NULL AND sequence = 0"
    )
