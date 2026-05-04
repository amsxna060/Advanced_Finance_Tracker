"""029 add performance indexes on FK and filter columns"""

from alembic import op
from sqlalchemy import text

revision = "029_add_perf_indexes"
down_revision = "028_unencumbered_assets"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(text("""
        -- partnerships
        CREATE INDEX IF NOT EXISTS ix_partnerships_linked_property_deal_id ON partnerships (linked_property_deal_id);
        CREATE INDEX IF NOT EXISTS ix_partnerships_status                  ON partnerships (status);
        CREATE INDEX IF NOT EXISTS ix_partnerships_is_deleted              ON partnerships (is_deleted);
        CREATE INDEX IF NOT EXISTS ix_partnerships_is_legacy               ON partnerships (is_legacy);

        -- partnership_members
        CREATE INDEX IF NOT EXISTS ix_partnership_members_partnership_id ON partnership_members (partnership_id);
        CREATE INDEX IF NOT EXISTS ix_partnership_members_contact_id     ON partnership_members (contact_id);
        CREATE INDEX IF NOT EXISTS ix_partnership_members_is_self        ON partnership_members (is_self);

        -- partnership_transactions
        CREATE INDEX IF NOT EXISTS ix_partnership_transactions_partnership_id ON partnership_transactions (partnership_id);
        CREATE INDEX IF NOT EXISTS ix_partnership_transactions_member_id      ON partnership_transactions (member_id);
        CREATE INDEX IF NOT EXISTS ix_partnership_transactions_txn_type       ON partnership_transactions (txn_type);

        -- property_deals
        CREATE INDEX IF NOT EXISTS ix_property_deals_status     ON property_deals (status);
        CREATE INDEX IF NOT EXISTS ix_property_deals_is_deleted ON property_deals (is_deleted);
        CREATE INDEX IF NOT EXISTS ix_property_deals_is_legacy  ON property_deals (is_legacy);

        -- property_transactions
        CREATE INDEX IF NOT EXISTS ix_property_transactions_property_deal_id ON property_transactions (property_deal_id);
        CREATE INDEX IF NOT EXISTS ix_property_transactions_txn_type         ON property_transactions (txn_type);
    """))


def downgrade():
    op.execute(text("""
        DROP INDEX IF EXISTS ix_partnerships_linked_property_deal_id;
        DROP INDEX IF EXISTS ix_partnerships_status;
        DROP INDEX IF EXISTS ix_partnerships_is_deleted;
        DROP INDEX IF EXISTS ix_partnerships_is_legacy;
        DROP INDEX IF EXISTS ix_partnership_members_partnership_id;
        DROP INDEX IF EXISTS ix_partnership_members_contact_id;
        DROP INDEX IF EXISTS ix_partnership_members_is_self;
        DROP INDEX IF EXISTS ix_partnership_transactions_partnership_id;
        DROP INDEX IF EXISTS ix_partnership_transactions_member_id;
        DROP INDEX IF EXISTS ix_partnership_transactions_txn_type;
        DROP INDEX IF EXISTS ix_property_deals_status;
        DROP INDEX IF EXISTS ix_property_deals_is_deleted;
        DROP INDEX IF EXISTS ix_property_deals_is_legacy;
        DROP INDEX IF EXISTS ix_property_transactions_property_deal_id;
        DROP INDEX IF EXISTS ix_property_transactions_txn_type;
    """))
