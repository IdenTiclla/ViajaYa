"""ride_requests: auto_accept (assign the first driver who accepts the passenger's fare)

Revision ID: 0031_ride_auto_accept
Revises: 0030_rider_pickup_notice
"""

import sqlalchemy as sa
from alembic import op

revision = "0031_ride_auto_accept"
down_revision = "0030_rider_pickup_notice"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ride_requests",
        sa.Column("auto_accept", sa.Boolean(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("ride_requests", "auto_accept")
