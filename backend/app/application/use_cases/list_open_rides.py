"""Caso de uso: listar solicitudes abiertas para un conductor."""

from __future__ import annotations

from app.application.dto import Page, PageCursor
from app.domain.entities import User
from app.domain.exceptions import DriverUnavailableError, NotAuthorizedActionError
from app.domain.repositories import OpenRideDetail, RideRequestRepository


class ListOpenRides:
    def __init__(self, rides: RideRequestRepository) -> None:
        self._rides = rides

    async def execute(
        self,
        driver: User,
        cursor: PageCursor | None = None,
        limit: int = 50,
    ) -> Page[OpenRideDetail]:
        if not driver.is_driver or driver.vehicle_type is None:
            raise NotAuthorizedActionError(
                "Solo los conductores con vehículo pueden ver las solicitudes abiertas."
            )
        if not driver.is_online:
            raise DriverUnavailableError("Debes estar en línea para ver solicitudes abiertas.")
        details = await self._rides.list_open_with_rider_for_services(
            driver.offered_services,
            driver_id=driver.id,
            before_created_at=cursor.created_at if cursor else None,
            before_id=cursor.id if cursor else None,
            limit=limit + 1,
        )
        has_more = len(details) > limit
        items = details[:limit]
        next_cursor = None
        if has_more and items:
            last = items[-1].ride
            if last.created_at is None:  # pragma: no cover - la BD no permite NULL
                raise ValueError("A persisted request must have created_at.")
            next_cursor = PageCursor(created_at=last.created_at, id=last.id)
        return Page(items=items, next_cursor=next_cursor)
