"""ride_requests: paused (oculta la solicitud del pool mientras se edita)

Revision ID: 0012_ride_paused
Revises: 0011_drop_offer_rider_accepted
Create Date: 2026-06-20

Bandera ortogonal al ``status``: el ride sigue ``SEARCHING`` pero
``list_open_for_service`` lo excluye mientras ``paused=True`` (el pasajero está
modificando la solicitud). Las ofertas vivas se retiran al pausar y la solicitud
vuelve a publicarse al guardar la edición.
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
