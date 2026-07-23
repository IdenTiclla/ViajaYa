"""Fencing y aplazamiento de cancel_absent_ride durable."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from app.api.v1.realtime_outbox import DisabledCancelRideEventRecorder
from app.application.dto import (
    PassengerPresenceObservation,
    RenewableScheduledAction,
    ScheduledAction,
)
from app.application.exceptions import PassengerPresenceUnavailableError
from app.application.use_cases.execute_cancel_absent_ride_scheduled_action import (
    ExecuteCancelAbsentRideScheduledAction,
)
from app.domain.entities import Location, RideRequest, RideStatus, ServiceType, User
from tests.fakes import (
    InMemoryOfferRepository,
    InMemoryRideRequestRepository,
    InMemoryUserRepository,
)

_LOCK_TOKEN = uuid.UUID(int=1)


class _UnitOfWork:
    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1


class _Actions:
    def __init__(self) -> None:
        self.owned = True
        self.completed = True
        self.renewed: RenewableScheduledAction | None = None

    async def lock_owned(self, *_args) -> bool:
        return self.owned

    async def schedule_next(
        self,
        action: RenewableScheduledAction,
    ) -> ScheduledAction:
        self.renewed = action
        return _action(generation=2, status="pending", lock_token=None)

    async def mark_succeeded(self, *_args) -> bool:
        return self.completed


class _Leases:
    def __init__(
        self,
        observation: PassengerPresenceObservation | None = None,
        *,
        unavailable: bool = False,
    ) -> None:
        self.observation = observation or PassengerPresenceObservation(
            live=False,
            present=False,
            retry_after_seconds=0,
        )
        self.unavailable = unavailable

    async def observe(self, _ride_id: uuid.UUID) -> PassengerPresenceObservation:
        if self.unavailable:
            raise PassengerPresenceUnavailableError("sin Redis")
        return self.observation


def _ride() -> RideRequest:
    return RideRequest(
        rider_id=uuid.uuid4(),
        origin=Location(-16.5, -68.13, "Casa", "Calle 1"),
        destination=Location(-16.49, -68.14, "Trabajo", "Av. 2"),
        service_type=ServiceType.TAXI,
        fare=Decimal("25.00"),
    )


def _action(
    ride_id: uuid.UUID | None = None,
    *,
    generation: int = 1,
    status: str = "running",
    lock_token: uuid.UUID | None = _LOCK_TOKEN,
) -> ScheduledAction:
    ride_id = ride_id or uuid.uuid4()
    now = datetime.now(UTC)
    return ScheduledAction(
        id=uuid.uuid4(),
        dedupe_key=f"cancel_absent_ride:{ride_id}",
        action_type="cancel_absent_ride",
        aggregate_id=ride_id,
        generation=generation,
        execute_at=now,
        payload={"ride_id": str(ride_id)},
        status=status,  # type: ignore[arg-type]
        attempts=1,
        next_attempt_at=now,
        locked_at=now if status == "running" else None,
        lock_token=lock_token,
        last_error=None,
        terminal_at=None,
        created_at=now,
        updated_at=now,
    )


async def _subject(leases: _Leases):
    ride = _ride()
    rides = InMemoryRideRequestRepository()
    await rides.add(ride)
    offers = InMemoryOfferRepository(rides=rides)
    users = InMemoryUserRepository()
    await users.add(User(id=ride.rider_id, full_name="Pasajero", email="p@x.com"))
    actions = _Actions()
    unit_of_work = _UnitOfWork()
    use_case = ExecuteCancelAbsentRideScheduledAction(
        offers,
        users,
        actions,  # type: ignore[arg-type]
        unit_of_work,
        DisabledCancelRideEventRecorder(),
        leases,  # type: ignore[arg-type]
        unavailable_recheck_seconds=5,
    )
    return ride, actions, unit_of_work, use_case


async def test_presencia_viva_aplaza_sin_consumir_intentos() -> None:
    ride, actions, unit_of_work, use_case = await _subject(
        _Leases(
            PassengerPresenceObservation(
                live=True,
                present=True,
                retry_after_seconds=40,
            )
        )
    )

    result = await use_case.execute(_action(ride.id), datetime.now(UTC))

    assert result.status == "deferred"
    assert ride.status is RideStatus.SEARCHING
    assert actions.renewed is not None
    assert actions.renewed.action_type == "cancel_absent_ride"
    assert unit_of_work.commits == 1


async def test_redis_caido_aplaza_en_lugar_de_agotar_la_accion() -> None:
    ride, actions, unit_of_work, use_case = await _subject(
        _Leases(unavailable=True)
    )

    result = await use_case.execute(_action(ride.id), datetime.now(UTC))

    assert result.status == "deferred"
    assert ride.status is RideStatus.SEARCHING
    assert actions.renewed is not None
    assert unit_of_work.commits == 1


async def test_ausencia_confirmada_cancela_y_completa_la_accion() -> None:
    ride, actions, unit_of_work, use_case = await _subject(_Leases())

    result = await use_case.execute(_action(ride.id), datetime.now(UTC))

    assert result.status == "succeeded"
    assert result.cancelled_ride is not None
    assert result.cancelled_ride.ride.status is RideStatus.CANCELLED
    assert actions.renewed is None
    assert unit_of_work.commits == 1


async def test_lease_revocado_impide_tocar_el_viaje() -> None:
    ride, actions, unit_of_work, use_case = await _subject(_Leases())
    actions.owned = False

    result = await use_case.execute(_action(ride.id), datetime.now(UTC))

    assert result.status == "lost_lease"
    assert ride.status is RideStatus.SEARCHING
    assert unit_of_work.rollbacks == 1


async def test_generacion_renovada_antes_del_ack_revierte_el_cierre() -> None:
    ride, actions, unit_of_work, use_case = await _subject(_Leases())
    actions.completed = False

    result = await use_case.execute(_action(ride.id), datetime.now(UTC))

    assert result.status == "lost_lease"
    assert result.cancelled_ride is None
    assert unit_of_work.rollbacks == 1
    # PostgreSQL cubre que este rollback revierta también la mutación del ride.
