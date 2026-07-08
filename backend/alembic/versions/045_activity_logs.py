"""Activity / audit log table.

One append-only row per action taken in the app (create/update/delete on any
record, plus login/logout). Written automatically by the flush listeners in
app/services/activity_logger.py.

Revision ID: 045_activity_logs
Revises: 044_payment_done_rename
Create Date: 2026-07-08
"""
from alembic import op
import sqlalchemy as sa

revision = "045_activity_logs"
down_revision = "044_payment_done_rename"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activity_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("user_id", sa.Integer()),
        sa.Column("username", sa.String(100)),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("module", sa.String(30), nullable=False),
        sa.Column("entity_type", sa.String(60), nullable=False),
        sa.Column("entity_id", sa.Integer()),
        sa.Column("entity_name", sa.String(255)),
        sa.Column("description", sa.Text()),
        sa.Column("changes", sa.JSON()),
        sa.Column("amount", sa.Numeric(15, 2)),
        sa.Column("account_id", sa.Integer()),
        sa.Column("contact_id", sa.Integer()),
        sa.Column("loan_id", sa.Integer()),
        sa.Column("request_info", sa.String(255)),
    )
    op.create_index("ix_activity_logs_created_at", "activity_logs", ["created_at"])
    op.create_index("ix_activity_logs_created_desc", "activity_logs", [sa.text("created_at DESC")])
    op.create_index("ix_activity_logs_user_id", "activity_logs", ["user_id"])
    op.create_index("ix_activity_logs_action", "activity_logs", ["action"])
    op.create_index("ix_activity_logs_module", "activity_logs", ["module"])
    op.create_index("ix_activity_logs_entity_type", "activity_logs", ["entity_type"])
    op.create_index("ix_activity_logs_entity_id", "activity_logs", ["entity_id"])
    op.create_index("ix_activity_logs_account_id", "activity_logs", ["account_id"])
    op.create_index("ix_activity_logs_contact_id", "activity_logs", ["contact_id"])
    op.create_index("ix_activity_logs_loan_id", "activity_logs", ["loan_id"])


def downgrade() -> None:
    op.drop_table("activity_logs")
