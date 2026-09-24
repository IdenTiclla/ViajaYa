"""Use case: build the passenger's consistent realtime snapshot."""

from __future__ import annotations

import uuid

from app.application.dto import PassengerRealtimeSnapshot
from app.application.interfaces import RealtimeSnapshotReader
from app.domain.entities import User, UserRole
from app.domain.exceptions import NotAuthorizedActionError, RideNotFoundError


class BuildPassengerRealtimeSnapshot:
    def __init__(self, snapshots: RealtimeSnapshotReader) -> None:
        self._snapshots = snapshots

    async def execute(
        self,
        passenger: User,
        ride_id: uuid.UUID,
    ) -> PassengerRealtimeSnapshot:
        if passenger.role is not UserRole.PASSENGER:
            raise NotAuthorizedActionError(
                "Solo los pasajeros pueden recuperar el snapshot de su viaje."
            )

        streams = (f"ride:{ride_id}",)
        snapshot = await self._snapshots.read_passenger(ride_id, streams)
        if snapshot is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if snapshot.ride.ride.rider_id != passenger.id:
            raise NotAuthorizedActionError("No puedes recuperar el snapshot de este viaje.")
        return snapshot
