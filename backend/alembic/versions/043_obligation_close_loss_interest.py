"""Obligation close-with-loss + extra interest/profit columns.

Adds:
  money_obligations.loss_amount      — remaining written off when closed at a loss
  money_obligations.closed_date      — date the obligation was closed with loss
  money_obligations.interest_amount  — running total of extra interest/profit collected
  obligation_settlements.interest_amount — interest/profit portion of a single payment

Revision ID: 043_obligation_close_loss
Revises: 042_account_txn_source
Create Date: 2026-06-22
"""
from alembic import op
import sqlalchemy as sa

revision = "043_obligation_close_loss"
down_revision = "042_account_txn_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "money_obligations",
        sa.Column("loss_amount", sa.Numeric(15, 2), server_default="0"),
    )
    op.add_column(
        "money_obligations",
        sa.Column("closed_date", sa.Date()),
    )
    op.add_column(
        "money_obligations",
        sa.Column("interest_amount", sa.Numeric(15, 2), server_default="0"),
    )
    op.add_column(
        "obligation_settlements",
        sa.Column("interest_amount", sa.Numeric(15, 2), server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("obligation_settlements", "interest_amount")
    op.drop_column("money_obligations", "interest_amount")
    op.drop_column("money_obligations", "closed_date")
    op.drop_column("money_obligations", "loss_amount")
