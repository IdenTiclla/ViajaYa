"""Add monotonic per-topic sequences to the durable outbox.

Revision ID: 0019_realtime_stream_versions
Revises: 0018_realtime_outbox
Create Date: 2026-07-18
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_realtime_stream_versions"
down_revision: str | None = "0018_realtime_outbox"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "realtime_stream_versions",
        sa.Column("topic", sa.String(length=255), nullable=False),
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
            name="ck_realtime_stream_versions_version_nonnegative",
        ),
        sa.PrimaryKeyConstraint("topic", name="pk_realtime_stream_versions"),
    )

    op.add_column(
        "realtime_outbox",
        sa.Column("stream_version", sa.BigInteger(), nullable=True),
    )
    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT
                    id,
                    row_number() OVER (
                        PARTITION BY topic
                        ORDER BY created_at, batch_id, sequence, id
                    ) AS stream_version
                FROM realtime_outbox
            )
            UPDATE realtime_outbox AS outbox
            SET stream_version = ranked.stream_version
            FROM ranked
            WHERE outbox.id = ranked.id
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO realtime_stream_versions (topic, version)
            SELECT topic, MAX(stream_version)
            FROM realtime_outbox
            GROUP BY topic
            """
        )
    )
    op.alter_column(
        "realtime_outbox",
        "stream_version",
        existing_type=sa.BigInteger(),
        nullable=False,
    )
    op.create_check_constraint(
        "ck_realtime_outbox_stream_version_positive",
        "realtime_outbox",
        "stream_version >= 1",
    )
    op.create_unique_constraint(
        "uq_realtime_outbox_topic_stream_version",
        "realtime_outbox",
        ["topic", "stream_version"],
    )
    op.create_index(
        "ix_realtime_outbox_pending_stream",
        "realtime_outbox",
        ["topic", "stream_version"],
        unique=False,
        postgresql_where=sa.text("published_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_realtime_outbox_pending_stream",
        table_name="realtime_outbox",
    )
    op.drop_constraint(
        "uq_realtime_outbox_topic_stream_version",
        "realtime_outbox",
        type_="unique",
    )
    op.drop_constraint(
        "ck_realtime_outbox_stream_version_positive",
        "realtime_outbox",
        type_="check",
    )
    op.drop_column("realtime_outbox", "stream_version")
    op.drop_table("realtime_stream_versions")
