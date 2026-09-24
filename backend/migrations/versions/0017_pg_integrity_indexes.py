"""Strengthen integrity and read indexes on PostgreSQL.

The migration does not try to repair incompatible rows: the preflight lists the
problems and aborts before modifying the schema. Constraints that require
scanning existing tables are created ``NOT VALID`` and validated
explicitly to reduce DDL locking on PostgreSQL.

Revision ID: 0017_pg_integrity_indexes
Revises: 0016_driver_ride_dismissals
Create Date: 2026-07-18
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_pg_integrity_indexes"
down_revision: str | None = "0016_driver_ride_dismissals"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_ACTIVE_DRIVER_PREDICATE = sa.text(
    "driver_id IS NOT NULL AND status IN ('accepted', 'arriving', 'in_progress')"
)

_PREFLIGHT_CHECKS: tuple[tuple[str, str], ...] = (
    (
        "ride_requests.accepted_offer_id is orphaned or does not match ride/driver/status",
        """
        SELECT COUNT(*)
        FROM ride_requests AS ride
        LEFT JOIN offers AS offer ON offer.id = ride.accepted_offer_id
        WHERE ride.accepted_offer_id IS NOT NULL
          AND (
              offer.id IS NULL
              OR offer.ride_id <> ride.id
              OR offer.driver_id IS DISTINCT FROM ride.driver_id
              OR offer.status <> 'accepted'
          )
        """,
    ),
    (
        "ride_requests.fare is not positive or not finite",
        """
        SELECT COUNT(*)
        FROM ride_requests
        WHERE fare <= 0
           OR lower(CAST(fare AS TEXT)) IN ('nan', 'infinity', '-infinity')
        """,
    ),
    (
        "ride_requests.pool_version is lower than 1",
        "SELECT COUNT(*) FROM ride_requests WHERE pool_version < 1",
    ),
    (
        "driver_ride_dismissals.pool_version is lower than 1",
        "SELECT COUNT(*) FROM driver_ride_dismissals WHERE pool_version < 1",
    ),
    (
        "offers.price is not positive or not finite",
        """
        SELECT COUNT(*)
        FROM offers
        WHERE price <= 0
           OR lower(CAST(price AS TEXT)) IN ('nan', 'infinity', '-infinity')
        """,
    ),
    (
        "offers.eta_min is outside the 0..240 range",
        "SELECT COUNT(*) FROM offers WHERE eta_min IS NOT NULL AND eta_min NOT BETWEEN 0 AND 240",
    ),
    (
        "ride_ratings.score is outside the 1..5 range",
        "SELECT COUNT(*) FROM ride_ratings WHERE score NOT BETWEEN 1 AND 5",
    ),
    (
        "users.rating is outside the 1..5 range",
        "SELECT COUNT(*) FROM users WHERE rating IS NOT NULL AND rating NOT BETWEEN 1 AND 5",
    ),
    (
        "there are drivers assigned to more than one active ride",
        """
        SELECT COUNT(*)
        FROM (
            SELECT driver_id
            FROM ride_requests
            WHERE driver_id IS NOT NULL
              AND status IN ('accepted', 'arriving', 'in_progress')
            GROUP BY driver_id
            HAVING COUNT(*) > 1
        ) AS duplicated_active_drivers
        """,
    ),
)

_CHECK_CONSTRAINTS: tuple[tuple[str, str, str], ...] = (
    ("users", "ck_users_rating_range", "rating IS NULL OR (rating >= 1 AND rating <= 5)"),
    (
        "ride_requests",
        "ck_ride_requests_fare_positive",
        "fare > 0 AND lower(CAST(fare AS TEXT)) "
        "NOT IN ('nan', 'infinity', '-infinity')",
    ),
    (
        "ride_requests",
        "ck_ride_requests_pool_version_positive",
        "pool_version >= 1",
    ),
    (
        "driver_ride_dismissals",
        "ck_driver_ride_dismissals_pool_version_positive",
        "pool_version >= 1",
    ),
    (
        "offers",
        "ck_offers_price_positive",
        "price > 0 AND lower(CAST(price AS TEXT)) "
        "NOT IN ('nan', 'infinity', '-infinity')",
    ),
    (
        "offers",
        "ck_offers_eta_min_range",
        "eta_min IS NULL OR (eta_min >= 0 AND eta_min <= 240)",
    ),
    ("ride_ratings", "ck_ride_ratings_score_range", "score >= 1 AND score <= 5"),
)


def _run_preflight() -> None:
    connection = op.get_bind()
    problems: list[str] = []
    for description, query in _PREFLIGHT_CHECKS:
        count = int(connection.execute(sa.text(query)).scalar_one())
        if count:
            problems.append(f"{description}: {count}")

    if problems:
        details = "\n".join(f"- {problem}" for problem in problems)
        raise RuntimeError(
            "Migration 0017 stopped without modifying the schema. "
            f"Fix the incompatible data and run it again:\n{details}"
        )


def _create_not_valid_constraints() -> None:
    op.create_foreign_key(
        "fk_ride_requests_accepted_offer_id_offers",
        "ride_requests",
        "offers",
        ["accepted_offer_id"],
        ["id"],
        ondelete="SET NULL",
        postgresql_not_valid=True,
    )
    op.execute(
        "ALTER TABLE ride_requests "
        "VALIDATE CONSTRAINT fk_ride_requests_accepted_offer_id_offers"
    )

    for table, name, condition in _CHECK_CONSTRAINTS:
        op.create_check_constraint(
            name,
            table,
            condition,
            postgresql_not_valid=True,
        )
        op.execute(f'ALTER TABLE "{table}" VALIDATE CONSTRAINT "{name}"')


def upgrade() -> None:
    _run_preflight()
    _create_not_valid_constraints()

    op.create_index(
        "ix_ride_requests_open_pool_cursor",
        "ride_requests",
        ["service_type", sa.text("created_at DESC"), sa.text("id DESC")],
        postgresql_where=sa.text("status = 'searching' AND paused = false"),
    )
    op.create_index(
        "ix_ride_requests_rider_status_cursor",
        "ride_requests",
        ["rider_id", "status", sa.text("created_at DESC"), sa.text("id DESC")],
    )
    op.create_index(
        "ix_ride_requests_driver_status_cursor",
        "ride_requests",
        ["driver_id", "status", sa.text("created_at DESC"), sa.text("id DESC")],
    )
    op.create_index(
        "ix_offers_ride_status_cursor",
        "offers",
        ["ride_id", "status", sa.text("created_at DESC"), sa.text("id DESC")],
    )
    op.create_index(
        "ix_offers_driver_status_cursor",
        "offers",
        ["driver_id", "status", sa.text("created_at DESC"), sa.text("id DESC")],
    )
    op.create_index(
        "uq_ride_requests_active_driver",
        "ride_requests",
        ["driver_id"],
        unique=True,
        postgresql_where=_ACTIVE_DRIVER_PREDICATE,
    )

    op.drop_index("ix_ride_requests_rider_id", table_name="ride_requests")
    op.drop_index("ix_ride_requests_driver_id", table_name="ride_requests")
    op.drop_index("ix_offers_ride_id", table_name="offers")
    op.drop_index("ix_offers_driver_id", table_name="offers")


def downgrade() -> None:
    # The simple indexes are restored first so the FKs are not left without support
    # while their composite replacements are dropped.
    op.create_index("ix_ride_requests_rider_id", "ride_requests", ["rider_id"])
    op.create_index("ix_ride_requests_driver_id", "ride_requests", ["driver_id"])
    op.create_index("ix_offers_ride_id", "offers", ["ride_id"])
    op.create_index("ix_offers_driver_id", "offers", ["driver_id"])

    op.drop_index("uq_ride_requests_active_driver", table_name="ride_requests")
    op.drop_index("ix_offers_driver_status_cursor", table_name="offers")
    op.drop_index("ix_offers_ride_status_cursor", table_name="offers")
    op.drop_index("ix_ride_requests_driver_status_cursor", table_name="ride_requests")
    op.drop_index("ix_ride_requests_rider_status_cursor", table_name="ride_requests")
    op.drop_index("ix_ride_requests_open_pool_cursor", table_name="ride_requests")

    op.drop_constraint(
        "fk_ride_requests_accepted_offer_id_offers",
        "ride_requests",
        type_="foreignkey",
    )
    for table, name, _condition in reversed(_CHECK_CONSTRAINTS):
        op.drop_constraint(name, table, type_="check")
