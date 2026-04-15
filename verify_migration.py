#!/usr/bin/env python3
"""Quick verification of migration results."""
import json
import requests

DEV_BASE = "http://localhost:8000/api"
r = requests.post(f"{DEV_BASE}/auth/login", data={"username": "admin", "password": "admin123"})
H = {"Authorization": f"Bearer {r.json()['access_token']}"}

with open("prod_data_dump.json") as f:
    prod = json.load(f)

print("=== MIGRATION VERIFICATION ===\n")

props = requests.get(f"{DEV_BASE}/properties", headers=H, allow_redirects=True).json()
print(f"Properties: {len(props)}/{len(prod['properties'])} migrated")
for p in props:
    print(f"  [{p['id']}] {p['title']} ({p['status']}, {p['total_area_sqft']}sqft)")

print()
parts = requests.get(f"{DEV_BASE}/partnerships", headers=H, allow_redirects=True).json()
print(f"Partnerships: {len(parts)}/{len(prod['partnerships'])} migrated")
for p in parts:
    print(f"  [{p['id']}] {p['title']}")

print()
contacts = requests.get(f"{DEV_BASE}/contacts", headers=H, allow_redirects=True, params={"limit": 100}).json()
print(f"Contacts: {len(contacts)} total (20 original + 4 partner contacts)")
