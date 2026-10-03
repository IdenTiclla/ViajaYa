"""ride_requests: arrived_at (when the driver reported being at the pickup point)

Revision ID: 0032_ride_arrived_at
Revises: 0031_ride_auto_accept
"""

import sqlalchemy as sa
from alembic import op

revision = "0032_ride_arrived_at"
down_revision = "0031_ride_auto_accept"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ride_requests",
        sa.Column("arrived_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ride_requests", "arrived_at")
