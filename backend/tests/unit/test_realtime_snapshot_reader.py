"""Pruebas SQLite del corte de lectura para snapshots realtime."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.domain.entities import (
    OfferStatus,
    PaymentMethod,
    RideStatus,
    ServiceType,
    UserRole,
    VehicleType,
)
from app.infrastructure.db.base import Base
from app.infrastructure.db.models import (
    OfferModel,
    RealtimeStreamVersionModel,
    RideRequestModel,
    UserModel,
)
from app.infrastructure.db.realtime_snapshots import SqlAlchemyRealtimeSnapshotReader


@pytest_asyncio.fixture
async def snapshot_db() -> AsyncIterator[tuple[async_sessionmaker[AsyncSession], AsyncEngine]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield sessions, engine
    finally:
        await engine.dispose()


def _user(
    email: str,
    *,
    role: UserRole = UserRole.PASSENGER,
    vehicle_type: VehicleType | None = None,
    is_online: bool = False,
) -> UserModel:
    return UserModel(
        id=uuid.uuid4(),
        full_name=email.split("@")[0],
        email=email,
        role=role,
        vehicle_type=vehicle_type,
        is_online=is_online,
    )


def _ride(
    rider_id: uuid.UUID,
    *,
    service_type: ServiceType = ServiceType.TAXI,
    status: RideStatus = RideStatus.SEARCHING,
    paused: bool = False,
    driver_id: uuid.UUID | None = None,
) -> RideRequestModel:
    return RideRequestModel(
        id=uuid.uuid4(),
        rider_id=rider_id,
        origin_latitude=-16.5,
        origin_longitude=-68.13,
        origin_name="Origen",
        origin_address="Calle 1",
        destination_latitude=-16.49,
        destination_longitude=-68.14,
        destination_name="Destino",
        destination_address="Calle 2",
        service_type=service_type,
        fare=Decimal("25.00"),
        payment_method=PaymentMethod.CASH,
        status=status,
        paused=paused,
        driver_id=driver_id,
    )


async def test_passenger_captura_estado_watermark_y_no_expira_ofertas(
    snapshot_db: tuple[async_sessionmaker[AsyncSession], AsyncEngine],
) -> None:
    sessions, engine = snapshot_db
    rider = _user(f"rider-{uuid.uuid4()}@test.local")
    live_driver = _user(
        f"driver-live-{uuid.uuid4()}@test.local",
        role=UserRole.DRIVER,
        vehicle_type=VehicleType.TAXI,
    )
    expired_driver = _user(
        f"driver-expired-{uuid.uuid4()}@test.local",
        role=UserRole.DRIVER,
        vehicle_type=VehicleType.TAXI,
    )
    ride = _ride(rider.id)
    live_offer = OfferModel(
        ride_id=ride.id,
        driver_id=live_driver.id,
        price=Decimal("27.00"),
        eta_min=4,
        status=OfferStatus.PENDING,
        created_at=datetime.now(UTC),
    )
    expired_offer = OfferModel(
        ride_id=ride.id,
        driver_id=expired_driver.id,
        price=Decimal("28.00"),
        eta_min=5,
        status=OfferStatus.PENDING,
        created_at=datetime.now(UTC) - timedelta(seconds=31),
    )
    topic = f"ride:{ride.id}"

    async with sessions.begin() as session:
        session.add_all(
            [
                rider,
                live_driver,
                expired_driver,
                ride,
                live_offer,
                expired_offer,
                RealtimeStreamVersionModel(topic=topic, version=7),
            ]
        )

    statements: list[str] = []

    def record_statement(_conn, _cursor, statement, _parameters, _context, _many) -> None:
        statements.append(statement.strip().upper())

    event.listen(engine.sync_engine, "before_cursor_execute", record_statement)
    try:
        snapshot = await SqlAlchemyRealtimeSnapshotReader(sessions).read_passenger(
            ride.id,
            (topic,),
        )
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record_statement)

    assert snapshot is not None
    assert snapshot.snapshot_id.version == 4
    assert snapshot.ride.ride.id == ride.id
    assert snapshot.ride.rider is not None
    assert snapshot.ride.rider.id == rider.id
    assert [detail.offer.id for detail in snapshot.offers] == [live_offer.id]
    assert [(item.stream, item.stream_version) for item in snapshot.watermarks] == [(topic, 7)]
    assert snapshot.captured_at.tzinfo is not None
    assert statements
    assert len(statements) == 5
    assert all(not sql.startswith(("INSERT", "UPDATE", "DELETE")) for sql in statements)

    async with sessions() as session:
        persisted = await session.scalar(
            select(OfferModel.status).where(OfferModel.id == expired_offer.id)
        )
    assert persisted is OfferStatus.PENDING


async def test_driver_unifica_estado_y_rellena_watermarks_ausentes_con_cero(
    snapshot_db: tuple[async_sessionmaker[AsyncSession], AsyncEngine],
) -> None:
    sessions, _engine = snapshot_db
    driver = _user(
        f"driver-{uuid.uuid4()}@test.local",
        role=UserRole.DRIVER,
        vehicle_type=VehicleType.TAXI,
        is_online=True,
    )
    open_rider = _user(f"open-{uuid.uuid4()}@test.local")
    paused_rider = _user(f"paused-{uuid.uuid4()}@test.local")
    incompatible_rider = _user(f"incompatible-{uuid.uuid4()}@test.local")
    open_ride = _ride(open_rider.id)
    paused_ride = _ride(paused_rider.id, paused=True)
    incompatible_paused_ride = _ride(
        incompatible_rider.id,
        service_type=ServiceType.MOTO,
        paused=True,
    )
    live_offer = OfferModel(
        ride_id=open_ride.id,
        driver_id=driver.id,
        price=Decimal("27.00"),
        eta_min=4,
        status=OfferStatus.PENDING,
        created_at=datetime.now(UTC),
    )
    paused_offer = OfferModel(
        ride_id=paused_ride.id,
        driver_id=driver.id,
        price=Decimal("26.00"),
        eta_min=3,
        status=OfferStatus.REJECTED,
        created_at=datetime.now(UTC),
    )
    incompatible_offer = OfferModel(
        ride_id=incompatible_paused_ride.id,
        driver_id=driver.id,
        price=Decimal("26.00"),
        eta_min=3,
        status=OfferStatus.REJECTED,
        created_at=datetime.now(UTC),
    )
    streams = (
        f"pool:{driver.vehicle_type.value}",
        "pool:delivery",
        f"driver:{driver.id}",
    )

    async with sessions.begin() as session:
        session.add_all(
            [
                driver,
                open_rider,
                paused_rider,
                incompatible_rider,
                open_ride,
                paused_ride,
                incompatible_paused_ride,
                live_offer,
                paused_offer,
                incompatible_offer,
                RealtimeStreamVersionModel(topic=streams[0], version=4),
            ]
        )

    snapshot = await SqlAlchemyRealtimeSnapshotReader(sessions).read_driver(
        driver.id,
        streams,
    )

    assert snapshot is not None
    assert snapshot.snapshot_id.version == 4
    assert [detail.ride.id for detail in snapshot.open_rides.items] == [open_ride.id]
    assert [detail.ride.id for detail in snapshot.paused_rides] == [paused_ride.id]
    assert [detail.offer.id for detail in snapshot.offers] == [live_offer.id]
    assert snapshot.active_ride is None
    assert [(item.stream, item.stream_version) for item in snapshot.watermarks] == [
        (streams[0], 4),
        (streams[1], 0),
        (streams[2], 0),
    ]
