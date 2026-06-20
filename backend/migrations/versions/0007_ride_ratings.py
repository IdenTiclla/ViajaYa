"""ride ratings

Revision ID: 0007_ride_ratings
Revises: 0006_normalize_enum_values
Create Date: 2026-05-31

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_ride_ratings"
down_revision = "0006_normalize_enum_values"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ride_ratings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("ride_id", sa.Uuid(), nullable=False),
        sa.Column("rater_id", sa.Uuid(), nullable=False),
        sa.Column("ratee_id", sa.Uuid(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["ride_id"], ["ride_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["rater_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ratee_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("ride_id", "rater_id", name="uq_ride_ratings_ride_rater"),
    )
    op.create_index("ix_ride_ratings_ride_id", "ride_ratings", ["ride_id"])
    op.create_index("ix_ride_ratings_ratee_id", "ride_ratings", ["ratee_id"])


def downgrade() -> None:
    op.drop_index("ix_ride_ratings_ratee_id", table_name="ride_ratings")
    op.drop_index("ix_ride_ratings_ride_id", table_name="ride_ratings")
    op.drop_table("ride_ratings")
