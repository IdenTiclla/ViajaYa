"""SQLAlchemy adapter for the driver's registered vehicles."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities import DriverVehicle, ServiceType, VehicleType
from app.domain.repositories import DriverVehicleRepository
from app.infrastructure.db.models import DriverVehicleModel

_TYPE_ORDER = list(VehicleType)


def _vehicle_order(vehicle: DriverVehicle) -> int:
    """Stable taxi → moto → truck order (the enum order), shared with the app."""

    return _TYPE_ORDER.index(vehicle.vehicle_type)


def _to_entity(row: DriverVehicleModel) -> DriverVehicle:
    return DriverVehicle(
        id=row.id,
        user_id=row.user_id,
        vehicle_type=row.vehicle_type,
        plate=row.plate,
        vehicle_model=row.vehicle_model,
        services=tuple(ServiceType(value) for value in row.services),
        status=row.status,
        created_at=row.created_at,
    )


class SqlAlchemyDriverVehicleRepository(DriverVehicleRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_by_user(self, user_id: uuid.UUID) -> list[DriverVehicle]:
        result = await self._session.execute(
            select(DriverVehicleModel).where(DriverVehicleModel.user_id == user_id)
        )
        vehicles = [_to_entity(row) for row in result.scalars().all()]
        return sorted(vehicles, key=_vehicle_order)

    async def get(self, user_id: uuid.UUID, vehicle_type: VehicleType) -> DriverVehicle | None:
        result = await self._session.execute(
            select(DriverVehicleModel).where(
                DriverVehicleModel.user_id == user_id,
                DriverVehicleModel.vehicle_type == vehicle_type,
            )
        )
        row = result.scalar_one_or_none()
        return _to_entity(row) if row else None

    async def save(self, vehicle: DriverVehicle) -> DriverVehicle:
        row = await self._session.get(DriverVehicleModel, vehicle.id)
        if row is None:
            row = DriverVehicleModel(id=vehicle.id, user_id=vehicle.user_id)
            self._session.add(row)
        row.vehicle_type = vehicle.vehicle_type
        row.plate = vehicle.plate
        row.vehicle_model = vehicle.vehicle_model
        row.services = [service.value for service in vehicle.services]
        row.status = vehicle.status
        await self._session.commit()
        await self._session.refresh(row)
        return _to_entity(row)

    async def delete(self, vehicle: DriverVehicle) -> None:
        row = await self._session.get(DriverVehicleModel, vehicle.id)
        if row is not None:
            await self._session.delete(row)
            await self._session.commit()
