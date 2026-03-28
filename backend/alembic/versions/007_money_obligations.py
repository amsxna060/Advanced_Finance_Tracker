"""Create money_obligations and obligation_settlements tables.

Revision ID: 007_money_obligations
Revises: 006_account_linking
Create Date: 2026-03-29
"""
from alembic import op
import sqlalchemy as sa

revision = "007_money_obligations"
down_revision = "006_account_linking"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "money_obligations",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("obligation_type", sa.String(20), nullable=False),
        sa.Column("contact_id", sa.Integer(), sa.ForeignKey("contacts.id"), nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("amount_settled", sa.Numeric(15, 2), server_default="0"),
        sa.Column("reason", sa.Text()),
        sa.Column("linked_type", sa.String(30)),
        sa.Column("linked_id", sa.Integer()),
        sa.Column("due_date", sa.Date()),
        sa.Column("status", sa.String(20), server_default="pending"),
        sa.Column("notes", sa.Text()),
        sa.Column("is_deleted", sa.Boolean(), server_default="false"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "obligation_settlements",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("obligation_id", sa.Integer(), sa.ForeignKey("money_obligations.id"), nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("settlement_date", sa.Date(), nullable=False),
        sa.Column("payment_mode", sa.String(30)),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("cash_accounts.id")),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("obligation_settlements")
    op.drop_table("money_obligations")
