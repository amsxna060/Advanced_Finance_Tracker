"""024 add property_anomalies table"""

from alembic import op
import sqlalchemy as sa

revision = "024_property_anomalies"
down_revision = "023_all_tables_raw_sql"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "property_anomalies",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("scope_kind", sa.String(30), nullable=False),
        sa.Column("scope_id", sa.Integer, nullable=False),
        sa.Column("scope_title", sa.String(255)),
        sa.Column("anomaly_type", sa.String(80), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False, server_default="warning"),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("metric_value", sa.Numeric(15, 2)),
        sa.Column("threshold_value", sa.Numeric(15, 2)),
        sa.Column("is_resolved", sa.Boolean, server_default=sa.text("false"), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("first_seen", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("last_scanned", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_property_anomalies_scope", "property_anomalies", ["scope_kind", "scope_id"])
    op.create_index("ix_property_anomalies_resolved", "property_anomalies", ["is_resolved"])


def downgrade():
    op.drop_index("ix_property_anomalies_resolved")
    op.drop_index("ix_property_anomalies_scope")
    op.drop_table("property_anomalies")
