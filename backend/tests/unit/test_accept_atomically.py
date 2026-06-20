"""Tests de la "regla de oro": despacho atómico al aceptar una oferta.

El pasajero tiene la decisión final: al aceptar una oferta ``PENDING`` se asigna
el viaje al conductor en una transacción atómica. Las demás ofertas vivas del
conductor en **otros** viajes se retiran, y si el viaje ya fue asignado (carrera)
el despacho devuelve ``None`` → 409.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from app.application.dto import CreateOfferInput
from app.application.use_cases.accept_offer import AcceptOffer
from app.application.use_cases.create_offer import CreateOffer
from app.domain.entities import (
    Location,
    OfferStatus,
    RideRequest,
    ServiceType,
    User,
    UserRole,
)
from tests.fakes import (
    InMemoryOfferRepository,
    InMemoryRideRequestRepository,
    InMemoryUserRepository,
)

_LOC = Location(-16.5, -68.13, "Casa", "Calle 1")
_DEST = Location(-16.49, -68.14, "Trabajo", "Av. 2")


def _passenger() -> User:
    return User(full_name="Pasa", email=f"p-{uuid.uuid4().hex[:6]}@x.com", role=UserRole.PASSENGER)


def _driver() -> User:
    return User(
        full_name="Condu",
        email=f"d-{uuid.uuid4().hex[:6]}@x.com",
        role=UserRole.DRIVER,
        vehicle_type=ServiceType.TAXI,
    )


def _ride(rider_id: uuid.UUID) -> RideRequest:
    return RideRequest(
        rider_id=rider_id,
        origin=_LOC,
        destination=_DEST,
        service_type=ServiceType.TAXI,
        fare=Decimal("25.00"),
    )


def _wire() -> tuple:
    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    return rides, users, offers


async def test_accept_withdraws_drivers_other_offers():
    """El conductor oferta a dos pasajeros; al ganar uno, su oferta al otro se retira."""
    rides, users, offers = _wire()
    rider_a, rider_b, driver = _passenger(), _passenger(), _driver()
    await users.add(driver)
    ride_a = await rides.add(_ride(rider_a.id))
    ride_b = await rides.add(_ride(rider_b.id))

    offer_a = await CreateOffer(rides, offers).execute(
        driver, ride_a.id, CreateOfferInput(accept_at_fare=True)
    )
    offer_b = await CreateOffer(rides, offers).execute(
        driver, ride_b.id, CreateOfferInput(accept_at_fare=True)
    )

    # El pasajero A acepta: el conductor se le asigna.
    result = await AcceptOffer(rides, offers).execute(rider_a, offer_a.detail.offer.id)

    assert result.detail.ride.driver_id == driver.id
    # La oferta del conductor al pasajero B se retiró y B aparece en la lista.
    assert ride_b.id in result.withdrawn_ride_ids
    assert (await offers.get_by_id(offer_b.detail.offer.id)).status is OfferStatus.REJECTED


async def test_accept_returns_none_when_ride_already_assigned():
    """Carrera: el ride ya fue asignado por un accept previo; el segundo aborta."""
    rides, users, offers = _wire()
    rider, d1, d2 = _passenger(), _driver(), _driver()
    await users.add(d1)
    await users.add(d2)
    ride = await rides.add(_ride(rider.id))

    o1 = await CreateOffer(rides, offers).execute(
        d1, ride.id, CreateOfferInput(accept_at_fare=True)
    )
    o2 = await CreateOffer(rides, offers).execute(
        d2, ride.id, CreateOfferInput(accept_at_fare=True)
    )

    # El primer accept asigna el ride (y rechaza o2 en la misma transacción).
    await AcceptOffer(rides, offers).execute(rider, o1.detail.offer.id)

    # Reabrimos o2 como PENDING para simular la ventana previa al check atómico:
    # el ride ya está ACCEPTED → accept_atomically devuelve None.
    (await offers.get_by_id(o2.detail.offer.id)).status = OfferStatus.PENDING

    acceptance = await offers.accept_atomically(o2.detail.offer.id)
    assert acceptance is None
