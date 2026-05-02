"""026 add recurring_transactions table and loan priority column"""

from alembic import op
import sqlalchemy as sa

revision = "026_recurring_transactions_loan_priority"
down_revision = "025_forecast_overrides"
branch_labels = None
depends_on = None


def upgrade():
    # --- enum types ---
    op.execute("CREATE TYPE recurring_type_enum AS ENUM ('inflow', 'outflow')")
    op.execute("CREATE TYPE recurring_frequency_enum AS ENUM ('weekly', 'monthly', 'yearly')")
    op.execute("CREATE TYPE loan_priority_enum AS ENUM ('high', 'medium', 'low')")

    # --- recurring_transactions ---
    op.create_table(
        "recurring_transactions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("type", sa.Enum("inflow", "outflow", name="recurring_type_enum"), nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("frequency", sa.Enum("weekly", "monthly", "yearly", name="recurring_frequency_enum"), nullable=False),
        sa.Column("next_due_date", sa.Date, nullable=False),
        sa.Column("account_id", sa.Integer, sa.ForeignKey("cash_accounts.id"), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_recurring_transactions_created_by", "recurring_transactions", ["created_by"])
    op.create_index("ix_recurring_transactions_next_due_date", "recurring_transactions", ["next_due_date"])

    # --- loans.priority ---
    op.add_column(
        "loans",
        sa.Column(
            "priority",
            sa.Enum("high", "medium", "low", name="loan_priority_enum"),
            nullable=True,
            server_default="medium",
        ),
    )


def downgrade():
    op.drop_column("loans", "priority")
    op.drop_index("ix_recurring_transactions_next_due_date")
    op.drop_index("ix_recurring_transactions_created_by")
    op.drop_table("recurring_transactions")
    op.execute("DROP TYPE IF EXISTS loan_priority_enum")
    op.execute("DROP TYPE IF EXISTS recurring_frequency_enum")
    op.execute("DROP TYPE IF EXISTS recurring_type_enum")
