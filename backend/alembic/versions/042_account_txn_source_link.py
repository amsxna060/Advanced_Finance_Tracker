"""Add exact source link (source_type, source_id) to account_transactions

Reversals previously matched ledger rows by (linked_type, linked_id, txn_type,
amount, txn_date) — a heuristic that could void the wrong row when two
same-day same-amount entries existed. New rows are stamped with the exact
record that created them; legacy rows keep NULL and fall back to the old
matching.

Revision ID: 042_account_txn_source
Revises: 041_expense_recurring
Create Date: 2026-06-12
"""

from alembic import op
import sqlalchemy as sa

revision = "042_account_txn_source"
down_revision = "041_expense_recurring"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "account_transactions",
        sa.Column("source_type", sa.String(length=40), nullable=True),
    )
    op.add_column(
        "account_transactions",
        sa.Column("source_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_account_transactions_source",
        "account_transactions",
        ["source_type", "source_id"],
    )


def downgrade():
    op.drop_index("ix_account_transactions_source", table_name="account_transactions")
    op.drop_column("account_transactions", "source_id")
    op.drop_column("account_transactions", "source_type")
