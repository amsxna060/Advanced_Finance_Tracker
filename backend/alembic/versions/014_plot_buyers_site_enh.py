"""Add plot_buyers table, enhance property_transactions and site_plots

Revision ID: 014_plot_buyers_site_enh
Revises: 013_category_learnings
Create Date: 2026-04-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

revision = "014_plot_buyers_site_enh"
down_revision = "013_category_learnings"
branch_labels = None
depends_on = None


def _col_exists(table, column):
    bind = op.get_bind()
    insp = sa_inspect(bind)
    cols = [c["name"] for c in insp.get_columns(table)]
    return column in cols


def _table_exists(table):
    bind = op.get_bind()
    insp = sa_inspect(bind)
    return table in insp.get_table_names()


def upgrade():
    # 1. Create plot_buyers table for tracking multiple buyers per plot deal
    if not _table_exists("plot_buyers"):
        op.create_table(
            "plot_buyers",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("property_deal_id", sa.Integer(), sa.ForeignKey("property_deals.id"), nullable=False),
            sa.Column("buyer_contact_id", sa.Integer(), sa.ForeignKey("contacts.id"), nullable=True),
            sa.Column("buyer_name", sa.String(255), nullable=True),
            sa.Column("area_sqft", sa.Numeric(12, 3), nullable=True),
            sa.Column("rate_per_sqft", sa.Numeric(12, 3), nullable=True),
            sa.Column("total_value", sa.Numeric(15, 2), nullable=True),
            sa.Column("advance_received", sa.Numeric(15, 2), server_default="0"),
            sa.Column("total_paid", sa.Numeric(15, 2), server_default="0"),
            sa.Column("registry_date", sa.Date(), nullable=True),
            sa.Column("status", sa.String(30), server_default="pending"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    # 2. Add received_by_member_id to property_transactions
    if not _col_exists("property_transactions", "received_by_member_id"):
        op.add_column(
            "property_transactions",
            sa.Column("received_by_member_id", sa.Integer(), sa.ForeignKey("partnership_members.id"), nullable=True),
        )

    # 3. Add plot_buyer_id to property_transactions (to link payment to a specific buyer)
    if not _col_exists("property_transactions", "plot_buyer_id"):
        op.add_column(
            "property_transactions",
            sa.Column("plot_buyer_id", sa.Integer(), sa.ForeignKey("plot_buyers.id"), nullable=True),
        )

    # 4. Enhance site_plots: add buyer_contact_id, status, advance fields
    if not _col_exists("site_plots", "buyer_contact_id"):
        op.add_column(
            "site_plots",
            sa.Column("buyer_contact_id", sa.Integer(), sa.ForeignKey("contacts.id"), nullable=True),
        )
    if not _col_exists("site_plots", "status"):
        op.add_column(
            "site_plots",
            sa.Column("status", sa.String(30), server_default="available"),
        )
    if not _col_exists("site_plots", "advance_received"):
        op.add_column(
            "site_plots",
            sa.Column("advance_received", sa.Numeric(15, 2), server_default="0"),
        )
    if not _col_exists("site_plots", "total_paid"):
        op.add_column(
            "site_plots",
            sa.Column("total_paid", sa.Numeric(15, 2), server_default="0"),
        )
    if not _col_exists("site_plots", "registry_date"):
        op.add_column(
            "site_plots",
            sa.Column("registry_date", sa.Date(), nullable=True),
        )


def downgrade():
    op.drop_column("site_plots", "registry_date")
    op.drop_column("site_plots", "total_paid")
    op.drop_column("site_plots", "advance_received")
    op.drop_column("site_plots", "status")
    op.drop_column("site_plots", "buyer_contact_id")
    op.drop_column("property_transactions", "plot_buyer_id")
    op.drop_column("property_transactions", "received_by_member_id")
    op.drop_table("plot_buyers")
