"""
Seed default Tier-2 Firozabad monthly budgets.
Run: python3 scripts/seed_budgets.py
Requires: backend running on localhost:8000 + a valid JWT token in env var TOKEN
          OR hardcode the token below.
"""
import os, sys, httpx

API = os.getenv("API_URL", "http://localhost:8000")
TOKEN = os.getenv("TOKEN", "")

BUDGETS = {
    "Groceries & Daily Needs":  8000,
    "Food & Dining":             5000,
    "Housing & Utilities":       4000,
    "Transport & Auto":          4000,
    "Health & Medical":          3000,
    "Education & Children":      5000,
    "Spiritual & Social":        3000,
    "Personal & Lifestyle":      4000,
    "Financial & Legal":         2000,
    "Shopping & Electronics":    3000,
    "Entertainment & Leisure":   2000,
    "Investment":                8000,
    "Uncategorized":             2000,
}

if not TOKEN:
    # Try to get token from login
    username = input("Admin username: ")
    password = input("Admin password: ")
    r = httpx.post(f"{API}/api/auth/login", json={"username": username, "password": password})
    r.raise_for_status()
    TOKEN = r.json()["access_token"]

headers = {"Authorization": f"Bearer {TOKEN}"}

print(f"Seeding {len(BUDGETS)} budgets to {API}...")
total = 0
for cat, amount in BUDGETS.items():
    r = httpx.post(
        f"{API}/api/category-limits",
        json={"category": cat, "monthly_limit": amount, "rollover_enabled": False},
        headers=headers,
    )
    if r.status_code in (200, 201):
        print(f"  ✓  {cat:35s} ₹{amount:,}")
        total += amount
    else:
        print(f"  ✗  {cat:35s} [{r.status_code}] {r.text}")

print(f"\nTotal monthly budget: ₹{total:,} / month")
