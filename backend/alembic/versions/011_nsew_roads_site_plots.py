"""Add NSEW sides, roads, site_plots table, float precision

Revision ID: 011_nsew_roads_site_plots
Revises: 3bbc02343332
Create Date: 2026-04-02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

revision = "011_nsew_roads_site_plots"
down_revision = "3bbc02343332"
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
    # 1. Add NSEW direction columns to property_deals (nullable for existing data)
    if not _col_exists("property_deals", "side_north_ft"):
        op.add_column("property_deals", sa.Column("side_north_ft", sa.Numeric(10, 3), nullable=True))
    if not _col_exists("property_deals", "side_south_ft"):
        op.add_column("property_deals", sa.Column("side_south_ft", sa.Numeric(10, 3), nullable=True))
    if not _col_exists("property_deals", "side_east_ft"):
        op.add_column("property_deals", sa.Column("side_east_ft", sa.Numeric(10, 3), nullable=True))
    if not _col_exists("property_deals", "side_west_ft"):
        op.add_column("property_deals", sa.Column("side_west_ft", sa.Numeric(10, 3), nullable=True))

    # 2. Add road fields to property_deals
    if not _col_exists("property_deals", "road_count"):
        op.add_column("property_deals", sa.Column("road_count", sa.Integer(), nullable=True))
    if not _col_exists("property_deals", "roads_json"):
        op.add_column("property_deals", sa.Column("roads_json", sa.Text(), nullable=True))

    # 3. Alter existing side columns to 3 decimal places
    op.alter_column("property_deals", "side_left_ft", type_=sa.Numeric(10, 3), existing_type=sa.Numeric(10, 2), existing_nullable=True)
    op.alter_column("property_deals", "side_right_ft", type_=sa.Numeric(10, 3), existing_type=sa.Numeric(10, 2), existing_nullable=True)
    op.alter_column("property_deals", "side_top_ft", type_=sa.Numeric(10, 3), existing_type=sa.Numeric(10, 2), existing_nullable=True)
    op.alter_column("property_deals", "side_bottom_ft", type_=sa.Numeric(10, 3), existing_type=sa.Numeric(10, 2), existing_nullable=True)

    # 4. Create site_plots table (skip if it already exists from create_all)
    if not _table_exists("site_plots"):
        op.create_table(
            "site_plots",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("property_deal_id", sa.Integer(), sa.ForeignKey("property_deals.id"), nullable=False),
            sa.Column("plot_number", sa.String(50), nullable=True),
            sa.Column("area_sqft", sa.Numeric(12, 3), nullable=True),
            sa.Column("side_north_ft", sa.Numeric(10, 3), nullable=True),
            sa.Column("side_south_ft", sa.Numeric(10, 3), nullable=True),
            sa.Column("side_east_ft", sa.Numeric(10, 3), nullable=True),
            sa.Column("side_west_ft", sa.Numeric(10, 3), nullable=True),
            sa.Column("sold_price_per_sqft", sa.Numeric(12, 3), nullable=True),
            sa.Column("calculated_price", sa.Numeric(15, 3), nullable=True),
            sa.Column("buyer_name", sa.String(255), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("sold_date", sa.Date(), nullable=True),
            sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )


def downgrade():
    op.drop_table("site_plots")
    op.drop_column("property_deals", "roads_json")
    op.drop_column("property_deals", "road_count")
    op.drop_column("property_deals", "side_west_ft")
    op.drop_column("property_deals", "side_east_ft")
    op.drop_column("property_deals", "side_south_ft")
    op.drop_column("property_deals", "side_north_ft")
    op.alter_column("property_deals", "side_left_ft", type_=sa.Numeric(10, 2), existing_type=sa.Numeric(10, 3), existing_nullable=True)
    op.alter_column("property_deals", "side_right_ft", type_=sa.Numeric(10, 2), existing_type=sa.Numeric(10, 3), existing_nullable=True)
    op.alter_column("property_deals", "side_top_ft", type_=sa.Numeric(10, 2), existing_type=sa.Numeric(10, 3), existing_nullable=True)
    op.alter_column("property_deals", "side_bottom_ft", type_=sa.Numeric(10, 2), existing_type=sa.Numeric(10, 3), existing_nullable=True)
