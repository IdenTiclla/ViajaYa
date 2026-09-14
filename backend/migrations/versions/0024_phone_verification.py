"""Add verified identities and bounded, one-use phone challenges without backfill."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0024_phone_verification"
down_revision = "0023_outbox_correlation_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Legacy phone/email/provider fields are not proof of ownership.
    op.create_table(
        "user_identities",
        sa.Column("provider", sa.String(16), primary_key=True),
        sa.Column("subject", sa.String(255), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "provider", name="uq_user_identity_provider"),
        sa.CheckConstraint("provider IN ('phone', 'google', 'facebook')",
                           name="ck_user_identity_provider"),
    )
    op.create_index("ix_user_identities_user_id", "user_identities", ["user_id"])
    op.create_table(
        "phone_challenges",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("phone", sa.String(16), nullable=False),
        sa.Column("purpose", sa.String(32), nullable=False),
        sa.Column("device_digest", sa.String(64), nullable=False),
        sa.Column("code_digest", sa.String(64), nullable=False),
        sa.Column("provider_id", sa.String(128), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True)),
        sa.Column("proof_digest", sa.String(64), unique=True),
        sa.Column("proof_expires_at", sa.DateTime(timezone=True)),
        sa.Column("consumed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("attempts >= 0 AND attempts <= 5", name="ck_phone_challenge_attempts"),
    )
    op.create_index("ix_phone_challenge_binding", "phone_challenges",
                    ["phone", "device_digest", "purpose"])
    op.create_index("ix_phone_challenges_expires_at", "phone_challenges", ["expires_at"])
    op.create_table(
        "phone_rate_budgets",
        sa.Column("key", sa.String(128), primary_key=True),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.Column("resets_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_phone_rate_budgets_resets_at", "phone_rate_budgets", ["resets_at"])


def downgrade() -> None:
    op.drop_table("phone_rate_budgets")
    op.drop_table("phone_challenges")
    op.drop_table("user_identities")
