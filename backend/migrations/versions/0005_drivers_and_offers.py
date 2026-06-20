"""drivers role/fields, ride assignment and offers table

Revision ID: 0005_drivers_and_offers
Revises: 0004_create_saved_places
Create Date: 2026-05-31

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

revision: str = "0005_drivers_and_offers"
down_revision: str | None = "0004_create_saved_places"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- users: rol + campos de conductor ---
    op.add_column(
        "users",
        sa.Column(
            "role", sa.String(length=20), server_default="passenger", nullable=False
        ),
    )
    op.add_column("users", sa.Column("vehicle_type", sa.String(length=20), nullable=True))
    op.add_column("users", sa.Column("plate", sa.String(length=20), nullable=True))
    op.add_column("users", sa.Column("vehicle_model", sa.String(length=120), nullable=True))
    op.add_column("users", sa.Column("rating", sa.Float(), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "is_online", sa.Boolean(), server_default=sa.false(), nullable=False
        ),
    )

    # --- ride_requests: conductor asignado y oferta aceptada ---
    op.add_column(
        "ride_requests",
        sa.Column(
            "driver_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "ride_requests",
        sa.Column("accepted_offer_id", PGUUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "ix_ride_requests_driver_id", "ride_requests", ["driver_id"], unique=False
    )

    # --- offers ---
    op.create_table(
        "offers",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column(
            "ride_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("ride_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "driver_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("price", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("eta_min", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_offers_ride_id", "offers", ["ride_id"], unique=False)
    op.create_index("ix_offers_driver_id", "offers", ["driver_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_offers_driver_id", table_name="offers")
    op.drop_index("ix_offers_ride_id", table_name="offers")
    op.drop_table("offers")

    op.drop_index("ix_ride_requests_driver_id", table_name="ride_requests")
    op.drop_column("ride_requests", "accepted_offer_id")
    op.drop_column("ride_requests", "driver_id")

    op.drop_column("users", "is_online")
    op.drop_column("users", "rating")
    op.drop_column("users", "vehicle_model")
    op.drop_column("users", "plate")
    op.drop_column("users", "vehicle_type")
    op.drop_column("users", "role")
