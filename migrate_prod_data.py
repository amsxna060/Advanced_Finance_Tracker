#!/usr/bin/env python3
"""
migrate_prod_data.py
One-time script: reads prod_data_dump.json, marks all existing dev records
as is_legacy=True, then inserts production data as is_legacy=False.

Run from project root:
    python3 migrate_prod_data.py

Requires the local dev API to be running on localhost:8000.
"""
import json
import sys
import requests
from decimal import Decimal

DEV_BASE = "http://localhost:8000/api"

def login():
    r = requests.post(f"{DEV_BASE}/auth/login", data={"username": "admin", "password": "admin123"})
    if r.status_code != 200:
        print(f"Login failed: {r.status_code} {r.text}")
        sys.exit(1)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}

def main():
    with open("prod_data_dump.json") as f:
        data = json.load(f)

    H = login()

    # Step 1: Mark ALL existing dev data as legacy via direct DB
    print("Step 1: Marking existing dev data as legacy via API endpoint...")
    r = requests.post(f"{DEV_BASE}/admin/mark-legacy", headers=H)
    if r.status_code != 200:
        print(f"  FAILED: {r.status_code} {r.text}")
        sys.exit(1)
    print(f"  Done: {r.json()}")

    # Step 2: Create contacts first (we need ID mapping)
    print("\nStep 2: Creating contacts...")
    prod_contacts = data.get("contacts", [])
    contact_id_map = {}  # prod_id -> dev_id

    for c in prod_contacts:
        prod_id = c["id"]
        # Check if contact already exists by name+phone
        payload = {
            "name": c["name"],
            "phone": c.get("phone"),
            "alternate_phone": c.get("alternate_phone"),
            "address": c.get("address"),
            "city": c.get("city"),
            "contact_type": c.get("contact_type", "individual"),
            "relationship_type": c.get("relationship_type", "borrower"),
            "is_handshake": c.get("is_handshake", False),
            "notes": c.get("notes"),
        }
        r = requests.post(f"{DEV_BASE}/contacts", headers=H, json=payload)
        if r.status_code == 200:
            new_id = r.json()["id"]
            contact_id_map[prod_id] = new_id
            print(f"  Contact {prod_id} '{c['name']}' -> dev ID {new_id}")
        else:
            # Might be 409 duplicate — try to find by name
            print(f"  Contact {prod_id} '{c['name']}' create returned {r.status_code}: {r.text[:100]}")
            # Search for it
            search_r = requests.get(f"{DEV_BASE}/contacts", headers=H, params={"search": c["name"]})
            if search_r.status_code == 200:
                matches = [x for x in search_r.json() if x["name"].lower() == c["name"].lower()]
                if matches:
                    contact_id_map[prod_id] = matches[0]["id"]
                    print(f"    Found existing: dev ID {matches[0]['id']}")
                else:
                    print(f"    WARNING: Could not find contact '{c['name']}' in dev DB")
            else:
                print(f"    WARNING: Search failed: {search_r.status_code}")

    # Step 3: Create properties
    print("\nStep 3: Creating properties...")
    prop_id_map = {}  # prod_prop_id -> dev_prop_id

    for prop_detail in data["properties"]:
        p = prop_detail["property"]
        prod_id = p["id"]

        payload = {
            "title": p["title"],
            "location": p.get("location"),
            "property_type": p.get("property_type", "plot"),
            "total_area_sqft": float(p["total_area_sqft"]) if p.get("total_area_sqft") else None,
            "deal_type": p.get("deal_type", "middleman"),
            "seller_contact_id": contact_id_map.get(p.get("seller_contact_id")),
            "buyer_contact_id": contact_id_map.get(p.get("buyer_contact_id")),
            "seller_rate_per_sqft": float(p["seller_rate_per_sqft"]) if p.get("seller_rate_per_sqft") else None,
            "buyer_rate_per_sqft": float(p["buyer_rate_per_sqft"]) if p.get("buyer_rate_per_sqft") else None,
            "total_seller_value": float(p["total_seller_value"]) if p.get("total_seller_value") else None,
            "total_buyer_value": float(p["total_buyer_value"]) if p.get("total_buyer_value") else None,
            "advance_paid": float(p["advance_paid"]) if p.get("advance_paid") else 0,
            "advance_date": p.get("advance_date"),
            "negotiating_date": p.get("negotiating_date"),
            "deal_locked_date": p.get("deal_locked_date"),
            "expected_registry_date": p.get("expected_registry_date"),
            "actual_registry_date": p.get("actual_registry_date"),
            "broker_name": p.get("broker_name"),
            "broker_commission": float(p["broker_commission"]) if p.get("broker_commission") else 0,
            "other_expenses": float(p["other_expenses"]) if p.get("other_expenses") else None,
            "purchase_price": float(p["purchase_price"]) if p.get("purchase_price") else None,
            "holding_cost": float(p["holding_cost"]) if p.get("holding_cost") else 0,
            "sale_price": float(p["sale_price"]) if p.get("sale_price") else None,
            "sale_date": p.get("sale_date"),
            "side_north_ft": float(p["side_north_ft"]) if p.get("side_north_ft") else None,
            "side_south_ft": float(p["side_south_ft"]) if p.get("side_south_ft") else None,
            "side_east_ft": float(p["side_east_ft"]) if p.get("side_east_ft") else None,
            "side_west_ft": float(p["side_west_ft"]) if p.get("side_west_ft") else None,
            "road_count": p.get("road_count"),
            "roads_json": p.get("roads_json"),
            "my_investment": float(p["my_investment"]) if p.get("my_investment") else 0,
            "my_share_percentage": float(p["my_share_percentage"]) if p.get("my_share_percentage") else None,
            "status": p.get("status", "negotiating"),
            "notes": p.get("notes"),
        }

        r = requests.post(f"{DEV_BASE}/properties", headers=H, json=payload)
        if r.status_code == 200:
            new_id = r.json()["id"]
            prop_id_map[prod_id] = new_id
            print(f"  Property {prod_id} '{p['title']}' -> dev ID {new_id}")
        else:
            print(f"  FAILED Property {prod_id} '{p['title']}': {r.status_code} {r.text[:200]}")

    # Step 4: Create partnerships (with linked property)
    print("\nStep 4: Creating partnerships...")
    partnership_id_map = {}  # prod -> dev
    member_id_map = {}  # prod_member_id -> dev_member_id

    for part_detail in data["partnerships"]:
        pp = part_detail["partnership"]
        prod_id = pp["id"]

        dev_prop_id = prop_id_map.get(pp.get("linked_property_deal_id"))

        payload = {
            "title": pp["title"],
            "linked_property_deal_id": dev_prop_id,
            "total_deal_value": float(pp["total_deal_value"]) if pp.get("total_deal_value") else None,
            "our_investment": float(pp["our_investment"]) if pp.get("our_investment") else 0,
            "our_share_percentage": float(pp["our_share_percentage"]) if pp.get("our_share_percentage") else None,
            "start_date": pp.get("start_date"),
            "expected_end_date": pp.get("expected_end_date"),
            "notes": pp.get("notes"),
        }

        r = requests.post(f"{DEV_BASE}/partnerships", headers=H, json=payload)
        if r.status_code == 200:
            new_id = r.json()["id"]
            partnership_id_map[prod_id] = new_id
            print(f"  Partnership {prod_id} '{pp['title']}' -> dev ID {new_id}")
        else:
            print(f"  FAILED Partnership {prod_id}: {r.status_code} {r.text[:200]}")
            continue

        # Step 4b: Add members
        members = part_detail.get("members", [])
        for m in members:
            mem = m["member"]
            prod_member_id = mem["id"]
            con = m.get("contact")

            member_payload = {
                "is_self": mem.get("is_self", False),
                "share_percentage": float(mem["share_percentage"]),
                "advance_contributed": float(mem.get("advance_contributed") or 0),
                "notes": mem.get("notes"),
            }

            if not mem.get("is_self") and con:
                dev_contact_id = contact_id_map.get(con.get("id"))
                if dev_contact_id:
                    member_payload["contact_id"] = dev_contact_id
                else:
                    print(f"    WARNING: No dev contact for prod contact {con.get('id')} '{con.get('name')}'")

            mr = requests.post(f"{DEV_BASE}/partnerships/{new_id}/members", headers=H, json=member_payload)
            if mr.status_code == 200:
                new_member_id = mr.json()["id"]
                member_id_map[prod_member_id] = new_member_id
                contact_name = con["name"] if con else "SELF"
                print(f"    Member {prod_member_id} '{contact_name}' -> dev ID {new_member_id}")
            else:
                print(f"    FAILED Member {prod_member_id}: {mr.status_code} {mr.text[:200]}")

    # Step 5: Create partnership transactions
    print("\nStep 5: Creating partnership transactions...")
    for part_detail in data["partnerships"]:
        pp = part_detail["partnership"]
        prod_part_id = pp["id"]
        dev_part_id = partnership_id_map.get(prod_part_id)
        if not dev_part_id:
            print(f"  Skipping txns for unmapped partnership {prod_part_id}")
            continue

        txns = part_detail.get("transactions", [])
        for t in txns:
            dev_member_id = member_id_map.get(t.get("member_id"))

            txn_payload = {
                "txn_type": t["txn_type"],
                "amount": float(t["amount"]),
                "txn_date": t["txn_date"],
                "payment_mode": t.get("payment_mode"),
                "description": t.get("description"),
                "member_id": dev_member_id,
                "from_partnership_pot": t.get("from_partnership_pot", False),
                "broker_name": t.get("broker_name"),
            }

            tr = requests.post(f"{DEV_BASE}/partnerships/{dev_part_id}/transactions", headers=H, json=txn_payload)
            if tr.status_code == 200:
                print(f"  Partnership {prod_part_id} txn {t['txn_type']} {t['amount']} -> OK")
            else:
                print(f"  FAILED txn {t['txn_type']} {t['amount']}: {tr.status_code} {tr.text[:200]}")

    # Step 6: Create legacy property transactions (for properties without partnerships)
    print("\nStep 6: Creating legacy property transactions...")
    for prop_detail in data["properties"]:
        p = prop_detail["property"]
        prod_id = p["id"]
        dev_prop_id = prop_id_map.get(prod_id)
        if not dev_prop_id:
            continue

        txns = prop_detail.get("transactions", [])
        for t in txns:
            if t.get("source") == "legacy":
                txn_payload = {
                    "txn_type": t["txn_type"],
                    "amount": float(t["amount"]),
                    "txn_date": t["txn_date"],
                    "payment_mode": t.get("payment_mode"),
                    "description": t.get("description"),
                }
                tr = requests.post(f"{DEV_BASE}/properties/{dev_prop_id}/transactions", headers=H, json=txn_payload)
                if tr.status_code == 200:
                    print(f"  Property {prod_id} legacy txn {t['txn_type']} {t['amount']} -> OK")
                else:
                    print(f"  FAILED legacy txn: {tr.status_code} {tr.text[:200]}")

    print("\n" + "=" * 60)
    print("MIGRATION COMPLETE")
    print(f"  Contacts migrated: {len(contact_id_map)}")
    print(f"  Properties migrated: {len(prop_id_map)}")
    print(f"  Partnerships migrated: {len(partnership_id_map)}")
    print(f"  Members migrated: {len(member_id_map)}")
    print("=" * 60)

    # Save ID mappings for reference
    mappings = {
        "contact_id_map": {str(k): v for k, v in contact_id_map.items()},
        "prop_id_map": {str(k): v for k, v in prop_id_map.items()},
        "partnership_id_map": {str(k): v for k, v in partnership_id_map.items()},
        "member_id_map": {str(k): v for k, v in member_id_map.items()},
    }
    with open("migration_id_mappings.json", "w") as f:
        json.dump(mappings, f, indent=2)
    print("ID mappings saved to migration_id_mappings.json")


if __name__ == "__main__":
    main()
