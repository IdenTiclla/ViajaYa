"""add payment_method to ride_requests

Revision ID: 0003_add_payment_method
Revises: 0002_create_ride_requests
Create Date: 2026-05-30

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_add_payment_method"
down_revision: str | None = "0002_create_ride_requests"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ride_requests",
        sa.Column(
            "payment_method",
            sa.String(length=20),
            server_default="cash",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("ride_requests", "payment_method")
