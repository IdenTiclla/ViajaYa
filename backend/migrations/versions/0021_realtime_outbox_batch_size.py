"""Añade cardinalidad durable e índice de retención a la outbox.

Revision ID: 0021_realtime_outbox_batch_size
Revises: 0020_realtime_outbox_quarantine
Create Date: 2026-07-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021_realtime_outbox_batch_size"
down_revision: str | None = "0020_realtime_outbox_quarantine"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "realtime_outbox",
        sa.Column("batch_size", sa.Integer(), nullable=True),
    )
    op.execute(
        sa.text(
            """
            WITH batch_cardinality AS (
                SELECT batch_id, MAX(sequence) + 1 AS batch_size
                FROM realtime_outbox
                GROUP BY batch_id
            )
            UPDATE realtime_outbox AS outbox
            SET batch_size = batch_cardinality.batch_size
            FROM batch_cardinality
            WHERE outbox.batch_id = batch_cardinality.batch_id
            """
        )
    )
    op.alter_column(
        "realtime_outbox",
        "batch_size",
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.create_check_constraint(
        "ck_realtime_outbox_batch_size_positive",
        "realtime_outbox",
        "batch_size >= 1",
    )
    op.create_check_constraint(
        "ck_realtime_outbox_sequence_within_batch",
        "realtime_outbox",
        "sequence < batch_size",
    )
    op.create_index(
        "ix_realtime_outbox_published_retention",
        "realtime_outbox",
        ["published_at", "batch_id"],
        unique=False,
        postgresql_where=sa.text(
            "published_at IS NOT NULL AND sequence = 0"
        ),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_realtime_outbox_published_retention",
        table_name="realtime_outbox",
    )
    op.drop_constraint(
        "ck_realtime_outbox_sequence_within_batch",
        "realtime_outbox",
        type_="check",
    )
    op.drop_constraint(
        "ck_realtime_outbox_batch_size_positive",
        "realtime_outbox",
        type_="check",
    )
    op.drop_column("realtime_outbox", "batch_size")
