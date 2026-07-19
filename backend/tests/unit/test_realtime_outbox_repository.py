"""Pruebas SQLite del repositorio outbox y su unidad de trabajo."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.application.dto import PendingRealtimeEvent
from app.infrastructure.db.models import (
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
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
) -> PendingRealtimeEvent:
    return PendingRealtimeEvent(
        event_type=event_type,
        topic=f"ride:{aggregate_id}",
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        payload={"type": event_type, "data": {"ride_id": str(aggregate_id)}},
    )


async def test_add_batch_asigna_lote_secuencia_y_versiones_consecutivas(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    ride_id = uuid.uuid4()
    driver_id = uuid.uuid4()
    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        unit_of_work = SqlAlchemyUnitOfWork(session)
        saved = await outbox.add_batch(
            [
                _pending(ride_id, "offer_withdrawn"),
                _pending(ride_id, "offer_created"),
                _pending(driver_id, "driver_notice", aggregate_type="driver"),
            ]
        )
        await unit_of_work.commit()

    assert [event.sequence for event in saved] == [0, 1, 2]
    assert len({event.batch_id for event in saved}) == 1
    assert [event.aggregate_version for event in saved] == [1, 2, 1]
    assert saved[1].payload["type"] == "offer_created"

    async with outbox_sessions() as session:
        outbox = SqlAlchemyRealtimeOutbox(session)
        next_batch = await outbox.add_batch([_pending(ride_id, "offer_expired")])
        await SqlAlchemyUnitOfWork(session).commit()
    assert next_batch[0].aggregate_version == 3


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
    assert outbox_count == 0
    assert version_count == 0


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


async def test_add_batch_rechaza_un_lote_vacio(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    async with outbox_sessions() as session:
        with pytest.raises(ValueError, match="no puede estar vacío"):
            await SqlAlchemyRealtimeOutbox(session).add_batch([])
