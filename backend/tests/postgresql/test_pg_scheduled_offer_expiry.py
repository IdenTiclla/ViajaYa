"""Durable offer expiry on PostgreSQL and restart recovery."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import (
    build_expire_offer_and_complete_scheduled_action,
    get_create_offer,
)
from app.api.v1.scheduled_actions import ApplicationScheduledActionExecutor
from app.application.dto import CreateOfferInput
from app.application.use_cases.reconcile_missing_scheduled_actions import (
    ReconcileMissingScheduledActions,
)
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
from app.infrastructure.db.scheduled_actions_reconciliation import (
    SqlAlchemyMissingOfferScheduledActionsReconciler,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork
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


def _worker(
    sessions,
    settings: Settings,
    now: datetime,
) -> ScheduledActionsWorker:
    async def fixed_clock(_session: AsyncSession) -> datetime:
        return now

    return ScheduledActionsWorker(
        sessions,
        ApplicationScheduledActionExecutor(
            sessions,
            settings,
            clock=fixed_clock,
        ),
        poll_interval_seconds=30,
        lease_seconds=30,
        handler_timeout_seconds=10,
        max_attempts=5,
        retry_base_seconds=1,
        retry_max_seconds=60,
        clock=fixed_clock,
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
        # The first process confirms the claim and dies before running it.
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
        # 1 creation event + a fan-out of 2 expiry events.
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
            expired = await build_expire_offer_and_complete_scheduled_action(
                session,
                settings,
            ).execute(offer.id, now)
            assert expired is not None

        # The worker no longer claims the action completed by the timer.
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
        assert result.status == "empty"
        assert action_status == "succeeded"
        assert outbox_count == 3
    finally:
        await _delete_action(sessions, offer.id)


async def test_oferta_creada_off_se_recupera_al_promover_a_shadow(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    off_settings = Settings(_env_file=None, scheduled_actions_mode="off")
    _, _, _, offer = await _create_scheduled_offer(sessions, off_settings)
    now = datetime.now(UTC)
    await _make_due(sessions, offer.id, now)
    shadow_settings = Settings(
        _env_file=None,
        realtime_outbox_dispatch_mode="shadow",
        realtime_outbox_recording_enabled=True,
        scheduled_actions_mode="shadow",
    )
    try:
        result = await _worker(sessions, shadow_settings, now).dispatch_once()

        async with sessions() as session:
            offer_status = await session.scalar(
                select(OfferModel.status).where(OfferModel.id == offer.id)
            )
            action_status = await session.scalar(
                select(ScheduledActionModel.status).where(
                    ScheduledActionModel.aggregate_id == offer.id
                )
            )

        assert result.status == "succeeded"
        assert offer_status is OfferStatus.EXPIRED
        assert action_status == "succeeded"
    finally:
        await _delete_action(sessions, offer.id)


async def test_shadow_reconcilia_oferta_creada_despues_del_backfill(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    settings = _settings(mode="shadow")
    _, _, _, offer = await _create_scheduled_offer(sessions, settings)
    now = datetime.now(UTC)
    await _delete_action(sessions, offer.id)
    async with sessions() as session:
        await session.execute(
            update(OfferModel)
            .where(OfferModel.id == offer.id)
            .values(created_at=now - OFFER_TTL - timedelta(seconds=1))
        )
        await session.commit()

    try:
        async with sessions() as session:
            reconciled = await ReconcileMissingScheduledActions(
                SqlAlchemyMissingOfferScheduledActionsReconciler(session),
                SqlAlchemyUnitOfWork(session),
            ).execute(1000)
            await session.execute(
                delete(ScheduledActionModel).where(
                    ScheduledActionModel.aggregate_id != offer.id
                )
            )
            await session.commit()

        result = await _worker(sessions, settings, now).dispatch_once()

        async with sessions() as session:
            offer_status = await session.scalar(
                select(OfferModel.status).where(OfferModel.id == offer.id)
            )
            action = await session.scalar(
                select(ScheduledActionModel).where(
                    ScheduledActionModel.aggregate_id == offer.id
                )
            )

        assert result.status == "succeeded"
        assert reconciled >= 1
        assert offer_status is OfferStatus.EXPIRED
        assert action is not None and action.status == "succeeded"
    finally:
        await _delete_action(sessions, offer.id)
