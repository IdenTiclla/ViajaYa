"""Certification of migration 0017 on a disposable PostgreSQL database."""

from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, async_sessionmaker

from app.infrastructure.db.repositories import SqlAlchemyOfferRepository

_REVISION_0016 = "0016_driver_ride_dismissals"
_REVISION_0017 = "0017_pg_integrity_indexes"
_ACTIVE_STATUSES = "'accepted', 'arriving', 'in_progress'"

_NEW_CONSTRAINTS = {
    "fk_ride_requests_accepted_offer_id_offers",
    "ck_users_rating_range",
    "ck_ride_requests_fare_positive",
    "ck_ride_requests_pool_version_positive",
    "ck_driver_ride_dismissals_pool_version_positive",
    "ck_offers_price_positive",
    "ck_offers_eta_min_range",
    "ck_ride_ratings_score_range",
}
_NEW_INDEXES = {
    "ix_ride_requests_open_pool_cursor",
    "ix_ride_requests_rider_status_cursor",
    "ix_ride_requests_driver_status_cursor",
    "ix_offers_ride_status_cursor",
    "ix_offers_driver_status_cursor",
    "uq_ride_requests_active_driver",
}
_SIMPLE_INDEXES = {
    "ix_ride_requests_rider_id",
    "ix_ride_requests_driver_id",
    "ix_offers_ride_id",
    "ix_offers_driver_id",
}


async def _revision(connection: AsyncConnection) -> str:
    return str(
        (
            await connection.execute(sa.text("SELECT version_num FROM alembic_version"))
        ).scalar_one()
    )


async def _constraint_state(connection: AsyncConnection) -> dict[str, bool]:
    rows = (
        await connection.execute(
            sa.text(
                """
                SELECT conname, convalidated
                FROM pg_constraint
                WHERE conname::text = ANY(CAST(:names AS text[]))
                """
            ),
            {"names": list(_NEW_CONSTRAINTS)},
        )
    ).all()
    return {str(name): bool(validated) for name, validated in rows}


async def _index_names(connection: AsyncConnection) -> set[str]:
    rows = (
        await connection.execute(
            sa.text(
                """
                SELECT indexname
                FROM pg_indexes
                WHERE schemaname = current_schema()
                  AND tablename IN ('ride_requests', 'offers')
                """
            )
        )
    ).scalars()
    return {str(name) for name in rows}


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
                :id, 'Persona de prueba', :email, 'local', :role, :vehicle_type, :is_online
            )
            """
        ),
        {
            "id": user_id,
            "email": f"{user_id}@integration.test",
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
    fare: Decimal = Decimal("20.00"),
    pool_version: int = 1,
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
                -17.39, -66.15, 'Origen', 'Origen de prueba',
                -17.40, -66.16, 'Destino', 'Destino de prueba',
                'taxi', :fare, 'cash', :status, :driver_id, false, :pool_version
            )
            """
        ),
        {
            "id": ride_id,
            "rider_id": rider_id,
            "fare": fare,
            "status": status,
            "driver_id": driver_id,
            "pool_version": pool_version,
        },
    )


async def _insert_offer(
    connection: AsyncConnection,
    offer_id: uuid.UUID,
    ride_id: uuid.UUID,
    driver_id: uuid.UUID,
    *,
    price: Decimal = Decimal("20.00"),
    eta_min: int | None = 5,
    status: str = "pending",
) -> None:
    await connection.execute(
        sa.text(
            """
            INSERT INTO offers (id, ride_id, driver_id, price, eta_min, status)
            VALUES (:id, :ride_id, :driver_id, :price, :eta_min, :status)
            """
        ),
        {
            "id": offer_id,
            "ride_id": ride_id,
            "driver_id": driver_id,
            "price": price,
            "eta_min": eta_min,
            "status": status,
        },
    )


async def _assert_integrity_error(
    connection: AsyncConnection,
    statement: sa.TextClause,
    parameters: dict[str, object],
) -> None:
    savepoint = await connection.begin_nested()
    try:
        with pytest.raises(IntegrityError):
            await connection.execute(statement, parameters)
    finally:
        await savepoint.rollback()


async def test_upgrade_downgrade_y_reupgrade_0017(pg_test_db) -> None:
    await pg_test_db.migrate_async("downgrade", _REVISION_0016)
    try:
        async with pg_test_db.engine.connect() as connection:
            assert await _revision(connection) == _REVISION_0016
            indexes = await _index_names(connection)
            assert _SIMPLE_INDEXES <= indexes
            assert not (_NEW_INDEXES & indexes)
            assert not await _constraint_state(connection)

        await pg_test_db.migrate_async("upgrade", _REVISION_0017)
        async with pg_test_db.engine.connect() as connection:
            assert await _revision(connection) == _REVISION_0017
            assert await _constraint_state(connection) == dict.fromkeys(
                _NEW_CONSTRAINTS, True
            )
            indexes = await _index_names(connection)
            assert _NEW_INDEXES <= indexes
            assert not (_SIMPLE_INDEXES & indexes)

        await pg_test_db.migrate_async("downgrade", _REVISION_0016)
        await pg_test_db.migrate_async("upgrade", _REVISION_0017)
        async with pg_test_db.engine.connect() as connection:
            assert await _revision(connection) == _REVISION_0017
    finally:
        await pg_test_db.migrate_async("upgrade", "head")


async def test_restricciones_rechazan_valores_invalidos(pg_test_db) -> None:
    async with pg_test_db.engine.connect() as connection:
        transaction = await connection.begin()
        try:
            rider_id = uuid.uuid4()
            driver_id = uuid.uuid4()
            ride_id = uuid.uuid4()
            await _insert_user(connection, rider_id)
            await _insert_user(connection, driver_id, role="driver")
            await _insert_ride(connection, ride_id, rider_id)

            invalid_ride = sa.text(
                """
                INSERT INTO ride_requests (
                    id, rider_id,
                    origin_latitude, origin_longitude, origin_name, origin_address,
                    destination_latitude, destination_longitude,
                    destination_name, destination_address,
                    service_type, fare, payment_method, status, paused, pool_version
                )
                VALUES (
                    :id, :rider_id,
                    -17.39, -66.15, 'Origen', 'Origen',
                    -17.40, -66.16, 'Destino', 'Destino',
                    'taxi', :fare, 'cash', 'cancelled', false, :pool_version
                )
                """
            )
            for fare, pool_version in (
                (Decimal("0"), 1),
                (Decimal("-1"), 1),
                (Decimal("NaN"), 1),
                (Decimal("20"), 0),
            ):
                await _assert_integrity_error(
                    connection,
                    invalid_ride,
                    {
                        "id": uuid.uuid4(),
                        "rider_id": rider_id,
                        "fare": fare,
                        "pool_version": pool_version,
                    },
                )

            invalid_offer = sa.text(
                """
                INSERT INTO offers (id, ride_id, driver_id, price, eta_min, status)
                VALUES (:id, :ride_id, :driver_id, :price, :eta_min, 'pending')
                """
            )
            for price, eta_min in (
                (Decimal("0"), 5),
                (Decimal("-1"), 5),
                (Decimal("NaN"), 5),
                (Decimal("20"), -1),
                (Decimal("20"), 241),
            ):
                await _assert_integrity_error(
                    connection,
                    invalid_offer,
                    {
                        "id": uuid.uuid4(),
                        "ride_id": ride_id,
                        "driver_id": driver_id,
                        "price": price,
                        "eta_min": eta_min,
                    },
                )

            await _assert_integrity_error(
                connection,
                sa.text(
                    """
                    INSERT INTO driver_ride_dismissals (
                        id, driver_id, ride_id, pool_version
                    )
                    VALUES (:id, :driver_id, :ride_id, 0)
                    """
                ),
                {"id": uuid.uuid4(), "driver_id": driver_id, "ride_id": ride_id},
            )

            for rating in (0.0, 6.0):
                await _assert_integrity_error(
                    connection,
                    sa.text("UPDATE users SET rating = :rating WHERE id = :id"),
                    {"rating": rating, "id": driver_id},
                )

            completed_ride_id = uuid.uuid4()
            await _insert_ride(
                connection,
                completed_ride_id,
                rider_id,
                status="completed",
                driver_id=driver_id,
            )
            for score in (0, 6):
                await _assert_integrity_error(
                    connection,
                    sa.text(
                        """
                        INSERT INTO ride_ratings (
                            id, ride_id, rater_id, ratee_id, score
                        )
                        VALUES (:id, :ride_id, :rater_id, :ratee_id, :score)
                        """
                    ),
                    {
                        "id": uuid.uuid4(),
                        "ride_id": completed_ride_id,
                        "rater_id": rider_id,
                        "ratee_id": driver_id,
                        "score": score,
                    },
                )
        finally:
            await transaction.rollback()


async def test_eliminar_oferta_aceptada_pone_fk_en_null(pg_test_db) -> None:
    async with pg_test_db.engine.connect() as connection:
        transaction = await connection.begin()
        try:
            rider_id = uuid.uuid4()
            driver_id = uuid.uuid4()
            ride_id = uuid.uuid4()
            offer_id = uuid.uuid4()
            await _insert_user(connection, rider_id)
            await _insert_user(connection, driver_id, role="driver")
            await _insert_ride(
                connection,
                ride_id,
                rider_id,
                status="accepted",
                driver_id=driver_id,
            )
            await _insert_offer(
                connection,
                offer_id,
                ride_id,
                driver_id,
                status="accepted",
            )
            await connection.execute(
                sa.text(
                    "UPDATE ride_requests SET accepted_offer_id = :offer_id WHERE id = :ride_id"
                ),
                {"offer_id": offer_id, "ride_id": ride_id},
            )

            await connection.execute(
                sa.text("DELETE FROM offers WHERE id = :offer_id"),
                {"offer_id": offer_id},
            )
            accepted_offer_id = (
                await connection.execute(
                    sa.text("SELECT accepted_offer_id FROM ride_requests WHERE id = :ride_id"),
                    {"ride_id": ride_id},
                )
            ).scalar_one()
            assert accepted_offer_id is None
        finally:
            await transaction.rollback()


async def test_indice_unico_rechaza_dos_rides_activos_del_conductor(pg_test_db) -> None:
    async with pg_test_db.engine.connect() as connection:
        transaction = await connection.begin()
        try:
            driver_id = uuid.uuid4()
            rider_a = uuid.uuid4()
            rider_b = uuid.uuid4()
            await _insert_user(connection, driver_id, role="driver")
            await _insert_user(connection, rider_a)
            await _insert_user(connection, rider_b)
            await _insert_ride(
                connection,
                uuid.uuid4(),
                rider_a,
                status="accepted",
                driver_id=driver_id,
            )

            savepoint = await connection.begin_nested()
            try:
                with pytest.raises(IntegrityError, match="uq_ride_requests_active_driver"):
                    await _insert_ride(
                        connection,
                        uuid.uuid4(),
                        rider_b,
                        status="arriving",
                        driver_id=driver_id,
                    )
            finally:
                await savepoint.rollback()
        finally:
            await transaction.rollback()


async def test_aceptaciones_concurrentes_dejan_un_solo_ride_activo(pg_test_db) -> None:
    driver_id = uuid.uuid4()
    rider_a = uuid.uuid4()
    rider_b = uuid.uuid4()
    ride_a = uuid.uuid4()
    ride_b = uuid.uuid4()
    offer_a = uuid.uuid4()
    offer_b = uuid.uuid4()

    async with pg_test_db.engine.begin() as connection:
        await _insert_user(connection, driver_id, role="driver")
        await _insert_user(connection, rider_a)
        await _insert_user(connection, rider_b)
        await _insert_ride(connection, ride_a, rider_a)
        await _insert_ride(connection, ride_b, rider_b)
        await _insert_offer(connection, offer_a, ride_a, driver_id)
        await _insert_offer(connection, offer_b, ride_b, driver_id)

    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    async with sessions() as session_a, sessions() as session_b:
        repository_a = SqlAlchemyOfferRepository(session_a)
        repository_b = SqlAlchemyOfferRepository(session_b)
        result_a, result_b = await asyncio.gather(
            repository_a.accept_atomically(offer_a),
            repository_b.accept_atomically(offer_b),
        )

    assert sum(result is not None for result in (result_a, result_b)) == 1
    async with pg_test_db.engine.connect() as connection:
        active_count = (
            await connection.execute(
                sa.text(
                    f"""
                    SELECT COUNT(*)
                    FROM ride_requests
                    WHERE driver_id = :driver_id
                      AND status IN ({_ACTIVE_STATUSES})
                    """
                ),
                {"driver_id": driver_id},
            )
        ).scalar_one()
        accepted_offers = (
            await connection.execute(
                sa.text(
                    """
                    SELECT COUNT(*)
                    FROM offers
                    WHERE driver_id = :driver_id AND status = 'accepted'
                    """
                ),
                {"driver_id": driver_id},
            )
        ).scalar_one()
    assert active_count == 1
    assert accepted_offers == 1
