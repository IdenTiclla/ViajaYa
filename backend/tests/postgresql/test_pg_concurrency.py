"""Carreras transaccionales que SQLite no puede certificar."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from decimal import Decimal
from typing import TypeVar

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncConnection, async_sessionmaker

from app.domain.entities import Offer, RideRating, RideStatus
from app.infrastructure.db.repositories import (
    SqlAlchemyOfferRepository,
    SqlAlchemyRatingRepository,
)

_TIMEOUT_SECONDS = 10
_T = TypeVar("_T")
_U = TypeVar("_U")


async def _race(
    left: Callable[[], Awaitable[_T]],
    right: Callable[[], Awaitable[_U]],
) -> tuple[_T, _U]:
    """Libera dos operaciones a la vez y falla si un lock no converge."""
    barrier = asyncio.Barrier(2)

    async def run_left() -> _T:
        await barrier.wait()
        return await left()

    async def run_right() -> _U:
        await barrier.wait()
        return await right()

    results = await asyncio.wait_for(
        asyncio.gather(run_left(), run_right()),
        timeout=_TIMEOUT_SECONDS,
    )
    return results[0], results[1]


async def _insert_user(
    connection: AsyncConnection,
    user_id: uuid.UUID,
    *,
    role: str = "passenger",
) -> None:
    await connection.execute(
        sa.text(
            """
            INSERT INTO users (
                id, full_name, email, auth_provider, role, vehicle_type, is_online
            )
            VALUES (
                :id, 'Persona concurrente', :email, 'local',
                :role, :vehicle_type, :is_online
            )
            """
        ),
        {
            "id": user_id,
            "email": f"{user_id}@concurrency.test",
            "role": role,
            "vehicle_type": "taxi" if role == "driver" else None,
            "is_online": role == "driver",
        },
    )


async def _insert_ride(
    connection: AsyncConnection,
    ride_id: uuid.UUID,
    rider_id: uuid.UUID,
    *,
    status: str = "searching",
    driver_id: uuid.UUID | None = None,
) -> None:
    await connection.execute(
        sa.text(
            """
            INSERT INTO ride_requests (
                id, rider_id,
                origin_latitude, origin_longitude, origin_name, origin_address,
                destination_latitude, destination_longitude,
                destination_name, destination_address,
                service_type, fare, payment_method, status, driver_id, paused, pool_version
            )
            VALUES (
                :id, :rider_id,
                -17.39, -66.15, 'Origen', 'Origen concurrente',
                -17.40, -66.16, 'Destino', 'Destino concurrente',
                'taxi', 20, 'cash', :status, :driver_id, false, 1
            )
            """
        ),
        {
            "id": ride_id,
            "rider_id": rider_id,
            "status": status,
            "driver_id": driver_id,
        },
    )


async def _insert_offer(
    connection: AsyncConnection,
    offer_id: uuid.UUID,
    ride_id: uuid.UUID,
    driver_id: uuid.UUID,
) -> None:
    await connection.execute(
        sa.text(
            """
            INSERT INTO offers (id, ride_id, driver_id, price, eta_min, status)
            VALUES (:id, :ride_id, :driver_id, 20, 5, 'pending')
            """
        ),
        {"id": offer_id, "ride_id": ride_id, "driver_id": driver_id},
    )


async def test_dos_aceptaciones_del_mismo_ride_solo_tienen_un_ganador(pg_test_db) -> None:
    rider_id = uuid.uuid4()
    ride_id = uuid.uuid4()
    driver_a = uuid.uuid4()
    driver_b = uuid.uuid4()
    offer_a = uuid.uuid4()
    offer_b = uuid.uuid4()
    async with pg_test_db.engine.begin() as connection:
        await _insert_user(connection, rider_id)
        await _insert_user(connection, driver_a, role="driver")
        await _insert_user(connection, driver_b, role="driver")
        await _insert_ride(connection, ride_id, rider_id)
        await _insert_offer(connection, offer_a, ride_id, driver_a)
        await _insert_offer(connection, offer_b, ride_id, driver_b)

    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    async with sessions() as session_a, sessions() as session_b:
        repository_a = SqlAlchemyOfferRepository(session_a)
        repository_b = SqlAlchemyOfferRepository(session_b)
        result_a, result_b = await _race(
            lambda: repository_a.accept_atomically(offer_a),
            lambda: repository_b.accept_atomically(offer_b),
        )

    assert sum(result is not None for result in (result_a, result_b)) == 1
    winner = result_a or result_b
    assert winner is not None
    async with pg_test_db.engine.connect() as connection:
        ride = (
            await connection.execute(
                sa.text(
                    """
                    SELECT status, driver_id, accepted_offer_id
                    FROM ride_requests
                    WHERE id = :ride_id
                    """
                ),
                {"ride_id": ride_id},
            )
        ).one()
        offer_statuses = (
            await connection.execute(
                sa.text(
                    """
                    SELECT status, COUNT(*)
                    FROM offers
                    WHERE ride_id = :ride_id
                    GROUP BY status
                    """
                ),
                {"ride_id": ride_id},
            )
        ).all()

    assert tuple(ride) == (
        "accepted",
        winner.accepted_offer.driver_id,
        winner.accepted_offer.id,
    )
    assert dict(offer_statuses) == {"accepted": 1, "rejected": 1}


@pytest.mark.parametrize("service", ["taxi", "moto"])
async def test_crossed_negotiations_can_assign_two_independent_trips(pg_test_db, service) -> None:
    """Two drivers bidding for both riders can each win one trip concurrently."""
    riders = [uuid.uuid4(), uuid.uuid4()]
    drivers = [uuid.uuid4(), uuid.uuid4()]
    rides = [uuid.uuid4(), uuid.uuid4()]
    offers = [[uuid.uuid4(), uuid.uuid4()], [uuid.uuid4(), uuid.uuid4()]]
    async with pg_test_db.engine.begin() as connection:
        for index in range(2):
            await _insert_user(connection, riders[index])
            await _insert_user(connection, drivers[index], role="driver")
            await _insert_ride(connection, rides[index], riders[index])
            await connection.execute(
                sa.text("UPDATE users SET vehicle_type = :service WHERE id = :id"),
                {"service": service, "id": drivers[index]},
            )
            await connection.execute(
                sa.text("UPDATE ride_requests SET service_type = :service WHERE id = :id"),
                {"service": service, "id": rides[index]},
            )
        for driver_index, driver in enumerate(drivers):
            for ride_index, ride in enumerate(rides):
                await _insert_offer(connection, offers[driver_index][ride_index], ride, driver)

    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    async with sessions() as session_a, sessions() as session_b:
        result_a, result_b = await _race(
            lambda: SqlAlchemyOfferRepository(session_a).accept_atomically(offers[0][0]),
            lambda: SqlAlchemyOfferRepository(session_b).accept_atomically(offers[1][1]),
        )
    assert result_a is not None
    assert result_b is not None
    async with pg_test_db.engine.connect() as connection:
        for index, ride_id in enumerate(rides):
            saved = (await connection.execute(
                sa.text(
                    "SELECT driver_id, accepted_offer_id, status FROM ride_requests WHERE id=:id"
                ),
                {"id": ride_id},
            )).one()
            assert tuple(saved) == (drivers[index], offers[index][index], "accepted")
            statuses = (await connection.execute(
                sa.text("SELECT id, status FROM offers WHERE ride_id=:id"), {"id": ride_id},
            )).all()
            assert dict(statuses) == {
                offers[index][index]: "accepted", offers[1 - index][index]: "rejected",
            }


@pytest.mark.parametrize("cancellation", ["manual", "absence"])
async def test_aceptacion_compite_con_cancelacion(pg_test_db, cancellation: str) -> None:
    rider_id = uuid.uuid4()
    driver_id = uuid.uuid4()
    ride_id = uuid.uuid4()
    offer_id = uuid.uuid4()
    async with pg_test_db.engine.begin() as connection:
        await _insert_user(connection, rider_id)
        await _insert_user(connection, driver_id, role="driver")
        await _insert_ride(connection, ride_id, rider_id)
        await _insert_offer(connection, offer_id, ride_id, driver_id)

    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    async with sessions() as accept_session, sessions() as cancel_session:
        accept_repository = SqlAlchemyOfferRepository(accept_session)
        cancel_repository = SqlAlchemyOfferRepository(cancel_session)

        async def cancel():
            if cancellation == "manual":
                return await cancel_repository.cancel_ride_atomically(
                    ride_id,
                    expected_status=RideStatus.SEARCHING,
                    expected_paused=False,
                )
            return await cancel_repository.cancel_ride_on_disconnect_atomically(ride_id)

        accepted, cancelled = await _race(
            lambda: accept_repository.accept_atomically(offer_id),
            cancel,
        )

    assert sum(result is not None for result in (accepted, cancelled)) == 1
    async with pg_test_db.engine.connect() as connection:
        ride = (
            await connection.execute(
                sa.text(
                    """
                    SELECT status, driver_id, accepted_offer_id, cancelled_at IS NOT NULL
                    FROM ride_requests
                    WHERE id = :ride_id
                    """
                ),
                {"ride_id": ride_id},
            )
        ).one()
        offer_status = (
            await connection.execute(
                sa.text("SELECT status FROM offers WHERE id = :offer_id"),
                {"offer_id": offer_id},
            )
        ).scalar_one()

    if accepted is not None:
        assert tuple(ride) == ("accepted", driver_id, offer_id, False)
        assert offer_status == "accepted"
    else:
        assert tuple(ride) == ("cancelled", None, None, True)
        assert offer_status == "rejected"


async def test_dos_ofertas_simultaneas_dejan_una_sola_viva(pg_test_db) -> None:
    rider_id = uuid.uuid4()
    driver_id = uuid.uuid4()
    ride_id = uuid.uuid4()
    offer_a = Offer(
        id=uuid.uuid4(),
        ride_id=ride_id,
        driver_id=driver_id,
        price=Decimal("21.00"),
        eta_min=5,
    )
    offer_b = Offer(
        id=uuid.uuid4(),
        ride_id=ride_id,
        driver_id=driver_id,
        price=Decimal("22.00"),
        eta_min=4,
    )
    async with pg_test_db.engine.begin() as connection:
        await _insert_user(connection, rider_id)
        await _insert_user(connection, driver_id, role="driver")
        await _insert_ride(connection, ride_id, rider_id)

    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    async with sessions() as session_a, sessions() as session_b:
        repository_a = SqlAlchemyOfferRepository(session_a)
        repository_b = SqlAlchemyOfferRepository(session_b)
        result_a, result_b = await _race(
            lambda: repository_a.create_or_supersede_atomically(
                offer_a,
                expected_ride_fare=Decimal("20.00"),
            ),
            lambda: repository_b.create_or_supersede_atomically(
                offer_b,
                expected_ride_fare=Decimal("20.00"),
            ),
        )

    assert result_a is not None
    assert result_b is not None
    superseded = [
        result.superseded_offer_id
        for result in (result_a, result_b)
        if result.superseded_offer_id is not None
    ]
    assert len(superseded) == 1
    assert superseded[0] in {offer_a.id, offer_b.id}
    async with pg_test_db.engine.connect() as connection:
        statuses = (
            await connection.execute(
                sa.text(
                    """
                    SELECT status, COUNT(*)
                    FROM offers
                    WHERE ride_id = :ride_id AND driver_id = :driver_id
                    GROUP BY status
                    """
                ),
                {"ride_id": ride_id, "driver_id": driver_id},
            )
        ).all()
    assert dict(statuses) == {"pending": 1, "rejected": 1}


async def test_ratings_concurrentes_del_mismo_autor_persisten_una_fila(pg_test_db) -> None:
    rater_id = uuid.uuid4()
    ratee_id = uuid.uuid4()
    ride_id = uuid.uuid4()
    rating_a = RideRating(
        ride_id=ride_id,
        rater_id=rater_id,
        ratee_id=ratee_id,
        score=5,
        comment="Primera carrera",
    )
    rating_b = RideRating(
        ride_id=ride_id,
        rater_id=rater_id,
        ratee_id=ratee_id,
        score=5,
        comment="Segunda carrera",
    )
    async with pg_test_db.engine.begin() as connection:
        await _insert_user(connection, rater_id)
        await _insert_user(connection, ratee_id, role="driver")
        await _insert_ride(
            connection,
            ride_id,
            rater_id,
            status="completed",
            driver_id=ratee_id,
        )

    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    async with sessions() as session_a, sessions() as session_b:
        repository_a = SqlAlchemyRatingRepository(session_a)
        repository_b = SqlAlchemyRatingRepository(session_b)
        result_a, result_b = await _race(
            lambda: repository_a.add_and_recompute(rating_a),
            lambda: repository_b.add_and_recompute(rating_b),
        )

    assert sum(result is not None for result in (result_a, result_b)) == 1
    async with pg_test_db.engine.connect() as connection:
        rating_rows = (
            await connection.execute(
                sa.text(
                    """
                    SELECT COUNT(*), MIN(score), MAX(score)
                    FROM ride_ratings
                    WHERE ride_id = :ride_id AND rater_id = :rater_id
                    """
                ),
                {"ride_id": ride_id, "rater_id": rater_id},
            )
        ).one()
        cached_rating = (
            await connection.execute(
                sa.text("SELECT rating FROM users WHERE id = :ratee_id"),
                {"ratee_id": ratee_id},
            )
        ).scalar_one()

    assert tuple(rating_rows) == (1, 5, 5)
    assert cached_rating == pytest.approx(5.0)


@pytest.mark.parametrize("service", ["taxi", "moto"])
async def test_offer_version_rechecked_after_waiting_for_concurrent_edit(pg_test_db, service):
    driver_id, rider_id, ride_id, previous_id = (uuid.uuid4() for _ in range(4))
    async with pg_test_db.engine.begin() as connection:
        await _insert_user(connection, rider_id)
        await _insert_user(connection, driver_id, role="driver")
        await _insert_ride(connection, ride_id, rider_id)
        await _insert_offer(connection, previous_id, ride_id, driver_id)
        await connection.execute(
            sa.text("UPDATE users SET vehicle_type=:service WHERE id=:id"),
            {"service": service, "id": driver_id},
        )
        await connection.execute(
            sa.text("UPDATE ride_requests SET service_type=:service WHERE id=:id"),
            {"service": service, "id": ride_id},
        )
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    async with sessions() as editor, sessions() as bidder:
        await editor.execute(
            sa.text("UPDATE ride_requests SET pool_version=2, origin_latitude=-17.5 WHERE id=:id"),
            {"id": ride_id},
        )
        repository = SqlAlchemyOfferRepository(bidder)
        pending = asyncio.create_task(repository.create_or_supersede_atomically(
            Offer(ride_id=ride_id, driver_id=driver_id, price=Decimal("22"), eta_min=3),
            expected_ride_fare=Decimal("20"), expected_pool_version=1,
        ))
        try:
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(asyncio.shield(pending), timeout=0.1)
            await editor.commit()
            assert await asyncio.wait_for(pending, timeout=5) is None
        finally:
            await editor.rollback()
            if not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
        rows = (await bidder.execute(
            sa.text("SELECT id, status FROM offers WHERE ride_id=:id"), {"id": ride_id},
        )).all()
        assert rows == [(previous_id, "pending")]
