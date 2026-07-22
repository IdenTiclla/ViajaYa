"""Expiración durable de ofertas sobre PostgreSQL y recuperación de restart."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api.deps import build_expire_offer, get_create_offer
from app.api.v1.scheduled_actions import ApplicationScheduledActionExecutor
from app.application.dto import CreateOfferInput
from app.domain.entities import (
    Location,
    OfferStatus,
    RideRequest,
    ServiceType,
    User,
    UserRole,
    VehicleType,
)
from app.domain.ride_policy import OFFER_TTL
from app.infrastructure.config import Settings
from app.infrastructure.db.models import (
    OfferModel,
    RealtimeOutboxModel,
    ScheduledActionModel,
)
from app.infrastructure.db.repositories import (
    SqlAlchemyRideRequestRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.db.scheduled_actions import (
    SqlAlchemyScheduledActionRepository,
)
from app.infrastructure.scheduled_actions.worker import ScheduledActionsWorker


def _settings(*, mode: str = "live") -> Settings:
    return Settings(
        _env_file=None,
        realtime_outbox_dispatch_mode="live_local",
        realtime_outbox_recording_enabled=True,
        scheduled_actions_mode=mode,
    )


async def _create_scheduled_offer(sessions, settings: Settings):
    async with sessions() as session:
        users = SqlAlchemyUserRepository(session)
        rider = await users.add(
            User(
                full_name="Pasajero scheduled PG",
                email=f"rider-scheduled-{uuid.uuid4()}@test.com",
            )
        )
        driver = await users.add(
            User(
                full_name="Conductor scheduled PG",
                email=f"driver-scheduled-{uuid.uuid4()}@test.com",
                role=UserRole.DRIVER,
                vehicle_type=VehicleType.TAXI,
                is_online=True,
            )
        )
        rides = SqlAlchemyRideRequestRepository(session)
        ride = await rides.add(
            RideRequest(
                rider_id=rider.id,
                origin=Location(-17.39, -66.15, "Origen", "Calle 1"),
                destination=Location(-17.40, -66.16, "Destino", "Calle 2"),
                service_type=ServiceType.TAXI,
                fare=Decimal("20.00"),
            )
        )
        result = await get_create_offer(rides, session, settings).execute(
            driver,
            ride.id,
            CreateOfferInput(accept_at_fare=True),
        )
        return rider, driver, ride, result.detail.offer


async def _make_due(sessions, offer_id: uuid.UUID, now: datetime) -> None:
    created_at = now - OFFER_TTL - timedelta(seconds=1)
    execute_at = created_at + OFFER_TTL
    async with sessions() as session:
        await session.execute(
            update(OfferModel)
            .where(OfferModel.id == offer_id)
            .values(created_at=created_at)
        )
        await session.execute(
            update(ScheduledActionModel)
            .where(ScheduledActionModel.aggregate_id == offer_id)
            .values(execute_at=execute_at, next_attempt_at=execute_at)
        )
        await session.commit()


def _worker(sessions, settings: Settings, now: datetime) -> ScheduledActionsWorker:
    return ScheduledActionsWorker(
        sessions,
        ApplicationScheduledActionExecutor(
            sessions,
            settings,
            clock=lambda: now,
        ),
        poll_interval_seconds=30,
        lease_seconds=30,
        handler_timeout_seconds=10,
        max_attempts=5,
        retry_base_seconds=1,
        retry_max_seconds=60,
        clock=lambda: now,
    )


async def _delete_action(sessions, offer_id: uuid.UUID) -> None:
    async with sessions() as session:
        await session.execute(
            delete(ScheduledActionModel).where(
                ScheduledActionModel.aggregate_id == offer_id
            )
        )
        await session.commit()


async def test_restart_despues_del_claim_recupera_y_expira_una_sola_vez(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    settings = _settings()
    _, _, ride, offer = await _create_scheduled_offer(sessions, settings)
    claim_at = datetime.now(UTC)
    await _make_due(sessions, offer.id, claim_at)
    try:
        # El primer proceso confirma el claim y muere antes de ejecutar.
        async with sessions() as session:
            claimed = await SqlAlchemyScheduledActionRepository(session).claim_due(
                claim_at,
                claim_at - timedelta(minutes=1),
            )
            assert claimed is not None
            await session.commit()

        restart_at = claim_at + timedelta(seconds=31)
        result = await _worker(sessions, settings, restart_at).dispatch_once()

        async with sessions() as session:
            offer_status = await session.scalar(
                select(OfferModel.status).where(OfferModel.id == offer.id)
            )
            action = await session.scalar(
                select(ScheduledActionModel).where(
                    ScheduledActionModel.aggregate_id == offer.id
                )
            )
            outbox_count = await session.scalar(
                select(func.count(RealtimeOutboxModel.id)).where(
                    RealtimeOutboxModel.aggregate_id == ride.id
                )
            )

        assert result.status == "succeeded"
        assert result.lease_recovered is True
        assert offer_status is OfferStatus.EXPIRED
        assert action is not None and action.status == "succeeded"
        assert action.attempts == 2
        # 1 evento de creación + fanout de 2 eventos de expiración.
        assert outbox_count == 3
    finally:
        await _delete_action(sessions, offer.id)


async def test_timer_shadow_y_worker_compiten_sin_duplicar_outbox(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    settings = _settings(mode="shadow")
    _, _, ride, offer = await _create_scheduled_offer(sessions, settings)
    now = datetime.now(UTC)
    await _make_due(sessions, offer.id, now)
    try:
        # El timer legado gana durante shadow.
        async with sessions() as session:
            expired = await build_expire_offer(session, settings).execute(offer.id)
            assert expired is not None

        # Al activar el worker, la acción converge como no-op exitoso.
        result = await _worker(sessions, settings, now).dispatch_once()

        async with sessions() as session:
            action_status = await session.scalar(
                select(ScheduledActionModel.status).where(
                    ScheduledActionModel.aggregate_id == offer.id
                )
            )
            outbox_count = await session.scalar(
                select(func.count(RealtimeOutboxModel.id)).where(
                    RealtimeOutboxModel.aggregate_id == ride.id
                )
            )
        assert result.status == "succeeded"
        assert action_status == "succeeded"
        assert outbox_count == 3
    finally:
        await _delete_action(sessions, offer.id)
