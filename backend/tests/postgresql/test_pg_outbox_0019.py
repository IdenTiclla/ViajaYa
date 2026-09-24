"""PostgreSQL certification of the 0019 outbox per-topic sequences."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncConnection

_REVISION_0018 = "0018_realtime_outbox"
_REVISION_0019 = "0019_realtime_stream_versions"

_OUTBOX_COLUMNS_0018 = {
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
}
_OUTBOX_COLUMNS_0019 = _OUTBOX_COLUMNS_0018 | {"stream_version"}
_STREAM_COLUMNS = {"topic", "version", "updated_at"}
_CONSTRAINTS_0018 = {
    "pk_realtime_aggregate_versions",
    "ck_realtime_aggregate_versions_version_nonnegative",
    "pk_realtime_outbox",
    "uq_realtime_outbox_batch_sequence",
    "uq_realtime_outbox_aggregate_version",
    "ck_realtime_outbox_sequence_nonnegative",
    "ck_realtime_outbox_aggregate_version_positive",
    "ck_realtime_outbox_attempts_nonnegative",
}
_CONSTRAINTS_0019 = _CONSTRAINTS_0018 | {
    "pk_realtime_stream_versions",
    "ck_realtime_stream_versions_version_nonnegative",
    "uq_realtime_outbox_topic_stream_version",
    "ck_realtime_outbox_stream_version_positive",
}


async def _revision(connection: AsyncConnection) -> str:
    return str(
        (
            await connection.execute(sa.text("SELECT version_num FROM alembic_version"))
        ).scalar_one()
    )


async def _table_names(connection: AsyncConnection) -> set[str]:
    names = (
        await connection.execute(
            sa.text(
                """
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = current_schema()
                  AND tablename IN (
                      'realtime_aggregate_versions',
                      'realtime_stream_versions',
                      'realtime_outbox'
                  )
                """
            )
        )
    ).scalars()
    return {str(name) for name in names}


async def _columns(
    connection: AsyncConnection,
) -> dict[str, dict[str, tuple[str, str]]]:
    rows = (
        await connection.execute(
            sa.text(
                """
                SELECT table_name, column_name, udt_name, is_nullable
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name IN (
                      'realtime_aggregate_versions',
                      'realtime_stream_versions',
                      'realtime_outbox'
                  )
                """
            )
        )
    ).all()
    result: dict[str, dict[str, tuple[str, str]]] = {}
    for table_name, column_name, udt_name, is_nullable in rows:
        result.setdefault(str(table_name), {})[str(column_name)] = (
            str(udt_name),
            str(is_nullable),
        )
    return result


async def _constraint_names(connection: AsyncConnection) -> set[str]:
    names = (
        await connection.execute(
            sa.text(
                """
                SELECT conname
                FROM pg_constraint
                WHERE conrelid IN (
                    'realtime_aggregate_versions'::regclass,
                    'realtime_outbox'::regclass,
                    COALESCE(
                        to_regclass('realtime_stream_versions'),
                        'realtime_outbox'::regclass
                    )
                )
                """
            )
        )
    ).scalars()
    return {str(name) for name in names}


async def _assert_pending_index_0018(connection: AsyncConnection) -> None:
    index_definition = (
        await connection.execute(
            sa.text(
                """
                SELECT indexdef
                FROM pg_indexes
                WHERE schemaname = current_schema()
                  AND tablename = 'realtime_outbox'
                  AND indexname = 'ix_realtime_outbox_pending'
                """
            )
        )
    ).scalar_one()
    normalized = " ".join(str(index_definition).lower().split())
    assert "(next_attempt_at, created_at, id)" in normalized
    assert "where ((published_at is null) and (sequence = 0))" in normalized


async def _assert_schema_0018(connection: AsyncConnection) -> None:
    assert await _table_names(connection) == {
        "realtime_aggregate_versions",
        "realtime_outbox",
    }
    columns = await _columns(connection)
    assert set(columns["realtime_outbox"]) == _OUTBOX_COLUMNS_0018
    assert "realtime_stream_versions" not in columns
    assert _CONSTRAINTS_0018 <= await _constraint_names(connection)
    await _assert_pending_index_0018(connection)


async def _assert_schema_0019(connection: AsyncConnection) -> None:
    assert await _table_names(connection) == {
        "realtime_aggregate_versions",
        "realtime_stream_versions",
        "realtime_outbox",
    }
    columns = await _columns(connection)
    assert set(columns["realtime_outbox"]) == _OUTBOX_COLUMNS_0019
    assert set(columns["realtime_stream_versions"]) == _STREAM_COLUMNS
    assert columns["realtime_outbox"]["stream_version"] == ("int8", "NO")
    assert columns["realtime_stream_versions"]["version"] == ("int8", "NO")
    assert _CONSTRAINTS_0019 <= await _constraint_names(connection)
    await _assert_pending_index_0018(connection)

    index_definition = (
        await connection.execute(
            sa.text(
                """
                SELECT indexdef
                FROM pg_indexes
                WHERE schemaname = current_schema()
                  AND tablename = 'realtime_outbox'
                  AND indexname = 'ix_realtime_outbox_pending_stream'
                """
            )
        )
    ).scalar_one()
    normalized = " ".join(str(index_definition).lower().split())
    assert "(topic, stream_version)" in normalized
    assert "where (published_at is null)" in normalized


def _seed_rows() -> tuple[list[dict[str, object]], dict[str, list[uuid.UUID]]]:
    topic_a = f"ride:{uuid.uuid4()}"
    topic_b = f"driver:{uuid.uuid4()}"
    aggregate_a = uuid.uuid4()
    aggregate_b = uuid.uuid4()
    created_at = datetime(2026, 7, 18, 12, tzinfo=UTC)

    prefix = (uuid.uuid4().int >> 16) << 16
    batch_low = uuid.UUID(int=prefix + 10)
    batch_high = uuid.UUID(int=prefix + 20)
    batch_later = uuid.UUID(int=prefix + 5)
    batch_b = uuid.UUID(int=prefix + 30)

    id_low_batch = uuid.UUID(int=prefix + 101)
    id_sequence_zero = uuid.UUID(int=prefix + 102)
    id_sequence_one = uuid.UUID(int=prefix + 103)
    id_later = uuid.UUID(int=prefix + 104)
    id_b_published = uuid.UUID(int=prefix + 105)
    id_b_pending = uuid.UUID(int=prefix + 106)

    rows = [
        {
            "id": id_later,
            "batch_id": batch_later,
            "sequence": 2,
            "event_type": "ride_status",
            "topic": topic_a,
            "aggregate_type": "ride",
            "aggregate_id": aggregate_a,
            "aggregate_version": 4,
            "payload": json.dumps({"order": "later"}),
            "created_at": created_at + timedelta(minutes=1),
            "next_attempt_at": created_at + timedelta(minutes=1),
            "published_at": None,
        },
        {
            "id": id_sequence_one,
            "batch_id": batch_high,
            "sequence": 1,
            "event_type": "ride_status",
            "topic": topic_a,
            "aggregate_type": "ride",
            "aggregate_id": aggregate_a,
            "aggregate_version": 3,
            "payload": json.dumps({"order": "sequence_one"}),
            "created_at": created_at,
            "next_attempt_at": created_at,
            "published_at": None,
        },
        {
            "id": id_low_batch,
            "batch_id": batch_low,
            "sequence": 0,
            "event_type": "ride_status",
            "topic": topic_a,
            "aggregate_type": "ride",
            "aggregate_id": aggregate_a,
            "aggregate_version": 1,
            "payload": json.dumps({"order": "low_batch"}),
            "created_at": created_at,
            "next_attempt_at": created_at,
            "published_at": None,
        },
        {
            "id": id_sequence_zero,
            "batch_id": batch_high,
            "sequence": 0,
            "event_type": "ride_status",
            "topic": topic_a,
            "aggregate_type": "ride",
            "aggregate_id": aggregate_a,
            "aggregate_version": 2,
            "payload": json.dumps({"order": "sequence_zero"}),
            "created_at": created_at,
            "next_attempt_at": created_at,
            "published_at": None,
        },
        {
            "id": id_b_pending,
            "batch_id": batch_b,
            "sequence": 1,
            "event_type": "offer_created",
            "topic": topic_b,
            "aggregate_type": "offer",
            "aggregate_id": aggregate_b,
            "aggregate_version": 2,
            "payload": json.dumps({"order": "pending"}),
            "created_at": created_at + timedelta(seconds=1),
            "next_attempt_at": created_at + timedelta(seconds=1),
            "published_at": None,
        },
        {
            "id": id_b_published,
            "batch_id": batch_b,
            "sequence": 0,
            "event_type": "offer_created",
            "topic": topic_b,
            "aggregate_type": "offer",
            "aggregate_id": aggregate_b,
            "aggregate_version": 1,
            "payload": json.dumps({"order": "published"}),
            "created_at": created_at,
            "next_attempt_at": created_at,
            "published_at": created_at + timedelta(seconds=2),
        },
    ]
    expected = {
        topic_a: [
            id_low_batch,
            id_sequence_zero,
            id_sequence_one,
            id_later,
        ],
        topic_b: [id_b_published, id_b_pending],
    }
    return rows, expected


async def _insert_rows_0018(
    connection: AsyncConnection,
    rows: list[dict[str, object]],
) -> None:
    await connection.execute(
        sa.text(
            """
            INSERT INTO realtime_outbox (
                id,
                batch_id,
                sequence,
                event_type,
                topic,
                aggregate_type,
                aggregate_id,
                aggregate_version,
                payload,
                created_at,
                next_attempt_at,
                published_at
            ) VALUES (
                :id,
                :batch_id,
                :sequence,
                :event_type,
                :topic,
                :aggregate_type,
                :aggregate_id,
                :aggregate_version,
                CAST(:payload AS jsonb),
                :created_at,
                :next_attempt_at,
                :published_at
            )
            """
        ),
        rows,
    )


async def _assert_backfill(
    connection: AsyncConnection,
    expected: dict[str, list[uuid.UUID]],
) -> None:
    topics = list(expected)
    rows = (
        await connection.execute(
            sa.text(
                """
                SELECT topic, id, stream_version
                FROM realtime_outbox
                WHERE topic IN (:topic_a, :topic_b)
                ORDER BY topic, stream_version
                """
            ),
            {"topic_a": topics[0], "topic_b": topics[1]},
        )
    ).all()
    actual: dict[str, list[tuple[uuid.UUID, int]]] = {}
    for topic, event_id, stream_version in rows:
        actual.setdefault(str(topic), []).append((event_id, int(stream_version)))
    assert actual == {
        topic: [(event_id, version) for version, event_id in enumerate(ids, start=1)]
        for topic, ids in expected.items()
    }

    counters = (
        await connection.execute(
            sa.text(
                """
                SELECT topic, version
                FROM realtime_stream_versions
                WHERE topic IN (:topic_a, :topic_b)
                """
            ),
            {"topic_a": topics[0], "topic_b": topics[1]},
        )
    ).all()
    assert {str(topic): int(version) for topic, version in counters} == {
        topic: len(ids) for topic, ids in expected.items()
    }


async def _cleanup(connection: AsyncConnection, topics: list[str]) -> None:
    await connection.execute(
        sa.text(
            "DELETE FROM realtime_outbox WHERE topic IN (:topic_a, :topic_b)"
        ),
        {"topic_a": topics[0], "topic_b": topics[1]},
    )
    await connection.execute(
        sa.text(
            "DELETE FROM realtime_stream_versions WHERE topic IN (:topic_a, :topic_b)"
        ),
        {"topic_a": topics[0], "topic_b": topics[1]},
    )


async def test_deterministic_backfill_downgrade_and_reupgrade_0019(pg_test_db) -> None:
    rows, expected = _seed_rows()
    topics = list(expected)

    await pg_test_db.migrate_async("downgrade", _REVISION_0018)
    try:
        async with pg_test_db.engine.begin() as connection:
            assert await _revision(connection) == _REVISION_0018
            await _assert_schema_0018(connection)
            await _insert_rows_0018(connection, rows)

        await pg_test_db.migrate_async("upgrade", _REVISION_0019)
        async with pg_test_db.engine.connect() as connection:
            assert await _revision(connection) == _REVISION_0019
            await _assert_schema_0019(connection)
            await _assert_backfill(connection, expected)

        await pg_test_db.migrate_async("downgrade", _REVISION_0018)
        async with pg_test_db.engine.connect() as connection:
            assert await _revision(connection) == _REVISION_0018
            await _assert_schema_0018(connection)
            preserved_ids = (
                await connection.execute(
                    sa.text(
                        """
                        SELECT id
                        FROM realtime_outbox
                        WHERE topic IN (:topic_a, :topic_b)
                        """
                    ),
                    {"topic_a": topics[0], "topic_b": topics[1]},
                )
            ).scalars()
            assert set(preserved_ids) == {
                event_id for ids in expected.values() for event_id in ids
            }

        await pg_test_db.migrate_async("upgrade", _REVISION_0019)
        async with pg_test_db.engine.connect() as connection:
            assert await _revision(connection) == _REVISION_0019
            await _assert_schema_0019(connection)
            await _assert_backfill(connection, expected)
    finally:
        await pg_test_db.migrate_async("upgrade", "head")
        async with pg_test_db.engine.begin() as connection:
            await _cleanup(connection, topics)
