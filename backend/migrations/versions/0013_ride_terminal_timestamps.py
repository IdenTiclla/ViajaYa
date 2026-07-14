"""ride_requests: timestamps terminales

Revision ID: 0013_ride_terminal_timestamps
Revises: 0012_ride_paused
Create Date: 2026-07-09
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013_ride_terminal_timestamps"
down_revision = "0012_ride_paused"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ride_requests",
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "ride_requests",
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE ride_requests SET completed_at = created_at "
            "WHERE status = 'completed' AND completed_at IS NULL"
        )
    )
    op.execute(
        sa.text(
            "UPDATE ride_requests SET cancelled_at = created_at "
            "WHERE status = 'cancelled' AND cancelled_at IS NULL"
        )
    )


def downgrade() -> None:
    op.drop_column("ride_requests", "cancelled_at")
    op.drop_column("ride_requests", "completed_at")
