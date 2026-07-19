"""Certificación PostgreSQL de la migración y el claim de la outbox 0018."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncConnection, async_sessionmaker

from app.application.dto import PendingRealtimeEvent
from app.infrastructure.db.models import (
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
)
from app.infrastructure.db.outbox import SqlAlchemyRealtimeOutbox

_REVISION_0017 = "0017_pg_integrity_indexes"
_REVISION_0018 = "0018_realtime_outbox"

_VERSION_COLUMNS = {
    "aggregate_type",
    "aggregate_id",
    "version",
    "updated_at",
}
_OUTBOX_COLUMNS = {
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
_CONSTRAINTS = {
    "pk_realtime_aggregate_versions",
    "ck_realtime_aggregate_versions_version_nonnegative",
    "pk_realtime_outbox",
    "uq_realtime_outbox_batch_sequence",
    "uq_realtime_outbox_aggregate_version",
    "ck_realtime_outbox_sequence_nonnegative",
    "ck_realtime_outbox_aggregate_version_positive",
    "ck_realtime_outbox_attempts_nonnegative",
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
                      'realtime_outbox'
                  )
                """
            )
        )
    ).scalars()
    return {str(name) for name in names}


async def _assert_0018_schema(connection: AsyncConnection) -> None:
    assert await _table_names(connection) == {
        "realtime_aggregate_versions",
        "realtime_outbox",
    }

    column_rows = (
        await connection.execute(
            sa.text(
                """
                SELECT table_name, column_name, udt_name
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name IN (
                      'realtime_aggregate_versions',
                      'realtime_outbox'
                  )
                """
            )
        )
    ).all()
    columns: dict[str, dict[str, str]] = {}
    for table_name, column_name, udt_name in column_rows:
        columns.setdefault(str(table_name), {})[str(column_name)] = str(udt_name)
    assert set(columns["realtime_aggregate_versions"]) == _VERSION_COLUMNS
    assert set(columns["realtime_outbox"]) == _OUTBOX_COLUMNS
    assert columns["realtime_aggregate_versions"]["version"] == "int8"
    assert columns["realtime_outbox"]["payload"] == "jsonb"

    constraint_names = (
        await connection.execute(
            sa.text(
                """
                SELECT conname
                FROM pg_constraint
                WHERE conrelid IN (
                    'realtime_aggregate_versions'::regclass,
                    'realtime_outbox'::regclass
                )
                """
            )
        )
    ).scalars()
    assert _CONSTRAINTS <= {str(name) for name in constraint_names}

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
    normalized_index = " ".join(str(index_definition).lower().split())
    assert "(next_attempt_at, created_at, id)" in normalized_index
    assert "where ((published_at is null) and (sequence = 0))" in normalized_index


async def test_upgrade_downgrade_y_reupgrade_0018(pg_test_db) -> None:
    await pg_test_db.migrate_async("downgrade", _REVISION_0017)
    try:
        async with pg_test_db.engine.connect() as connection:
            assert await _revision(connection) == _REVISION_0017
            assert not await _table_names(connection)

        await pg_test_db.migrate_async("upgrade", _REVISION_0018)
        async with pg_test_db.engine.connect() as connection:
            assert await _revision(connection) == _REVISION_0018
            await _assert_0018_schema(connection)

        await pg_test_db.migrate_async("downgrade", _REVISION_0017)
        async with pg_test_db.engine.connect() as connection:
            assert await _revision(connection) == _REVISION_0017
            assert not await _table_names(connection)

        await pg_test_db.migrate_async("upgrade", _REVISION_0018)
        async with pg_test_db.engine.connect() as connection:
            assert await _revision(connection) == _REVISION_0018
            await _assert_0018_schema(connection)
    finally:
        await pg_test_db.migrate_async("upgrade", "head")


def _outbox_rows(batch_id: uuid.UUID, count: int) -> list[dict[str, object]]:
    aggregate_id = uuid.uuid4()
    return [
        {
            "id": uuid.uuid4(),
            "batch_id": batch_id,
            "sequence": sequence,
            "event_type": "ride_status",
            "topic": f"ride:{aggregate_id}",
            "aggregate_type": "ride",
            "aggregate_id": aggregate_id,
            "aggregate_version": sequence + 1,
            "payload": {"status": "accepted", "sequence": sequence},
        }
        for sequence in range(count)
    ]


async def _delete_batches(pg_test_db, batch_ids: list[uuid.UUID]) -> None:
    async with pg_test_db.engine.begin() as connection:
        await connection.execute(
            sa.delete(RealtimeOutboxModel).where(
                RealtimeOutboxModel.batch_id.in_(batch_ids)
            )
        )


async def test_skip_locked_reparte_batches_completos_sin_solaparlos(pg_test_db) -> None:
    batch_a = uuid.uuid4()
    batch_b = uuid.uuid4()
    expected_sequences = {
        batch_a: [0, 1, 2],
        batch_b: [0, 1],
    }
    async with pg_test_db.engine.begin() as connection:
        await connection.execute(
            sa.insert(RealtimeOutboxModel),
            _outbox_rows(batch_a, 3) + _outbox_rows(batch_b, 2),
        )

    try:
        sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
        claim_at = datetime.now(UTC) + timedelta(seconds=1)
        async with sessions() as session_a, sessions() as session_b:
            transaction_a = await session_a.begin()
            transaction_b = await session_b.begin()
            try:
                claimed_a = await SqlAlchemyRealtimeOutbox(session_a).claim_next_batch(
                    claim_at
                )
                claimed_b = await SqlAlchemyRealtimeOutbox(session_b).claim_next_batch(
                    claim_at
                )

                claimed_a_batch = claimed_a[0].batch_id
                claimed_b_batch = claimed_b[0].batch_id
                assert claimed_a_batch != claimed_b_batch
                assert {claimed_a_batch, claimed_b_batch} == {batch_a, batch_b}
                assert [event.sequence for event in claimed_a] == expected_sequences[
                    claimed_a_batch
                ]
                assert [event.sequence for event in claimed_b] == expected_sequences[
                    claimed_b_batch
                ]
            finally:
                await transaction_b.rollback()
                await transaction_a.rollback()
    finally:
        await _delete_batches(pg_test_db, [batch_a, batch_b])


async def test_rollback_libera_el_batch_completo_para_otro_worker(pg_test_db) -> None:
    batch_id = uuid.uuid4()
    async with pg_test_db.engine.begin() as connection:
        await connection.execute(sa.insert(RealtimeOutboxModel), _outbox_rows(batch_id, 3))

    try:
        sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
        claim_at = datetime.now(UTC) + timedelta(seconds=1)
        async with sessions() as session_a, sessions() as session_b:
            transaction_a = await session_a.begin()
            transaction_b = await session_b.begin()
            try:
                outbox_a = SqlAlchemyRealtimeOutbox(session_a)
                outbox_b = SqlAlchemyRealtimeOutbox(session_b)
                claimed_a = await outbox_a.claim_next_batch(claim_at)
                assert [event.sequence for event in claimed_a] == [0, 1, 2]
                assert await outbox_b.claim_next_batch(claim_at) == []

                await transaction_a.rollback()
                reclaimed_b = await outbox_b.claim_next_batch(claim_at)
                assert [event.sequence for event in reclaimed_b] == [0, 1, 2]
                assert {event.batch_id for event in reclaimed_b} == {batch_id}
            finally:
                if transaction_b.is_active:
                    await transaction_b.rollback()
                if transaction_a.is_active:
                    await transaction_a.rollback()
    finally:
        await _delete_batches(pg_test_db, [batch_id])


async def test_upsert_concurrente_asigna_versiones_distintas(pg_test_db) -> None:
    aggregate_id = uuid.uuid4()
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)

    async def add_event(event_type: str) -> int:
        async with sessions() as session:
            saved = await SqlAlchemyRealtimeOutbox(session).add_batch(
                [
                    PendingRealtimeEvent(
                        event_type=event_type,
                        topic=f"ride:{aggregate_id}",
                        aggregate_type="ride",
                        aggregate_id=aggregate_id,
                        payload={"type": event_type, "data": {}},
                    )
                ]
            )
            await session.commit()
            return saved[0].aggregate_version

    try:
        versions = await asyncio.gather(
            add_event("offer_created"),
            add_event("offer_withdrawn"),
        )
        assert sorted(versions) == [1, 2]
    finally:
        async with pg_test_db.engine.begin() as connection:
            await connection.execute(
                sa.delete(RealtimeOutboxModel).where(
                    RealtimeOutboxModel.aggregate_id == aggregate_id
                )
            )
            await connection.execute(
                sa.delete(RealtimeAggregateVersionModel).where(
                    RealtimeAggregateVersionModel.aggregate_type == "ride",
                    RealtimeAggregateVersionModel.aggregate_id == aggregate_id,
                )
            )


async def test_rollback_no_consume_version_del_agregado(pg_test_db) -> None:
    aggregate_id = uuid.uuid4()
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    pending = PendingRealtimeEvent(
        event_type="offer_created",
        topic=f"ride:{aggregate_id}",
        aggregate_type="ride",
        aggregate_id=aggregate_id,
        payload={"type": "offer_created", "data": {}},
    )

    async with sessions() as session:
        rolled_back = await SqlAlchemyRealtimeOutbox(session).add_batch([pending])
        assert rolled_back[0].aggregate_version == 1
        await session.rollback()

    try:
        async with sessions() as session:
            persisted = await SqlAlchemyRealtimeOutbox(session).add_batch([pending])
            await session.commit()
        assert persisted[0].aggregate_version == 1
    finally:
        async with pg_test_db.engine.begin() as connection:
            await connection.execute(
                sa.delete(RealtimeOutboxModel).where(
                    RealtimeOutboxModel.aggregate_id == aggregate_id
                )
            )
            await connection.execute(
                sa.delete(RealtimeAggregateVersionModel).where(
                    RealtimeAggregateVersionModel.aggregate_type == "ride",
                    RealtimeAggregateVersionModel.aggregate_id == aggregate_id,
                )
            )
