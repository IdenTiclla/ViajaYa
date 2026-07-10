"""Pruebas focales de las garantías de persistencia de solicitudes."""

from __future__ import annotations

import uuid
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.exc import IntegrityError

from app.domain.entities import Location, RideRequest, ServiceType
from app.infrastructure.db.repositories import SqlAlchemyRideRequestRepository


def _integrity_error(message: str) -> IntegrityError:
    return IntegrityError("INSERT INTO ride_requests ...", {}, Exception(message))


def _ride() -> RideRequest:
    return RideRequest(
        rider_id=uuid.uuid4(),
        origin=Location(-16.5, -68.13, "Casa", "Calle 1"),
        destination=Location(-16.49, -68.14, "Trabajo", "Av. 2"),
        service_type=ServiceType.TAXI,
        fare=Decimal("25.00"),
    )


@pytest.mark.asyncio
async def test_add_if_no_active_maps_active_rider_unique_collision_to_none():
    session = AsyncMock()
    repository = SqlAlchemyRideRequestRepository(session)
    repository.get_active_by_rider = AsyncMock(return_value=None)  # type: ignore[method-assign]
    repository.add = AsyncMock(  # type: ignore[method-assign]
        side_effect=_integrity_error(
            "UNIQUE constraint failed: ride_requests.rider_id"
        )
    )

    result = await repository.add_if_no_active(_ride())

    assert result is None
    session.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_add_if_no_active_does_not_hide_other_integrity_errors():
    session = AsyncMock()
    repository = SqlAlchemyRideRequestRepository(session)
    repository.get_active_by_rider = AsyncMock(return_value=None)  # type: ignore[method-assign]
    error = _integrity_error("FOREIGN KEY constraint failed")
    repository.add = AsyncMock(side_effect=error)  # type: ignore[method-assign]

    with pytest.raises(IntegrityError) as captured:
        await repository.add_if_no_active(_ride())

    assert captured.value is error
    session.rollback.assert_awaited_once()
