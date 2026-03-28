"""Add account_id linking across all modules + contact_id on account_transactions.

All new columns are nullable — zero impact on existing data.

Revision ID: 006_account_linking
Revises: 005_add_contact_account_to_beesi
Create Date: 2026-03-28
"""
from alembic import op
import sqlalchemy as sa

revision = "006_account_linking"
down_revision = "005_add_contact_account_to_beesi"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Loans: default account for money in/out
    op.add_column("loans", sa.Column("account_id", sa.Integer(), sa.ForeignKey("cash_accounts.id"), nullable=True))
    # Loan payments: which account was used for this payment
    op.add_column("loan_payments", sa.Column("account_id", sa.Integer(), sa.ForeignKey("cash_accounts.id"), nullable=True))
    # Expenses: which account was debited
    op.add_column("expenses", sa.Column("account_id", sa.Integer(), sa.ForeignKey("cash_accounts.id"), nullable=True))
    # Property transactions: which account was used
    op.add_column("property_transactions", sa.Column("account_id", sa.Integer(), sa.ForeignKey("cash_accounts.id"), nullable=True))
    # Partnership transactions: which account was used
    op.add_column("partnership_transactions", sa.Column("account_id", sa.Integer(), sa.ForeignKey("cash_accounts.id"), nullable=True))
    # Account transactions: track which contact this money relates to
    op.add_column("account_transactions", sa.Column("contact_id", sa.Integer(), sa.ForeignKey("contacts.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("account_transactions", "contact_id")
    op.drop_column("partnership_transactions", "account_id")
    op.drop_column("property_transactions", "account_id")
    op.drop_column("expenses", "account_id")
    op.drop_column("loan_payments", "account_id")
    op.drop_column("loans", "account_id")
