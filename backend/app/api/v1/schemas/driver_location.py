"""GPS snapshots have a separate ephemeral contract from negotiation events."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from app.domain.driver_location import DriverLocation


class DriverLocationInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_meters: float = Field(ge=0, le=100)
    heading: float | None = Field(default=None, ge=0, lt=360)
    captured_at: AwareDatetime


class DriverLocationResponse(DriverLocationInput):
    ride_id: UUID
    driver_id: UUID
    received_at: datetime

    @classmethod
    def from_location(cls, location: DriverLocation) -> "DriverLocationResponse":
        return cls.model_validate(location, from_attributes=True)


class DriverLocationReportResponse(BaseModel):
    accepted: bool


class DriverLocationMessage(BaseModel):
    type: Literal["driver_location"] = "driver_location"
    data: DriverLocationResponse | None
