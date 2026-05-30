"""create ride_requests table

Revision ID: 0002_create_ride_requests
Revises: 0001_create_users
Create Date: 2026-05-29

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

revision: str = "0002_create_ride_requests"
down_revision: str | None = "0001_create_users"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ride_requests",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column(
            "rider_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("origin_latitude", sa.Float(), nullable=False),
        sa.Column("origin_longitude", sa.Float(), nullable=False),
        sa.Column("origin_name", sa.String(length=255), nullable=False),
        sa.Column("origin_address", sa.String(length=512), nullable=False),
        sa.Column("destination_latitude", sa.Float(), nullable=False),
        sa.Column("destination_longitude", sa.Float(), nullable=False),
        sa.Column("destination_name", sa.String(length=255), nullable=False),
        sa.Column("destination_address", sa.String(length=512), nullable=False),
        sa.Column("service_type", sa.String(length=20), nullable=False),
        sa.Column("fare", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="searching", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_ride_requests_rider_id", "ride_requests", ["rider_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ride_requests_rider_id", table_name="ride_requests")
    op.drop_table("ride_requests")
