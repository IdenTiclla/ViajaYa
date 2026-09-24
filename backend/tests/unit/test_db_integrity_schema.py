"""ORM schema contract for integrity and critical indexes."""

from __future__ import annotations

from importlib import import_module
from io import StringIO

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.dialects import postgresql

from app.infrastructure.db.models import (
    DriverRideDismissalModel,
    OfferModel,
    RideRatingModel,
    RideRequestModel,
    UserModel,
)

migration = import_module("migrations.versions.0017_pg_integrity_indexes")


def _check_names(model: type) -> set[str | None]:
    return {
        constraint.name
        for constraint in model.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    }


def test_modelos_declaran_restricciones_de_integridad() -> None:
    assert "ck_users_rating_range" in _check_names(UserModel)
    assert {
        "ck_ride_requests_fare_positive",
        "ck_ride_requests_pool_version_positive",
    } <= _check_names(RideRequestModel)
    assert "ck_driver_ride_dismissals_pool_version_positive" in _check_names(
        DriverRideDismissalModel
    )
    assert {"ck_offers_price_positive", "ck_offers_eta_min_range"} <= _check_names(OfferModel)
    assert "ck_ride_ratings_score_range" in _check_names(RideRatingModel)


def test_accepted_offer_tiene_fk_set_null() -> None:
    foreign_keys = RideRequestModel.__table__.c.accepted_offer_id.foreign_keys

    assert len(foreign_keys) == 1
    foreign_key = next(iter(foreign_keys))
    assert foreign_key.target_fullname == "offers.id"
    assert foreign_key.ondelete == "SET NULL"
    assert foreign_key.constraint.name == "fk_ride_requests_accepted_offer_id_offers"


def test_indices_compuestos_reemplazan_indices_simples() -> None:
    ride_indexes = {index.name: index for index in RideRequestModel.__table__.indexes}
    offer_indexes = {index.name: index for index in OfferModel.__table__.indexes}

    assert {
        "uq_ride_requests_active_rider",
        "uq_ride_requests_active_driver",
        "ix_ride_requests_open_pool_cursor",
        "ix_ride_requests_rider_status_cursor",
        "ix_ride_requests_driver_status_cursor",
    } <= ride_indexes.keys()
    assert {
        "ix_offers_ride_status_cursor",
        "ix_offers_driver_status_cursor",
    } <= offer_indexes.keys()
    assert ride_indexes["uq_ride_requests_active_driver"].unique

    open_pool_index = ride_indexes["ix_ride_requests_open_pool_cursor"]
    assert [str(expression) for expression in open_pool_index.expressions] == [
        "ride_requests.service_type",
        "created_at DESC",
        "id DESC",
    ]
    assert str(open_pool_index.dialect_options["postgresql"]["where"]) == (
        "status = 'searching' AND paused = false"
    )
    assert str(open_pool_index.dialect_options["sqlite"]["where"]) == (
        "status = 'searching' AND paused = false"
    )

    assert "ix_ride_requests_rider_id" not in ride_indexes
    assert "ix_ride_requests_driver_id" not in ride_indexes
    assert "ix_offers_ride_id" not in offer_indexes
    assert "ix_offers_driver_id" not in offer_indexes


def test_preflight_rechaza_oferta_aceptada_de_otro_ride_o_conductor(monkeypatch) -> None:
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE users (id TEXT PRIMARY KEY, rating REAL)")
        connection.exec_driver_sql(
            """
            CREATE TABLE ride_requests (
                id TEXT PRIMARY KEY,
                accepted_offer_id TEXT,
                driver_id TEXT,
                fare NUMERIC NOT NULL,
                pool_version INTEGER NOT NULL,
                status TEXT NOT NULL
            )
            """
        )
        connection.exec_driver_sql(
            """
            CREATE TABLE offers (
                id TEXT PRIMARY KEY,
                ride_id TEXT NOT NULL,
                driver_id TEXT NOT NULL,
                price NUMERIC NOT NULL,
                eta_min INTEGER,
                status TEXT NOT NULL
            )
            """
        )
        connection.exec_driver_sql(
            "CREATE TABLE driver_ride_dismissals (pool_version INTEGER NOT NULL)"
        )
        connection.exec_driver_sql("CREATE TABLE ride_ratings (score INTEGER NOT NULL)")
        connection.exec_driver_sql(
            """
            INSERT INTO ride_requests
                (id, accepted_offer_id, driver_id, fare, pool_version, status)
            VALUES
                ('ride-a', 'offer-a', 'driver-a', 20, 1, 'accepted'),
                ('ride-b', 'offer-b', 'driver-b', 20, 1, 'accepted'),
                ('ride-c', 'offer-c', 'driver-c', 20, 1, 'accepted')
            """
        )
        connection.exec_driver_sql(
            """
            INSERT INTO offers (id, ride_id, driver_id, price, eta_min, status)
            VALUES
                ('offer-a', 'other-ride', 'driver-a', 20, 5, 'accepted'),
                ('offer-b', 'ride-b', 'other-driver', 20, 5, 'accepted'),
                ('offer-c', 'ride-c', 'driver-c', 20, 5, 'pending')
            """
        )

        context = MigrationContext.configure(connection)
        monkeypatch.setattr(migration, "op", Operations(context))

        with pytest.raises(RuntimeError, match="no coincide con ride/conductor/estado: 3"):
            migration._run_preflight()

    engine.dispose()


def test_migracion_renderiza_not_valid_e_indice_parcial(monkeypatch) -> None:
    output = StringIO()
    context = MigrationContext.configure(
        dialect=postgresql.dialect(),
        opts={"as_sql": True, "output_buffer": output},
    )
    monkeypatch.setattr(migration, "op", Operations(context))
    monkeypatch.setattr(migration, "_run_preflight", lambda: None)

    migration.upgrade()

    sql = output.getvalue()
    assert "ON DELETE SET NULL NOT VALID" in sql
    assert "VALIDATE CONSTRAINT fk_ride_requests_accepted_offer_id_offers" in sql
    for _table, name, _condition in migration._CHECK_CONSTRAINTS:
        assert f"CONSTRAINT {name} CHECK" in sql
        assert f'VALIDATE CONSTRAINT "{name}"' in sql
    assert "lower(CAST(fare AS TEXT)) NOT IN ('nan', 'infinity', '-infinity')" in sql
    assert "lower(CAST(price AS TEXT)) NOT IN ('nan', 'infinity', '-infinity')" in sql
    assert (
        "CREATE INDEX ix_ride_requests_open_pool_cursor ON ride_requests "
        "(service_type, created_at DESC, id DESC) "
        "WHERE status = 'searching' AND paused = false" in sql
    )
    assert (
        "CREATE UNIQUE INDEX uq_ride_requests_active_driver ON ride_requests (driver_id) "
        "WHERE driver_id IS NOT NULL AND status IN ('accepted', 'arriving', 'in_progress')"
        in sql
    )
    for name in (
        "ix_ride_requests_rider_id",
        "ix_ride_requests_driver_id",
        "ix_offers_ride_id",
        "ix_offers_driver_id",
    ):
        assert f"DROP INDEX {name}" in sql
