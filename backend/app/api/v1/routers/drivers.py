"""Endpoints del conductor: disponibilidad en línea."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import (
    CurrentUserDep,
    get_driver_active_ride,
    get_get_driver_earnings,
    get_set_driver_online,
)
from app.api.v1 import events
from app.api.v1.schemas.auth import UserResponse
from app.api.v1.schemas.drivers import DriverEarningsResponse, OnlineRequest
from app.api.v1.schemas.rides import RideResponse
from app.application.use_cases.get_driver_active_ride import GetDriverActiveRide
from app.application.use_cases.get_driver_earnings import GetDriverEarnings
from app.application.use_cases.set_driver_online import SetDriverOnline

router = APIRouter(prefix="/drivers", tags=["drivers"])


@router.post("/me/online", response_model=UserResponse)
async def set_online(
    body: OnlineRequest,
    current_user: CurrentUserDep,
    use_case: Annotated[SetDriverOnline, Depends(get_set_driver_online)],
) -> UserResponse:
    """Alterna la disponibilidad del conductor (en línea/desconectado)."""
    result = await use_case.execute(current_user, body.is_online)
    await events.publish_driver_offline_offers(
        result.driver.id, result.withdrawn_offers
    )
    return UserResponse.from_entity(result.driver)


@router.get("/me/active-ride", response_model=RideResponse | None)
async def active_ride(
    current_user: CurrentUserDep,
    use_case: Annotated[GetDriverActiveRide, Depends(get_driver_active_ride)],
) -> RideResponse | None:
    """Viaje en curso asignado al conductor, o ``null`` si no tiene ninguno."""
    detail = await use_case.execute(current_user)
    return RideResponse.from_detail(detail) if detail is not None else None


@router.get("/me/earnings", response_model=DriverEarningsResponse)
async def earnings(
    current_user: CurrentUserDep,
    use_case: Annotated[GetDriverEarnings, Depends(get_get_driver_earnings)],
) -> DriverEarningsResponse:
    """Resumen de ganancias del conductor (hoy, histórico y viajes recientes)."""
    summary = await use_case.execute(current_user)
    return DriverEarningsResponse.from_dto(summary)
