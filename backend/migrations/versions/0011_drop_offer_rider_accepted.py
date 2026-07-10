"""offers: retirar el estado rider_accepted (el pasajero decide, no el conductor)

Revision ID: 0011_drop_offer_rider_accepted
Revises: 0010_offer_rider_accepted_at
Create Date: 2026-06-20

Aceptación = asignación directa: el pasajero tiene la decisión final, así que el
estado intermedio ``rider_accepted`` (y su ventana de confirmación del conductor)
desaparecen. ``OfferStatus`` es un enum *no nativo* (``String`` con
``values_callable``), por lo que quitar el valor de Python **no** requiere un
``ALTER TYPE`` en Postgres. La columna física ``rider_accepted_at`` (creada en
0010) se conserva sin tocar y solo se mapea como almacenamiento legado, para no
perder datos históricos (drop de columna es destructivo).

Como saneamiento, marcamos ``rejected`` cualquier oferta que hubiera quedado en
``rider_accepted`` (ya no es un estado aceptable y rompería la negociación).
"""

from __future__ import annotations

from alembic import op

revision = "0011_drop_offer_rider_accepted"
down_revision = "0010_offer_rider_accepted_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE offers SET status = 'rejected' WHERE status = 'rider_accepted'")


def downgrade() -> None:
    # Nada que revertir en el esquema: el valor lógico ``rider_accepted`` se
    # reintegraría en entidades/modelo, y la columna ``rider_accepted_at`` sigue
    # existiendo (no se tocó). Sin DDL.
    pass
