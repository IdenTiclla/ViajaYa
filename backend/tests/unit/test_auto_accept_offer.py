"""AutoAcceptOffer: accepts on the passenger's behalf only when the request allows it."""

from __future__ import annotations

import uuid
from dataclasses import replace
from decimal import Decimal

from app.application.use_cases.auto_accept_offer import AutoAcceptOffer
from app.domain.entities import (
    Location,
    Offer,
    RideRequest,
    RideStatus,
    ServiceType,
    User,
)
from app.domain.exceptions import DriverUnavailableError

_RIDER = User(full_name="Rider", email="rider@x.com")


def _ride(**changes) -> RideRequest:
    ride = RideRequest(
        rider_id=_RIDER.id,
        origin=Location(latitude=-16.5, longitude=-68.13, name="Casa", address="Calle 1"),
        destination=Location(latitude=-16.49, longitude=-68.14, name="Trabajo", address="Av. 2"),
        service_type=ServiceType.TAXI,
        fare=Decimal("25.00"),
        auto_accept=True,
    )
    return replace(ride, **changes)


class _Rides:
    def __init__(self, ride: RideRequest) -> None:
        self.ride = ride

    async def get_by_id(self, ride_id: uuid.UUID) -> RideRequest | None:
        return self.ride if ride_id == self.ride.id else None


class _Users:
    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        return _RIDER if user_id == _RIDER.id else None


class _Accept:
    def __init__(self, error: Exception | None = None) -> None:
        self.calls: list[tuple[User, uuid.UUID]] = []
        self._error = error

    async def execute(self, rider: User, offer_id: uuid.UUID) -> str:
        self.calls.append((rider, offer_id))
        if self._error is not None:
            raise self._error
        return "accepted"


def _offer(ride: RideRequest, price: str) -> Offer:
    return Offer(ride_id=ride.id, driver_id=uuid.uuid4(), price=Decimal(price))


async def test_accepts_an_offer_at_the_fare_as_the_passenger():
    ride = _ride()
    accept = _Accept()
    offer = _offer(ride, "25.00")

    result = await AutoAcceptOffer(_Rides(ride), _Users(), accept).execute(offer)

    assert result == "accepted"
    assert accept.calls == [(_RIDER, offer.id)]


async def test_leaves_offers_alone_when_the_passenger_decides():
    for ride, price in (
        (_ride(auto_accept=False), "25.00"),
        (_ride(), "30.00"),
        (_ride(paused=True), "25.00"),
        (_ride(status=RideStatus.CANCELLED), "25.00"),
    ):
        accept = _Accept()
        result = await AutoAcceptOffer(_Rides(ride), _Users(), accept).execute(
            _offer(ride, price)
        )
        assert result is None
        assert accept.calls == []


async def test_a_lost_race_keeps_the_offer_live():
    ride = _ride()
    accept = _Accept(DriverUnavailableError("El viaje ya no está disponible."))

    result = await AutoAcceptOffer(_Rides(ride), _Users(), accept).execute(_offer(ride, "25.00"))

    assert result is None
    assert len(accept.calls) == 1
