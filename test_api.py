#!/usr/bin/env python3
"""Full API Lifecycle Tests for Advanced Finance Tracker"""
import requests, json, sys, time

BASE = "http://localhost:8000/api"
s = requests.Session()
TS = str(int(time.time()))[-6:]  # unique suffix

# Auth
r = s.post(f"{BASE}/auth/login", data={"username": "admin", "password": "admin123"})
assert r.status_code == 200, f"Login failed: {r.text}"
token = r.json()["access_token"]
s.headers.update({"Authorization": f"Bearer {token}"})

PASS = 0
FAIL = 0
BUGS = []

def check(name, actual, expected):
    global PASS, FAIL
    if str(actual) == str(expected):
        print(f"  [PASS] {name}: {actual}")
        PASS += 1
    else:
        print(f"  [FAIL] {name}: got '{actual}', expected '{expected}'")
        FAIL += 1
        BUGS.append(f"{name}: got '{actual}', expected '{expected}'")

def check_code(name, resp, expected_code):
    global PASS, FAIL
    if resp.status_code == expected_code:
        print(f"  [PASS] {name}: HTTP {resp.status_code}")
        PASS += 1
    else:
        print(f"  [FAIL] {name}: HTTP {resp.status_code}, expected {expected_code}, body={resp.text[:300]}")
        FAIL += 1
        BUGS.append(f"{name}: HTTP {resp.status_code}, expected {expected_code}, body={resp.text[:200]}")

def check_ok(name, resp):
    check_code(name, resp, 200)

def post(path, data):
    return s.post(f"{BASE}{path}", json=data)

def get(path):
    return s.get(f"{BASE}{path}")

def put(path, data):
    return s.put(f"{BASE}{path}", json=data)

def delete(path):
    return s.delete(f"{BASE}{path}")

print("=" * 60)
print("  FLOW A: PLOT Property Full Lifecycle")
print("=" * 60)

print("\n--- A1: Create Seller Contact ---")
r = post("/contacts", {"name": f"TSeller Plot {TS}", "phone": f"99001{TS}", "relationship_type": "seller", "city": "Mumbai"})
check_ok("Create seller", r)
SELLER_ID = r.json()["id"]
print(f"  seller_id={SELLER_ID}")

print("\n--- A2: Create Plot Property ---")
r = post("/properties", {
    "title": "Test Plot XYZ", "location": "Mumbai", "property_type": "plot",
    "total_area_sqft": 1000, "seller_rate_per_sqft": 5000,
    "seller_contact_id": SELLER_ID,
    "side_north_ft": 50, "side_south_ft": 50, "side_east_ft": 20, "side_west_ft": 20,
    "negotiating_date": "2026-04-01", "expected_registry_date": "2026-08-01"
})
check_ok("Create plot property", r)
d = r.json()
PROP_ID = d["id"]
check("Property type", d["property_type"], "plot")
check("Status", d["status"], "negotiating")
check("Deal type default", d.get("deal_type", "?"), "middleman")
print(f"  prop_id={PROP_ID}, total_seller_value={d.get('total_seller_value')}")

print("\n--- A3: Create Partner Contact ---")
r = post("/contacts", {"name": f"TPartner Rahul {TS}", "phone": f"98001{TS}", "relationship_type": "partner", "city": "Mumbai"})
PARTNER_CID = r.json()["id"]

print("\n--- A4: Create Partnership Linked to Property ---")
r = post("/partnerships", {
    "title": "Test Plot Pship",
    "linked_property_deal_id": PROP_ID,
    "total_deal_value": 5000000,
    "start_date": "2026-04-01",
    "expected_end_date": "2026-08-01"
})
check_ok("Create partnership", r)
d = r.json()
PSHIP_ID = d["id"]
check("Partnership status", d["status"], "active")
print(f"  pship_id={PSHIP_ID}")

print("\n--- A5: Add Self Member 60% ---")
r = post(f"/partnerships/{PSHIP_ID}/members", {"is_self": True, "share_percentage": 60})
check_ok("Add self member", r)
SELF_MID = r.json()["id"]
check("Self share", r.json()["share_percentage"], 60.0)

print("\n--- A6: Add Partner Member 40% ---")
r = post(f"/partnerships/{PSHIP_ID}/members", {"contact_id": PARTNER_CID, "is_self": False, "share_percentage": 40})
check_ok("Add partner member", r)
PART_MID = r.json()["id"]
check("Partner share", r.json()["share_percentage"], 40.0)

print("\n--- A7: Try >100% shares (should fail) ---")
r = post(f"/partnerships/{PSHIP_ID}/members", {"is_self": False, "share_percentage": 10})
check_code("Over 100% rejected", r, 400)

print("\n--- A8: Advance to Seller (Self, 500000) ---")
r = post(f"/partnerships/{PSHIP_ID}/transactions", {
    "txn_type": "advance_to_seller", "amount": 500000, "txn_date": "2026-04-05",
    "payment_mode": "bank_transfer", "member_id": SELF_MID
})
check_ok("Advance self", r)
T1_ID = r.json()["id"]

print("\n--- A9: Advance to Seller (Partner, 300000) ---")
r = post(f"/partnerships/{PSHIP_ID}/transactions", {
    "txn_type": "advance_to_seller", "amount": 300000, "txn_date": "2026-04-06",
    "payment_mode": "cash", "member_id": PART_MID
})
check_ok("Advance partner", r)
T2_ID = r.json()["id"]

print("\n--- A10: Remaining to Seller (Self, 2000000) ---")
r = post(f"/partnerships/{PSHIP_ID}/transactions", {
    "txn_type": "remaining_to_seller", "amount": 2000000, "txn_date": "2026-05-01",
    "payment_mode": "bank_transfer", "member_id": SELF_MID
})
check_ok("Remaining self", r)

print("\n--- A11: Remaining to Seller (Partner, 2200000) ---")
r = post(f"/partnerships/{PSHIP_ID}/transactions", {
    "txn_type": "remaining_to_seller", "amount": 2200000, "txn_date": "2026-05-02",
    "payment_mode": "bank_transfer", "member_id": PART_MID
})
check_ok("Remaining partner", r)

print("\n--- A12: Expense (Self, 50000) ---")
r = post(f"/partnerships/{PSHIP_ID}/transactions", {
    "txn_type": "expense", "amount": 50000, "txn_date": "2026-04-10",
    "payment_mode": "cash", "member_id": SELF_MID, "description": "Legal fees"
})
check_ok("Expense self", r)

print("\n--- A13: Broker Commission (from pot, 100000) ---")
r = post(f"/partnerships/{PSHIP_ID}/transactions", {
    "txn_type": "broker_commission", "amount": 100000, "txn_date": "2026-04-15",
    "payment_mode": "cash", "broker_name": "Rajesh Broker", "from_partnership_pot": True
})
check_ok("Broker from pot", r)
check("from_partnership_pot", r.json().get("from_partnership_pot"), True)

print("\n--- A14: Summary After Outflows ---")
r = get(f"/partnerships/{PSHIP_ID}")
summ = r.json()["summary"]
print(f"  advance_to_seller: {summ['advance_to_seller']}")
print(f"  remaining_to_seller: {summ['remaining_to_seller']}")
print(f"  broker_commission: {summ['broker_commission']}")
print(f"  expense_total: {summ['expense_total']}")
print(f"  total_outflow: {summ['total_outflow']}")
check("Advance total", summ["advance_to_seller"], 800000.0)
check("Remaining total", summ["remaining_to_seller"], 4200000.0)
check("Broker total", summ["broker_commission"], 100000.0)
check("Expense total", summ["expense_total"], 50000.0)
check("Total outflow", summ["total_outflow"], 5150000.0)

print("\n--- A15: Buyer txn without buyer (should 400) ---")
r = post(f"/partnerships/{PSHIP_ID}/transactions", {
    "txn_type": "buyer_advance", "amount": 100000, "txn_date": "2026-06-01", "payment_mode": "cash"
})
check_code("Buyer txn no buyer", r, 400)

print("\n--- A16: Create Buyer (Ramesh) ---")
r = post(f"/partnerships/{PSHIP_ID}/create-buyer", {
    "name": f"Ramesh Kumar {TS}", "phone": f"98765{TS}", "city": "Mumbai",
    "area_sqft": 1000, "rate_per_sqft": 7000,
    "side_north_ft": 50, "side_south_ft": 50, "side_east_ft": 20, "side_west_ft": 20
})
check_ok("Create buyer", r)
d = r.json()
print(f"  create-buyer response keys: {list(d.keys())}")
pb = d.get("plot_buyer") or d.get("buyer") or {}
PB_ID = pb.get("id")
if PB_ID:
    print(f"  plot_buyer_id={PB_ID}, total_value={pb.get('total_value')}")
else:
    print(f"  WARNING: Could not extract plot_buyer_id from response: {json.dumps(d)[:300]}")
    PB_ID = None

print("\n--- A17: Buyer Advance (1000000) ---")
if PB_ID:
    r = post(f"/partnerships/{PSHIP_ID}/transactions", {
        "txn_type": "buyer_advance", "amount": 1000000, "txn_date": "2026-06-01",
        "payment_mode": "bank_transfer", "plot_buyer_id": PB_ID
    })
    check_ok("Buyer advance", r)
else:
    print("  [SKIP] No PB_ID")

print("\n--- A18: Buyer Payment (3000000) ---")
if PB_ID:
    r = post(f"/partnerships/{PSHIP_ID}/transactions", {
        "txn_type": "buyer_payment", "amount": 3000000, "txn_date": "2026-07-01",
        "payment_mode": "bank_transfer", "plot_buyer_id": PB_ID
    })
    check_ok("Buyer payment 1", r)

print("\n--- A19: Buyer Payment (2000000, received_by partner) ---")
if PB_ID:
    r = post(f"/partnerships/{PSHIP_ID}/transactions", {
        "txn_type": "buyer_payment", "amount": 2000000, "txn_date": "2026-08-01",
        "payment_mode": "cash", "plot_buyer_id": PB_ID, "received_by_member_id": PART_MID
    })
    check_ok("Buyer payment 2", r)

print("\n--- A20: Profit Received (200000) ---")
r = post(f"/partnerships/{PSHIP_ID}/transactions", {
    "txn_type": "profit_received", "amount": 200000, "txn_date": "2026-08-15",
    "payment_mode": "cash"
})
check_ok("Profit received", r)

print("\n--- A21: Full Summary Check ---")
r = get(f"/partnerships/{PSHIP_ID}")
d = r.json()
summ = d["summary"]
print(f"  advance_to_seller: {summ['advance_to_seller']}")
print(f"  remaining_to_seller: {summ['remaining_to_seller']}")
print(f"  broker_commission: {summ['broker_commission']}")
print(f"  expense_total: {summ['expense_total']}")
print(f"  total_outflow: {summ['total_outflow']}")
print(f"  buyer_inflow: {summ.get('buyer_inflow', 'N/A')}")
print(f"  profit_received: {summ.get('profit_received', 0)}")
print(f"  total_inflow: {summ['total_inflow']}")
print(f"  our_pnl: {summ['our_pnl']}")
for m in d.get("members", []):
    mm = m["member"]
    nm = "Self" if mm["is_self"] else m.get("contact", {}).get("name", "?")
    print(f"  Member {nm}: invested={mm.get('advance_contributed', mm.get('total_invested', '?'))} share={mm['share_percentage']}%")
for b in d.get("plot_buyers", []):
    print(f"  Buyer {b.get('buyer_name', '?')}: paid={b.get('total_paid', '?')} val={b.get('total_value', '?')} st={b.get('status', '?')}")

print("\n--- A22: Property Sync Check ---")
r = get(f"/properties/{PROP_ID}")
d = r.json()
p = d["property"]
print(f"  Property status: {p['status']}")
print(f"  advance_paid: {p.get('advance_paid')}")
print(f"  broker_commission: {p.get('broker_commission')}")
print(f"  broker_name: {p.get('broker_name')}")
print(f"  other_expenses: {p.get('other_expenses')}")
print(f"  transactions count: {len(d.get('transactions', []))}")
print(f"  plot_buyers count: {len(d.get('plot_buyers', []))}")

print("\n--- A23: Edit Transaction ---")
r = put(f"/partnerships/{PSHIP_ID}/transactions/{T1_ID}", {
    "txn_type": "advance_to_seller", "amount": 600000, "txn_date": "2026-04-05",
    "payment_mode": "bank_transfer", "member_id": SELF_MID
})
check_ok("Edit txn", r)
check("Edited amount", r.json().get("amount"), 600000.0)
# Verify summary
r = get(f"/partnerships/{PSHIP_ID}")
adv = r.json()["summary"]["advance_to_seller"]
check("Advance after edit", adv, 900000.0)
# Undo
r = put(f"/partnerships/{PSHIP_ID}/transactions/{T1_ID}", {
    "txn_type": "advance_to_seller", "amount": 500000, "txn_date": "2026-04-05",
    "payment_mode": "bank_transfer", "member_id": SELF_MID
})

print("\n--- A24: Settlement ---")
r = put(f"/partnerships/{PSHIP_ID}/settle", {
    "actual_end_date": "2026-08-20", "notes": "Full settlement test"
})
check_ok("Settle partnership", r)
d = r.json()
print(f"  Settle response keys: {list(d.keys())}")
pship_status = d.get("partnership", {}).get("status", d.get("status", "?"))
check("Settled status", pship_status, "settled")

print("\n--- A25: Property Settled Too ---")
r = get(f"/properties/{PROP_ID}")
prop_st = r.json()["property"]["status"]
check("Property settled", prop_st, "settled")

print("\n--- A26: Obligations Created ---")
r = get("/obligations")
d = r.json()
items = d if isinstance(d, list) else d.get("items", d.get("obligations", []))
found = 0
for o in items:
    lt = o.get("linked_type", "")
    li = o.get("linked_id")
    if lt == "partnership" and li == PSHIP_ID:
        found += 1
        print(f"  Obligation: type={o.get('obligation_type')} contact={o.get('contact_id')} amount={o.get('amount')} status={o.get('status')}")
print(f"  Total obligations for this partnership: {found}")

print("\n" + "=" * 60)
print("  FLOW B: SITE Property Full Lifecycle")
print("=" * 60)

print("\n--- B1: Create Seller for Site ---")
r = post("/contacts", {"name": f"TSeller Site {TS}", "phone": f"99002{TS}", "relationship_type": "seller", "city": "Pune"})
check_ok("Create site seller", r)
SITE_SELLER_ID = r.json()["id"]

print("\n--- B2: Create Site Property ---")
r = post("/properties", {
    "title": "Test Site Project", "location": "Pune", "property_type": "site",
    "total_area_sqft": 5000, "total_seller_value": 10000000,
    "seller_contact_id": SITE_SELLER_ID,
    "negotiating_date": "2026-04-01", "expected_registry_date": "2026-10-01"
})
check_ok("Create site property", r)
d = r.json()
SITE_PROP_ID = d["id"]
check("Site type", d["property_type"], "site")
print(f"  site_prop_id={SITE_PROP_ID}")

print("\n--- B3: Create Partner B ---")
r = post("/contacts", {"name": f"TPartner SiteB {TS}", "phone": f"97003{TS}", "relationship_type": "partner", "city": "Pune"})
PARTB_CID = r.json()["id"]

print("\n--- B4: Create Partnership for Site ---")
r = post("/partnerships", {
    "title": "Test Site Pship", "linked_property_deal_id": SITE_PROP_ID,
    "total_deal_value": 10000000
})
check_ok("Create site partnership", r)
SITE_PSHIP_ID = r.json()["id"]
print(f"  site_pship_id={SITE_PSHIP_ID}")

print("\n--- B5: Add Members 50/50 ---")
r = post(f"/partnerships/{SITE_PSHIP_ID}/members", {"is_self": True, "share_percentage": 50})
check_ok("Site self member", r)
SITE_SELF_MID = r.json()["id"]
r = post(f"/partnerships/{SITE_PSHIP_ID}/members", {"contact_id": PARTB_CID, "is_self": False, "share_percentage": 50})
check_ok("Site partner member", r)
SITE_PART_MID = r.json()["id"]

print("\n--- B6: Outflow transactions ---")
r = post(f"/partnerships/{SITE_PSHIP_ID}/transactions", {
    "txn_type": "advance_to_seller", "amount": 2000000, "txn_date": "2026-04-05",
    "payment_mode": "bank_transfer", "member_id": SITE_SELF_MID
})
check_ok("Site advance", r)
r = post(f"/partnerships/{SITE_PSHIP_ID}/transactions", {
    "txn_type": "remaining_to_seller", "amount": 3000000, "txn_date": "2026-05-01",
    "payment_mode": "bank_transfer", "member_id": SITE_SELF_MID
})
check_ok("Site remaining self", r)
r = post(f"/partnerships/{SITE_PSHIP_ID}/transactions", {
    "txn_type": "remaining_to_seller", "amount": 5000000, "txn_date": "2026-05-02",
    "payment_mode": "bank_transfer", "member_id": SITE_PART_MID
})
check_ok("Site remaining partner", r)

print("\n--- B7: Add Site Plot SP-1 ---")
r = post(f"/partnerships/{SITE_PSHIP_ID}/add-plot", {
    "plot_number": "SP-1", "area_sqft": 500, "rate_per_sqft": 3000,
    "side_north_ft": 25, "side_south_ft": 25, "side_east_ft": 20, "side_west_ft": 20
})
check_ok("Add plot SP-1", r)
d = r.json()
print(f"  add-plot response keys: {list(d.keys())}")
sp1 = d.get("site_plot") or d.get("plot") or {}
SP1_ID = sp1.get("id")
print(f"  SP1_ID={SP1_ID}")

print("\n--- B8: Add Site Plot SP-2 ---")
r = post(f"/partnerships/{SITE_PSHIP_ID}/add-plot", {
    "plot_number": "SP-2", "area_sqft": 800, "rate_per_sqft": 2800
})
check_ok("Add plot SP-2", r)
d = r.json()
sp2 = d.get("site_plot") or d.get("plot") or {}
SP2_ID = sp2.get("id")
print(f"  SP2_ID={SP2_ID}")

print("\n--- B9: Assign Buyer to Site Plot ---")
r = post(f"/partnerships/{SITE_PSHIP_ID}/create-buyer", {
    "name": f"Site Buyer A {TS}", "phone": f"98005{TS}", "city": "Pune",
    "area_sqft": 500, "rate_per_sqft": 3500
})
d_resp = r.json()
print(f"  create-buyer status={r.status_code} keys={list(d_resp.keys())}")
if r.status_code == 200:
    print(f"  Full response: {json.dumps(d_resp)[:500]}")
else:
    print(f"  Error: {r.text[:300]}")
    BUGS.append(f"Site create-buyer failed: HTTP {r.status_code} {r.text[:200]}")
    FAIL += 1

# Also check via assign-buyer if it exists
# Try to get site partnership detail to see site_plots and plot_buyers
print("\n--- B10: Site Partnership Detail ---")
r = get(f"/partnerships/{SITE_PSHIP_ID}")
d = r.json()
print(f"  Members: {len(d.get('members', []))}")
print(f"  Transactions: {len(d.get('transactions', []))}")
print(f"  Site plots: {len(d.get('site_plots', []))}")
for sp in d.get("site_plots", []):
    print(f"    SP {sp.get('id')}: {sp.get('plot_number','?')} buyer={sp.get('buyer_name','?')} area={sp.get('area_sqft','?')}")
print(f"  Plot buyers: {len(d.get('plot_buyers', []))}")
for pb in d.get("plot_buyers", []):
    print(f"    PB {pb.get('id')}: {pb.get('buyer_name','?')} area={pb.get('area_sqft','?')} total_value={pb.get('total_value','?')}")
summ = d["summary"]
print(f"  total_outflow: {summ['total_outflow']}")
print(f"  total_inflow: {summ['total_inflow']}")

# Try buyer inflow txn for site
print("\n--- B11: Site Buyer Advance ---")
# Find plot_buyer or site_plot for inflow
pb_list = d.get("plot_buyers", [])
sp_list = d.get("site_plots", [])
site_buyer_id = None
if pb_list:
    site_buyer_id = pb_list[0]["id"]
    print(f"  Using plot_buyer_id={site_buyer_id}")
    r = post(f"/partnerships/{SITE_PSHIP_ID}/transactions", {
        "txn_type": "buyer_advance", "amount": 500000, "txn_date": "2026-06-01",
        "payment_mode": "cash", "plot_buyer_id": site_buyer_id
    })
    check_ok("Site buyer advance", r)
elif sp_list:
    for sp in sp_list:
        if sp.get("buyer_name"):
            print(f"  Found site_plot with buyer: {sp}")
    print(f"  No plot_buyers found, checking if buyer_advance works with site_plot_id")
else:
    print("  [SKIP] No buyers available for site")

print("\n--- B12: Site Property Sync Check ---")
r = get(f"/properties/{SITE_PROP_ID}")
d = r.json()
p = d["property"]
print(f"  Site status: {p['status']}")
print(f"  advance_paid: {p.get('advance_paid')}")
print(f"  site_plots: {len(d.get('site_plots', []))}")
for sp in d.get("site_plots", []):
    print(f"    SP: {sp.get('plot_number','?')} area={sp.get('area_sqft','?')} buyer={sp.get('buyer_name', 'None')}")
print(f"  transactions: {len(d.get('transactions', []))}")

print("\n--- B13: Settle Site Partnership ---")
r = put(f"/partnerships/{SITE_PSHIP_ID}/settle", {
    "actual_end_date": "2026-10-20", "notes": "Site settlement"
})
check_ok("Settle site partnership", r)

print("\n--- B14: Site Property Settled ---")
r = get(f"/properties/{SITE_PROP_ID}")
prop_st = r.json()["property"]["status"]
check("Site property settled", prop_st, "settled")


print("\n" + "=" * 60)
print("  FLOW C: Edge Cases & Validation")
print("=" * 60)

print("\n--- C1: Partnership without property ---")
r = post("/partnerships", {"title": "No-Property Partnership", "total_deal_value": 100000})
check_ok("No-prop partnership", r)
NP_PSHIP_ID = r.json()["id"]
check("No-prop status", r.json()["status"], "active")

print("\n--- C2: create-buyer on no-property partnership ---")
r = post(f"/partnerships/{NP_PSHIP_ID}/create-buyer", {
    "name": f"NoBuyer {TS}", "phone": f"12345{TS}", "area_sqft": 100
})
check_code("create-buyer no-prop", r, 400)

print("\n--- C3: add-plot on no-property partnership ---")
r = post(f"/partnerships/{NP_PSHIP_ID}/add-plot", {
    "plot_number": "X", "area_sqft": 100
})
check_code("add-plot no-prop", r, 400)

print("\n--- C4: Expense from pot (no member_id) ---")
r = post(f"/partnerships/{NP_PSHIP_ID}/members", {"is_self": True, "share_percentage": 100})
NP_SELF = r.json()["id"]
r = post(f"/partnerships/{NP_PSHIP_ID}/transactions", {
    "txn_type": "expense", "amount": 5000, "txn_date": "2026-04-12",
    "payment_mode": "cash", "from_partnership_pot": True, "description": "Misc from pot"
})
print(f"  Pot expense status={r.status_code}")
if r.status_code == 200:
    check("Pot expense from_pot", r.json().get("from_partnership_pot"), True)
else:
    print(f"  Error: {r.text[:200]}")
    BUGS.append(f"Pot expense without member_id failed: {r.text[:200]}")
    FAIL += 1

print("\n--- C5: Delete transaction ---")
r = post(f"/partnerships/{NP_PSHIP_ID}/transactions", {
    "txn_type": "advance_to_seller", "amount": 10000, "txn_date": "2026-04-01",
    "payment_mode": "cash", "member_id": NP_SELF
})
DEL_TXN_ID = r.json()["id"]
r = delete(f"/partnerships/{NP_PSHIP_ID}/transactions/{DEL_TXN_ID}")
check_ok("Delete txn", r)

print("\n--- C6: Duplicate self member ---")
r = post(f"/partnerships/{NP_PSHIP_ID}/members", {"is_self": True, "share_percentage": 50})
check_code("Duplicate self", r, 400)

print("\n--- C7: Zero amount transaction ---")
r = post(f"/partnerships/{NP_PSHIP_ID}/transactions", {
    "txn_type": "expense", "amount": 0, "txn_date": "2026-04-01",
    "payment_mode": "cash", "member_id": NP_SELF
})
print(f"  Zero amount: status={r.status_code}")
if r.status_code == 200:
    BUGS.append("Zero amount transaction accepted (should be rejected)")
    FAIL += 1
    print("  [FAIL] Zero amount accepted")
else:
    print("  [PASS] Zero amount rejected")
    PASS += 1

print("\n--- C8: Negative amount transaction ---")
r = post(f"/partnerships/{NP_PSHIP_ID}/transactions", {
    "txn_type": "expense", "amount": -1000, "txn_date": "2026-04-01",
    "payment_mode": "cash", "member_id": NP_SELF
})
print(f"  Negative amount: status={r.status_code}")
if r.status_code == 200:
    BUGS.append("Negative amount transaction accepted (should be rejected)")
    FAIL += 1
    print("  [FAIL] Negative amount accepted")
else:
    print("  [PASS] Negative amount rejected")
    PASS += 1

print("\n--- C9: Transaction on settled partnership ---")
r = post(f"/partnerships/{PSHIP_ID}/transactions", {
    "txn_type": "expense", "amount": 1000, "txn_date": "2026-09-01",
    "payment_mode": "cash", "member_id": SELF_MID
})
check_code("Txn on settled", r, 400)

print("\n--- C10: Delete member from settled partnership ---")
r = delete(f"/partnerships/{PSHIP_ID}/members/{SELF_MID}")
check_code("Delete member settled", r, 400)

print("\n--- C11: Property type validation ---")
r = post("/properties", {
    "title": "Bad Type", "location": "X", "property_type": "flat",
    "total_area_sqft": 100, "seller_contact_id": SELLER_ID
})
print(f"  Property type=flat: status={r.status_code}")
if r.status_code == 200:
    BUGS.append("Property type 'flat' accepted (should only allow plot/site)")
    FAIL += 1
    print("  [FAIL] flat type accepted")
else:
    print("  [PASS] flat type rejected")
    PASS += 1

print("\n--- C12: Edit settled partnership ---")
r = put(f"/partnerships/{PSHIP_ID}", {"title": "Edited Settled"})
print(f"  Edit settled: status={r.status_code}")
# Check if it allows or blocks

print("\n--- C13: buyer_advance with invalid plot_buyer_id ---")
r = post(f"/partnerships/{NP_PSHIP_ID}/transactions", {
    "txn_type": "buyer_advance", "amount": 100000, "txn_date": "2026-06-01",
    "payment_mode": "cash", "plot_buyer_id": 999999
})
check_code("Invalid buyer_id", r, 400)

print("\n--- C14: Delete partnership ---")
r = post("/partnerships", {"title": "To Delete", "total_deal_value": 50000})
DEL_PSHIP_ID = r.json()["id"]
r = delete(f"/partnerships/{DEL_PSHIP_ID}")
check_ok("Delete partnership", r)
# Verify deleted
r = get(f"/partnerships/{DEL_PSHIP_ID}")
check_code("Get deleted 404", r, 404)

print("\n--- C15: Multiple buyers for plot ---")
# Create fresh property and partnership for this test
r = post("/properties", {
    "title": "MultiBuyer Plot", "location": "Test", "property_type": "plot",
    "total_area_sqft": 2000, "seller_rate_per_sqft": 3000,
    "seller_contact_id": SELLER_ID
})
MB_PROP_ID = r.json()["id"]
r = post("/partnerships", {"title": "MultiBuyer Pship", "linked_property_deal_id": MB_PROP_ID, "total_deal_value": 6000000})
MB_PSHIP_ID = r.json()["id"]
r = post(f"/partnerships/{MB_PSHIP_ID}/members", {"is_self": True, "share_percentage": 100})
# Try creating 2 buyers for a plot (should only allow 1 for plot type)
r1 = post(f"/partnerships/{MB_PSHIP_ID}/create-buyer", {
    "name": f"Buyer1 MB {TS}", "phone": f"99998{TS}", "city": "Test", "area_sqft": 2000, "rate_per_sqft": 4000
})
print(f"  1st buyer: {r1.status_code}")
r2 = post(f"/partnerships/{MB_PSHIP_ID}/create-buyer", {
    "name": f"Buyer2 MB {TS}", "phone": f"99997{TS}", "city": "Test", "area_sqft": 2000, "rate_per_sqft": 4500
})
print(f"  2nd buyer: {r2.status_code}")
if r2.status_code == 200:
    BUGS.append("Plot type allows multiple buyers (should allow only 1 per plot)")
    FAIL += 1
    print("  [FAIL] Plot allows multiple buyers")
else:
    print("  [PASS] Plot rejects 2nd buyer")
    PASS += 1

print("\n\n" + "=" * 60)
print("  FINAL RESULTS")
print("=" * 60)
print(f"PASSED: {PASS}")
print(f"FAILED: {FAIL}")
if BUGS:
    print(f"\n{'='*60}")
    print("  ALL BUGS FOUND")
    print(f"{'='*60}")
    for i, bug in enumerate(BUGS, 1):
        print(f"  {i}. {bug}")
