"""Add a terminal quarantine for invalid outbox batches.

Revision ID: 0020_realtime_outbox_quarantine
Revises: 0019_realtime_stream_versions
Create Date: 2026-07-18
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020_realtime_outbox_quarantine"
down_revision: str | None = "0019_realtime_stream_versions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "realtime_outbox",
        sa.Column("quarantined_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "realtime_outbox",
        sa.Column("quarantine_code", sa.String(length=64), nullable=True),
    )
    op.create_check_constraint(
        "ck_realtime_outbox_terminal_state_exclusive",
        "realtime_outbox",
        "published_at IS NULL OR quarantined_at IS NULL",
    )
    op.create_check_constraint(
        "ck_realtime_outbox_quarantine_complete",
        "realtime_outbox",
        "(quarantined_at IS NULL) = (quarantine_code IS NULL)",
    )
    op.create_check_constraint(
        "ck_realtime_outbox_quarantine_code_length",
        "realtime_outbox",
        "quarantine_code IS NULL OR "
        "length(trim(quarantine_code)) BETWEEN 1 AND 64",
    )

    op.drop_index("ix_realtime_outbox_pending", table_name="realtime_outbox")
    op.create_index(
        "ix_realtime_outbox_pending",
        "realtime_outbox",
        ["next_attempt_at", "created_at", "id"],
        unique=False,
        postgresql_where=sa.text(
            "published_at IS NULL AND quarantined_at IS NULL AND sequence = 0"
        ),
    )
    op.drop_index(
        "ix_realtime_outbox_pending_stream",
        table_name="realtime_outbox",
    )
    op.create_index(
        "ix_realtime_outbox_pending_stream",
        "realtime_outbox",
        ["topic", "stream_version"],
        unique=False,
        postgresql_where=sa.text(
            "published_at IS NULL AND quarantined_at IS NULL"
        ),
    )
    op.create_index(
        "ix_realtime_outbox_quarantined",
        "realtime_outbox",
        ["quarantined_at", "batch_id"],
        unique=False,
        postgresql_where=sa.text(
            "quarantined_at IS NOT NULL AND sequence = 0"
        ),
    )


def downgrade() -> None:
    quarantined_count = int(
        op.get_bind()
        .execute(
            sa.text(
                "SELECT count(*) FROM realtime_outbox "
                "WHERE quarantined_at IS NOT NULL"
            )
        )
        .scalar_one()
    )
    if quarantined_count:
        raise RuntimeError(
            "Cannot revert 0020: there are quarantined outbox events."
        )

    op.drop_index("ix_realtime_outbox_quarantined", table_name="realtime_outbox")
    op.drop_index(
        "ix_realtime_outbox_pending_stream",
        table_name="realtime_outbox",
    )
    op.create_index(
        "ix_realtime_outbox_pending_stream",
        "realtime_outbox",
        ["topic", "stream_version"],
        unique=False,
        postgresql_where=sa.text("published_at IS NULL"),
    )
    op.drop_index("ix_realtime_outbox_pending", table_name="realtime_outbox")
    op.create_index(
        "ix_realtime_outbox_pending",
        "realtime_outbox",
        ["next_attempt_at", "created_at", "id"],
        unique=False,
        postgresql_where=sa.text("published_at IS NULL AND sequence = 0"),
    )

    op.drop_constraint(
        "ck_realtime_outbox_quarantine_code_length",
        "realtime_outbox",
        type_="check",
    )
    op.drop_constraint(
        "ck_realtime_outbox_quarantine_complete",
        "realtime_outbox",
        type_="check",
    )
    op.drop_constraint(
        "ck_realtime_outbox_terminal_state_exclusive",
        "realtime_outbox",
        type_="check",
    )
    op.drop_column("realtime_outbox", "quarantine_code")
    op.drop_column("realtime_outbox", "quarantined_at")
