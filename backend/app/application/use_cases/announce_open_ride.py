"""Use case: announce a request once the passenger's presence is confirmed."""

from __future__ import annotations

import uuid

from app.application.interfaces import AnnounceOpenRideEventRecorder, UnitOfWork
from app.domain.repositories import OpenRideDetail, RideRequestRepository


class AnnounceOpenRide:
    """Re-validate and record ``ride_created`` in a single short transaction."""

    def __init__(
        self,
        rides: RideRequestRepository,
        unit_of_work: UnitOfWork,
        event_recorder: AnnounceOpenRideEventRecorder,
    ) -> None:
        self._rides = rides
        self._unit_of_work = unit_of_work
        self._event_recorder = event_recorder

    async def execute(self, ride_id: uuid.UUID) -> OpenRideDetail | None:
        try:
            detail = await self._rides.lock_open_ride_with_rider_for_announcement(
                ride_id
            )
            if detail is None:
                await self._unit_of_work.rollback()
                return None

            await self._event_recorder.record(detail)
            await self._unit_of_work.commit()
            return detail
        except BaseException:
            await self._unit_of_work.rollback()
            raise
