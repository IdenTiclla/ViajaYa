"""PostgreSQL certification of the 0020 outbox terminal quarantine."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest
import sqlalchemy as sa

_REVISION_0019 = "0019_realtime_stream_versions"
_REVISION_0020 = "0020_realtime_outbox_quarantine"


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


async def _index_definition(connection, name: str) -> str:
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
    ).scalar_one()
    return " ".join(str(definition).lower().split())


async def test_migration_0020_preserves_rows_and_protects_its_downgrade(
    pg_test_db,
) -> None:
    event_id = uuid.uuid4()
    batch_id = uuid.uuid4()
    aggregate_id = uuid.uuid4()
    topic = f"ride:{aggregate_id}"
    now = datetime(2026, 7, 18, 12, tzinfo=UTC)

    await pg_test_db.migrate_async("downgrade", _REVISION_0019)
    try:
        async with pg_test_db.engine.begin() as connection:
            assert await _revision(connection) == _REVISION_0019
            assert "quarantined_at" not in await _column_names(connection)
            await connection.execute(
                sa.text(
                    """
                    INSERT INTO realtime_outbox (
                        id, batch_id, sequence, event_type, topic, stream_version,
                        aggregate_type, aggregate_id, aggregate_version, payload,
                        created_at, next_attempt_at
                    ) VALUES (
                        :id, :batch_id, 0, 'ride_closed', :topic, 1,
                        'ride', :aggregate_id, 1, CAST(:payload AS jsonb),
                        :created_at, :created_at
                    )
                    """
                ),
                {
                    "id": event_id,
                    "batch_id": batch_id,
                    "topic": topic,
                    "aggregate_id": aggregate_id,
                    "payload": json.dumps({"type": "ride_closed", "data": {}}),
                    "created_at": now,
                },
            )

        await pg_test_db.migrate_async("upgrade", _REVISION_0020)
        async with pg_test_db.engine.connect() as connection:
            assert await _revision(connection) == _REVISION_0020
            assert {"quarantined_at", "quarantine_code"} <= await _column_names(
                connection
            )
            assert {
                "ck_realtime_outbox_terminal_state_exclusive",
                "ck_realtime_outbox_quarantine_complete",
                "ck_realtime_outbox_quarantine_code_length",
            } <= await _constraint_names(connection)

            pending = await _index_definition(
                connection,
                "ix_realtime_outbox_pending",
            )
            assert "published_at is null" in pending
            assert "quarantined_at is null" in pending
            assert "sequence = 0" in pending

            pending_stream = await _index_definition(
                connection,
                "ix_realtime_outbox_pending_stream",
            )
            assert "published_at is null" in pending_stream
            assert "quarantined_at is null" in pending_stream

            quarantined = await _index_definition(
                connection,
                "ix_realtime_outbox_quarantined",
            )
            assert "quarantined_at is not null" in quarantined
            assert "sequence = 0" in quarantined

            state = (
                await connection.execute(
                    sa.text(
                        """
                        SELECT quarantined_at, quarantine_code
                        FROM realtime_outbox
                        WHERE id = :id
                        """
                    ),
                    {"id": event_id},
                )
            ).one()
            assert state == (None, None)

        async with pg_test_db.engine.begin() as connection:
            await connection.execute(
                sa.text(
                    """
                    UPDATE realtime_outbox
                    SET quarantined_at = :now, quarantine_code = 'invalid_payload'
                    WHERE id = :id
                    """
                ),
                {"id": event_id, "now": now},
            )

        with pytest.raises(RuntimeError, match="quarantined outbox events"):
            await pg_test_db.migrate_async("downgrade", _REVISION_0019)

        async with pg_test_db.engine.begin() as connection:
            assert await _revision(connection) == _REVISION_0020
            await connection.execute(
                sa.text("DELETE FROM realtime_outbox WHERE id = :id"),
                {"id": event_id},
            )

        await pg_test_db.migrate_async("downgrade", _REVISION_0019)
        async with pg_test_db.engine.connect() as connection:
            assert await _revision(connection) == _REVISION_0019
            assert "quarantined_at" not in await _column_names(connection)

        await pg_test_db.migrate_async("upgrade", _REVISION_0020)
        async with pg_test_db.engine.connect() as connection:
            assert await _revision(connection) == _REVISION_0020
    finally:
        await pg_test_db.migrate_async("upgrade", "head")
