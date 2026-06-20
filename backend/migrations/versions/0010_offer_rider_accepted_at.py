"""offers: rider_accepted_at (aceptación del pasajero pendiente de confirmar)

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
    # El estado ``rider_accepted`` viaja por la columna ``status`` existente
    # (String(20), enum no nativo): no requiere ALTER TYPE.
    op.add_column(
        "offers",
        sa.Column("rider_accepted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("offers", "rider_accepted_at")
