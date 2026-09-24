"""Pydantic schemas of the offers API (HTTP contract).

Separate from the domain entities.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator

from app.api.v1.schemas.datetimes import UtcAwareDatetime
from app.application.dto import OfferDetail
from app.domain.entities import OfferStatus, VehicleType
from app.domain.ride_policy import offer_expires_at


class OfferCreate(BaseModel):
    """A driver's offer: accept at the passenger's price or counter-offer.

    If ``accept_at_fare`` is ``True``, ``price`` is ignored (the ride's is used).
    If it is ``False`` (counter-offer), ``price`` is required.
    """

    accept_at_fare: bool = True
    price: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    eta_min: int | None = Field(default=None, ge=0, le=240)
    expected_pool_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _require_price_on_counteroffer(self) -> OfferCreate:
        if not self.accept_at_fare and self.price is None:
            raise ValueError("La contraoferta requiere un precio.")
        return self


class OfferDriverSchema(BaseModel):
    """Public data of the driver making the offer."""

    id: uuid.UUID
    full_name: str
    rating: float | None
    vehicle_type: VehicleType | None
    plate: str | None
    vehicle_model: str | None


class OfferResponse(BaseModel):
    id: uuid.UUID
    ride_id: uuid.UUID
    price: Decimal
    eta_min: int | None
    status: OfferStatus
    driver: OfferDriverSchema
    created_at: UtcAwareDatetime | None
    # When the offer expires (created_at + 30 s); drives the countdown.
    expires_at: UtcAwareDatetime | None

    @classmethod
    def from_detail(cls, detail: OfferDetail) -> OfferResponse:
        offer, driver = detail.offer, detail.driver
        return cls(
            id=offer.id,
            ride_id=offer.ride_id,
            price=offer.price,
            eta_min=offer.eta_min,
            status=offer.status,
            driver=OfferDriverSchema(
                id=driver.id,
                full_name=driver.full_name,
                rating=driver.rating,
                vehicle_type=driver.vehicle_type,
                plate=driver.plate,
                vehicle_model=driver.vehicle_model,
            ),
            created_at=offer.created_at,
            expires_at=offer_expires_at(offer),
        )
