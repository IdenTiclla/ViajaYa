"""Capturas consistentes para el contrato WebSocket versionado."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import exists, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.application.dto import (
    DriverRealtimeSnapshot,
    OfferDetail,
    Page,
    PageCursor,
    PassengerRealtimeSnapshot,
    RealtimeStreamCheckpoint,
    RideDetail,
)
from app.application.interfaces import RealtimeSnapshotReader
from app.domain.entities import (
    OfferStatus,
    RideStatus,
    UserRole,
    VehicleType,
    services_for_vehicle,
    vehicle_can_serve,
)
from app.domain.repositories import OpenRideDetail, RiderSummary
from app.domain.ride_policy import is_offer_active
from app.infrastructure.db.models import (
    OfferModel,
    RealtimeStreamVersionModel,
    RideRequestModel,
    UserModel,
)
from app.infrastructure.db.repositories import (
    SqlAlchemyOfferRepository,
    SqlAlchemyRideReadRepository,
    SqlAlchemyRideRequestRepository,
    SqlAlchemyUserRepository,
    _offer_to_entity,
    _ride_to_entity,
    _to_entity,
)

_OPEN_RIDES_LIMIT = 50


def _as_utc(moment: datetime) -> datetime:
    """Normaliza el ``CURRENT_TIMESTAMP`` sin zona que devuelve SQLite."""
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment


class SqlAlchemyRealtimeSnapshotReader(RealtimeSnapshotReader):
    """Lee estado y watermarks dentro del mismo corte de PostgreSQL.

    El adaptador abre una sesión corta por captura. En PostgreSQL, la primera
    sentencia de la transacción fija ``REPEATABLE READ READ ONLY``; así una
    mutación concurrente nunca puede quedar ausente del estado pero incluida en
    sus watermarks. SQLite conserva su transacción normal para la suite rápida.

    La expiración es solo un filtro contra ``captured_at``: esta ruta nunca
    modifica ofertas ni ejecuta mantenimiento durante una captura.
    """

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    async def read_passenger(
        self,
        ride_id: uuid.UUID,
        streams: Sequence[str],
    ) -> PassengerRealtimeSnapshot | None:
        requested_streams = tuple(streams)
        expected_stream = f"ride:{ride_id}"
        if requested_streams != (expected_stream,):
            raise ValueError("El snapshot del pasajero requiere exactamente su stream de ride.")

        async with self._session_factory() as session, session.begin():
            await self._configure_transaction(session)
            captured_at = await self._captured_at(session)

            users = SqlAlchemyUserRepository(session)
            rides = SqlAlchemyRideRequestRepository(session)
            offers = SqlAlchemyOfferRepository(session)

            ride = await rides.get_by_id(ride_id)
            if ride is None:
                return None

            rider = await users.get_by_id(ride.rider_id)
            driver = await users.get_by_id(ride.driver_id) if ride.driver_id is not None else None
            accepted_offer = (
                await offers.get_by_id(ride.accepted_offer_id)
                if ride.accepted_offer_id is not None
                else None
            )

            offer_details = await self._read_passenger_offers(
                session,
                ride_id,
                captured_at,
            )

            watermarks = await self._read_watermarks(session, requested_streams)
            return PassengerRealtimeSnapshot(
                snapshot_id=uuid.uuid4(),
                ride=RideDetail(
                    ride=ride,
                    rider=rider,
                    driver=driver,
                    accepted_offer=accepted_offer,
                ),
                offers=offer_details,
                watermarks=watermarks,
                captured_at=captured_at,
            )

    async def read_driver(
        self,
        driver_id: uuid.UUID,
        streams: Sequence[str],
    ) -> DriverRealtimeSnapshot | None:
        requested_streams = tuple(streams)

        async with self._session_factory() as session, session.begin():
            await self._configure_transaction(session)
            captured_at = await self._captured_at(session)

            users = SqlAlchemyUserRepository(session)
            rides = SqlAlchemyRideRequestRepository(session)
            ride_reads = SqlAlchemyRideReadRepository(session)
            offers = SqlAlchemyOfferRepository(session)

            driver = await users.get_by_id(driver_id)
            if driver is None or driver.role is not UserRole.DRIVER or driver.vehicle_type is None:
                return None

            expected_streams = {
                f"pool:{driver.vehicle_type.value}",
                "pool:delivery",
                f"driver:{driver.id}",
            }
            if len(requested_streams) != 3 or set(requested_streams) != expected_streams:
                raise ValueError("Los streams no coinciden con el conductor capturado.")

            if driver.is_online:
                candidates = await rides.list_open_with_rider_for_vehicle(
                    driver.vehicle_type,
                    driver_id=driver.id,
                    limit=_OPEN_RIDES_LIMIT + 1,
                )
                open_rides = self._open_rides_page(candidates)
            else:
                open_rides = Page(items=[])

            paused_rides = await self._read_paused_rides(
                session,
                driver.id,
                driver.vehicle_type,
            )

            offer_details = [
                OfferDetail(offer=offer, driver=driver)
                for offer in await offers.list_active_by_driver(driver.id)
                if is_offer_active(offer, captured_at)
            ]

            active_detail = await ride_reads.get_active_for_driver(driver.id)
            if active_detail is not None and not vehicle_can_serve(
                active_detail.ride.service_type,
                driver.vehicle_type,
            ):
                raise ValueError(
                    "El viaje activo no pertenece a los pools del conductor capturado."
                )
            active_ride = (
                RideDetail(
                    ride=active_detail.ride,
                    rider=active_detail.rider,
                    driver=driver,
                    accepted_offer=active_detail.accepted_offer,
                )
                if active_detail is not None
                else None
            )

            watermarks = await self._read_watermarks(session, requested_streams)
            return DriverRealtimeSnapshot(
                snapshot_id=uuid.uuid4(),
                open_rides=open_rides,
                paused_rides=paused_rides,
                offers=offer_details,
                active_ride=active_ride,
                watermarks=watermarks,
                captured_at=captured_at,
            )

    async def _configure_transaction(self, session: AsyncSession) -> None:
        if session.get_bind().dialect.name == "postgresql":
            # Debe ser la primera sentencia SQL: PostgreSQL no permite cambiar el
            # aislamiento después de que la transacción haya leído una tabla.
            await session.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))

    async def _captured_at(self, session: AsyncSession) -> datetime:
        captured_at = await session.scalar(select(func.now()))
        if captured_at is None:  # pragma: no cover - los dialectos soportados lo devuelven
            raise RuntimeError("La base no devolvió el instante de captura.")
        return _as_utc(captured_at)

    async def _read_watermarks(
        self,
        session: AsyncSession,
        streams: Sequence[str],
    ) -> tuple[RealtimeStreamCheckpoint, ...]:
        rows = (
            await session.execute(
                select(
                    RealtimeStreamVersionModel.topic,
                    RealtimeStreamVersionModel.version,
                ).where(RealtimeStreamVersionModel.topic.in_(streams))
            )
        ).all()
        versions = {topic: int(version) for topic, version in rows}
        return tuple(
            RealtimeStreamCheckpoint(
                stream=stream,
                stream_version=versions.get(stream, 0),
            )
            for stream in streams
        )

    async def _read_passenger_offers(
        self,
        session: AsyncSession,
        ride_id: uuid.UUID,
        captured_at: datetime,
    ) -> list[OfferDetail]:
        """Carga ofertas vivas y su conductor en una sola consulta."""
        rows = (
            await session.execute(
                select(OfferModel, UserModel)
                .join(UserModel, UserModel.id == OfferModel.driver_id)
                .where(
                    OfferModel.ride_id == ride_id,
                    OfferModel.status == OfferStatus.PENDING,
                )
                .order_by(OfferModel.created_at.desc())
            )
        ).all()
        details: list[OfferDetail] = []
        for offer_row, driver_row in rows:
            offer = _offer_to_entity(offer_row)
            if is_offer_active(offer, captured_at):
                details.append(
                    OfferDetail(
                        offer=offer,
                        driver=_to_entity(driver_row),
                    )
                )
        return details

    async def _read_paused_rides(
        self,
        session: AsyncSession,
        driver_id: uuid.UUID,
        vehicle_type: VehicleType,
    ) -> list[OpenRideDetail]:
        """Carga rides pausados y resumen del pasajero sin consultas por fila."""
        trips_completed = (
            select(func.count(RideRequestModel.id))
            .where(
                RideRequestModel.rider_id == UserModel.id,
                RideRequestModel.status == RideStatus.COMPLETED,
            )
            .correlate(UserModel)
            .scalar_subquery()
        )
        offered_by_driver = exists(
            select(OfferModel.id).where(
                OfferModel.ride_id == RideRequestModel.id,
                OfferModel.driver_id == driver_id,
            )
        )
        rows = (
            await session.execute(
                select(RideRequestModel, UserModel, trips_completed)
                .join(UserModel, UserModel.id == RideRequestModel.rider_id)
                .where(
                    offered_by_driver,
                    RideRequestModel.service_type.in_(services_for_vehicle(vehicle_type)),
                    RideRequestModel.status == RideStatus.SEARCHING,
                    RideRequestModel.paused.is_(True),
                )
                .order_by(RideRequestModel.created_at.desc())
            )
        ).all()
        return [
            OpenRideDetail(
                ride=_ride_to_entity(ride_row),
                rider=RiderSummary(
                    full_name=rider_row.full_name,
                    rating=rider_row.rating,
                    trips_completed=int(trips or 0),
                ),
            )
            for ride_row, rider_row, trips in rows
        ]

    @staticmethod
    def _open_rides_page(candidates: list[OpenRideDetail]) -> Page[OpenRideDetail]:
        items = candidates[:_OPEN_RIDES_LIMIT]
        next_cursor = None
        if len(candidates) > _OPEN_RIDES_LIMIT and items:
            last = items[-1].ride
            if last.created_at is None:  # pragma: no cover - la BD no permite NULL
                raise ValueError("Una solicitud persistida debe tener created_at.")
            next_cursor = PageCursor(created_at=last.created_at, id=last.id)
        return Page(items=items, next_cursor=next_cursor)
