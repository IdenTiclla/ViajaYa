"""drop ride last_seen_at (búsqueda infinita: la solicitud ya no caduca)

Revision ID: 0009_drop_ride_last_seen_at
Revises: 0008_ride_last_seen_at
Create Date: 2026-06-07

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009_drop_ride_last_seen_at"
down_revision = "0008_ride_last_seen_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("ride_requests", "last_seen_at")


def downgrade() -> None:
    op.add_column(
        "ride_requests",
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
