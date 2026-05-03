"""027 add is_voided soft-delete column to account_transactions"""

from alembic import op
from sqlalchemy import text

revision = "027_account_txn_soft_delete"
down_revision = "026_recurring_txn_loan_prio"
branch_labels = None
depends_on = None


def upgrade():
    # Add is_voided column (idempotent)
    op.execute(text("""
        DO $$ BEGIN
            ALTER TABLE account_transactions
                ADD COLUMN is_voided BOOLEAN NOT NULL DEFAULT FALSE;
        EXCEPTION WHEN duplicate_column THEN null;
        END $$
    """))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_account_txn_is_voided "
        "ON account_transactions (is_voided)"
    ))


def downgrade():
    op.execute(text("DROP INDEX IF EXISTS ix_account_txn_is_voided"))
    op.execute(text("ALTER TABLE account_transactions DROP COLUMN IF EXISTS is_voided"))
