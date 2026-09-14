"""Add phone accounts, managed sessions, and audited recovery without backfilling trust."""

import sqlalchemy as sa
from alembic import op

revision = "0025_managed_accounts"
down_revision = "0024_phone_verification"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("users", "email", existing_type=sa.String(320), nullable=True)
    op.add_column("users", sa.Column("phone_verified_at", sa.DateTime(timezone=True)))
    op.add_column(
        "users",
        sa.Column("legacy_auth_disabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "users", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true())
    )
    op.add_column("users", sa.Column("terms_version", sa.String(80)))
    op.add_column("users", sa.Column("terms_accepted_at", sa.DateTime(timezone=True)))
    op.add_column("phone_challenges", sa.Column("actor_user_id", sa.Uuid()))
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("device_name", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("revocation_reason", sa.String(40)),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_table(
        "auth_refresh_credentials",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Uuid(),
            sa.ForeignKey("auth_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("access_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True)),
        sa.Column("request_id", sa.Uuid()),
        sa.Column("successor_id", sa.Uuid()),
    )
    op.create_index(
        "ix_auth_refresh_credentials_session_id", "auth_refresh_credentials", ["session_id"]
    )
    op.create_table(
        "phone_completion_receipts",
        sa.Column("proof_digest", sa.String(64), primary_key=True),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("device_digest", sa.String(64), nullable=False),
        sa.Column(
            "session_id",
            sa.Uuid(),
            sa.ForeignKey("auth_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "credential_id",
            sa.Uuid(),
            sa.ForeignKey("auth_refresh_credentials.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "account_audit_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event", sa.String(60), nullable=False),
        sa.Column("user_id", sa.Uuid()),
        sa.Column("actor_id", sa.Uuid()),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_account_audit_events_user_id", "account_audit_events", ["user_id"])
    op.create_index("ix_account_audit_events_created_at", "account_audit_events", ["created_at"])
    op.create_table(
        "account_recovery_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("proof_digest", sa.String(64), unique=True, nullable=False),
        sa.Column("device_digest", sa.String(64), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("contact_phone", sa.String(16), nullable=False),
        sa.Column("account_hint", sa.String(255), nullable=False),
        sa.Column("reason", sa.String(1000), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("user_id", sa.Uuid()),
        sa.Column("reviewer_id", sa.Uuid()),
        sa.Column("evidence_reference", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    # Never invent emails or discard phone-only accounts to make a rollback fit.
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM users WHERE email IS NULL")):
        raise RuntimeError("Phone-only accounts require a reviewed data migration before downgrade")
    for table in (
        "account_recovery_requests",
        "account_audit_events",
        "phone_completion_receipts",
        "auth_refresh_credentials",
        "auth_sessions",
    ):
        op.drop_table(table)
    op.drop_column("phone_challenges", "actor_user_id")
    for column in (
        "terms_accepted_at",
        "terms_version",
        "is_active",
        "legacy_auth_disabled",
        "phone_verified_at",
    ):
        op.drop_column("users", column)
    op.alter_column("users", "email", existing_type=sa.String(320), nullable=False)
