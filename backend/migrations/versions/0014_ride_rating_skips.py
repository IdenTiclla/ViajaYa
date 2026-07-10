"""ride_rating_skips: omisión persistente de calificación

Revision ID: 0014_ride_rating_skips
Revises: 0013_ride_terminal_timestamps
Create Date: 2026-07-09
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0014_ride_rating_skips"
down_revision = "0013_ride_terminal_timestamps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ride_rating_skips",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("ride_id", sa.Uuid(), nullable=False),
        sa.Column("rater_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["ride_id"], ["ride_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["rater_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "ride_id",
            "rater_id",
            name="uq_ride_rating_skips_ride_rater",
        ),
    )
    op.create_index(
        "ix_ride_rating_skips_ride_id",
        "ride_rating_skips",
        ["ride_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_ride_rating_skips_ride_id", table_name="ride_rating_skips")
    op.drop_table("ride_rating_skips")
