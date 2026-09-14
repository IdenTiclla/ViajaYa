"""Driver applications: per-driver services, application status and the truck vehicle.

``role`` becomes the account's active mode; ``driver_status`` says whether the
account may enter driver mode and ``driver_services`` which services it chose
(a subset of what its vehicle allows). Existing drivers are approved as they are
and keep every service their vehicle allowed so far (taxi/moto + delivery).
``truck``/``moving`` need no schema change: enums are plain VARCHAR(20).

Revision ID: 0027_driver_applications
Revises: 0026_drop_password_access
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0027_driver_applications"
down_revision = "0026_drop_password_access"
branch_labels = None
depends_on = None

_SERVICES_TYPE = sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("driver_services", _SERVICES_TYPE, nullable=False, server_default="[]"),
    )
    op.add_column("users", sa.Column("driver_status", sa.String(length=20), nullable=True))
    # Legacy drivers were approved out of band and served every vehicle service.
    users = sa.table(
        "users",
        sa.column("role", sa.String(20)),
        sa.column("vehicle_type", sa.String(20)),
        sa.column("driver_services", _SERVICES_TYPE),
        sa.column("driver_status", sa.String(20)),
    )
    connection = op.get_bind()
    for vehicle, services in (("taxi", ["taxi", "delivery"]), ("moto", ["moto", "delivery"])):
        connection.execute(
            users.update()
            .where(users.c.role == "driver", users.c.vehicle_type == vehicle)
            .values(driver_status="approved", driver_services=services)
        )


def downgrade() -> None:
    # Accounts riding as passengers keep role='passenger'; their application is lost.
    op.drop_column("users", "driver_status")
    op.drop_column("users", "driver_services")
