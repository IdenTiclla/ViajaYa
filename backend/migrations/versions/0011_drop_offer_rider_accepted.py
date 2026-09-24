"""offers: remove the rider_accepted status (the passenger decides, not the driver)

Revision ID: 0011_drop_offer_rider_accepted
Revises: 0010_offer_rider_accepted_at
Create Date: 2026-06-20

Acceptance = direct assignment: the passenger has the final say, so the
intermediate ``rider_accepted`` status (and its driver confirmation window)
go away. ``OfferStatus`` is a *non-native* enum (``String`` with
``values_callable``), so removing the Python value does **not** require an
``ALTER TYPE`` in Postgres. The physical ``rider_accepted_at`` column (created in
0010) is kept untouched and only mapped as legacy storage, so no
historical data is lost (dropping a column is destructive).

As a cleanup, we mark ``rejected`` any offer left in
``rider_accepted`` (it is no longer an acceptable status and would break the negotiation).
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
    # Nothing to revert in the schema: the logical ``rider_accepted`` value would be
    # reinstated in the entities/model, and the ``rider_accepted_at`` column still
    # exists (it was not touched). No DDL.
    pass
