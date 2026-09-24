"""PostgreSQL certification of durable correlation and the 0023 rolling deploy."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import sqlalchemy as sa

_REVISION_0022 = "0022_scheduled_actions"
_REVISION_0023 = "0023_outbox_correlation_id"


async def _column(connection) -> tuple[str, str | None] | None:
    row = (
        await connection.execute(
            sa.text(
                """
                SELECT is_nullable, column_default
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'realtime_outbox'
                  AND column_name = 'correlation_id'
                """
            )
        )
    ).one_or_none()
    if row is None:
        return None
    return str(row.is_nullable), (
        str(row.column_default) if row.column_default is not None else None
    )


async def _insert_legacy_event(
    connection,
    *,
    batch_id: uuid.UUID,
    sequence: int = 0,
    batch_size: int = 1,
) -> uuid.UUID:
    event_id = uuid.uuid4()
    aggregate_id = uuid.uuid4()
    now = datetime(2026, 7, 22, 12, tzinfo=UTC)
    await connection.execute(
        sa.text(
            """
            INSERT INTO realtime_outbox (
                id, batch_id, sequence, batch_size, event_type, topic,
                stream_version, aggregate_type, aggregate_id,
                aggregate_version, payload, created_at, next_attempt_at
            ) VALUES (
                :id, :batch_id, :sequence, :batch_size, 'ride_closed', :topic,
                1, 'ride', :aggregate_id, 1, CAST(:payload AS jsonb),
                :created_at, :created_at
            )
            """
        ),
        {
            "id": event_id,
            "batch_id": batch_id,
            "sequence": sequence,
            "batch_size": batch_size,
            "topic": f"ride:{aggregate_id}",
            "aggregate_id": aggregate_id,
            "payload": json.dumps(
                {
                    "type": "ride_closed",
                    "data": {"ride_id": str(aggregate_id)},
                }
            ),
            "created_at": now,
        },
    )
    return event_id


async def test_migration_0023_backfills_and_accepts_the_previous_writer(
    pg_test_db,
) -> None:
    historic_batch = uuid.uuid4()
    rolling_batch = uuid.uuid4()

    await pg_test_db.migrate_async("downgrade", _REVISION_0022)
    try:
        async with pg_test_db.engine.begin() as connection:
            assert await _column(connection) is None
            historic_event = await _insert_legacy_event(
                connection,
                batch_id=historic_batch,
            )

        await pg_test_db.migrate_async("upgrade", _REVISION_0023)
        async with pg_test_db.engine.begin() as connection:
            metadata = await _column(connection)
            assert metadata is not None
            assert metadata[0] == "NO"
            assert metadata[1] is None

            historic_correlation = await connection.scalar(
                sa.text(
                    "SELECT correlation_id FROM realtime_outbox WHERE id = :id"
                ),
                {"id": historic_event},
            )
            assert historic_correlation == historic_batch

            first_rolling_event = await _insert_legacy_event(
                connection,
                batch_id=rolling_batch,
                sequence=0,
                batch_size=2,
            )
            second_rolling_event = await _insert_legacy_event(
                connection,
                batch_id=rolling_batch,
                sequence=1,
                batch_size=2,
            )
            rolling_correlations = (
                await connection.scalars(
                    sa.text(
                        "SELECT correlation_id FROM realtime_outbox "
                        "WHERE id IN (:first_id, :second_id)"
                    ),
                    {
                        "first_id": first_rolling_event,
                        "second_id": second_rolling_event,
                    },
                )
            ).all()
            assert set(rolling_correlations) == {rolling_batch}
            trigger_count = await connection.scalar(
                sa.text(
                    "SELECT count(*) FROM pg_trigger "
                    "WHERE tgname = 'trg_realtime_outbox_legacy_correlation_id' "
                    "AND NOT tgisinternal"
                ),
            )
            assert trigger_count == 1

        await pg_test_db.migrate_async("downgrade", _REVISION_0022)
        async with pg_test_db.engine.connect() as connection:
            assert await _column(connection) is None
            assert await connection.scalar(
                sa.text(
                    "SELECT to_regprocedure("
                    "'set_realtime_outbox_legacy_correlation_id()'"
                    ") IS NULL"
                )
            ) is True
    finally:
        await pg_test_db.migrate_async("upgrade", "head")
        async with pg_test_db.engine.begin() as connection:
            await connection.execute(
                sa.text(
                    "DELETE FROM realtime_outbox "
                    "WHERE batch_id IN (:historic_batch, :rolling_batch)"
                ),
                {
                    "historic_batch": historic_batch,
                    "rolling_batch": rolling_batch,
                },
            )
