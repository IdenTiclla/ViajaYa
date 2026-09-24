"""Add durable scheduled actions and recover pending offers.

Revision ID: 0022_scheduled_actions
Revises: 0021_realtime_outbox_batch_size
Create Date: 2026-07-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0022_scheduled_actions"
down_revision: str | None = "0021_realtime_outbox_batch_size"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scheduled_actions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("dedupe_key", sa.String(length=255), nullable=False),
        sa.Column("action_type", sa.String(length=64), nullable=False),
        sa.Column("aggregate_id", sa.Uuid(), nullable=False),
        sa.Column("generation", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("execute_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lock_token", sa.Uuid(), nullable=True),
        sa.Column("last_error", sa.String(length=64), nullable=True),
        sa.Column("terminal_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "generation >= 1",
            name="ck_scheduled_actions_generation_positive",
        ),
        sa.CheckConstraint(
            "attempts >= 0",
            name="ck_scheduled_actions_attempts_nonnegative",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'succeeded', 'cancelled', 'dead')",
            name="ck_scheduled_actions_status",
        ),
        sa.CheckConstraint(
            "(status = 'running') = (locked_at IS NOT NULL AND lock_token IS NOT NULL)",
            name="ck_scheduled_actions_lease_complete",
        ),
        sa.CheckConstraint(
            "(status IN ('succeeded', 'cancelled', 'dead')) = "
            "(terminal_at IS NOT NULL)",
            name="ck_scheduled_actions_terminal_complete",
        ),
        sa.CheckConstraint(
            "length(trim(dedupe_key)) BETWEEN 1 AND 255",
            name="ck_scheduled_actions_dedupe_key_length",
        ),
        sa.CheckConstraint(
            "length(trim(action_type)) BETWEEN 1 AND 64",
            name="ck_scheduled_actions_action_type_length",
        ),
        sa.CheckConstraint(
            "last_error IS NULL OR length(trim(last_error)) BETWEEN 1 AND 64",
            name="ck_scheduled_actions_last_error_length",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_scheduled_actions")),
        sa.UniqueConstraint(
            "dedupe_key",
            name=op.f("uq_scheduled_actions_dedupe_key"),
        ),
    )
    op.create_index(
        "ix_scheduled_actions_due",
        "scheduled_actions",
        ["next_attempt_at", "execute_at", "id"],
        unique=False,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "ix_scheduled_actions_stale",
        "scheduled_actions",
        ["locked_at", "id"],
        unique=False,
        postgresql_where=sa.text("status = 'running'"),
    )
    op.create_index(
        "ix_scheduled_actions_terminal_retention",
        "scheduled_actions",
        ["terminal_at", "id"],
        unique=False,
        postgresql_where=sa.text("status IN ('succeeded', 'cancelled')"),
    )

    # Recover offers that may have lost their asyncio.create_task during
    # a crash. The deadline keeps the 30 s from created_at, not from the deploy.
    op.execute(
        sa.text(
            """
            INSERT INTO scheduled_actions (
                id, dedupe_key, action_type, aggregate_id, generation,
                execute_at, payload, status, attempts, next_attempt_at
            )
            SELECT
                gen_random_uuid(),
                'expire_offer:' || id::text,
                'expire_offer',
                id,
                1,
                created_at + INTERVAL '30 seconds',
                jsonb_build_object('offer_id', id::text),
                'pending',
                0,
                created_at + INTERVAL '30 seconds'
            FROM offers
            WHERE status = 'pending'
            ON CONFLICT (dedupe_key) DO NOTHING
            """
        )
    )


def downgrade() -> None:
    pending_count = op.get_bind().execute(
        sa.text(
            "SELECT count(*) FROM scheduled_actions "
            "WHERE status IN ('pending', 'running')"
        )
    ).scalar_one()
    if pending_count:
        raise RuntimeError(
            "No se puede eliminar scheduled_actions con trabajo pendiente o reclamado."
        )
    op.drop_index(
        "ix_scheduled_actions_terminal_retention",
        table_name="scheduled_actions",
    )
    op.drop_index("ix_scheduled_actions_stale", table_name="scheduled_actions")
    op.drop_index("ix_scheduled_actions_due", table_name="scheduled_actions")
    op.drop_table("scheduled_actions")
