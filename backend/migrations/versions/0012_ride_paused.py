"""ride_requests: paused (hides the request from the pool while it is being edited)

Revision ID: 0012_ride_paused
Revises: 0011_drop_offer_rider_accepted
Create Date: 2026-06-20

A flag orthogonal to ``status``: the ride stays ``SEARCHING`` but
``list_open_for_service`` excludes it while ``paused=True`` (the passenger is
modifying the request). Live offers are withdrawn when pausing and the request
is published again when the edit is saved.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0012_ride_paused"
down_revision = "0011_drop_offer_rider_accepted"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ride_requests",
        sa.Column("paused", sa.Boolean(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("ride_requests", "paused")
