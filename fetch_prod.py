#!/usr/bin/env python3
"""Fetch all production data for migration."""
import requests
import json
import sys

BASE = "https://advanced-finance-tracker.onrender.com/api"

# Login
r = requests.post(f"{BASE}/auth/login", data={"username": "amolsaxena060", "password": "8268Gupt@"})
if r.status_code != 200:
    print(f"Login failed: {r.status_code} {r.text}")
    sys.exit(1)
token = r.json()["access_token"]
H = {"Authorization": f"Bearer {token}"}

# Fetch all data
print("=== PROPERTIES ===")
props = requests.get(f"{BASE}/properties", headers=H).json()
print(f"Total properties: {len(props)}")
for p in props:
    print(f"  ID={p['id']} title={p['title']!r} type={p.get('property_type')} status={p.get('status')} area={p.get('total_area_sqft')}")

print()
print("=== PARTNERSHIPS ===")
parts = requests.get(f"{BASE}/partnerships", headers=H).json()
print(f"Total partnerships: {len(parts)}")
for pp in parts:
    print(f"  ID={pp['id']} title={pp['title']!r} linked_prop={pp.get('linked_property_deal_id')} status={pp.get('status')} total_deal={pp.get('total_deal_value')}")

print()
print("=== CONTACTS ===")
contacts = requests.get(f"{BASE}/contacts", headers=H).json()
print(f"Total contacts: {len(contacts)}")
for c in contacts:
    print(f"  ID={c['id']} name={c['name']!r} phone={c.get('phone')} type={c.get('relationship_type')} city={c.get('city')}")

# Fetch detailed data for each property and partnership
all_data = {"properties": [], "partnerships": [], "contacts": contacts}

for p in props:
    detail = requests.get(f"{BASE}/properties/{p['id']}", headers=H).json()
    all_data["properties"].append(detail)
    print(f"\nProperty {p['id']} ({p['title']!r}):")
    txns = detail.get("transactions", [])
    print(f"  Transactions: {len(txns)}")
    for t in txns:
        print(f"    {t.get('source','?')} txn_type={t['txn_type']} amount={t['amount']} date={t.get('txn_date')} desc={t.get('description','')!r}")
    plot_buyers = detail.get("plot_buyers", [])
    print(f"  PlotBuyers: {len(plot_buyers)}")
    for pb in plot_buyers:
        print(f"    id={pb['id']} buyer={pb.get('buyer_name')} area={pb.get('area_sqft')} rate={pb.get('rate_per_sqft')} total={pb.get('total_value')} status={pb.get('status')}")
    site_plots = detail.get("site_plots", [])
    print(f"  SitePlots: {len(site_plots)}")
    for sp in site_plots:
        print(f"    id={sp['id']} plot#={sp.get('plot_number')} buyer={sp.get('buyer_name')} area={sp.get('area_sqft')} status={sp.get('status')}")

for pp in parts:
    detail = requests.get(f"{BASE}/partnerships/{pp['id']}", headers=H).json()
    all_data["partnerships"].append(detail)
    pdata = detail.get("partnership", {})
    print(f"\nPartnership {pp['id']} ({pp['title']!r}):")
    members = detail.get("members", [])
    print(f"  Members: {len(members)}")
    for m in members:
        mem = m.get("member", {})
        con = m.get("contact")
        print(f"    id={mem.get('id')} is_self={mem.get('is_self')} share={mem.get('share_percentage')}% advance={mem.get('advance_contributed')} contact={con.get('name') if con else 'SELF'}")
    txns = detail.get("transactions", [])
    print(f"  Transactions: {len(txns)}")
    for t in txns:
        print(f"    type={t['txn_type']} amount={t['amount']} date={t.get('txn_date')} member_id={t.get('member_id')} buyer_id={t.get('plot_buyer_id')} site_id={t.get('site_plot_id')} desc={t.get('description','')!r}")
    print(f"  Summary: {detail.get('summary', {})}")

# Save full dump
with open("prod_data_dump.json", "w") as f:
    json.dump(all_data, f, indent=2, default=str)
print("\n\nFull data saved to prod_data_dump.json")
