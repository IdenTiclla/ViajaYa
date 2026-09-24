"""Driver endpoints: application, account mode, availability, active ride and earnings."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import (
    CurrentUserDep,
    get_driver_active_ride,
    get_get_driver_earnings,
    get_list_driver_vehicles,
    get_register_driver_vehicle,
    get_remove_driver_vehicle,
    get_set_driver_online,
    get_switch_account_mode,
)
from app.api.v1 import events
from app.api.v1.schemas.auth import UserResponse
from app.api.v1.schemas.drivers import (
    AccountModeRequest,
    DriverEarningsResponse,
    DriverVehicleRegistrationResponse,
    DriverVehicleRequest,
    DriverVehicleResponse,
    OnlineRequest,
)
from app.api.v1.schemas.rides import RideResponse
from app.application.use_cases.get_driver_active_ride import GetDriverActiveRide
from app.application.use_cases.get_driver_earnings import GetDriverEarnings
from app.application.use_cases.list_driver_vehicles import ListDriverVehicles
from app.application.use_cases.register_driver_vehicle import RegisterDriverVehicle
from app.application.use_cases.remove_driver_vehicle import RemoveDriverVehicle
from app.application.use_cases.set_driver_online import SetDriverOnline
from app.application.use_cases.switch_account_mode import SwitchAccountMode
from app.domain.entities import VehicleType

router = APIRouter(prefix="/drivers", tags=["drivers"])


@router.get("/me/vehicles", response_model=list[DriverVehicleResponse])
async def list_vehicles(
    current_user: CurrentUserDep,
    use_case: Annotated[ListDriverVehicles, Depends(get_list_driver_vehicles)],
) -> list[DriverVehicleResponse]:
    """Vehicles the account registered to drive with (taxi, moto and/or truck)."""
    vehicles = await use_case.execute(current_user)
    return [DriverVehicleResponse.from_entity(vehicle) for vehicle in vehicles]


@router.post("/me/vehicles", response_model=DriverVehicleRegistrationResponse)
async def register_vehicle(
    body: DriverVehicleRequest,
    current_user: CurrentUserDep,
    use_case: Annotated[RegisterDriverVehicle, Depends(get_register_driver_vehicle)],
) -> DriverVehicleRegistrationResponse:
    """Register or update the vehicle of that type and the services served with it.

    The account keeps its mode; ``user.driver_status`` aggregates the vehicles
    (``approved`` as soon as one is) and ``user.vehicle_type`` is the active one.
    """
    result = await use_case.execute(current_user, body.to_input())
    return DriverVehicleRegistrationResponse.from_dto(result)


@router.delete("/me/vehicles/{vehicle_type}", response_model=UserResponse)
async def remove_vehicle(
    vehicle_type: VehicleType,
    current_user: CurrentUserDep,
    use_case: Annotated[RemoveDriverVehicle, Depends(get_remove_driver_vehicle)],
) -> UserResponse:
    """Remove a vehicle (not the one in use while in driver mode)."""
    user = await use_case.execute(current_user, vehicle_type)
    return UserResponse.from_entity(user)


@router.post("/me/mode", response_model=UserResponse)
async def switch_account_mode(
    body: AccountModeRequest,
    current_user: CurrentUserDep,
    use_case: Annotated[SwitchAccountMode, Depends(get_switch_account_mode)],
) -> UserResponse:
    """Switch between passenger and driver mode, choosing the vehicle to drive with."""
    user = await use_case.execute(current_user, body.mode, body.vehicle_type)
    return UserResponse.from_entity(user)


@router.post("/me/online", response_model=UserResponse)
async def set_online(
    body: OnlineRequest,
    current_user: CurrentUserDep,
    use_case: Annotated[SetDriverOnline, Depends(get_set_driver_online)],
) -> UserResponse:
    """Toggle the driver's availability (online/offline)."""
    result = await use_case.execute(current_user, body.is_online)
    await events.publish_driver_offline_offers(result)
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
    """The driver's earnings summary (today, all-time and recent rides)."""
    summary = await use_case.execute(current_user)
    return DriverEarningsResponse.from_dto(summary)
