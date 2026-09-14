"""Caso de uso: un conductor crea una oferta (aceptar, contraofertar o mejorar).

Si el conductor ya tiene una oferta ``PENDING`` en el viaje, la nueva la
**reemplaza** (mejorar la oferta): la anterior pasa a ``REJECTED`` y se devuelve
su id para que la capa API retire la tarjeta vieja de la pantalla del pasajero.
"""

from __future__ import annotations

import uuid

from app.application.dto import (
    CreateOfferInput,
    CreateOfferResult,
    OfferDetail,
    PendingScheduledAction,
)
from app.application.interfaces import (
    CreateOfferEventRecorder,
    ScheduledActionScheduler,
    UnitOfWork,
)
from app.domain.entities import Offer, RideStatus, User, driver_can_serve
from app.domain.exceptions import (
    DriverUnavailableError,
    InvalidFareError,
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    RideNotFoundError,
)
from app.domain.repositories import OfferRepository, RideRequestRepository
from app.domain.ride_policy import offer_expires_at
from app.domain.value_objects import FareOffer


class CreateOffer:
    def __init__(
        self,
        rides: RideRequestRepository,
        offers: OfferRepository,
        unit_of_work: UnitOfWork,
        event_recorder: CreateOfferEventRecorder,
        scheduled_actions: ScheduledActionScheduler | None = None,
    ) -> None:
        self._rides = rides
        self._offers = offers
        self._unit_of_work = unit_of_work
        self._event_recorder = event_recorder
        self._scheduled_actions = scheduled_actions

    async def execute(
        self, driver: User, ride_id: uuid.UUID, data: CreateOfferInput
    ) -> CreateOfferResult:
        try:
            result = await self._mutate(driver, ride_id, data)
            await self._event_recorder.record(result)
            await self._schedule_expiration(result)
            await self._unit_of_work.commit()
            return result
        except BaseException:
            await self._unit_of_work.rollback()
            raise

    async def _schedule_expiration(self, result: CreateOfferResult) -> None:
        if self._scheduled_actions is None:
            return
        offer = result.detail.offer
        execute_at = offer_expires_at(offer)
        if execute_at is None:  # pragma: no cover - persistencia exige created_at
            raise RuntimeError("La oferta persistida no tiene fecha de creación.")
        await self._scheduled_actions.schedule(
            PendingScheduledAction(
                dedupe_key=f"expire_offer:{offer.id}",
                action_type="expire_offer",
                aggregate_id=offer.id,
                generation=1,
                execute_at=execute_at,
                payload={"offer_id": str(offer.id)},
            )
        )

    async def _mutate(
        self, driver: User, ride_id: uuid.UUID, data: CreateOfferInput
    ) -> CreateOfferResult:
        if not driver.is_driver or driver.vehicle_type is None:
            raise NotAuthorizedActionError("Solo los conductores con vehículo pueden ofertar.")
        if not driver.is_online:
            raise DriverUnavailableError("Debes estar en línea para enviar ofertas.")

        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if ride.status is not RideStatus.SEARCHING:
            raise InvalidRideTransitionError("La solicitud ya no admite ofertas.")
        if ride.paused:
            raise InvalidRideTransitionError("La solicitud está siendo modificada.")
        if not driver_can_serve(driver, ride.service_type):
            raise NotAuthorizedActionError("Tu vehículo no coincide con el servicio solicitado.")

        active_rides = await self._rides.list_by_driver(driver.id)
        if any(
            active.status in {RideStatus.ACCEPTED, RideStatus.ARRIVING, RideStatus.IN_PROGRESS}
            for active in active_rides
        ):
            raise DriverUnavailableError("Ya tienes un viaje activo.")

        if data.accept_at_fare:
            # Aceptar al precio del pasajero.
            price = ride.fare
        else:
            # Contraoferta: precio propio validado (> 0).
            if data.price is None:
                raise InvalidFareError("La contraoferta requiere un precio.")
            price = FareOffer(data.price).amount

        offer = Offer(
            ride_id=ride.id,
            driver_id=driver.id,
            price=price,
            eta_min=data.eta_min,
        )
        creation = await self._offers.create_or_supersede_atomically(
            offer,
            expected_ride_fare=ride.fare,
        )
        if creation is None:
            raise DriverUnavailableError(
                "La solicitud o tu disponibilidad cambiaron; actualiza e inténtalo de nuevo."
            )
        return CreateOfferResult(
            detail=OfferDetail(offer=creation.offer, driver=driver),
            superseded_offer_id=creation.superseded_offer_id,
        )
