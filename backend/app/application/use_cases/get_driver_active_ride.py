"""Use case: the driver's active ride (to know whether they were already chosen)."""

from __future__ import annotations

from app.application.dto import RideDetail
from app.application.interfaces import RideReadRepository
from app.domain.entities import User
from app.domain.exceptions import NotAuthorizedActionError


class GetDriverActiveRide:
    def __init__(self, ride_reads: RideReadRepository) -> None:
        self._ride_reads = ride_reads

    async def execute(self, driver: User) -> RideDetail | None:
        if not driver.is_driver:
            raise NotAuthorizedActionError("Solo los conductores tienen viajes asignados.")

        detail = await self._ride_reads.get_active_for_driver(driver.id)
        if detail is None:
            return None

        return RideDetail(
            ride=detail.ride,
            rider=detail.rider,
            driver=driver,
            accepted_offer=detail.accepted_offer,
        )
