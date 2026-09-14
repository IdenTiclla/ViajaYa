"""Driver vehicles: one row per registered vehicle (taxi, moto, truck) and user.

``users.vehicle_type``/``plate``/``vehicle_model``/``driver_services`` become the
*active* vehicle (chosen when entering driver mode) and ``users.driver_status``
the aggregate over the vehicles. Every driver with a vehicle on ``users`` gets
that vehicle backfilled here with its current status and services.

Revision ID: 0028_driver_vehicles
Revises: 0027_driver_applications
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0028_driver_vehicles"
down_revision = "0027_driver_applications"
branch_labels = None
depends_on = None

_SERVICES_TYPE = sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    vehicles = op.create_table(
        "driver_vehicles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("vehicle_type", sa.String(length=20), nullable=False),
        sa.Column("plate", sa.String(length=20), nullable=False),
        sa.Column("vehicle_model", sa.String(length=120), nullable=False),
        sa.Column("services", _SERVICES_TYPE, nullable=False, server_default="[]"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("user_id", "vehicle_type", name="uq_driver_vehicles_user_type"),
    )
    op.create_index("ix_driver_vehicles_user_id", "driver_vehicles", ["user_id"])

    users = sa.table(
        "users",
        sa.column("id", sa.Uuid()),
        sa.column("vehicle_type", sa.String(20)),
        sa.column("plate", sa.String(20)),
        sa.column("vehicle_model", sa.String(120)),
        sa.column("driver_services", _SERVICES_TYPE),
        sa.column("driver_status", sa.String(20)),
    )
    connection = op.get_bind()
    rows = connection.execute(
        sa.select(
            users.c.id,
            users.c.vehicle_type,
            users.c.plate,
            users.c.vehicle_model,
            users.c.driver_services,
            users.c.driver_status,
        ).where(users.c.vehicle_type.isnot(None))
    ).all()
    for row in rows:
        connection.execute(
            vehicles.insert().values(
                id=uuid.uuid4(),
                user_id=row.id,
                vehicle_type=row.vehicle_type,
                plate=row.plate or "",
                vehicle_model=row.vehicle_model or "",
                services=list(row.driver_services or []),
                status=row.driver_status or "approved",
            )
        )


def downgrade() -> None:
    # The active vehicle stays on ``users``; other vehicles are lost.
    op.drop_index("ix_driver_vehicles_user_id", table_name="driver_vehicles")
    op.drop_table("driver_vehicles")
