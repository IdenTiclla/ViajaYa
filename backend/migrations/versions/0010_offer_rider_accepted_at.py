"""offers: rider_accepted_at (passenger acceptance pending confirmation)

Revision ID: 0010_offer_rider_accepted_at
Revises: 0009_drop_ride_last_seen_at
Create Date: 2026-06-09

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010_offer_rider_accepted_at"
down_revision = "0009_drop_ride_last_seen_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The ``rider_accepted`` status travels through the existing ``status`` column
    # (String(20), non-native enum): it does not require ALTER TYPE.
    op.add_column(
        "offers",
        sa.Column("rider_accepted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("offers", "rider_accepted_at")
