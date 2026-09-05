"""Garantías del reloj autoritativo usado por ofertas y scheduler."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.application.dto import PendingScheduledAction
from app.domain.entities import OfferStatus, RideStatus
from app.domain.ride_policy import OFFER_TTL
from app.infrastructure.db.clock import database_utc_now
from app.infrastructure.db.models import (
    OfferModel,
    RideRequestModel,
    ScheduledActionModel,
)
from app.infrastructure.db.repositories import SqlAlchemyOfferRepository
from app.infrastructure.db.scheduled_actions import (
    SqlAlchemyScheduledActionRepository,
)
from tests.postgresql.test_pg_expire_offer import _insert_scenario


def _pending(execute_at: datetime) -> PendingScheduledAction:
    aggregate_id = uuid.uuid4()
    return PendingScheduledAction(
        dedupe_key=f"expire_offer:{aggregate_id}",
        action_type="expire_offer",
        aggregate_id=aggregate_id,
        generation=1,
        execute_at=execute_at,
        payload={"offer_id": str(aggregate_id)},
    )


async def test_clock_timestamp_no_queda_fijado_al_inicio_de_transaccion(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    async with sessions() as session:
        transaction_started_at = await session.scalar(select(func.now()))
        await session.execute(text("SELECT pg_sleep(0.02)"))

        actual = await database_utc_now(session)

        assert transaction_started_at is not None
        assert actual > transaction_started_at


async def test_terminal_at_del_scheduler_ignora_reloj_del_proceso_en_postgresql(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    supplied_at = datetime(2000, 1, 1, tzinfo=UTC)
    async with sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        now = await database_utc_now(session)
        scheduled = await repository.schedule(_pending(now))
        await session.commit()
        claimed = await repository.claim_due(now, now - timedelta(minutes=1))
        assert claimed is not None and claimed.lock_token is not None
        await session.commit()

        assert await repository.mark_succeeded(
            claimed.id,
            claimed.generation,
            claimed.lock_token,
            supplied_at,
        )
        await session.commit()

        terminal_at = await session.scalar(
            select(ScheduledActionModel.terminal_at).where(
                ScheduledActionModel.id == scheduled.id
            )
        )

    assert terminal_at is not None
    assert terminal_at > supplied_at


async def test_reloj_de_expiracion_se_lee_despues_del_row_lock(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    _, _, _, offer = await _insert_scenario(sessions, expired=False)
    clock_called = asyncio.Event()

    async def expired_clock(_session: AsyncSession) -> datetime:
        clock_called.set()
        return datetime.now(UTC) + timedelta(minutes=1)

    async with sessions() as locking_session, sessions() as expiring_session:
        locked = await locking_session.scalar(
            select(OfferModel)
            .where(OfferModel.id == offer.id)
            .with_for_update()
        )
        assert locked is not None

        expiration = asyncio.create_task(
            SqlAlchemyOfferRepository(
                expiring_session,
                clock=expired_clock,
            ).mark_expired_if_pending(offer.id)
        )
        try:
            await asyncio.sleep(0.05)
            assert not clock_called.is_set()
            await locking_session.commit()
            expired = await asyncio.wait_for(expiration, timeout=2)
        finally:
            if not expiration.done():
                expiration.cancel()
                await asyncio.gather(expiration, return_exceptions=True)
            await locking_session.rollback()

    assert clock_called.is_set()
    assert expired is not None


async def test_aceptacion_revalida_ttl_con_reloj_autoritativo(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    _, _, ride, offer = await _insert_scenario(sessions, expired=False)
    assert offer.created_at is not None

    async def database_after_deadline(_session: AsyncSession) -> datetime:
        return offer.created_at + OFFER_TTL + timedelta(seconds=1)

    async with sessions() as session:
        acceptance = await SqlAlchemyOfferRepository(
            session,
            clock=database_after_deadline,
        ).accept_atomically(offer.id)

    async with sessions() as session:
        offer_status = await session.scalar(
            select(OfferModel.status).where(OfferModel.id == offer.id)
        )
        ride_status = await session.scalar(
            select(RideRequestModel.status).where(RideRequestModel.id == ride.id)
        )

    assert acceptance is None
    assert offer_status is OfferStatus.EXPIRED
    assert ride_status is RideStatus.SEARCHING
