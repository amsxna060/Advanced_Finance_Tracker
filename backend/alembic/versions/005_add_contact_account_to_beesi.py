"""005_add_contact_account_to_beesi

Revision ID: 005_add_contact_account_to_beesi
Revises: 004_add_beesi_and_accounts
Create Date: 2026-03-28

Adds contact_id (who organises the BC) and account_id (which cash account
to auto-debit installments from / credit pot withdrawal to) to the beesis table.
"""

from alembic import op
import sqlalchemy as sa

revision = "005_add_contact_account_to_beesi"
down_revision = "004_add_beesi_and_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "beesis",
        sa.Column("contact_id", sa.Integer, sa.ForeignKey("contacts.id"), nullable=True),
    )
    op.add_column(
        "beesis",
        sa.Column("account_id", sa.Integer, sa.ForeignKey("cash_accounts.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("beesis", "account_id")
    op.drop_column("beesis", "contact_id")
