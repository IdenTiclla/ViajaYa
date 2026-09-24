"""PostgreSQL certification of the 0021 outbox cardinality and retention."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

_REVISION_0020 = "0020_realtime_outbox_quarantine"
_REVISION_0021 = "0021_realtime_outbox_batch_size"


async def _revision(connection) -> str:
    return str(
        (
            await connection.execute(sa.text("SELECT version_num FROM alembic_version"))
        ).scalar_one()
    )


async def _column_names(connection) -> set[str]:
    rows = (
        await connection.execute(
            sa.text(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'realtime_outbox'
                """
            )
        )
    ).scalars()
    return {str(row) for row in rows}


async def _constraint_names(connection) -> set[str]:
    rows = (
        await connection.execute(
            sa.text(
                """
                SELECT conname
                FROM pg_constraint
                WHERE conrelid = 'realtime_outbox'::regclass
                """
            )
        )
    ).scalars()
    return {str(row) for row in rows}


async def _index_definition(connection, name: str) -> str | None:
    definition = (
        await connection.execute(
            sa.text(
                """
                SELECT indexdef
                FROM pg_indexes
                WHERE schemaname = current_schema()
                  AND tablename = 'realtime_outbox'
                  AND indexname = :name
                """
            ),
            {"name": name},
        )
    ).scalar_one_or_none()
    return (
        " ".join(str(definition).lower().split())
        if definition is not None
        else None
    )


async def test_migration_0021_backfills_cardinality_and_is_reversible(
    pg_test_db,
) -> None:
    batch_id = uuid.uuid4()
    aggregate_id = uuid.uuid4()
    topic = f"ride:{aggregate_id}"
    now = datetime(2026, 7, 22, 12, tzinfo=UTC)
    event_ids = [uuid.uuid4(), uuid.uuid4()]

    await pg_test_db.migrate_async("downgrade", _REVISION_0020)
    try:
        async with pg_test_db.engine.begin() as connection:
            assert await _revision(connection) == _REVISION_0020
            assert "batch_size" not in await _column_names(connection)
            await connection.execute(
                sa.text(
                    """
                    INSERT INTO realtime_outbox (
                        id, batch_id, sequence, event_type, topic, stream_version,
                        aggregate_type, aggregate_id, aggregate_version, payload,
                        created_at, next_attempt_at, published_at
                    ) VALUES (
                        :id, :batch_id, :sequence, 'ride_status', :topic,
                        :stream_version, 'ride', :aggregate_id, :aggregate_version,
                        CAST(:payload AS jsonb), :created_at, :created_at, :published_at
                    )
                    """
                ),
                [
                    {
                        "id": event_id,
                        "batch_id": batch_id,
                        "sequence": sequence,
                        "topic": topic,
                        "stream_version": sequence + 1,
                        "aggregate_id": aggregate_id,
                        "aggregate_version": sequence + 1,
                        "payload": json.dumps(
                            {
                                "type": "ride_status",
                                "data": {"ride_id": str(aggregate_id)},
                            }
                        ),
                        "created_at": now,
                        "published_at": now,
                    }
                    for sequence, event_id in enumerate(event_ids)
                ],
            )

        await pg_test_db.migrate_async("upgrade", _REVISION_0021)
        async with pg_test_db.engine.connect() as connection:
            assert await _revision(connection) == _REVISION_0021
            assert "batch_size" in await _column_names(connection)
            assert {
                "ck_realtime_outbox_batch_size_positive",
                "ck_realtime_outbox_sequence_within_batch",
            } <= await _constraint_names(connection)
            cardinalities = (
                await connection.execute(
                    sa.text(
                        """
                        SELECT sequence, batch_size
                        FROM realtime_outbox
                        WHERE batch_id = :batch_id
                        ORDER BY sequence
                        """
                    ),
                    {"batch_id": batch_id},
                )
            ).all()
            assert cardinalities == [(0, 2), (1, 2)]

            published_index = await _index_definition(
                connection,
                "ix_realtime_outbox_published_retention",
            )
            assert published_index is not None
            assert "(published_at, batch_id)" in published_index
            assert "published_at is not null" in published_index
            assert "sequence = 0" in published_index

        with pytest.raises(IntegrityError):
            async with pg_test_db.engine.begin() as connection:
                await connection.execute(
                    sa.text(
                        """
                        UPDATE realtime_outbox
                        SET batch_size = 1
                        WHERE id = :id
                        """
                    ),
                    {"id": event_ids[1]},
                )

        await pg_test_db.migrate_async("downgrade", _REVISION_0020)
        async with pg_test_db.engine.connect() as connection:
            assert await _revision(connection) == _REVISION_0020
            assert "batch_size" not in await _column_names(connection)
            assert (
                await _index_definition(
                    connection,
                    "ix_realtime_outbox_published_retention",
                )
                is None
            )
            preserved = (
                await connection.execute(
                    sa.text(
                        "SELECT id FROM realtime_outbox WHERE batch_id = :batch_id"
                    ),
                    {"batch_id": batch_id},
                )
            ).scalars()
            assert set(preserved) == set(event_ids)

        await pg_test_db.migrate_async("upgrade", _REVISION_0021)
        async with pg_test_db.engine.connect() as connection:
            cardinalities = (
                await connection.execute(
                    sa.text(
                        """
                        SELECT batch_size
                        FROM realtime_outbox
                        WHERE batch_id = :batch_id
                        ORDER BY sequence
                        """
                    ),
                    {"batch_id": batch_id},
                )
            ).scalars()
            assert list(cardinalities) == [2, 2]
    finally:
        await pg_test_db.migrate_async("upgrade", "head")
        async with pg_test_db.engine.begin() as connection:
            await connection.execute(
                sa.text("DELETE FROM realtime_outbox WHERE batch_id = :batch_id"),
                {"batch_id": batch_id},
            )
