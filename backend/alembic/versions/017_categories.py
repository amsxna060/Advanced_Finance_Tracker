"""Add categories table with parent-child hierarchy

Revision ID: 017_categories
Revises: 016_credit_cards_category_limits
Create Date: 2026-04-15
"""

from alembic import op
import sqlalchemy as sa

revision = "017_categories"
down_revision = "016_credit_cards_category_limits"
branch_labels = None
depends_on = None


def upgrade():
    # Table may already exist from Base.metadata.create_all — create only if missing
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'categories')"
    ))
    table_exists = result.scalar()

    if not table_exists:
        op.create_table(
            "categories",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("parent_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=True),
            sa.Column("icon", sa.String(50), nullable=True),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
            sa.Column("sort_order", sa.Integer(), server_default=sa.text("0")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_categories_id", "categories", ["id"])
        op.create_index("ix_categories_parent_id", "categories", ["parent_id"])

    # Only seed if table is empty
    count = conn.execute(sa.text("SELECT COUNT(*) FROM categories")).scalar()
    if count > 0:
        return

    # Seed Indian household categories
    from sqlalchemy import table, column, Integer, String, Boolean

    categories_t = table(
        "categories",
        column("id", Integer),
        column("name", String),
        column("parent_id", Integer),
        column("icon", String),
        column("sort_order", Integer),
        column("is_active", Boolean),
    )

    parents = [
        {"id": 1, "name": "Housing & Utilities", "icon": "🏠", "sort_order": 1},
        {"id": 2, "name": "Groceries & Daily Needs", "icon": "🛒", "sort_order": 2},
        {"id": 3, "name": "Food & Dining", "icon": "🍽️", "sort_order": 3},
        {"id": 4, "name": "Education & Children", "icon": "📚", "sort_order": 4},
        {"id": 5, "name": "Transport & Auto", "icon": "🚗", "sort_order": 5},
        {"id": 6, "name": "Health & Medical", "icon": "🏥", "sort_order": 6},
        {"id": 7, "name": "Spiritual & Social", "icon": "🙏", "sort_order": 7},
        {"id": 8, "name": "Personal & Lifestyle", "icon": "👤", "sort_order": 8},
        {"id": 9, "name": "Financial & Legal", "icon": "⚖️", "sort_order": 9},
    ]

    children = [
        # Housing & Utilities (parent_id=1)
        {"id": 10, "name": "Rent / EMI", "parent_id": 1, "sort_order": 1},
        {"id": 11, "name": "Electricity", "parent_id": 1, "sort_order": 2},
        {"id": 12, "name": "Water", "parent_id": 1, "sort_order": 3},
        {"id": 13, "name": "Gas (Piped / Cylinder)", "parent_id": 1, "sort_order": 4},
        {"id": 14, "name": "Internet & Phone", "parent_id": 1, "sort_order": 5},
        {"id": 15, "name": "DTH / Cable", "parent_id": 1, "sort_order": 6},
        {"id": 16, "name": "Society Maintenance", "parent_id": 1, "sort_order": 7},
        {"id": 17, "name": "Home Repair & Painting", "parent_id": 1, "sort_order": 8},
        # Groceries & Daily Needs (parent_id=2)
        {"id": 18, "name": "Vegetables & Fruits", "parent_id": 2, "sort_order": 1},
        {"id": 19, "name": "Dairy & Eggs", "parent_id": 2, "sort_order": 2},
        {"id": 20, "name": "Grains & Staples", "parent_id": 2, "sort_order": 3},
        {"id": 21, "name": "Spices & Condiments", "parent_id": 2, "sort_order": 4},
        {"id": 22, "name": "Grocery Apps (BigBasket, Blinkit)", "parent_id": 2, "sort_order": 5},
        {"id": 23, "name": "Household Supplies", "parent_id": 2, "sort_order": 6},
        # Food & Dining (parent_id=3)
        {"id": 24, "name": "Restaurant / Eating Out", "parent_id": 3, "sort_order": 1},
        {"id": 25, "name": "Food Delivery (Swiggy, Zomato)", "parent_id": 3, "sort_order": 2},
        {"id": 26, "name": "Snacks & Chai / Coffee", "parent_id": 3, "sort_order": 3},
        {"id": 27, "name": "Mess / Tiffin Service", "parent_id": 3, "sort_order": 4},
        {"id": 28, "name": "Sweet Shop / Mithai", "parent_id": 3, "sort_order": 5},
        # Education & Children (parent_id=4)
        {"id": 29, "name": "School / College Fees", "parent_id": 4, "sort_order": 1},
        {"id": 30, "name": "Books & Stationery", "parent_id": 4, "sort_order": 2},
        {"id": 31, "name": "Coaching / Tuition", "parent_id": 4, "sort_order": 3},
        {"id": 32, "name": "Online Courses", "parent_id": 4, "sort_order": 4},
        {"id": 33, "name": "Kids Activities / Sports", "parent_id": 4, "sort_order": 5},
        # Transport & Auto (parent_id=5)
        {"id": 34, "name": "Petrol / Diesel / CNG", "parent_id": 5, "sort_order": 1},
        {"id": 35, "name": "Auto / Rickshaw", "parent_id": 5, "sort_order": 2},
        {"id": 36, "name": "Cab (Ola, Uber)", "parent_id": 5, "sort_order": 3},
        {"id": 37, "name": "Vehicle Service / Repair", "parent_id": 5, "sort_order": 4},
        {"id": 38, "name": "Toll & Parking", "parent_id": 5, "sort_order": 5},
        {"id": 39, "name": "Vehicle Insurance / Tax", "parent_id": 5, "sort_order": 6},
        # Health & Medical (parent_id=6)
        {"id": 40, "name": "Doctor / Hospital", "parent_id": 6, "sort_order": 1},
        {"id": 41, "name": "Medicine / Pharmacy", "parent_id": 6, "sort_order": 2},
        {"id": 42, "name": "Diagnostic / Lab Tests", "parent_id": 6, "sort_order": 3},
        {"id": 43, "name": "Health Insurance Premium", "parent_id": 6, "sort_order": 4},
        {"id": 44, "name": "Dental / Eye Care", "parent_id": 6, "sort_order": 5},
        # Spiritual & Social (parent_id=7)
        {"id": 45, "name": "Temple / Pooja / Daan", "parent_id": 7, "sort_order": 1},
        {"id": 46, "name": "Festivals & Celebrations", "parent_id": 7, "sort_order": 2},
        {"id": 47, "name": "Gifts & Shagun", "parent_id": 7, "sort_order": 3},
        {"id": 48, "name": "Wedding / Function", "parent_id": 7, "sort_order": 4},
        {"id": 49, "name": "Charity / Donation", "parent_id": 7, "sort_order": 5},
        # Personal & Lifestyle (parent_id=8)
        {"id": 50, "name": "Clothing & Fashion", "parent_id": 8, "sort_order": 1},
        {"id": 51, "name": "Salon & Grooming", "parent_id": 8, "sort_order": 2},
        {"id": 52, "name": "Online Shopping", "parent_id": 8, "sort_order": 3},
        {"id": 53, "name": "Entertainment & Movies", "parent_id": 8, "sort_order": 4},
        {"id": 54, "name": "Gym / Fitness", "parent_id": 8, "sort_order": 5},
        {"id": 55, "name": "Mobile Recharge / Apps", "parent_id": 8, "sort_order": 6},
        # Financial & Legal (parent_id=9)
        {"id": 56, "name": "Insurance Premium (LIC etc)", "parent_id": 9, "sort_order": 1},
        {"id": 57, "name": "Income Tax / TDS", "parent_id": 9, "sort_order": 2},
        {"id": 58, "name": "Legal / Stamp Duty", "parent_id": 9, "sort_order": 3},
        {"id": 59, "name": "Bank Charges / Penalties", "parent_id": 9, "sort_order": 4},
        {"id": 60, "name": "Commission / Brokerage", "parent_id": 9, "sort_order": 5},
    ]

    for p in parents:
        op.bulk_insert(categories_t, [{"id": p["id"], "name": p["name"], "parent_id": None, "icon": p["icon"], "sort_order": p["sort_order"], "is_active": True}])
    for c in children:
        op.bulk_insert(categories_t, [{"id": c["id"], "name": c["name"], "parent_id": c["parent_id"], "icon": None, "sort_order": c["sort_order"], "is_active": True}])


def downgrade():
    op.drop_table("categories")
