"""Pruebas del metadata SQLAlchemy de la outbox durable."""

from __future__ import annotations

from sqlalchemy import CheckConstraint, UniqueConstraint
from sqlalchemy.dialects import postgresql, sqlite

from app.infrastructure.db.models import (
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
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


def test_contador_de_stream_tiene_topic_como_clave_y_restriccion() -> None:
    table = RealtimeStreamVersionModel.__table__

    assert table.name == "realtime_stream_versions"
    assert tuple(column.name for column in table.primary_key.columns) == ("topic",)
    checks = {
        constraint.name: str(constraint.sqltext)
        for constraint in table.constraints
        if isinstance(constraint, CheckConstraint)
    }
    assert checks == {
        "ck_realtime_stream_versions_version_nonnegative": "version >= 0"
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
        "stream_version",
        "aggregate_type",
        "aggregate_id",
        "aggregate_version",
        "payload",
        "created_at",
        "next_attempt_at",
        "published_at",
        "quarantined_at",
        "quarantine_code",
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
        ("topic", "stream_version"),
    }

    checks = {
        constraint.name: str(constraint.sqltext)
        for constraint in table.constraints
        if isinstance(constraint, CheckConstraint)
    }
    assert checks == {
        "ck_realtime_outbox_sequence_nonnegative": "sequence >= 0",
        "ck_realtime_outbox_aggregate_version_positive": "aggregate_version >= 1",
        "ck_realtime_outbox_stream_version_positive": "stream_version >= 1",
        "ck_realtime_outbox_attempts_nonnegative": "attempts >= 0",
        "ck_realtime_outbox_terminal_state_exclusive": (
            "published_at IS NULL OR quarantined_at IS NULL"
        ),
        "ck_realtime_outbox_quarantine_complete": (
            "(quarantined_at IS NULL) = (quarantine_code IS NULL)"
        ),
        "ck_realtime_outbox_quarantine_code_length": (
            "quarantine_code IS NULL OR "
            "length(trim(quarantine_code)) BETWEEN 1 AND 64"
        ),
    }

    pending = next(index for index in table.indexes if index.name == "ix_realtime_outbox_pending")
    assert tuple(expression.name for expression in pending.expressions) == (
        "next_attempt_at",
        "created_at",
        "id",
    )
    assert str(pending.dialect_options["postgresql"]["where"]) == (
        "published_at IS NULL AND quarantined_at IS NULL AND sequence = 0"
    )

    pending_stream = next(
        index
        for index in table.indexes
        if index.name == "ix_realtime_outbox_pending_stream"
    )
    assert tuple(expression.name for expression in pending_stream.expressions) == (
        "topic",
        "stream_version",
    )
    assert str(pending_stream.dialect_options["postgresql"]["where"]) == (
        "published_at IS NULL AND quarantined_at IS NULL"
    )
    assert str(pending_stream.dialect_options["sqlite"]["where"]) == (
        "published_at IS NULL AND quarantined_at IS NULL"
    )

    quarantined = next(
        index
        for index in table.indexes
        if index.name == "ix_realtime_outbox_quarantined"
    )
    assert tuple(expression.name for expression in quarantined.expressions) == (
        "quarantined_at",
        "batch_id",
    )
    assert str(quarantined.dialect_options["postgresql"]["where"]) == (
        "quarantined_at IS NOT NULL AND sequence = 0"
    )
