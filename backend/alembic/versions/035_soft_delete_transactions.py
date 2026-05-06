"""Add is_voided soft-delete to loan_payments, property_transactions, partnership_transactions

Revision ID: 035_soft_delete_transactions
Revises: 034_write_off_and_payment_fixes
Create Date: 2026-05-06
"""
from alembic import op

revision = "035_soft_delete_transactions"
down_revision = "034_write_off_and_payment_fixes"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE loan_payments ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE"
    )
    op.execute(
        "ALTER TABLE property_transactions ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE"
    )
    op.execute(
        "ALTER TABLE partnership_transactions ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE"
    )


def downgrade():
    op.execute("ALTER TABLE loan_payments DROP COLUMN IF EXISTS is_voided")
    op.execute("ALTER TABLE property_transactions DROP COLUMN IF EXISTS is_voided")
    op.execute("ALTER TABLE partnership_transactions DROP COLUMN IF EXISTS is_voided")
