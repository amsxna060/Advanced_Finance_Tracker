"""Add credit card fields and category limits table

Revision ID: 016_credit_cards_category_limits
Revises: 015_partnership_txn_enh
Create Date: 2026-04-14
"""

from alembic import op
import sqlalchemy as sa

revision = "016_credit_cards_category_limits"
down_revision = "015_partnership_txn_enh"
branch_labels = None
depends_on = None


def upgrade():
    # Add credit card fields to cash_accounts (idempotent)
    from alembic import op
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)

    existing_cols = {c["name"] for c in inspector.get_columns("cash_accounts")}
    if "credit_limit" not in existing_cols:
        op.add_column("cash_accounts", sa.Column("credit_limit", sa.Numeric(15, 2), nullable=True))
    if "billing_cycle_date" not in existing_cols:
        op.add_column("cash_accounts", sa.Column("billing_cycle_date", sa.Integer(), nullable=True))

    # Create category_limits table (only if it doesn't already exist)
    if "category_limits" not in inspector.get_table_names():
        op.create_table(
            "category_limits",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("category", sa.String(100), nullable=False, unique=True),
            sa.Column("monthly_limit", sa.Numeric(15, 2), nullable=False),
            sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )


def downgrade():
    op.drop_table("category_limits")
    op.drop_column("cash_accounts", "billing_cycle_date")
    op.drop_column("cash_accounts", "credit_limit")
