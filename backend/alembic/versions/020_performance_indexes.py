"""Add performance indexes for frequent query patterns

Revision ID: 020_performance_indexes
Revises: 019_category_limit_rollover
Create Date: 2026-04-27
"""

from alembic import op

revision = "020_performance_indexes"
down_revision = "019_category_limit_rollover"
branch_labels = None
depends_on = None


def upgrade():
    # Expenses — most filtered/sorted table
    op.create_index("ix_expenses_created_by_date", "expenses", ["created_by", "expense_date"])
    op.create_index("ix_expenses_expense_date", "expenses", ["expense_date"])
    op.create_index("ix_expenses_category", "expenses", ["category"])

    # Account transactions — used in balance aggregation and cashflow
    op.create_index("ix_account_txn_account_date", "account_transactions", ["account_id", "txn_date"])
    op.create_index("ix_account_txn_type", "account_transactions", ["txn_type"])

    # Loans — filtered on is_deleted + status on every dashboard/summary call
    op.create_index("ix_loans_deleted_status", "loans", ["is_deleted", "status"])
    op.create_index("ix_loans_contact_id", "loans", ["contact_id"])

    # Loan payments — joined in cashflow GROUP BY
    op.create_index("ix_loan_payments_loan_id", "loan_payments", ["loan_id"])
    op.create_index("ix_loan_payments_date", "loan_payments", ["payment_date"])

    # Loan capitalization events — queried per loan in calculate_outstanding
    op.create_index(
        "ix_loan_cap_events_loan_id",
        "loan_capitalization_events",
        ["loan_id"],
    )


def downgrade():
    op.drop_index("ix_expenses_created_by_date", table_name="expenses")
    op.drop_index("ix_expenses_expense_date", table_name="expenses")
    op.drop_index("ix_expenses_category", table_name="expenses")
    op.drop_index("ix_account_txn_account_date", table_name="account_transactions")
    op.drop_index("ix_account_txn_type", table_name="account_transactions")
    op.drop_index("ix_loans_deleted_status", table_name="loans")
    op.drop_index("ix_loans_contact_id", table_name="loans")
    op.drop_index("ix_loan_payments_loan_id", table_name="loan_payments")
    op.drop_index("ix_loan_payments_date", table_name="loan_payments")
    op.drop_index("ix_loan_cap_events_loan_id", table_name="loan_capitalization_events")
