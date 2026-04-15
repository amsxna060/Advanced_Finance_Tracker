"""Add is_legacy flag to property_deals, partnerships, contacts, and related tables

Revision ID: 018_is_legacy_flag
Revises: 017_categories
Create Date: 2026-04-15
"""

from alembic import op
import sqlalchemy as sa

revision = "018_is_legacy_flag"
down_revision = "017_categories"
branch_labels = None
depends_on = None


def upgrade():
    for table in [
        "property_deals", "partnerships", "contacts",
        "property_transactions", "partnership_transactions",
        "partnership_members", "plot_buyers", "site_plots",
    ]:
        op.add_column(table, sa.Column("is_legacy", sa.Boolean(), server_default="false", nullable=False))


def downgrade():
    for table in [
        "property_deals", "partnerships", "contacts",
        "property_transactions", "partnership_transactions",
        "partnership_members", "plot_buyers", "site_plots",
    ]:
        op.drop_column(table, "is_legacy")
