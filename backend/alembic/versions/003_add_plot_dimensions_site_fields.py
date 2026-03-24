"""Add plot dimensions and site investment fields

Revision ID: 003_plot_dims
Revises: e05cc2c9a712
Create Date: 2026-03-24
"""
from alembic import op
import sqlalchemy as sa

revision = '003_plot_dims'
down_revision = 'e05cc2c9a712'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('property_deals', sa.Column('side_left_ft', sa.Numeric(10, 2), nullable=True))
    op.add_column('property_deals', sa.Column('side_right_ft', sa.Numeric(10, 2), nullable=True))
    op.add_column('property_deals', sa.Column('side_top_ft', sa.Numeric(10, 2), nullable=True))
    op.add_column('property_deals', sa.Column('side_bottom_ft', sa.Numeric(10, 2), nullable=True))
    op.add_column('property_deals', sa.Column('my_investment', sa.Numeric(15, 2), nullable=True, server_default='0'))
    op.add_column('property_deals', sa.Column('my_share_percentage', sa.Numeric(6, 3), nullable=True))
    op.add_column('property_deals', sa.Column('total_profit_received', sa.Numeric(15, 2), nullable=True))
    op.add_column('property_deals', sa.Column('site_deal_start_date', sa.Date(), nullable=True))
    op.add_column('property_deals', sa.Column('site_deal_end_date', sa.Date(), nullable=True))


def downgrade():
    op.drop_column('property_deals', 'side_left_ft')
    op.drop_column('property_deals', 'side_right_ft')
    op.drop_column('property_deals', 'side_top_ft')
    op.drop_column('property_deals', 'side_bottom_ft')
    op.drop_column('property_deals', 'my_investment')
    op.drop_column('property_deals', 'my_share_percentage')
    op.drop_column('property_deals', 'total_profit_received')
    op.drop_column('property_deals', 'site_deal_start_date')
    op.drop_column('property_deals', 'site_deal_end_date')
