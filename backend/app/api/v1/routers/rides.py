"""Endpoints de viajes: crear solicitud y listar destinos recientes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.deps import (
    CurrentUserDep,
    get_create_ride_request,
    get_list_recent_destinations,
)
from app.api.v1.schemas.rides import (
    CreateRideRequestRequest,
    RecentDestinationResponse,
    RideRequestResponse,
)
from app.application.dto import CreateRideRequestInput, LocationInput
from app.application.use_cases.create_ride_request import CreateRideRequest
from app.application.use_cases.list_recent_destinations import ListRecentDestinations

router = APIRouter(prefix="/rides", tags=["rides"])


def _to_location_input(point) -> LocationInput:
    return LocationInput(
        latitude=point.latitude,
        longitude=point.longitude,
        name=point.name,
        address=point.address,
    )


@router.post("", response_model=RideRequestResponse, status_code=status.HTTP_201_CREATED)
async def create_ride(
    body: CreateRideRequestRequest,
    current_user: CurrentUserDep,
    use_case: Annotated[CreateRideRequest, Depends(get_create_ride_request)],
) -> RideRequestResponse:
    ride = await use_case.execute(
        current_user.id,
        CreateRideRequestInput(
            origin=_to_location_input(body.origin),
            destination=_to_location_input(body.destination),
            service_type=body.service_type,
            fare=body.fare,
            payment_method=body.payment_method,
        ),
    )
    return RideRequestResponse.from_entity(ride)


@router.get("/recent-destinations", response_model=list[RecentDestinationResponse])
async def recent_destinations(
    current_user: CurrentUserDep,
    use_case: Annotated[ListRecentDestinations, Depends(get_list_recent_destinations)],
) -> list[RecentDestinationResponse]:
    locations = await use_case.execute(current_user.id)
    return [RecentDestinationResponse.from_location(loc) for loc in locations]
