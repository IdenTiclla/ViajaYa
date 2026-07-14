"""Persist discarded pool requests per driver and request version.

Revision ID: 0016_driver_ride_dismissals
Revises: 0015_unique_active_ride
Create Date: 2026-07-11
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0016_driver_ride_dismissals"
down_revision = "0015_unique_active_ride"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ride_requests",
        sa.Column("pool_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_table(
        "driver_ride_dismissals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("driver_id", sa.Uuid(), nullable=False),
        sa.Column("ride_id", sa.Uuid(), nullable=False),
        sa.Column("pool_version", sa.Integer(), nullable=False),
        sa.Column(
            "dismissed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["driver_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ride_id"], ["ride_requests.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("driver_id", "ride_id", name="uq_driver_ride_dismissals_driver_ride"),
    )
    op.create_index("ix_driver_ride_dismissals_driver_id", "driver_ride_dismissals", ["driver_id"])
    op.create_index("ix_driver_ride_dismissals_ride_id", "driver_ride_dismissals", ["ride_id"])


def downgrade() -> None:
    op.drop_index("ix_driver_ride_dismissals_ride_id", table_name="driver_ride_dismissals")
    op.drop_index("ix_driver_ride_dismissals_driver_id", table_name="driver_ride_dismissals")
    op.drop_table("driver_ride_dismissals")
    op.drop_column("ride_requests", "pool_version")
