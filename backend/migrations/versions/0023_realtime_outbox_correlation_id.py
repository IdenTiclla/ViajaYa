"""Correlaciona cada evento durable con su solicitud o acción productora.

Revision ID: 0023_outbox_correlation_id
Revises: 0022_scheduled_actions
Create Date: 2026-07-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023_outbox_correlation_id"
down_revision: str | None = "0022_scheduled_actions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "realtime_outbox",
        sa.Column(
            "correlation_id",
            sa.Uuid(),
            nullable=True,
        ),
    )
    # Para el histórico, batch_id es un identificador estable que agrupa el
    # mismo efecto de negocio sin inventar vínculos entre batches distintos.
    op.execute(
        sa.text(
            "UPDATE realtime_outbox "
            "SET correlation_id = batch_id "
            "WHERE correlation_id IS NULL"
        )
    )
    # Un default no puede referenciar ``batch_id`` y ``gen_random_uuid()`` se
    # evaluaría una vez por fila. El trigger mantiene compatible al productor
    # anterior y asigna la misma correlación estable a todo su fanout.
    op.execute(
        sa.text(
            """
            CREATE FUNCTION set_realtime_outbox_legacy_correlation_id()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                IF NEW.correlation_id IS NULL THEN
                    NEW.correlation_id := NEW.batch_id;
                END IF;
                RETURN NEW;
            END;
            $$
            """
        )
    )
    op.execute(
        sa.text(
            """
            CREATE TRIGGER trg_realtime_outbox_legacy_correlation_id
            BEFORE INSERT ON realtime_outbox
            FOR EACH ROW
            WHEN (NEW.correlation_id IS NULL)
            EXECUTE FUNCTION set_realtime_outbox_legacy_correlation_id()
            """
        )
    )
    op.alter_column(
        "realtime_outbox",
        "correlation_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "DROP TRIGGER trg_realtime_outbox_legacy_correlation_id "
            "ON realtime_outbox"
        )
    )
    op.execute(
        sa.text("DROP FUNCTION set_realtime_outbox_legacy_correlation_id()")
    )
    op.drop_column("realtime_outbox", "correlation_id")
