"""Add paid_to_seller to partnership_transactions; backfill total_deal_value

Revision ID: 040_paid_to_seller
Revises: 039_backfill_cl_user_id
Create Date: 2026-05-19 00:00:00.000000

paid_to_seller: flags buyer-payment transactions where the buyer paid
the seller directly (bypassing the partnership pot). Replaces the
fragile description-text heuristic "→ Paid directly to Seller".

Also backfills partnership.total_deal_value from the linked property's
total_seller_value for any partnership where it was not yet set, so
P&L calculations can use the full committed seller cost.
"""
from alembic import op
import sqlalchemy as sa

revision = "040_paid_to_seller"
down_revision = "039_backfill_cl_user_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Add paid_to_seller boolean column (default false)
    op.add_column(
        "partnership_transactions",
        sa.Column("paid_to_seller", sa.Boolean(), nullable=False, server_default="false"),
    )

    # 2. Backfill: mark existing transactions that used the old description heuristic
    conn.execute(sa.text("""
        UPDATE partnership_transactions
           SET paid_to_seller = true
         WHERE received_by_member_id IS NULL
           AND txn_type IN ('buyer_advance', 'buyer_payment', 'buyer_payment_received')
           AND description IS NOT NULL
           AND description LIKE '%Paid directly to Seller%'
    """))

    # 3. Backfill partnership.total_deal_value from linked property's total_seller_value
    #    Only overwrites partnerships where total_deal_value is unset (NULL or 0).
    conn.execute(sa.text("""
        UPDATE partnerships p
           SET total_deal_value = pd.total_seller_value
          FROM property_deals pd
         WHERE p.linked_property_deal_id = pd.id
           AND pd.total_seller_value IS NOT NULL
           AND pd.total_seller_value > 0
           AND (p.total_deal_value IS NULL OR p.total_deal_value = 0)
    """))


def downgrade() -> None:
    op.drop_column("partnership_transactions", "paid_to_seller")
