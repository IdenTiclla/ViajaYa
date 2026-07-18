"""Pruebas de las proyecciones SQL de lectura de viajes."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import event

from app.domain.entities import (
    AuthProvider,
    OfferStatus,
    PaymentMethod,
    RideStatus,
    ServiceType,
    UserRole,
    VehicleType,
)
from app.infrastructure.db.models import (
    OfferModel,
    RideRatingModel,
    RideRequestModel,
    UserModel,
)
from app.infrastructure.db.repositories import SqlAlchemyRideReadRepository


def _user(*, user_id: uuid.UUID, email: str, role: UserRole) -> UserModel:
    return UserModel(
        id=user_id,
        full_name=email.split("@")[0],
        email=email,
        auth_provider=AuthProvider.LOCAL,
        role=role,
        vehicle_type=VehicleType.TAXI if role is UserRole.DRIVER else None,
        is_online=role is UserRole.DRIVER,
    )


def _ride(
    *,
    ride_id: uuid.UUID,
    rider_id: uuid.UUID,
    driver_id: uuid.UUID | None,
    status: RideStatus,
    fare: str,
    destination: str,
    created_at: datetime,
    completed_at: datetime | None = None,
    accepted_offer_id: uuid.UUID | None = None,
) -> RideRequestModel:
    return RideRequestModel(
        id=ride_id,
        rider_id=rider_id,
        origin_latitude=-16.5,
        origin_longitude=-68.13,
        origin_name="Origen",
        origin_address="Calle 1",
        destination_latitude=-16.49,
        destination_longitude=-68.14,
        destination_name=destination,
        destination_address="Avenida 2",
        service_type=ServiceType.TAXI,
        fare=Decimal(fare),
        payment_method=PaymentMethod.CASH,
        status=status,
        driver_id=driver_id,
        accepted_offer_id=accepted_offer_id,
        paused=False,
        pool_version=1,
        created_at=created_at,
        completed_at=completed_at,
    )


async def _seed(session_factory) -> dict[str, uuid.UUID]:
    rider_id = uuid.uuid4()
    driver_id = uuid.uuid4()
    completed_with_offer_id = uuid.uuid4()
    completed_at_fare_id = uuid.uuid4()
    cancelled_id = uuid.uuid4()
    active_id = uuid.uuid4()
    completed_offer_id = uuid.uuid4()
    active_offer_id = uuid.uuid4()

    async with session_factory() as session:
        session.add_all(
            [
                _user(
                    user_id=rider_id,
                    email="pasajero-lecturas@example.com",
                    role=UserRole.PASSENGER,
                ),
                _user(
                    user_id=driver_id,
                    email="conductor-lecturas@example.com",
                    role=UserRole.DRIVER,
                ),
                _ride(
                    ride_id=completed_with_offer_id,
                    rider_id=rider_id,
                    driver_id=driver_id,
                    status=RideStatus.COMPLETED,
                    fare="20.00",
                    destination="Destino antiguo",
                    created_at=datetime(2026, 7, 10, 12, tzinfo=UTC),
                    completed_at=datetime(2026, 7, 10, 13, tzinfo=UTC),
                    accepted_offer_id=completed_offer_id,
                ),
                _ride(
                    ride_id=completed_at_fare_id,
                    rider_id=rider_id,
                    driver_id=driver_id,
                    status=RideStatus.COMPLETED,
                    fare="22.00",
                    destination="Destino reciente",
                    created_at=datetime(2026, 7, 11, 12, tzinfo=UTC),
                    completed_at=datetime(2026, 7, 12, 13, tzinfo=UTC),
                ),
                _ride(
                    ride_id=cancelled_id,
                    rider_id=rider_id,
                    driver_id=None,
                    status=RideStatus.CANCELLED,
                    fare="15.00",
                    destination="Destino cancelado",
                    created_at=datetime(2026, 7, 13, 12, tzinfo=UTC),
                ),
                _ride(
                    ride_id=active_id,
                    rider_id=rider_id,
                    driver_id=driver_id,
                    status=RideStatus.ARRIVING,
                    fare="25.00",
                    destination="Destino activo",
                    created_at=datetime(2026, 7, 14, 12, tzinfo=UTC),
                    accepted_offer_id=active_offer_id,
                ),
                OfferModel(
                    id=completed_offer_id,
                    ride_id=completed_with_offer_id,
                    driver_id=driver_id,
                    price=Decimal("30.00"),
                    status=OfferStatus.ACCEPTED,
                    created_at=datetime(2026, 7, 10, 12, 5, tzinfo=UTC),
                ),
                OfferModel(
                    id=active_offer_id,
                    ride_id=active_id,
                    driver_id=driver_id,
                    price=Decimal("27.00"),
                    eta_min=5,
                    status=OfferStatus.ACCEPTED,
                    created_at=datetime(2026, 7, 14, 12, 5, tzinfo=UTC),
                ),
                RideRatingModel(
                    ride_id=completed_with_offer_id,
                    rater_id=rider_id,
                    ratee_id=driver_id,
                    score=5,
                    created_at=datetime(2026, 7, 10, 14, tzinfo=UTC),
                ),
                RideRatingModel(
                    ride_id=completed_with_offer_id,
                    rater_id=driver_id,
                    ratee_id=rider_id,
                    score=4,
                    created_at=datetime(2026, 7, 10, 14, 5, tzinfo=UTC),
                ),
            ]
        )
        await session.commit()

    return {
        "rider": rider_id,
        "driver": driver_id,
        "completed_with_offer": completed_with_offer_id,
        "completed_at_fare": completed_at_fare_id,
        "cancelled": cancelled_id,
        "active": active_id,
    }


async def _execute_counting_selects(session_factory, operation, expected_selects: int = 1):
    engine = session_factory.kw["bind"]
    selects: list[str] = []

    def count_selects(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            selects.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", count_selects)
    try:
        result = await operation()
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count_selects)
    assert len(selects) == expected_selects
    return result


async def test_active_driver_ride_is_enriched_with_one_select(session_factory):
    ids = await _seed(session_factory)

    async with session_factory() as session:
        repository = SqlAlchemyRideReadRepository(session)
        detail = await _execute_counting_selects(
            session_factory,
            lambda: repository.get_active_for_driver(ids["driver"]),
        )

    assert detail is not None
    assert detail.ride.id == ids["active"]
    assert detail.rider is not None
    assert detail.rider.id == ids["rider"]
    assert detail.accepted_offer is not None
    assert detail.accepted_offer.price == Decimal("27.00")


async def test_history_resolves_counterpart_price_rating_and_order_in_one_select(
    session_factory,
):
    ids = await _seed(session_factory)

    async with session_factory() as session:
        repository = SqlAlchemyRideReadRepository(session)
        items = await _execute_counting_selects(
            session_factory,
            lambda: repository.list_history_items(
                ids["rider"],
                UserRole.PASSENGER,
                {RideStatus.COMPLETED, RideStatus.CANCELLED},
                None,
                100,
            ),
        )

    assert items.next_cursor is None
    assert [item.ride.id for item in items.items] == [
        ids["cancelled"],
        ids["completed_at_fare"],
        ids["completed_with_offer"],
    ]
    assert items.items[0].counterpart is None
    assert items.items[1].counterpart is not None
    assert items.items[1].counterpart.id == ids["driver"]
    assert items.items[1].price == Decimal("22.00")
    assert items.items[1].my_rating is None
    assert items.items[2].price == Decimal("30.00")
    assert items.items[2].my_rating == 5


async def test_driver_history_resolves_rider_and_own_rating_in_one_select(
    session_factory,
):
    ids = await _seed(session_factory)

    async with session_factory() as session:
        repository = SqlAlchemyRideReadRepository(session)
        items = await _execute_counting_selects(
            session_factory,
            lambda: repository.list_history_items(
                ids["driver"],
                UserRole.DRIVER,
                {RideStatus.COMPLETED, RideStatus.CANCELLED},
                None,
                100,
            ),
        )

    assert items.next_cursor is None
    assert [item.ride.id for item in items.items] == [
        ids["completed_at_fare"],
        ids["completed_with_offer"],
    ]
    assert all(item.counterpart is not None for item in items.items)
    assert all(
        item.counterpart.id == ids["rider"]
        for item in items.items
        if item.counterpart
    )
    assert items.items[0].price == Decimal("22.00")
    assert items.items[0].my_rating is None
    assert items.items[1].price == Decimal("30.00")
    assert items.items[1].my_rating == 4


async def test_history_uses_descending_keyset_cursor(session_factory):
    ids = await _seed(session_factory)

    async with session_factory() as session:
        repository = SqlAlchemyRideReadRepository(session)
        first = await repository.list_history_items(
            ids["rider"],
            UserRole.PASSENGER,
            {RideStatus.COMPLETED, RideStatus.CANCELLED},
            None,
            1,
        )
        second = await repository.list_history_items(
            ids["rider"],
            UserRole.PASSENGER,
            {RideStatus.COMPLETED, RideStatus.CANCELLED},
            first.next_cursor,
            1,
        )

    assert [item.ride.id for item in first.items] == [ids["cancelled"]]
    assert first.next_cursor is not None
    assert [item.ride.id for item in second.items] == [ids["completed_at_fare"]]
    assert second.next_cursor is not None


async def test_earnings_aggregates_in_sql_and_limits_recent_with_two_selects(
    session_factory,
):
    ids = await _seed(session_factory)

    async with session_factory() as session:
        repository = SqlAlchemyRideReadRepository(session)
        summary = await _execute_counting_selects(
            session_factory,
            lambda: repository.get_driver_earnings_summary(
                ids["driver"],
                datetime(2026, 7, 10, tzinfo=UTC),
                datetime(2026, 7, 11, tzinfo=UTC),
                1,
            ),
            expected_selects=2,
        )

    assert summary.total_all_time == Decimal("52.00")
    assert summary.trips_all_time == 2
    assert summary.total_today == Decimal("30.00")
    assert summary.trips_today == 1
    assert [item.ride_id for item in summary.recent] == [ids["completed_at_fare"]]
    assert summary.recent[0].price == Decimal("22.00")
    assert summary.recent[0].destination_name == "Destino reciente"


async def test_earnings_returns_zeroes_and_empty_recent_with_two_selects(session_factory):
    async with session_factory() as session:
        repository = SqlAlchemyRideReadRepository(session)
        summary = await _execute_counting_selects(
            session_factory,
            lambda: repository.get_driver_earnings_summary(
                uuid.uuid4(),
                datetime(2026, 7, 10, tzinfo=UTC),
                datetime(2026, 7, 11, tzinfo=UTC),
                10,
            ),
            expected_selects=2,
        )

    assert summary.total_today == Decimal("0")
    assert summary.trips_today == 0
    assert summary.total_all_time == Decimal("0")
    assert summary.trips_all_time == 0
    assert summary.recent == []
