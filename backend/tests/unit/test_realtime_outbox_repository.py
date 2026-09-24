"""SQLite tests of the outbox repository and its unit of work."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.application.dto import PendingRealtimeEvent
from app.infrastructure.db.models import (
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
)
from app.infrastructure.db.outbox import SqlAlchemyRealtimeOutbox
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork


@pytest_asyncio.fixture
async def outbox_sessions() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(RealtimeAggregateVersionModel.__table__.create)
        await connection.run_sync(RealtimeStreamVersionModel.__table__.create)
        await connection.run_sync(RealtimeOutboxModel.__table__.create)
    try:
        yield factory
    finally:
        await engine.dispose()


def _pending(
    aggregate_id: uuid.UUID,
    event_type: str,
    *,
    aggregate_type: str = "ride",
    topic: str | None = None,
    correlation_id: uuid.UUID | None = None,
) -> PendingRealtimeEvent:
    return PendingRealtimeEvent(
        event_type=event_type,
        topic=topic or f"ride:{aggregate_id}",
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        correlation_id=correlation_id,
        payload={"type": event_type, "data": {"ride_id": str(aggregate_id)}},
    )


async def test_add_batch_asigna_lote_secuencia_y_versiones_consecutivas(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    ride_id = uuid.uuid4()
    driver_id = uuid.uuid4()
    pending = [
        _pending(ride_id, "offer_withdrawn"),
        _pending(ride_id, "offer_created"),
        _pending(driver_id, "driver_notice", aggregate_type="driver"),
    ]
    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        unit_of_work = SqlAlchemyUnitOfWork(session)
        saved = await outbox.add_batch(pending)
        await unit_of_work.commit()

    assert [event.sequence for event in saved] == [0, 1, 2]
    assert [event.batch_size for event in saved] == [3, 3, 3]
    assert len({event.batch_id for event in saved}) == 1
    assert len({event.correlation_id for event in saved}) == 1
    assert [event.aggregate_version for event in saved] == [1, 2, 1]
    assert [event.stream_version for event in saved] == [1, 2, 1]
    assert saved[1].payload["type"] == "offer_created"

    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        next_batch = await outbox.add_batch([_pending(ride_id, "offer_expired")])
        await SqlAlchemyUnitOfWork(session).commit()
    assert next_batch[0].aggregate_version == 3
    assert next_batch[0].stream_version == 3
    assert next_batch[0].batch_size == 1


async def test_add_batch_rejects_mixed_explicit_correlations(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    ride_id = uuid.uuid4()
    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)

        with pytest.raises(ValueError, match="mezcla correlation_id"):
            await outbox.add_batch(
                [
                    _pending(
                        ride_id,
                        "offer_withdrawn",
                        correlation_id=uuid.uuid4(),
                    ),
                    _pending(
                        ride_id,
                        "offer_created",
                        correlation_id=uuid.uuid4(),
                    ),
                ]
            )


async def test_add_batch_agrupa_y_reserva_las_claves_en_orden_determinista(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    first_ride_id = uuid.UUID(int=1)
    second_ride_id = uuid.UUID(int=2)
    first_topic = "pool:delivery"
    second_topic = "pool:taxi"

    async with outbox_sessions() as session:
        calls: list[tuple[str, str, int]] = []

        class RecordingOutbox(SqlAlchemyRealtimeOutbox):
            async def _reserve_aggregate_versions(
                self,
                aggregate_type: str,
                aggregate_id: uuid.UUID,
                count: int,
            ) -> int:
                calls.append(("aggregate", f"{aggregate_type}:{aggregate_id}", count))
                return await super()._reserve_aggregate_versions(
                    aggregate_type,
                    aggregate_id,
                    count,
                )

            async def _reserve_stream_versions(self, topic: str, count: int) -> int:
                calls.append(("stream", topic, count))
                return await super()._reserve_stream_versions(topic, count)

        saved = await RecordingOutbox(session).add_batch(
            [
                _pending(second_ride_id, "second_ride_created", topic=second_topic),
                _pending(first_ride_id, "first_ride_created", topic=second_topic),
                _pending(second_ride_id, "second_ride_closed", topic=first_topic),
                _pending(first_ride_id, "first_ride_closed", topic=first_topic),
            ]
        )
        await SqlAlchemyUnitOfWork(session).commit()

    assert calls == [
        ("aggregate", f"ride:{first_ride_id}", 2),
        ("aggregate", f"ride:{second_ride_id}", 2),
        ("stream", first_topic, 2),
        ("stream", second_topic, 2),
    ]
    assert [event.aggregate_version for event in saved] == [1, 1, 2, 2]
    assert [event.stream_version for event in saved] == [1, 2, 1, 2]


async def test_rollback_descarta_eventos_y_contadores(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    ride_id = uuid.uuid4()
    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        await outbox.add_batch([_pending(ride_id, "offer_created")])
        await SqlAlchemyUnitOfWork(session).rollback()

    async with outbox_sessions() as session:
        outbox_count = await session.scalar(select(func.count(RealtimeOutboxModel.id)))
        version_count = await session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        )
        stream_version_count = await session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        )
    assert outbox_count == 0
    assert version_count == 0
    assert stream_version_count == 0

    async with outbox_sessions() as session:
        saved = await SqlAlchemyRealtimeOutbox(session).add_batch(
            [_pending(ride_id, "offer_created")]
        )
        await SqlAlchemyUnitOfWork(session).commit()
    assert saved[0].aggregate_version == 1
    assert saved[0].stream_version == 1


async def test_claim_reintenta_el_lote_completo_y_luego_lo_marca_publicado(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    ride_id = uuid.uuid4()
    async with outbox_sessions() as session:
        created = await SqlAlchemyRealtimeOutbox(session).add_batch(
            [
                _pending(ride_id, "offer_withdrawn"),
                _pending(ride_id, "offer_created"),
            ]
        )
        await SqlAlchemyUnitOfWork(session).commit()

    claim_at = datetime.now(UTC) + timedelta(seconds=1)
    retry_at = claim_at + timedelta(minutes=1)
    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        claimed = await outbox.claim_next_batch(claim_at)
        assert [event.sequence for event in claimed] == [0, 1]
        assert [event.batch_size for event in claimed] == [2, 2]
        assert [event.attempts for event in claimed] == [1, 1]
        await outbox.mark_batch_failed(created[0].batch_id, "redis no disponible", retry_at)
        await SqlAlchemyUnitOfWork(session).commit()

    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        assert await outbox.claim_next_batch(retry_at - timedelta(microseconds=1)) == []
        await SqlAlchemyUnitOfWork(session).rollback()

    published_at = retry_at + timedelta(seconds=1)
    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        retried = await outbox.claim_next_batch(retry_at)
        assert [event.attempts for event in retried] == [2, 2]
        assert [event.last_error for event in retried] == [
            "redis no disponible",
            "redis no disponible",
        ]
        await outbox.mark_batch_published(created[0].batch_id, published_at)
        await SqlAlchemyUnitOfWork(session).commit()

    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        assert await outbox.claim_next_batch(published_at + timedelta(days=1)) == []
        rows = (
            await session.execute(
                select(RealtimeOutboxModel)
                .where(RealtimeOutboxModel.batch_id == created[0].batch_id)
                .order_by(RealtimeOutboxModel.sequence)
            )
        ).scalars().all()
    assert [row.attempts for row in rows] == [2, 2]
    assert [row.last_error for row in rows] == [None, None]
    assert all(row.published_at is not None for row in rows)


async def test_claim_no_adelanta_un_stream_bloqueado_y_deja_progresar_otro(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    blocked_ride_id = uuid.uuid4()
    independent_ride_id = uuid.uuid4()
    now = datetime.now(UTC) + timedelta(seconds=1)
    retry_at = now + timedelta(minutes=1)

    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        head = await outbox.add_batch([_pending(blocked_ride_id, "offer_created")])
        await SqlAlchemyUnitOfWork(session).commit()
    async with outbox_sessions() as session:
        await SqlAlchemyRealtimeOutbox(session).add_batch(
            [_pending(blocked_ride_id, "offer_withdrawn")]
        )
        await SqlAlchemyUnitOfWork(session).commit()
    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        claimed_head = await outbox.claim_next_batch(now)
        assert claimed_head[0].batch_id == head[0].batch_id
        await outbox.mark_batch_failed(head[0].batch_id, "contrato inválido", retry_at)
        await SqlAlchemyUnitOfWork(session).commit()

    async with outbox_sessions() as session:
        independent = await SqlAlchemyRealtimeOutbox(session).add_batch(
            [_pending(independent_ride_id, "offer_created")]
        )
        await SqlAlchemyUnitOfWork(session).commit()

    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        claimed_independent = await outbox.claim_next_batch(now)
        assert claimed_independent[0].batch_id == independent[0].batch_id
        await outbox.mark_batch_published(independent[0].batch_id, now)
        await SqlAlchemyUnitOfWork(session).commit()

    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        assert await outbox.claim_next_batch(now) == []
        retried_head = await outbox.claim_next_batch(retry_at)
        assert retried_head[0].batch_id == head[0].batch_id
        await outbox.mark_batch_published(head[0].batch_id, retry_at)
        await SqlAlchemyUnitOfWork(session).commit()

    async with outbox_sessions() as session:
        next_same_stream = await SqlAlchemyRealtimeOutbox(session).claim_next_batch(
            retry_at
        )
        assert next_same_stream[0].stream_version == 2
        await SqlAlchemyUnitOfWork(session).rollback()


async def test_quarantine_is_terminal_idempotent_and_unblocks_stream(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    ride_id = uuid.uuid4()
    now = datetime.now(UTC) + timedelta(seconds=1)
    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        head = await outbox.add_batch(
            [
                _pending(ride_id, "offer_withdrawn"),
                _pending(ride_id, "offer_created"),
            ]
        )
        await SqlAlchemyUnitOfWork(session).commit()
    async with outbox_sessions() as session:
        successor = await SqlAlchemyRealtimeOutbox(session).add_batch(
            [_pending(ride_id, "offer_expired")]
        )
        await SqlAlchemyUnitOfWork(session).commit()

    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        claimed = await outbox.claim_next_batch(now)
        assert claimed[0].batch_id == head[0].batch_id
        assert await outbox.mark_batch_quarantined(
            head[0].batch_id,
            "invalid_payload",
            now,
        ) == 2
        await SqlAlchemyUnitOfWork(session).commit()

    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        assert await outbox.mark_batch_quarantined(
            head[0].batch_id,
            "invalid_payload",
            now,
        ) == 0
        await outbox.mark_batch_published(head[0].batch_id, now)
        await SqlAlchemyUnitOfWork(session).commit()

    async with outbox_sessions() as session:
        rows = (
            await session.execute(
                select(RealtimeOutboxModel)
                .where(RealtimeOutboxModel.batch_id == head[0].batch_id)
                .order_by(RealtimeOutboxModel.sequence)
            )
        ).scalars().all()
        terminal_states = [
            (row.quarantined_at, row.quarantine_code, row.published_at)
            for row in rows
        ]
        claimed_successor = await SqlAlchemyRealtimeOutbox(session).claim_next_batch(now)
        await SqlAlchemyUnitOfWork(session).rollback()

    assert [
        (
            quarantined_at.replace(tzinfo=UTC) if quarantined_at else None,
            code,
            published_at,
        )
        for quarantined_at, code, published_at in terminal_states
    ] == [(now, "invalid_payload", None), (now, "invalid_payload", None)]
    assert claimed_successor[0].batch_id == successor[0].batch_id
    assert claimed_successor[0].stream_version == 3


async def test_quarantine_rollback_keeps_head_blocking_its_successor(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    ride_id = uuid.uuid4()
    now = datetime.now(UTC) + timedelta(seconds=1)
    async with outbox_sessions() as session:
        head = await SqlAlchemyRealtimeOutbox(session).add_batch(
            [_pending(ride_id, "offer_created")]
        )
        await SqlAlchemyUnitOfWork(session).commit()
    async with outbox_sessions() as session:
        await SqlAlchemyRealtimeOutbox(session).add_batch(
            [_pending(ride_id, "offer_withdrawn")]
        )
        await SqlAlchemyUnitOfWork(session).commit()

    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        claimed = await outbox.claim_next_batch(now)
        assert claimed[0].batch_id == head[0].batch_id
        assert await outbox.mark_batch_quarantined(
            head[0].batch_id,
            "invalid_payload",
            now,
        ) == 1
        await SqlAlchemyUnitOfWork(session).rollback()

    async with outbox_sessions() as session:
        claimed_again = await SqlAlchemyRealtimeOutbox(session).claim_next_batch(now)
        await SqlAlchemyUnitOfWork(session).rollback()

    assert claimed_again[0].batch_id == head[0].batch_id


async def test_published_batch_cannot_be_quarantined(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    ride_id = uuid.uuid4()
    now = datetime.now(UTC) + timedelta(seconds=1)
    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        saved = await outbox.add_batch([_pending(ride_id, "ride_closed")])
        await SqlAlchemyUnitOfWork(session).commit()
    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        await outbox.mark_batch_published(saved[0].batch_id, now)
        await SqlAlchemyUnitOfWork(session).commit()
    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        assert await outbox.mark_batch_quarantined(
            saved[0].batch_id,
            "invalid_payload",
            now,
        ) == 0
        await SqlAlchemyUnitOfWork(session).commit()

        row = await session.scalar(
            select(RealtimeOutboxModel).where(
                RealtimeOutboxModel.batch_id == saved[0].batch_id
            )
        )

    assert row is not None
    assert row.published_at is not None
    assert row.quarantined_at is None
    assert row.quarantine_code is None


async def test_terminal_state_constraints_reject_incomplete_or_mixed_quarantine(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    ride_id = uuid.uuid4()
    now = datetime.now(UTC) + timedelta(seconds=1)
    async with outbox_sessions() as session:
        saved = await SqlAlchemyRealtimeOutbox(session).add_batch(
            [_pending(ride_id, "ride_closed")]
        )
        await SqlAlchemyUnitOfWork(session).commit()

    async with outbox_sessions() as session:
        row = await session.scalar(
            select(RealtimeOutboxModel).where(
                RealtimeOutboxModel.batch_id == saved[0].batch_id
            )
        )
        assert row is not None
        row.quarantined_at = now
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()

    async with outbox_sessions() as session:
        row = await session.scalar(
            select(RealtimeOutboxModel).where(
                RealtimeOutboxModel.batch_id == saved[0].batch_id
            )
        )
        assert row is not None
        row.published_at = now
        row.quarantined_at = now
        row.quarantine_code = "invalid_payload"
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()


async def test_batch_size_constraints_reject_invalid_cardinality(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    ride_id = uuid.uuid4()
    async with outbox_sessions() as session:
        saved = await SqlAlchemyRealtimeOutbox(session).add_batch(
            [
                _pending(ride_id, "offer_withdrawn"),
                _pending(ride_id, "offer_created"),
            ]
        )
        await SqlAlchemyUnitOfWork(session).commit()

    async with outbox_sessions() as session:
        second = await session.scalar(
            select(RealtimeOutboxModel).where(
                RealtimeOutboxModel.id == saved[1].id
            )
        )
        assert second is not None
        second.batch_size = 1
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()

    async with outbox_sessions() as session:
        first = await session.scalar(
            select(RealtimeOutboxModel).where(
                RealtimeOutboxModel.id == saved[0].id
            )
        )
        assert first is not None
        first.batch_size = 0
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()


async def test_add_batch_rechaza_un_lote_vacio(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    async with outbox_sessions() as session:
        with pytest.raises(ValueError, match="no puede estar vacío"):
            await SqlAlchemyRealtimeOutbox(session).add_batch([])
