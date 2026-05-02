"""026 add recurring_transactions table and loan priority column"""

from alembic import op
import sqlalchemy as sa

revision = "026_recurring_transactions_loan_priority"
down_revision = "025_forecast_overrides"
branch_labels = None
depends_on = None


def upgrade():
    # --- enum types (idempotent: skip if already exists) ---
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE recurring_type_enum AS ENUM ('inflow', 'outflow');
        EXCEPTION WHEN duplicate_object THEN null;
        END $$
    """)
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE recurring_frequency_enum AS ENUM ('weekly', 'monthly', 'yearly');
        EXCEPTION WHEN duplicate_object THEN null;
        END $$
    """)
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE loan_priority_enum AS ENUM ('high', 'medium', 'low');
        EXCEPTION WHEN duplicate_object THEN null;
        END $$
    """)

    # --- recurring_transactions (idempotent) ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS recurring_transactions (
            id          SERIAL PRIMARY KEY,
            created_by  INTEGER NOT NULL REFERENCES users(id),
            title       VARCHAR(255) NOT NULL,
            type        recurring_type_enum NOT NULL,
            amount      NUMERIC(15, 2) NOT NULL,
            frequency   recurring_frequency_enum NOT NULL,
            next_due_date DATE NOT NULL,
            account_id  INTEGER REFERENCES cash_accounts(id),
            is_active   BOOLEAN NOT NULL DEFAULT TRUE,
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_recurring_transactions_created_by   ON recurring_transactions (created_by)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_recurring_transactions_next_due_date ON recurring_transactions (next_due_date)")

    # --- loans.priority (idempotent: skip if column already exists) ---
    op.execute("""
        DO $$ BEGIN
            ALTER TABLE loans ADD COLUMN priority loan_priority_enum DEFAULT 'medium';
        EXCEPTION WHEN duplicate_column THEN null;
        END $$
    """)


def downgrade():
    op.execute("ALTER TABLE loans DROP COLUMN IF EXISTS priority")
    op.execute("DROP INDEX IF EXISTS ix_recurring_transactions_next_due_date")
    op.execute("DROP INDEX IF EXISTS ix_recurring_transactions_created_by")
    op.execute("DROP TABLE IF EXISTS recurring_transactions")
    op.execute("DROP TYPE IF EXISTS loan_priority_enum")
    op.execute("DROP TYPE IF EXISTS recurring_frequency_enum")
    op.execute("DROP TYPE IF EXISTS recurring_type_enum")
