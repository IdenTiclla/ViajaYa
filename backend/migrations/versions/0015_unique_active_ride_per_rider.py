"""Garantiza un único viaje activo por pasajero.

Revision ID: 0015_unique_active_ride
Revises: 0014_ride_rating_skips
Create Date: 2026-07-10
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0015_unique_active_ride"
down_revision = "0014_ride_rating_skips"
branch_labels = None
depends_on = None


_RANKED_ACTIVE_RIDES = """
    SELECT
        id,
        COUNT(*) OVER (PARTITION BY rider_id) AS active_count,
        COUNT(*) FILTER (
            WHERE status IN ('accepted', 'arriving', 'in_progress')
        ) OVER (PARTITION BY rider_id) AS assigned_count,
        ROW_NUMBER() OVER (
            PARTITION BY rider_id
            ORDER BY
                CASE status
                    WHEN 'in_progress' THEN 1
                    WHEN 'arriving' THEN 2
                    WHEN 'accepted' THEN 3
                    WHEN 'searching' THEN 4
                END,
                created_at DESC,
                id DESC
        ) AS active_position
    FROM ride_requests
    WHERE status IN ('searching', 'accepted', 'arriving', 'in_progress')
"""


def upgrade() -> None:
    # Cierra primero las ofertas pendientes de los viajes históricos duplicados.
    op.execute(
        sa.text(
            f"""
            WITH ranked_active AS ({_RANKED_ACTIVE_RIDES})
            UPDATE offers
            SET status = 'rejected'
            WHERE status = 'pending'
              AND ride_id IN (
                  SELECT id
                  FROM ranked_active
                  WHERE active_count > 1
                    AND (assigned_count = 0 OR active_position > 1)
              )
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            WITH ranked_active AS ({_RANKED_ACTIVE_RIDES})
            UPDATE ride_requests
            SET status = 'cancelled',
                cancelled_at = COALESCE(cancelled_at, CURRENT_TIMESTAMP)
            WHERE id IN (
                SELECT id
                FROM ranked_active
                WHERE active_count > 1
                  AND (assigned_count = 0 OR active_position > 1)
            )
            """
        )
    )

    op.create_index(
        "uq_ride_requests_active_rider",
        "ride_requests",
        ["rider_id"],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('searching', 'accepted', 'arriving', 'in_progress')"
        ),
        sqlite_where=sa.text(
            "status IN ('searching', 'accepted', 'arriving', 'in_progress')"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_ride_requests_active_rider", table_name="ride_requests")
