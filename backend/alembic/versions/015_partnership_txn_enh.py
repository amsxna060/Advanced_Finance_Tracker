"""Enhance partnership_transactions for action hub, add dimensions to plot_buyers

Revision ID: 015_partnership_txn_enh
Revises: 014_plot_buyers_site_enh
Create Date: 2026-04-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

revision = "015_partnership_txn_enh"
down_revision = "014_plot_buyers_site_enh"
branch_labels = None
depends_on = None


def _col_exists(table, column):
    bind = op.get_bind()
    insp = sa_inspect(bind)
    cols = [c["name"] for c in insp.get_columns(table)]
    return column in cols


def upgrade():
    # 1. partnership_transactions: add plot_buyer_id, site_plot_id, broker_name, from_partnership_pot
    if not _col_exists("partnership_transactions", "plot_buyer_id"):
        op.add_column(
            "partnership_transactions",
            sa.Column("plot_buyer_id", sa.Integer(), sa.ForeignKey("plot_buyers.id"), nullable=True),
        )
    if not _col_exists("partnership_transactions", "site_plot_id"):
        op.add_column(
            "partnership_transactions",
            sa.Column("site_plot_id", sa.Integer(), sa.ForeignKey("site_plots.id"), nullable=True),
        )
    if not _col_exists("partnership_transactions", "broker_name"):
        op.add_column(
            "partnership_transactions",
            sa.Column("broker_name", sa.String(255), nullable=True),
        )
    if not _col_exists("partnership_transactions", "from_partnership_pot"):
        op.add_column(
            "partnership_transactions",
            sa.Column("from_partnership_pot", sa.Boolean(), server_default="false"),
        )

    # 2. Widen txn_type column to accommodate longer type names
    op.alter_column(
        "partnership_transactions",
        "txn_type",
        type_=sa.String(50),
        existing_type=sa.String(30),
    )

    # 3. plot_buyers: add dimension fields and change default status
    if not _col_exists("plot_buyers", "side_north_ft"):
        op.add_column("plot_buyers", sa.Column("side_north_ft", sa.Numeric(10, 3), nullable=True))
    if not _col_exists("plot_buyers", "side_south_ft"):
        op.add_column("plot_buyers", sa.Column("side_south_ft", sa.Numeric(10, 3), nullable=True))
    if not _col_exists("plot_buyers", "side_east_ft"):
        op.add_column("plot_buyers", sa.Column("side_east_ft", sa.Numeric(10, 3), nullable=True))
    if not _col_exists("plot_buyers", "side_west_ft"):
        op.add_column("plot_buyers", sa.Column("side_west_ft", sa.Numeric(10, 3), nullable=True))

    # 4. property_deals: add negotiating_date
    if not _col_exists("property_deals", "negotiating_date"):
        op.add_column(
            "property_deals",
            sa.Column("negotiating_date", sa.Date(), nullable=True),
        )


def downgrade():
    op.drop_column("property_deals", "negotiating_date")
    op.drop_column("plot_buyers", "side_west_ft")
    op.drop_column("plot_buyers", "side_east_ft")
    op.drop_column("plot_buyers", "side_south_ft")
    op.drop_column("plot_buyers", "side_north_ft")
    op.alter_column(
        "partnership_transactions",
        "txn_type",
        type_=sa.String(30),
        existing_type=sa.String(50),
    )
    op.drop_column("partnership_transactions", "from_partnership_pot")
    op.drop_column("partnership_transactions", "broker_name")
    op.drop_column("partnership_transactions", "site_plot_id")
    op.drop_column("partnership_transactions", "plot_buyer_id")
