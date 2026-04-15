#!/usr/bin/env python3
"""Fix missing contacts and partnership members from initial migration."""
import json
import requests

DEV_BASE = "http://localhost:8000/api"

# Login
r = requests.post(f"{DEV_BASE}/auth/login", data={"username": "admin", "password": "admin123"})
H = {"Authorization": f"Bearer {r.json()['access_token']}"}

# Load existing mappings
with open("migration_id_mappings.json") as f:
    maps = json.load(f)
contact_id_map = {int(k): v for k, v in maps["contact_id_map"].items()}
partnership_id_map = {int(k): v for k, v in maps["partnership_id_map"].items()}
member_id_map = {int(k): v for k, v in maps["member_id_map"].items()}

# Create missing contacts
missing_contacts = [
    {"id": 22, "name": "Ram Shankar Bhadouriya", "phone": "+91 9917420700", "city": "Firozabad"},
    {"id": 25, "name": "Pappu Rathore Ultratech Cement", "phone": "+91 9837817108", "city": "Firozabad"},
    {"id": 38, "name": "Vikas Rathore", "phone": None, "city": None},
    {"id": 54, "name": "Ram Nivas Rathore", "phone": None, "city": "Firozabad"},
]

for c in missing_contacts:
    payload = {
        "name": c["name"],
        "phone": c["phone"],
        "city": c["city"],
        "contact_type": "individual",
        "relationship_type": "partner",
    }
    r = requests.post(f"{DEV_BASE}/contacts", headers=H, json=payload)
    if r.status_code == 200:
        new_id = r.json()["id"]
        contact_id_map[c["id"]] = new_id
        print(f"Created contact {c['id']} '{c['name']}' -> dev ID {new_id}")
    elif r.status_code == 409:
        # Extract ID from error message like "already exists (ID 70)"
        import re
        match = re.search(r"already exists \(ID (\d+)\)", r.text)
        if match:
            existing_id = int(match.group(1))
            contact_id_map[c["id"]] = existing_id
            print(f"Contact {c['id']} '{c['name']}' already exists -> dev ID {existing_id}")
        else:
            print(f"FAILED contact {c['id']}: 409 but couldn't extract ID: {r.text[:200]}")
    else:
        print(f"FAILED contact {c['id']}: {r.status_code} {r.text[:200]}")

# Now add the failed members
with open("prod_data_dump.json") as f:
    data = json.load(f)

for pd in data["partnerships"]:
    pp = pd["partnership"]
    dev_part_id = partnership_id_map.get(pp["id"])
    if not dev_part_id:
        continue
    for m in pd.get("members", []):
        mem = m["member"]
        if mem["id"] in member_id_map:
            continue  # already created
        con = m.get("contact")
        if not con:
            continue
        dev_contact_id = contact_id_map.get(con["id"])
        if not dev_contact_id:
            print(f"Still no dev contact for {con['id']} '{con['name']}'")
            continue
        member_payload = {
            "is_self": mem.get("is_self", False),
            "share_percentage": float(mem["share_percentage"]),
            "advance_contributed": float(mem.get("advance_contributed") or 0),
            "notes": mem.get("notes"),
            "contact_id": dev_contact_id,
        }
        mr = requests.post(f"{DEV_BASE}/partnerships/{dev_part_id}/members", headers=H, json=member_payload)
        if mr.status_code == 200:
            new_member_id = mr.json()["id"]
            member_id_map[mem["id"]] = new_member_id
            print(f"Added member {mem['id']} '{con['name']}' to partnership {dev_part_id} -> dev member ID {new_member_id}")
        else:
            print(f"FAILED member {mem['id']}: {mr.status_code} {mr.text[:200]}")

# Save updated mappings
maps["contact_id_map"] = {str(k): v for k, v in contact_id_map.items()}
maps["member_id_map"] = {str(k): v for k, v in member_id_map.items()}
with open("migration_id_mappings.json", "w") as f:
    json.dump(maps, f, indent=2)
print(f"\nUpdated mappings saved. Total contacts: {len(contact_id_map)}, Members: {len(member_id_map)}")
