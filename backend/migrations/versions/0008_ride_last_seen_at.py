"""ride last_seen_at heartbeat

Revision ID: 0008_ride_last_seen_at
Revises: 0007_ride_ratings
Create Date: 2026-06-01

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008_ride_last_seen_at"
down_revision = "0007_ride_ratings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ride_requests",
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("ride_requests", "last_seen_at")
