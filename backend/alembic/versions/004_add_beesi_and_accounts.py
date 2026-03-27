"""004_add_beesi_and_accounts

Revision ID: 004_add_beesi_and_accounts
Revises: 003_add_plot_dimensions_site_fields
Create Date: 2026-03-27

Adds:
  - beesis              (chit fund / BC tracking)
  - beesi_installments  (monthly payment log)
  - beesi_withdrawals   (pot withdrawal / lumpsum received)
  - cash_accounts       (named cash/bank/wallet accounts)
  - account_transactions (debit/credit ledger entries)
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "004_add_beesi_and_accounts"
down_revision = "003_add_plot_dimensions_site_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ─── beesis ────────────────────────────────────────────────────────────────
    op.create_table(
        "beesis",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("pot_size", sa.Numeric(15, 2), nullable=False),
        sa.Column("member_count", sa.Integer, nullable=False),
        sa.Column("tenure_months", sa.Integer, nullable=False),
        sa.Column("base_installment", sa.Numeric(15, 2), nullable=False),
        sa.Column("start_date", sa.Date, nullable=False),
        sa.Column("status", sa.String(20), server_default="active", nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("is_deleted", sa.Boolean, server_default=sa.false(), nullable=True),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ─── beesi_installments ────────────────────────────────────────────────────
    op.create_table(
        "beesi_installments",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("beesi_id", sa.Integer, sa.ForeignKey("beesis.id"), nullable=False),
        sa.Column("month_number", sa.Integer, nullable=False),
        sa.Column("payment_date", sa.Date, nullable=False),
        sa.Column("base_amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("dividend_received", sa.Numeric(15, 2), server_default="0"),
        sa.Column("actual_paid", sa.Numeric(15, 2), nullable=False),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ─── beesi_withdrawals ────────────────────────────────────────────────────
    op.create_table(
        "beesi_withdrawals",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("beesi_id", sa.Integer, sa.ForeignKey("beesis.id"), nullable=False),
        sa.Column("month_number", sa.Integer, nullable=False),
        sa.Column("withdrawal_date", sa.Date, nullable=False),
        sa.Column("gross_amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("discount_offered", sa.Numeric(15, 2), server_default="0"),
        sa.Column("net_received", sa.Numeric(15, 2), nullable=False),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ─── cash_accounts ────────────────────────────────────────────────────────
    op.create_table(
        "cash_accounts",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("account_type", sa.String(30), nullable=False),
        sa.Column("bank_name", sa.String(255), nullable=True),
        sa.Column("account_number", sa.String(100), nullable=True),
        sa.Column("opening_balance", sa.Numeric(15, 2), server_default="0"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("is_deleted", sa.Boolean, server_default=sa.false(), nullable=True),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ─── account_transactions ──────────────────────────────────────────────────
    op.create_table(
        "account_transactions",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("account_id", sa.Integer, sa.ForeignKey("cash_accounts.id"), nullable=False),
        sa.Column("txn_type", sa.String(10), nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("txn_date", sa.Date, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("linked_type", sa.String(30), nullable=True),
        sa.Column("linked_id", sa.Integer, nullable=True),
        sa.Column("reference_number", sa.String(100), nullable=True),
        sa.Column("payment_mode", sa.String(30), nullable=True),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("account_transactions")
    op.drop_table("cash_accounts")
    op.drop_table("beesi_withdrawals")
    op.drop_table("beesi_installments")
    op.drop_table("beesis")
