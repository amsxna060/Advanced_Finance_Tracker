#!/usr/bin/env python3
"""
Legacy category migration script.

Maps old/incorrect category (and sub-category) values on existing Expense rows
to the canonical DB category names introduced in migration 017_categories.

SAFETY:
  - Defaults to DRY-RUN mode — prints what would change, touches nothing.
  - Pass --apply to actually write changes.
  - Never deletes or alters amount / description / date — only category & sub_category.
  - Prints a full before/after summary before committing.
  - On any error the transaction is rolled back automatically.

USAGE:
  # Dry run (safe, no DB changes)
  python scripts/migrate_legacy_categories.py

  # Apply to LOCAL DB (via app's DATABASE_URL in .env)
  python scripts/migrate_legacy_categories.py --apply

  # Apply to a specific DATABASE_URL (production)
  DATABASE_URL="postgresql://user:pass@host:5432/dbname" python scripts/migrate_legacy_categories.py --apply
"""

import os
import sys
import argparse
from collections import defaultdict

# ── allow running from project root without installing the package ────────────
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# ─────────────────────────────────────────────────────────────────────────────
# MAPPING: old category name → new canonical parent name
# Add more entries here if you discover other old names in your data.
# ─────────────────────────────────────────────────────────────────────────────
CATEGORY_MAP: dict[str, str] = {
    # --- transport / fuel ---
    "Fuel":           "Transport & Auto",
    "Travel":         "Transport & Auto",
    # --- housing / utilities ---
    "Rent":           "Housing & Utilities",
    "Utilities":      "Housing & Utilities",
    "Home":           "Housing & Utilities",
    "Maintenance":    "Housing & Utilities",      # home maintenance; vehicle ones re-categorised by description
    # --- groceries ---
    "Grocery":        "Groceries & Daily Needs",
    "Groceries":      "Groceries & Daily Needs",
    "Market":         "Groceries & Daily Needs",
    # --- food ---
    # "Food & Dining" is already correct — keep as-is
    # --- health ---
    "Medical":        "Health & Medical",
    # --- education ---
    "Education":      "Education & Children",
    # --- personal / lifestyle ---
    "Personal":       "Personal & Lifestyle",
    "Shopping":       "Personal & Lifestyle",
    "Entertainment":  "Personal & Lifestyle",
    # --- financial / legal ---
    "Insurance":      "Financial & Legal",
    "Legal":          "Financial & Legal",
    "Registration":   "Financial & Legal",
    "Commission":     "Financial & Legal",
    # --- ambiguous / catch-all ---
    "Business":       "Financial & Legal",       # closest fit — adjust if needed
    "Miscellaneous":  "Personal & Lifestyle",    # adjust if needed
}

# ─────────────────────────────────────────────────────────────────────────────
# SUB-CATEGORY MAPPING: (old_parent, old_sub) → (new_parent, new_sub)
# Only needed when the sub-category name itself was wrong.
# If old_sub is None it means "any sub under that old parent".
# ─────────────────────────────────────────────────────────────────────────────
SUBCATEGORY_MAP: dict[tuple, tuple] = {
    # Fuel subs
    ("Fuel",      "Petrol"):           ("Transport & Auto", "Petrol / Diesel / CNG"),
    ("Fuel",      "Diesel"):           ("Transport & Auto", "Petrol / Diesel / CNG"),
    ("Fuel",      "CNG"):              ("Transport & Auto", "Petrol / Diesel / CNG"),
    ("Fuel",      "EV Charging"):      ("Transport & Auto", "Petrol / Diesel / CNG"),
    ("Fuel",      None):               ("Transport & Auto", "Petrol / Diesel / CNG"),
    # Travel subs
    ("Travel",    "Cab & Taxi"):       ("Transport & Auto", "Cab (Ola, Uber)"),
    ("Travel",    "Air Travel"):       ("Transport & Auto", None),
    ("Travel",    "Rail Travel"):      ("Transport & Auto", None),
    ("Travel",    "Local Transport"):  ("Transport & Auto", None),
    ("Travel",    "Toll & Parking"):   ("Transport & Auto", "Toll & Parking"),
    ("Travel",    None):               ("Transport & Auto", None),
    # Grocery subs
    ("Grocery",   "Vegetables & Fruits"):  ("Groceries & Daily Needs", "Vegetables & Fruits"),
    ("Grocery",   "Dairy & Eggs"):         ("Groceries & Daily Needs", "Dairy & Eggs"),
    ("Grocery",   "Grains & Staples"):     ("Groceries & Daily Needs", "Grains & Staples"),
    ("Grocery",   "Grocery Apps"):         ("Groceries & Daily Needs", "Grocery Apps (BigBasket, Blinkit)"),
    ("Grocery",   None):                   ("Groceries & Daily Needs", None),
    ("Groceries", None):                   ("Groceries & Daily Needs", None),
    ("Market",    None):                   ("Groceries & Daily Needs", None),
    # Medical subs
    ("Medical",   "Hospital"):             ("Health & Medical", "Doctor / Hospital"),
    ("Medical",   "Medicine / Pharmacy"):  ("Health & Medical", "Medicine / Pharmacy"),
    ("Medical",   "Diagnostic"):           ("Health & Medical", "Diagnostic / Lab Tests"),
    ("Medical",   "Dental"):               ("Health & Medical", "Dental / Eye Care"),
    ("Medical",   None):                   ("Health & Medical", None),
    # Education subs
    ("Education", "School / College Fees"):("Education & Children", "School / College Fees"),
    ("Education", "Books & Stationery"):   ("Education & Children", "Books & Stationery"),
    ("Education", "Online Courses"):       ("Education & Children", "Online Courses"),
    ("Education", "Coaching"):             ("Education & Children", "Coaching / Tuition"),
    ("Education", None):                   ("Education & Children", None),
    # Utilities subs
    ("Utilities", "Electricity"):          ("Housing & Utilities", "Electricity"),
    ("Utilities", "Internet & Phone"):     ("Housing & Utilities", "Internet & Phone"),
    ("Utilities", "Gas"):                  ("Housing & Utilities", "Gas (Piped / Cylinder)"),
    ("Utilities", "Water"):                ("Housing & Utilities", "Water"),
    ("Utilities", "DTH / Cable"):          ("Housing & Utilities", "DTH / Cable"),
    ("Utilities", None):                   ("Housing & Utilities", None),
    # Rent
    ("Rent",      None):                   ("Housing & Utilities", "Rent / EMI"),
    # Home
    ("Home",      "Furniture"):            ("Housing & Utilities", "Home Repair & Painting"),
    ("Home",      "Home Repair"):          ("Housing & Utilities", "Home Repair & Painting"),
    ("Home",      "Painting / Renovation"):("Housing & Utilities", "Home Repair & Painting"),
    ("Home",      None):                   ("Housing & Utilities", None),
    # Maintenance — if description looks like vehicle, → Transport; else → Housing
    ("Maintenance","Vehicle Service"):     ("Transport & Auto",   "Vehicle Service / Repair"),
    ("Maintenance","Home Repair"):         ("Housing & Utilities", "Home Repair & Painting"),
    ("Maintenance", None):                 ("Housing & Utilities", "Home Repair & Painting"),
    # Personal
    ("Personal",  "Salon & Grooming"):     ("Personal & Lifestyle", "Salon & Grooming"),
    ("Personal",  "Fitness"):              ("Personal & Lifestyle", "Gym / Fitness"),
    ("Personal",  "Clothing"):             ("Personal & Lifestyle", "Clothing & Fashion"),
    ("Personal",  None):                   ("Personal & Lifestyle", None),
    # Shopping
    ("Shopping",  "Online Shopping"):      ("Personal & Lifestyle", "Online Shopping"),
    ("Shopping",  "Clothing & Fashion"):   ("Personal & Lifestyle", "Clothing & Fashion"),
    ("Shopping",  "Electronics"):          ("Personal & Lifestyle", None),
    ("Shopping",  "Jewellery"):            ("Personal & Lifestyle", None),
    ("Shopping",  None):                   ("Personal & Lifestyle", "Online Shopping"),
    # Entertainment
    ("Entertainment","Movies"):            ("Personal & Lifestyle", "Entertainment & Movies"),
    ("Entertainment","Streaming"):         ("Personal & Lifestyle", "Entertainment & Movies"),
    ("Entertainment","Gaming"):            ("Personal & Lifestyle", "Entertainment & Movies"),
    ("Entertainment","Events"):            ("Personal & Lifestyle", "Entertainment & Movies"),
    ("Entertainment", None):               ("Personal & Lifestyle", "Entertainment & Movies"),
    # Insurance
    ("Insurance", None):                   ("Financial & Legal", "Insurance Premium (LIC etc)"),
    # Legal / Registration / Commission
    ("Legal",     None):                   ("Financial & Legal", "Legal / Stamp Duty"),
    ("Registration", None):                ("Financial & Legal", "Legal / Stamp Duty"),
    ("Commission", None):                  ("Financial & Legal", "Commission / Brokerage"),
    # Business / Miscellaneous
    ("Business",  None):                   ("Financial & Legal", None),
    ("Miscellaneous", None):               ("Personal & Lifestyle", None),
}


def resolve_subcategory(old_cat: str, old_sub: str | None) -> tuple[str, str | None]:
    """
    Look up (old_cat, old_sub) → (new_cat, new_sub).
    Falls back to (old_cat, old_sub) specific → (old_cat, None) wildcard.
    """
    key = (old_cat, old_sub)
    if key in SUBCATEGORY_MAP:
        return SUBCATEGORY_MAP[key]
    wildcard = (old_cat, None)
    if wildcard in SUBCATEGORY_MAP:
        new_cat, _ = SUBCATEGORY_MAP[wildcard]
        return new_cat, None
    # No sub mapping — just use the category map result
    new_cat = CATEGORY_MAP.get(old_cat, old_cat)
    return new_cat, None


def run(apply: bool, database_url: str | None):
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session

    url = database_url or os.environ.get("DATABASE_URL")
    if not url:
        # Fall back to app settings
        try:
            from app.config import settings
            url = settings.DATABASE_URL
        except Exception:
            print("ERROR: Cannot find DATABASE_URL. Set it via environment variable or .env file.")
            sys.exit(1)

    engine = create_engine(url)

    with Session(engine) as session:
        # ── fetch all expenses that have a legacy category ────────────────
        old_cats_quoted = ", ".join(f"'{c}'" for c in CATEGORY_MAP)
        rows = session.execute(
            text(f"SELECT id, category, sub_category, amount, description FROM expenses WHERE category IN ({old_cats_quoted}) ORDER BY id")
        ).fetchall()

        if not rows:
            print("✓ No expenses with legacy categories found — nothing to migrate.")
            return

        # ── build change plan ─────────────────────────────────────────────
        changes: list[dict] = []
        summary: dict[str, int] = defaultdict(int)

        for row in rows:
            eid, old_cat, old_sub, amount, desc = row
            new_cat = CATEGORY_MAP.get(old_cat, old_cat)

            if old_sub and (old_cat, old_sub) in SUBCATEGORY_MAP:
                new_cat, new_sub = SUBCATEGORY_MAP[(old_cat, old_sub)]
            elif old_sub:
                new_cat, new_sub = resolve_subcategory(old_cat, old_sub)
            else:
                wildcard = (old_cat, None)
                if wildcard in SUBCATEGORY_MAP:
                    new_cat, new_sub = SUBCATEGORY_MAP[wildcard]
                else:
                    new_sub = None

            changes.append({
                "id": eid,
                "old_cat": old_cat, "old_sub": old_sub,
                "new_cat": new_cat, "new_sub": new_sub,
                "amount": amount, "desc": (desc or "")[:60],
            })
            summary[f"{old_cat} → {new_cat}"] += 1

        # ── print preview ─────────────────────────────────────────────────
        print(f"\n{'='*70}")
        print(f"  Legacy category migration — {'DRY RUN (pass --apply to save)' if not apply else '⚠  APPLYING CHANGES'}")
        print(f"{'='*70}")
        print(f"\n  {len(changes)} expense(s) will be updated:\n")
        for mapping, count in sorted(summary.items()):
            print(f"  • {mapping:<45}  {count} rows")

        print(f"\n  Sample changes (up to 20):")
        print(f"  {'ID':>6}  {'Old Cat':<22}  {'Old Sub':<28}  →  {'New Cat':<22}  {'New Sub':<28}  {'Desc'}")
        print(f"  {'-'*6}  {'-'*22}  {'-'*28}     {'-'*22}  {'-'*28}  {'-'*40}")
        for c in changes[:20]:
            print(f"  {c['id']:>6}  {(c['old_cat'] or ''):<22}  {(c['old_sub'] or ''):<28}  →  {(c['new_cat'] or ''):<22}  {(c['new_sub'] or ''):<28}  {c['desc']}")
        if len(changes) > 20:
            print(f"  ... and {len(changes)-20} more")

        if not apply:
            print(f"\n  ↑ DRY RUN — nothing was changed.")
            print(f"  Run with --apply to commit these changes.\n")
            return

        # ── apply ──────────────────────────────────────────────────────────
        print(f"\n  Applying…")
        updated = 0
        try:
            for c in changes:
                session.execute(
                    text("UPDATE expenses SET category = :cat, sub_category = :sub WHERE id = :id"),
                    {"cat": c["new_cat"], "sub": c["new_sub"], "id": c["id"]},
                )
                updated += 1

            session.commit()
            print(f"\n  ✓ Done — {updated} expense(s) updated successfully.")
        except Exception as exc:
            session.rollback()
            print(f"\n  ✗ ERROR — rolled back. No changes were saved.\n  {exc}")
            sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate legacy expense categories to canonical DB names")
    parser.add_argument("--apply", action="store_true", help="Actually write changes (default: dry-run only)")
    parser.add_argument("--database-url", default=None, help="Override DATABASE_URL (e.g. production DB)")
    args = parser.parse_args()
    run(apply=args.apply, database_url=args.database_url)
