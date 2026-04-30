"""Fix ALL tables with potentially missing columns using raw SQL IF NOT EXISTS

Covers every table that has columns added via migrations using _col_exists()
(which can fail silently under Supabase/PgBouncer transaction-mode pooling).
Using raw PostgreSQL DDL for 100% reliability.

Revision ID: 023_all_tables_raw_sql
Revises: 022_site_plots_raw_sql
Create Date: 2026-04-30
"""
from alembic import op

revision = "023_all_tables_raw_sql"
down_revision = "022_site_plots_raw_sql"
branch_labels = None
depends_on = None


def upgrade():
    # ── partnership_transactions ────────────────────────────────────────────────
    # Added in migration 015 via _col_exists (may have been skipped on Supabase)
    op.execute("ALTER TABLE partnership_transactions ADD COLUMN IF NOT EXISTS plot_buyer_id INTEGER REFERENCES plot_buyers(id)")
    op.execute("ALTER TABLE partnership_transactions ADD COLUMN IF NOT EXISTS site_plot_id INTEGER REFERENCES site_plots(id)")
    op.execute("ALTER TABLE partnership_transactions ADD COLUMN IF NOT EXISTS broker_name VARCHAR(255)")
    op.execute("ALTER TABLE partnership_transactions ADD COLUMN IF NOT EXISTS from_partnership_pot BOOLEAN DEFAULT false")
    op.execute("ALTER TABLE partnership_transactions ADD COLUMN IF NOT EXISTS received_by_member_id INTEGER REFERENCES partnership_members(id)")

    # ── plot_buyers ─────────────────────────────────────────────────────────────
    # Added in migration 015 via _col_exists
    op.execute("ALTER TABLE plot_buyers ADD COLUMN IF NOT EXISTS side_north_ft NUMERIC(10,3)")
    op.execute("ALTER TABLE plot_buyers ADD COLUMN IF NOT EXISTS side_south_ft NUMERIC(10,3)")
    op.execute("ALTER TABLE plot_buyers ADD COLUMN IF NOT EXISTS side_east_ft NUMERIC(10,3)")
    op.execute("ALTER TABLE plot_buyers ADD COLUMN IF NOT EXISTS side_west_ft NUMERIC(10,3)")
    op.execute("ALTER TABLE plot_buyers ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN DEFAULT false")
    op.execute("ALTER TABLE plot_buyers ADD COLUMN IF NOT EXISTS buyer_contact_id INTEGER REFERENCES contacts(id)")

    # ── property_deals ──────────────────────────────────────────────────────────
    # Added in migration 011 via _col_exists (may have been skipped on Supabase)
    op.execute("ALTER TABLE property_deals ADD COLUMN IF NOT EXISTS side_north_ft NUMERIC(10,3)")
    op.execute("ALTER TABLE property_deals ADD COLUMN IF NOT EXISTS side_south_ft NUMERIC(10,3)")
    op.execute("ALTER TABLE property_deals ADD COLUMN IF NOT EXISTS side_east_ft NUMERIC(10,3)")
    op.execute("ALTER TABLE property_deals ADD COLUMN IF NOT EXISTS side_west_ft NUMERIC(10,3)")
    op.execute("ALTER TABLE property_deals ADD COLUMN IF NOT EXISTS road_count INTEGER")
    op.execute("ALTER TABLE property_deals ADD COLUMN IF NOT EXISTS roads_json TEXT")
    # negotiating_date added in migration 015 via _col_exists
    op.execute("ALTER TABLE property_deals ADD COLUMN IF NOT EXISTS negotiating_date DATE")

    # ── partnerships ────────────────────────────────────────────────────────────
    op.execute("ALTER TABLE partnerships ADD COLUMN IF NOT EXISTS our_investment NUMERIC(15,2) DEFAULT 0")
    op.execute("ALTER TABLE partnerships ADD COLUMN IF NOT EXISTS total_received NUMERIC(15,2) DEFAULT 0")
    op.execute("ALTER TABLE partnerships ADD COLUMN IF NOT EXISTS linked_property_deal_id INTEGER REFERENCES property_deals(id)")

    # ── property_transactions ───────────────────────────────────────────────────
    op.execute("ALTER TABLE property_transactions ADD COLUMN IF NOT EXISTS received_by_member_id INTEGER REFERENCES partnership_members(id)")
    op.execute("ALTER TABLE property_transactions ADD COLUMN IF NOT EXISTS plot_buyer_id INTEGER REFERENCES plot_buyers(id)")


def downgrade():
    pass  # safe no-op
