"""Freeze the assigned vehicle; historical trips without evidence remain unknown.

Revision ID: 0029_ride_vehicle_snapshot
Revises: 0028_driver_vehicles
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0029_ride_vehicle_snapshot"
down_revision = "0028_driver_vehicles"
branch_labels = None
depends_on = None

SNAPSHOT_TYPE = sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column("ride_requests", sa.Column("vehicle_snapshot", SNAPSHOT_TYPE, nullable=True))
    rides = sa.table(
        "ride_requests",
        sa.column("id", sa.Uuid()),
        sa.column("driver_id", sa.Uuid()),
        sa.column("status", sa.String()),
        sa.column("vehicle_snapshot", SNAPSHOT_TYPE),
    )
    users = sa.table(
        "users",
        sa.column("id", sa.Uuid()),
        sa.column("vehicle_type", sa.String()),
        sa.column("plate", sa.String()),
        sa.column("vehicle_model", sa.String()),
    )
    vehicles = sa.table(
        "driver_vehicles",
        sa.column("id", sa.Uuid()),
        sa.column("user_id", sa.Uuid()),
        sa.column("vehicle_type", sa.String()),
    )
    connection = op.get_bind()
    # Vehicle switching is forbidden during these stages. Completed/cancelled
    # trips cannot be reconstructed reliably from today's driver profile.
    rows = connection.execute(
        sa.select(
            rides.c.id,
            users.c.vehicle_type,
            users.c.plate,
            users.c.vehicle_model,
            vehicles.c.id.label("vehicle_id"),
        )
        .select_from(
            rides.join(users, rides.c.driver_id == users.c.id).outerjoin(
                vehicles,
                (vehicles.c.user_id == users.c.id)
                & (vehicles.c.vehicle_type == users.c.vehicle_type),
            )
        )
        .where(rides.c.status.in_(("accepted", "arriving", "in_progress")))
    )
    for row in rows:
        connection.execute(
            rides.update()
            .where(rides.c.id == row.id)
            .values(
                vehicle_snapshot={
                    "vehicle_id": str(row.vehicle_id) if row.vehicle_id else None,
                    "vehicle_type": row.vehicle_type,
                    "plate": row.plate,
                    "vehicle_model": row.vehicle_model,
                },
            )
        )


def downgrade() -> None:
    op.drop_column("ride_requests", "vehicle_snapshot")
