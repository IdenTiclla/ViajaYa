"""Create the durable outbox and the aggregate version counters.

Revision ID: 0018_realtime_outbox
Revises: 0017_pg_integrity_indexes
Create Date: 2026-07-18
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0018_realtime_outbox"
down_revision: str | None = "0017_pg_integrity_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "realtime_aggregate_versions",
        sa.Column("aggregate_type", sa.String(length=32), nullable=False),
        sa.Column("aggregate_id", sa.Uuid(), nullable=False),
        sa.Column(
            "version",
            sa.BigInteger(),
            server_default="0",
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "version >= 0",
            name="ck_realtime_aggregate_versions_version_nonnegative",
        ),
        sa.PrimaryKeyConstraint(
            "aggregate_type",
            "aggregate_id",
            name="pk_realtime_aggregate_versions",
        ),
    )

    op.create_table(
        "realtime_outbox",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column(
            "sequence",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("topic", sa.String(length=255), nullable=False),
        sa.Column("aggregate_type", sa.String(length=32), nullable=False),
        sa.Column("aggregate_id", sa.Uuid(), nullable=False),
        sa.Column("aggregate_version", sa.BigInteger(), nullable=False),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "next_attempt_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "attempts",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "sequence >= 0",
            name="ck_realtime_outbox_sequence_nonnegative",
        ),
        sa.CheckConstraint(
            "aggregate_version >= 1",
            name="ck_realtime_outbox_aggregate_version_positive",
        ),
        sa.CheckConstraint(
            "attempts >= 0",
            name="ck_realtime_outbox_attempts_nonnegative",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_realtime_outbox"),
        sa.UniqueConstraint(
            "batch_id",
            "sequence",
            name="uq_realtime_outbox_batch_sequence",
        ),
        sa.UniqueConstraint(
            "aggregate_type",
            "aggregate_id",
            "aggregate_version",
            name="uq_realtime_outbox_aggregate_version",
        ),
    )
    op.create_index(
        "ix_realtime_outbox_pending",
        "realtime_outbox",
        ["next_attempt_at", "created_at", "id"],
        unique=False,
        postgresql_where=sa.text("published_at IS NULL AND sequence = 0"),
    )


def downgrade() -> None:
    op.drop_index("ix_realtime_outbox_pending", table_name="realtime_outbox")
    op.drop_table("realtime_outbox")
    op.drop_table("realtime_aggregate_versions")
