"""Tests of the durable outbox's SQLAlchemy metadata."""

from __future__ import annotations

from sqlalchemy import CheckConstraint, UniqueConstraint
from sqlalchemy.dialects import postgresql, sqlite

from app.infrastructure.db.models import (
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
)


def test_version_counter_has_a_composite_key_and_constraint() -> None:
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


def test_stream_counter_has_topic_as_key_and_constraint() -> None:
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


def test_outbox_declares_jsonb_columns_constraints_and_pending_index() -> None:
    table = RealtimeOutboxModel.__table__

    assert tuple(table.columns.keys()) == (
        "id",
        "batch_id",
        "correlation_id",
        "sequence",
        "batch_size",
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
    assert table.c.correlation_id.server_default is None

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
        "ck_realtime_outbox_batch_size_positive": "batch_size >= 1",
        "ck_realtime_outbox_sequence_within_batch": "sequence < batch_size",
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

    published_retention = next(
        index
        for index in table.indexes
        if index.name == "ix_realtime_outbox_published_retention"
    )
    assert tuple(
        expression.name for expression in published_retention.expressions
    ) == ("published_at", "batch_id")
    assert str(published_retention.dialect_options["postgresql"]["where"]) == (
        "published_at IS NOT NULL AND sequence = 0"
    )
    assert str(published_retention.dialect_options["sqlite"]["where"]) == (
        "published_at IS NOT NULL AND sequence = 0"
    )
