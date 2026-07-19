"""Tenancy: add owner_id to all 29 domain tables + users.tenant_owner_id.

FB-1.1 (docs/saas-migration/BACKLOG.md). Three-step so it cannot fail on a
live database: add nullable column -> backfill -> set NOT NULL.

Backfill sources, in order of fidelity:
  - the table's own created_by (audit stamp) or user_id where present
  - the parent row's created_by (collaterals <- loans,
    partnership_members <- partnerships)
  - the seed admin (first admin user) for tables with no user column at all
    (contacts, categories) and as COALESCE fallback everywhere

activity_logs.owner_id stays nullable: system/scheduler events have no
tenant. Everything else ends NOT NULL.

users.tenant_owner_id: household membership. Existing non-admin users
(viewer/readonly guests of the single-operator era) are attached to the
seed admin's tenant, preserving today's "guests see the household's data"
behaviour.

Revision ID: 046_tenant_owner_id
Revises: 045_activity_logs
Create Date: 2026-07-19
"""
from alembic import op
import sqlalchemy as sa

revision = "046_tenant_owner_id"
down_revision = "045_activity_logs"
branch_labels = None
depends_on = None

# table -> SQL expression producing the backfill owner (correlated subqueries
# work on both Postgres and SQLite). ":admin" is substituted below.
_OWN_CREATED_BY = [
    "cash_accounts", "account_transactions",
    "beesis", "beesi_installments", "beesi_withdrawals",
    "category_limits",
    "money_obligations", "obligation_settlements",
    "loans", "loan_payments", "loan_capitalization_events",
    "expenses", "recurring_transactions",
    "property_anomalies", "property_deals", "property_transactions",
    "site_plots", "plot_buyers", "property_simulations",
    "partnerships", "partnership_transactions",
    "unencumbered_assets",
]
_OWN_USER_ID = ["forecast_overrides", "category_learnings", "activity_logs"]
_PARENT_JOIN = {
    "collaterals": "(SELECT l.created_by FROM loans l WHERE l.id = collaterals.loan_id)",
    "partnership_members": "(SELECT p.created_by FROM partnerships p WHERE p.id = partnership_members.partnership_id)",
}
_ADMIN_ONLY = ["contacts", "categories"]

ALL_TABLES = _OWN_CREATED_BY + _OWN_USER_ID + list(_PARENT_JOIN) + _ADMIN_ONLY
assert len(ALL_TABLES) == 29

# activity_logs keeps owner_id nullable (system events have no tenant)
_STAYS_NULLABLE = {"activity_logs"}


def upgrade() -> None:
    conn = op.get_bind()

    # ---- users.tenant_owner_id -------------------------------------------
    op.add_column(
        "users",
        sa.Column("tenant_owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )

    admin_id = conn.execute(
        sa.text("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
    ).scalar()

    if admin_id is not None:
        conn.execute(
            sa.text(
                "UPDATE users SET tenant_owner_id = :admin "
                "WHERE role != 'admin' AND tenant_owner_id IS NULL"
            ),
            {"admin": admin_id},
        )

    # ---- Step 1: add owner_id (nullable) everywhere ----------------------
    for table in ALL_TABLES:
        op.add_column(table, sa.Column("owner_id", sa.Integer(), nullable=True))

    # ---- Step 2: backfill -------------------------------------------------
    def _backfill(table: str, source_expr: str) -> None:
        has_rows = conn.execute(sa.text(f"SELECT 1 FROM {table} LIMIT 1")).scalar()
        if not has_rows:
            return
        if admin_id is None:
            raise RuntimeError(
                f"{table} has rows but no admin user exists to own them — "
                "cannot backfill owner_id"
            )
        conn.execute(
            sa.text(f"UPDATE {table} SET owner_id = COALESCE({source_expr}, :admin)"),
            {"admin": admin_id},
        )

    for table in _OWN_CREATED_BY:
        _backfill(table, f"{table}.created_by")
    for table in _OWN_USER_ID:
        _backfill(table, f"{table}.user_id")
    for table, expr in _PARENT_JOIN.items():
        _backfill(table, expr)
    for table in _ADMIN_ONLY:
        _backfill(table, "NULL")

    # ---- Step 3: constraints + indexes -----------------------------------
    for table in ALL_TABLES:
        if table not in _STAYS_NULLABLE:
            op.alter_column(table, "owner_id", nullable=False)
        op.create_index(f"ix_{table}_owner_id", table, ["owner_id"])
        op.create_foreign_key(f"fk_{table}_owner_id_users", table, "users", ["owner_id"], ["id"])


def downgrade() -> None:
    for table in ALL_TABLES:
        op.drop_constraint(f"fk_{table}_owner_id_users", table, type_="foreignkey")
        op.drop_index(f"ix_{table}_owner_id", table_name=table)
        op.drop_column(table, "owner_id")
    op.drop_column("users", "tenant_owner_id")
