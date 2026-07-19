"""Caso de uso: construir el snapshot realtime consistente del conductor."""

from __future__ import annotations

from app.application.dto import DriverRealtimeSnapshot
from app.application.interfaces import RealtimeSnapshotReader
from app.domain.entities import User, UserRole
from app.domain.exceptions import NotAuthorizedActionError


class BuildDriverRealtimeSnapshot:
    def __init__(self, snapshots: RealtimeSnapshotReader) -> None:
        self._snapshots = snapshots

    async def execute(self, driver: User) -> DriverRealtimeSnapshot:
        if driver.role is not UserRole.DRIVER or driver.vehicle_type is None:
            raise NotAuthorizedActionError(
                "Solo los conductores con vehículo pueden recuperar su snapshot."
            )

        streams = (
            f"pool:{driver.vehicle_type.value}",
            "pool:delivery",
            f"driver:{driver.id}",
        )
        snapshot = await self._snapshots.read_driver(driver.id, streams)
        if snapshot is None:
            raise NotAuthorizedActionError("El conductor ya no está disponible.")
        return snapshot
