"""Add missing columns to site_plots if table was created before migration 011

Some production DBs had the site_plots table created via create_all() before
migration 011 ran, so plot_number and the NSEW side columns were never added.
This migration adds them safely with existence checks.

Revision ID: 021_site_plots_missing_columns
Revises: 020_performance_indexes
Create Date: 2026-04-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

revision = "021_site_plots_missing_columns"
down_revision = "020_performance_indexes"
branch_labels = None
depends_on = None


def _col_exists(table, column):
    bind = op.get_bind()
    insp = sa_inspect(bind)
    cols = [c["name"] for c in insp.get_columns(table)]
    return column in cols


def upgrade():
    # These columns are defined in the model but may be absent if the table
    # was created by an early create_all() rather than by migration 011.
    if not _col_exists("site_plots", "plot_number"):
        op.add_column("site_plots", sa.Column("plot_number", sa.String(50), nullable=True))

    if not _col_exists("site_plots", "side_north_ft"):
        op.add_column("site_plots", sa.Column("side_north_ft", sa.Numeric(10, 3), nullable=True))
    if not _col_exists("site_plots", "side_south_ft"):
        op.add_column("site_plots", sa.Column("side_south_ft", sa.Numeric(10, 3), nullable=True))
    if not _col_exists("site_plots", "side_east_ft"):
        op.add_column("site_plots", sa.Column("side_east_ft", sa.Numeric(10, 3), nullable=True))
    if not _col_exists("site_plots", "side_west_ft"):
        op.add_column("site_plots", sa.Column("side_west_ft", sa.Numeric(10, 3), nullable=True))

    # status / buyer_contact_id / advance_received / total_paid / registry_date / is_legacy
    # were not in the original create_all model — add them too if missing
    if not _col_exists("site_plots", "status"):
        op.add_column("site_plots", sa.Column("status", sa.String(30), nullable=True, server_default="available"))
    if not _col_exists("site_plots", "buyer_contact_id"):
        op.add_column("site_plots", sa.Column("buyer_contact_id", sa.Integer(), sa.ForeignKey("contacts.id"), nullable=True))
    if not _col_exists("site_plots", "advance_received"):
        op.add_column("site_plots", sa.Column("advance_received", sa.Numeric(15, 2), nullable=True, server_default="0"))
    if not _col_exists("site_plots", "total_paid"):
        op.add_column("site_plots", sa.Column("total_paid", sa.Numeric(15, 2), nullable=True, server_default="0"))
    if not _col_exists("site_plots", "registry_date"):
        op.add_column("site_plots", sa.Column("registry_date", sa.Date(), nullable=True))
    if not _col_exists("site_plots", "is_legacy"):
        op.add_column("site_plots", sa.Column("is_legacy", sa.Boolean(), nullable=True, server_default="false"))


def downgrade():
    # Only drop if they were added by this migration (safe no-op approach: just pass)
    pass
