"""Migración, backfill y concurrencia real de ``scheduled_actions``."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
import sqlalchemy as sa
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.application.dto import PendingScheduledAction
from app.application.use_cases.get_scheduled_actions_operational_snapshot import (
    GetScheduledActionsOperationalSnapshot,
)
from app.domain.entities import (
    Location,
    Offer,
    RideRequest,
    ServiceType,
    User,
    UserRole,
    VehicleType,
)
from app.domain.ride_policy import OFFER_TTL
from app.infrastructure.db.models import ScheduledActionModel
from app.infrastructure.db.repositories import SqlAlchemyOfferRepository
from app.infrastructure.db.scheduled_actions import (
    SqlAlchemyScheduledActionRepository,
)
from app.infrastructure.db.scheduled_actions_observability import (
    SqlAlchemyScheduledActionsOperationalReader,
)

_REVISION_0021 = "0021_realtime_outbox_batch_size"
_REVISION_0022 = "0022_scheduled_actions"


async def _table_exists(pg_test_db) -> bool:
    async with pg_test_db.engine.connect() as connection:
        return bool(
            await connection.scalar(
                sa.text("SELECT to_regclass('scheduled_actions') IS NOT NULL")
            )
        )


async def test_upgrade_backfill_y_downgrade_seguro_0022(pg_test_db) -> None:
    await pg_test_db.purge_accounts()
    await pg_test_db.migrate_async("downgrade", _REVISION_0021)
    user_ids: list[uuid.UUID] = []
    offer_id: uuid.UUID | None = None
    try:
        sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
        async with sessions() as session:
            rider = User(
                full_name="Pasajero backfill scheduler",
                email=f"rider-scheduler-{uuid.uuid4()}@test.com",
            )
            driver = User(
                full_name="Conductor backfill scheduler",
                email=f"driver-scheduler-{uuid.uuid4()}@test.com",
                role=UserRole.DRIVER,
                vehicle_type=VehicleType.TAXI,
                is_online=True,
            )
            # Seed only columns present at this historical migration revision.
            await session.execute(
                sa.text(
                    "INSERT INTO users "
                    "(id, full_name, email, role, vehicle_type, is_online, auth_provider) "
                    "VALUES (:id, :full_name, :email, :role, :vehicle_type, :is_online, 'local')"
                ),
                [
                    {
                        "id": user.id,
                        "full_name": user.full_name,
                        "email": user.email,
                        "role": user.role.value,
                        "vehicle_type": user.vehicle_type.value if user.vehicle_type else None,
                        "is_online": user.is_online,
                    }
                    for user in (rider, driver)
                ],
            )
            ride = RideRequest(
                rider_id=rider.id,
                origin=Location(-17.39, -66.15, "Origen", "Calle 1"),
                destination=Location(-17.40, -66.16, "Destino", "Calle 2"),
                service_type=ServiceType.TAXI,
                fare=Decimal("20.00"),
            )
            # Seed only columns present at this historical migration revision.
            await session.execute(
                sa.text(
                    "INSERT INTO ride_requests ("
                    "id, rider_id, "
                    "origin_latitude, origin_longitude, origin_name, origin_address, "
                    "destination_latitude, destination_longitude, "
                    "destination_name, destination_address, "
                    "service_type, fare, payment_method, status, paused, pool_version"
                    ") VALUES ("
                    ":id, :rider_id, "
                    ":origin_latitude, :origin_longitude, :origin_name, :origin_address, "
                    ":destination_latitude, :destination_longitude, "
                    ":destination_name, :destination_address, "
                    ":service_type, :fare, :payment_method, :status, :paused, :pool_version"
                    ")"
                ),
                {
                    "id": ride.id,
                    "rider_id": ride.rider_id,
                    "origin_latitude": ride.origin.latitude,
                    "origin_longitude": ride.origin.longitude,
                    "origin_name": ride.origin.name,
                    "origin_address": ride.origin.address,
                    "destination_latitude": ride.destination.latitude,
                    "destination_longitude": ride.destination.longitude,
                    "destination_name": ride.destination.name,
                    "destination_address": ride.destination.address,
                    "service_type": ride.service_type.value,
                    "fare": ride.fare,
                    "payment_method": ride.payment_method.value,
                    "status": ride.status.value,
                    "paused": ride.paused,
                    "pool_version": ride.pool_version,
                },
            )
            offer = await SqlAlchemyOfferRepository(session).add(
                Offer(
                    ride_id=ride.id,
                    driver_id=driver.id,
                    price=ride.fare,
                    eta_min=5,
                )
            )
            user_ids = [rider.id, driver.id]
            offer_id = offer.id

        await pg_test_db.migrate_async("upgrade", _REVISION_0022)
        assert await _table_exists(pg_test_db)

        async with pg_test_db.engine.connect() as connection:
            columns = {
                str(name): str(udt_name)
                for name, udt_name in (
                    await connection.execute(
                        sa.text(
                            """
                            SELECT column_name, udt_name
                            FROM information_schema.columns
                            WHERE table_schema = current_schema()
                              AND table_name = 'scheduled_actions'
                            """
                        )
                    )
                ).all()
            }
            assert columns["payload"] == "jsonb"
            assert columns["execute_at"] == "timestamptz"
            assert columns["next_attempt_at"] == "timestamptz"
            constraints = {
                str(name)
                for name in (
                    await connection.execute(
                        sa.text(
                            """
                            SELECT conname
                            FROM pg_constraint
                            WHERE conrelid = 'scheduled_actions'::regclass
                            """
                        )
                    )
                ).scalars()
            }
            assert {
                "ck_scheduled_actions_status",
                "ck_scheduled_actions_lease_complete",
                "ck_scheduled_actions_terminal_complete",
                "uq_scheduled_actions_dedupe_key",
            } <= constraints
            index_definitions = {
                str(name): " ".join(str(definition).lower().split())
                for name, definition in (
                    await connection.execute(
                        sa.text(
                            """
                            SELECT indexname, indexdef
                            FROM pg_indexes
                            WHERE schemaname = current_schema()
                              AND tablename = 'scheduled_actions'
                            """
                        )
                    )
                ).all()
            }
            assert "where ((status)::text = 'pending'::text)" in index_definitions[
                "ix_scheduled_actions_due"
            ]
            assert "where ((status)::text = 'running'::text)" in index_definitions[
                "ix_scheduled_actions_stale"
            ]

        async with sessions() as session:
            action = await session.scalar(
                select(ScheduledActionModel).where(
                    ScheduledActionModel.aggregate_id == offer_id
                )
            )
            assert action is not None
            assert action.dedupe_key == f"expire_offer:{offer_id}"
            assert action.action_type == "expire_offer"
            assert action.generation == 1
            assert action.status == "pending"
            assert action.payload == {"offer_id": str(offer_id)}
            offer_created_at = await session.scalar(
                sa.text("SELECT created_at FROM offers WHERE id = :offer_id"),
                {"offer_id": offer_id},
            )
            assert action.execute_at == offer_created_at + OFFER_TTL

        with pytest.raises(
            RuntimeError,
            match="trabajo pendiente o reclamado",
        ):
            await pg_test_db.migrate_async("downgrade", _REVISION_0021)
        assert await _table_exists(pg_test_db)

        async with sessions() as session:
            await session.execute(delete(ScheduledActionModel))
            await session.commit()

        await pg_test_db.migrate_async("downgrade", _REVISION_0021)
        assert not await _table_exists(pg_test_db)
    finally:
        if user_ids:
            async with pg_test_db.engine.begin() as connection:
                await connection.execute(
                    sa.text("DELETE FROM users WHERE id = ANY(:user_ids)"),
                    {"user_ids": user_ids},
                )
        await pg_test_db.migrate_async("upgrade", "head")


def _pending(key: str, execute_at: datetime) -> PendingScheduledAction:
    aggregate_id = uuid.uuid5(uuid.NAMESPACE_URL, key)
    return PendingScheduledAction(
        dedupe_key=key,
        action_type="expire_offer",
        aggregate_id=aggregate_id,
        generation=1,
        execute_at=execute_at,
        payload={"offer_id": str(aggregate_id)},
    )


async def test_skip_locked_reparte_acciones_sin_solaparlas(pg_test_db) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    now = datetime.now(UTC)
    keys = [f"expire_offer:{uuid.uuid4()}" for _ in range(2)]
    async with sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        for key in keys:
            await repository.schedule(_pending(key, now))
        await session.commit()

    action_ids: list[uuid.UUID] = []
    try:
        async with sessions() as first_session, sessions() as second_session:
            first_transaction = await first_session.begin()
            second_transaction = await second_session.begin()
            try:
                first = await SqlAlchemyScheduledActionRepository(
                    first_session
                ).claim_due(now, now - timedelta(minutes=1))
                second = await SqlAlchemyScheduledActionRepository(
                    second_session
                ).claim_due(now, now - timedelta(minutes=1))
                assert first is not None
                assert second is not None
                assert first.id != second.id
                action_ids.extend([first.id, second.id])
            finally:
                await second_transaction.rollback()
                await first_transaction.rollback()
    finally:
        async with pg_test_db.engine.begin() as connection:
            await connection.execute(
                delete(ScheduledActionModel).where(
                    ScheduledActionModel.dedupe_key.in_(keys)
                )
            )

    assert len(set(action_ids)) == 2


async def test_reclaim_invalida_el_token_del_worker_anterior(pg_test_db) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    now = datetime.now(UTC)
    key = f"expire_offer:{uuid.uuid4()}"
    try:
        async with sessions() as session:
            repository = SqlAlchemyScheduledActionRepository(session)
            await repository.schedule(_pending(key, now))
            await session.commit()

        async with sessions() as session:
            repository = SqlAlchemyScheduledActionRepository(session)
            first = await repository.claim_due(now, now - timedelta(minutes=1))
            assert first is not None and first.lock_token is not None
            await session.commit()

        reclaim_at = now + timedelta(minutes=2)
        async with sessions() as session:
            repository = SqlAlchemyScheduledActionRepository(session)
            second = await repository.claim_due(
                reclaim_at,
                now + timedelta(minutes=1),
            )
            assert second is not None and second.lock_token is not None
            assert second.lock_token != first.lock_token
            await session.commit()

        async with sessions() as session:
            repository = SqlAlchemyScheduledActionRepository(session)
            assert not await repository.mark_succeeded(
                first.id,
                first.generation,
                first.lock_token,
                reclaim_at,
            )
            assert await repository.mark_succeeded(
                second.id,
                second.generation,
                second.lock_token,
                reclaim_at,
            )
            await session.commit()
    finally:
        async with pg_test_db.engine.begin() as connection:
            await connection.execute(
                delete(ScheduledActionModel).where(
                    ScheduledActionModel.dedupe_key == key
                )
            )


async def test_snapshot_operativo_cuenta_due_y_lease_stale_en_postgresql(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    now = datetime.now(UTC)
    execute_at = now - timedelta(seconds=40)
    keys = [f"expire_offer:{uuid.uuid4()}" for _ in range(2)]
    try:
        async with sessions() as session:
            repository = SqlAlchemyScheduledActionRepository(session)
            for key in keys:
                await repository.schedule(_pending(key, execute_at))
            await session.commit()
            claimed = await repository.claim_due(
                execute_at,
                execute_at - timedelta(minutes=1),
            )
            assert claimed is not None
            await session.commit()

        async with sessions() as session:
            snapshot = await GetScheduledActionsOperationalSnapshot(
                SqlAlchemyScheduledActionsOperationalReader(session)
            ).execute(now, lease_seconds=30)

        assert snapshot.pending_count == 1
        assert snapshot.due_count == 1
        assert snapshot.running_count == 1
        assert snapshot.stale_count == 1
        assert snapshot.oldest_due_age_seconds >= 40
    finally:
        async with pg_test_db.engine.begin() as connection:
            await connection.execute(
                delete(ScheduledActionModel).where(
                    ScheduledActionModel.dedupe_key.in_(keys)
                )
            )
