"""Persist the passenger's pickup acknowledgement without changing ride stages.

Revision ID: 0030_rider_pickup_notice
Revises: 0029_ride_vehicle_snapshot
"""

import sqlalchemy as sa
from alembic import op

revision = "0030_rider_pickup_notice"
down_revision = "0029_ride_vehicle_snapshot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ride_requests",
        sa.Column("rider_on_the_way_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ride_requests", "rider_on_the_way_at")
