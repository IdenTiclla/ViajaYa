"""Upload and recover authorized live trip positions."""

from uuid import UUID

from fastapi import APIRouter

from app.api.deps import CurrentUserDep, GetDriverLocationDep, ReportDriverLocationDep
from app.api.v1.schemas.driver_location import (
    DriverLocationInput,
    DriverLocationReportResponse,
    DriverLocationResponse,
)

router = APIRouter(prefix="/rides", tags=["driver-location"])


@router.put("/{ride_id}/driver-location", response_model=DriverLocationReportResponse)
async def report_location(
    ride_id: UUID,
    body: DriverLocationInput,
    user: CurrentUserDep,
    report: ReportDriverLocationDep,
) -> DriverLocationReportResponse:
    accepted = await report.execute(user, ride_id, **body.model_dump())
    return DriverLocationReportResponse(accepted=accepted)


@router.get("/{ride_id}/driver-location", response_model=DriverLocationResponse | None)
async def get_location(
    ride_id: UUID,
    user: CurrentUserDep,
    get: GetDriverLocationDep,
) -> DriverLocationResponse | None:
    location = await get.execute(user, ride_id)
    return DriverLocationResponse.from_location(location) if location else None
