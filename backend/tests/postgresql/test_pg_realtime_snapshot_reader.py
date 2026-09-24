"""PostgreSQL certification of the consistent realtime snapshot cut."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Sequence
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.domain.entities import PaymentMethod, RideStatus, ServiceType, UserRole
from app.infrastructure.db.models import (
    RealtimeStreamVersionModel,
    RideRequestModel,
    UserModel,
)
from app.infrastructure.db.realtime_snapshots import SqlAlchemyRealtimeSnapshotReader


class _PausingSnapshotReader(SqlAlchemyRealtimeSnapshotReader):
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        super().__init__(sessions)
        self.state_read = asyncio.Event()
        self.resume = asyncio.Event()

    async def _read_watermarks(
        self,
        session: AsyncSession,
        streams: Sequence[str],
    ):
        self.state_read.set()
        await self.resume.wait()
        return await super()._read_watermarks(session, streams)


async def _cleanup(pg_test_db, rider_id: uuid.UUID, ride_id: uuid.UUID, topic: str) -> None:
    async with pg_test_db.engine.begin() as connection:
        await connection.execute(
            sa.delete(RealtimeStreamVersionModel).where(RealtimeStreamVersionModel.topic == topic)
        )
        await connection.execute(sa.delete(RideRequestModel).where(RideRequestModel.id == ride_id))
        await connection.execute(sa.delete(UserModel).where(UserModel.id == rider_id))


async def test_snapshot_usa_repeatable_read_read_only_antes_de_cualquier_lectura(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    rider_id = uuid.uuid4()
    ride_id = uuid.uuid4()
    topic = f"ride:{ride_id}"

    async with sessions.begin() as session:
        session.add(
            UserModel(
                id=rider_id,
                full_name="Pasajero snapshot",
                email=f"snapshot-{rider_id}@test.local",
                role=UserRole.PASSENGER,
            )
        )
        # These models do not declare an ORM relationship between them; the flush
        # makes explicit that the ride's FK always sees the passenger first.
        await session.flush()
        session.add(
            RideRequestModel(
                id=ride_id,
                rider_id=rider_id,
                origin_latitude=-16.5,
                origin_longitude=-68.13,
                origin_name="Origen",
                origin_address="Calle 1",
                destination_latitude=-16.49,
                destination_longitude=-68.14,
                destination_name="Destino",
                destination_address="Calle 2",
                service_type=ServiceType.TAXI,
                fare=Decimal("25.00"),
                payment_method=PaymentMethod.CASH,
                status=RideStatus.SEARCHING,
                paused=False,
            )
        )
        session.add(RealtimeStreamVersionModel(topic=topic, version=1))

    reader = _PausingSnapshotReader(sessions)
    statements: list[str] = []

    def record_statement(_conn, _cursor, statement, _parameters, _context, _many) -> None:
        statements.append(" ".join(statement.split()).upper())

    event.listen(pg_test_db.engine.sync_engine, "before_cursor_execute", record_statement)
    try:
        capture_task = asyncio.create_task(reader.read_passenger(ride_id, (topic,)))
        await reader.state_read.wait()

        assert statements[0] == ("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")

        async with sessions.begin() as writer:
            await writer.execute(
                sa.update(RideRequestModel)
                .where(RideRequestModel.id == ride_id)
                .values(fare=Decimal("30.00"))
            )
            await writer.execute(
                sa.update(RealtimeStreamVersionModel)
                .where(RealtimeStreamVersionModel.topic == topic)
                .values(version=2)
            )

        reader.resume.set()
        snapshot = await capture_task
    finally:
        event.remove(pg_test_db.engine.sync_engine, "before_cursor_execute", record_statement)

    try:
        assert snapshot is not None
        assert snapshot.ride.ride.fare == Decimal("25.00")
        assert snapshot.watermarks[0].stream_version == 1

        async with sessions() as session:
            current_fare = await session.scalar(
                sa.select(RideRequestModel.fare).where(RideRequestModel.id == ride_id)
            )
            current_version = await session.scalar(
                sa.select(RealtimeStreamVersionModel.version).where(
                    RealtimeStreamVersionModel.topic == topic
                )
            )
        assert current_fare == Decimal("30.00")
        assert current_version == 2
    finally:
        await _cleanup(pg_test_db, rider_id, ride_id, topic)
