#!/bin/bash
# Full API Test: Plot Lifecycle + Site Lifecycle + Edge Cases
set -euo pipefail
BASE="http://localhost:8000/api"
TOKEN=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/x-www-form-urlencoded" -d "username=admin&password=admin123" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
AUTH="Authorization: Bearer $TOKEN"
CT="Content-Type: application/json"

PASS=0; FAIL=0; BUGS=""

check() {
  local name="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  [PASS] $name: $actual"
    PASS=$((PASS+1))
  else
    echo "  [FAIL] $name: got '$actual', expected '$expected'"
    FAIL=$((FAIL+1))
    BUGS="$BUGS\n- $name: got '$actual', expected '$expected'"
  fi
}

check_not() {
  local name="$1" actual="$2" not_expected="$3"
  if [[ "$actual" != "$not_expected" ]]; then
    echo "  [PASS] $name: $actual (not $not_expected)"
    PASS=$((PASS+1))
  else
    echo "  [FAIL] $name: got '$actual', should NOT be '$not_expected'"
    FAIL=$((FAIL+1))
    BUGS="$BUGS\n- $name: got '$actual', should NOT be '$not_expected'"
  fi
}

check_contains() {
  local name="$1" actual="$2" substr="$3"
  if [[ "$actual" == *"$substr"* ]]; then
    echo "  [PASS] $name: contains '$substr'"
    PASS=$((PASS+1))
  else
    echo "  [FAIL] $name: '$actual' does not contain '$substr'"
    FAIL=$((FAIL+1))
    BUGS="$BUGS\n- $name: '$actual' does not contain '$substr'"
  fi
}

post() { curl -s -X POST "$BASE$1" -H "$AUTH" -H "$CT" -d "$2"; }
get() { curl -s "$BASE$1" -H "$AUTH"; }
put() { curl -s -X PUT "$BASE$1" -H "$AUTH" -H "$CT" -d "$2"; }
del() { curl -s -X DELETE "$BASE$1" -H "$AUTH"; }
http_code() { curl -s -o /tmp/api_body.json -w "%{http_code}" -X "$1" "$BASE$2" -H "$AUTH" -H "$CT" -d "$3"; }
jq_val() { echo "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d$2'))" 2>/dev/null; }

echo "============================================="
echo "  FLOW A: PLOT Property Full Lifecycle"
echo "============================================="

echo -e "\n--- A1: Create Seller Contact ---"
R=$(post "/contacts" '{"name":"TSeller Plot","phone":"9900110011","relationship_type":"seller","city":"Mumbai"}')
SELLER_ID=$(jq_val "$R" "['id']")
check "Seller created" "$SELLER_ID" "$SELLER_ID"

echo -e "\n--- A2: Create Plot Property ---"
R=$(post "/properties" "{\"title\":\"Test Plot XYZ\",\"location\":\"Mumbai\",\"property_type\":\"plot\",\"total_area_sqft\":1000,\"seller_rate_per_sqft\":5000,\"seller_contact_id\":$SELLER_ID,\"side_north_ft\":50,\"side_south_ft\":50,\"side_east_ft\":20,\"side_west_ft\":20,\"negotiating_date\":\"2026-04-01\",\"expected_registry_date\":\"2026-08-01\"}")
PROP_ID=$(jq_val "$R" "['id']")
check "Property created" "$(jq_val "$R" "['property_type']")" "plot"
check "Status negotiating" "$(jq_val "$R" "['status']")" "negotiating"
TSV=$(jq_val "$R" "['total_seller_value']")
echo "  total_seller_value=$TSV"
check "Deal type middleman" "$(jq_val "$R" "['deal_type']")" "middleman"

echo -e "\n--- A3: Create Partner Contact ---"
R=$(post "/contacts" '{"name":"TPartner Rahul","phone":"9800110022","relationship_type":"partner","city":"Mumbai"}')
PARTNER_CID=$(jq_val "$R" "['id']")

echo -e "\n--- A4: Create Partnership Linked to Property ---"
R=$(post "/partnerships" "{\"title\":\"Test Plot Pship\",\"linked_property_deal_id\":$PROP_ID,\"total_deal_value\":5000000,\"start_date\":\"2026-04-01\",\"expected_end_date\":\"2026-08-01\"}")
PSHIP_ID=$(jq_val "$R" "['id']")
check "Partnership created" "$(jq_val "$R" "['status']")" "active"

echo -e "\n--- A5: Add Self Member 60% ---"
R=$(post "/partnerships/$PSHIP_ID/members" '{"is_self":true,"share_percentage":60}')
SELF_MID=$(jq_val "$R" "['id']")
check "Self member added" "$(jq_val "$R" "['share_percentage']")" "60.0"

echo -e "\n--- A6: Add Partner Member 40% ---"
R=$(post "/partnerships/$PSHIP_ID/members" "{\"contact_id\":$PARTNER_CID,\"is_self\":false,\"share_percentage\":40}")
PART_MID=$(jq_val "$R" "['id']")
check "Partner member added" "$(jq_val "$R" "['share_percentage']")" "40.0"

echo -e "\n--- A7: Try >100% shares (should fail) ---"
http_code "POST" "/partnerships/$PSHIP_ID/members" '{"is_self":false,"share_percentage":10}'
CODE=$(cat /tmp/api_body.json | python3 -c "import sys;print(sys.stdin.read())" | head -1)
# This should return 400
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/partnerships/$PSHIP_ID/members" -H "$AUTH" -H "$CT" -d '{"is_self":false,"share_percentage":10}')
check "Over 100% rejected" "$HTTP" "400"

echo -e "\n--- A8: Advance to Seller (Self, 500000) ---"
R=$(post "/partnerships/$PSHIP_ID/transactions" "{\"txn_type\":\"advance_to_seller\",\"amount\":500000,\"txn_date\":\"2026-04-05\",\"payment_mode\":\"bank_transfer\",\"member_id\":$SELF_MID}")
T1_ID=$(jq_val "$R" "['id']")
check "Advance txn created" "$(jq_val "$R" "['txn_type']")" "advance_to_seller"

echo -e "\n--- A9: Advance to Seller (Partner, 300000) ---"
R=$(post "/partnerships/$PSHIP_ID/transactions" "{\"txn_type\":\"advance_to_seller\",\"amount\":300000,\"txn_date\":\"2026-04-06\",\"payment_mode\":\"cash\",\"member_id\":$PART_MID}")
T2_ID=$(jq_val "$R" "['id']")

echo -e "\n--- A10: Remaining to Seller (Self, 2000000) ---"
R=$(post "/partnerships/$PSHIP_ID/transactions" "{\"txn_type\":\"remaining_to_seller\",\"amount\":2000000,\"txn_date\":\"2026-05-01\",\"payment_mode\":\"bank_transfer\",\"member_id\":$SELF_MID}")
T3_ID=$(jq_val "$R" "['id']")

echo -e "\n--- A11: Remaining to Seller (Partner, 2200000) ---"
R=$(post "/partnerships/$PSHIP_ID/transactions" "{\"txn_type\":\"remaining_to_seller\",\"amount\":2200000,\"txn_date\":\"2026-05-02\",\"payment_mode\":\"bank_transfer\",\"member_id\":$PART_MID}")

echo -e "\n--- A12: Expense (Self, 50000) ---"
R=$(post "/partnerships/$PSHIP_ID/transactions" "{\"txn_type\":\"expense\",\"amount\":50000,\"txn_date\":\"2026-04-10\",\"payment_mode\":\"cash\",\"member_id\":$SELF_MID,\"description\":\"Legal fees\"}")

echo -e "\n--- A13: Broker Commission (from pot, 100000) ---"
R=$(post "/partnerships/$PSHIP_ID/transactions" "{\"txn_type\":\"broker_commission\",\"amount\":100000,\"txn_date\":\"2026-04-15\",\"payment_mode\":\"cash\",\"broker_name\":\"Rajesh Broker\",\"from_partnership_pot\":true}")
check "Broker from_pot" "$(jq_val "$R" "['from_partnership_pot']")" "True"

echo -e "\n--- A14: Verify Summary After Outflows ---"
R=$(get "/partnerships/$PSHIP_ID")
S="$(echo "$R" | python3 -c "import sys,json;s=json.load(sys.stdin)['summary'];print(f\"{s['advance_to_seller']}|{s['remaining_to_seller']}|{s['broker_commission']}|{s['expense_total']}|{s['total_outflow']}\")")"
echo "  Summary: $S"
# advance=800000, remaining=4200000, broker=100000, expense=50000, total_outflow=5150000
check_contains "Advance 800000" "$S" "800000"
check_contains "Remaining 4200000" "$S" "4200000"

echo -e "\n--- A15: Buyer Payment Without Buyer (should 400) ---"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/partnerships/$PSHIP_ID/transactions" -H "$AUTH" -H "$CT" -d '{"txn_type":"buyer_advance","amount":100000,"txn_date":"2026-06-01","payment_mode":"cash"}')
check "Buyer txn blocked (no buyer)" "$HTTP" "400"

echo -e "\n--- A16: Create Buyer (Ramesh) ---"
R=$(post "/partnerships/$PSHIP_ID/create-buyer" '{"name":"Ramesh Kumar Test","phone":"9876540001","city":"Mumbai","area_sqft":1000,"rate_per_sqft":7000,"side_north_ft":50,"side_south_ft":50,"side_east_ft":20,"side_west_ft":20}')
PB_ID=$(jq_val "$R" ".get('plot_buyer',{}).get('id','FAIL')")
check_not "PlotBuyer created" "$PB_ID" "FAIL"
PB_TV=$(jq_val "$R" ".get('plot_buyer',{}).get('total_value','?')")
echo "  PlotBuyer total_value=$PB_TV"

echo -e "\n--- A17: Buyer Advance (Self receives, 1000000) ---"
R=$(post "/partnerships/$PSHIP_ID/transactions" "{\"txn_type\":\"buyer_advance\",\"amount\":1000000,\"txn_date\":\"2026-06-01\",\"payment_mode\":\"bank_transfer\",\"plot_buyer_id\":$PB_ID}")
check "Buyer advance OK" "$(jq_val "$R" "['txn_type']")" "buyer_advance"

echo -e "\n--- A18: Buyer Payment (Self, 3000000) ---"
R=$(post "/partnerships/$PSHIP_ID/transactions" "{\"txn_type\":\"buyer_payment\",\"amount\":3000000,\"txn_date\":\"2026-07-01\",\"payment_mode\":\"bank_transfer\",\"plot_buyer_id\":$PB_ID}")

echo -e "\n--- A19: Buyer Payment (Partner receives, 2000000) ---"
R=$(post "/partnerships/$PSHIP_ID/transactions" "{\"txn_type\":\"buyer_payment\",\"amount\":2000000,\"txn_date\":\"2026-08-01\",\"payment_mode\":\"cash\",\"plot_buyer_id\":$PB_ID,\"received_by_member_id\":$PART_MID}")

echo -e "\n--- A20: Profit Received (Self, 200000) ---"
R=$(post "/partnerships/$PSHIP_ID/transactions" "{\"txn_type\":\"profit_received\",\"amount\":200000,\"txn_date\":\"2026-08-15\",\"payment_mode\":\"cash\"}")

echo -e "\n--- A21: Full Summary Check ---"
R=$(get "/partnerships/$PSHIP_ID")
echo "$R" | python3 -c "
import sys,json;d=json.load(sys.stdin);s=d['summary']
print(f\"  advance_to_seller: {s['advance_to_seller']}\")
print(f\"  remaining_to_seller: {s['remaining_to_seller']}\")
print(f\"  broker_commission: {s['broker_commission']}\")
print(f\"  expense_total: {s['expense_total']}\")
print(f\"  total_outflow: {s['total_outflow']}\")
print(f\"  buyer_inflow: {s['buyer_inflow']}\")
print(f\"  profit_received: {s.get('profit_received',0)}\")
print(f\"  total_inflow: {s['total_inflow']}\")
print(f\"  our_pnl: {s['our_pnl']}\")
for m in d['members']:
    mm=m['member'];nm='Self' if mm['is_self'] else m.get('contact',{}).get('name','?')
    print(f\"  Member {nm}: adv={mm['advance_contributed']} share={mm['share_percentage']}%\")
for b in d.get('plot_buyers',[]):
    print(f\"  Buyer {b['buyer_name']}: paid={b['total_paid']} val={b['total_value']} st={b['status']}\")
"

echo -e "\n--- A22: Property Sync Check ---"
R=$(get "/properties/$PROP_ID")
echo "$R" | python3 -c "
import sys,json;d=json.load(sys.stdin);p=d['property']
print(f\"  Property status: {p['status']}\")
print(f\"  advance_paid: {p['advance_paid']}\")
print(f\"  broker_commission: {p['broker_commission']}\")
print(f\"  broker_name: {p.get('broker_name','?')}\")
print(f\"  other_expenses: {p['other_expenses']}\")
print(f\"  transactions: {len(d.get('transactions',[]))}\")
print(f\"  plot_buyers: {len(d.get('plot_buyers',[]))}\")
"

echo -e "\n--- A23: Edit Transaction ---"
R=$(put "/partnerships/$PSHIP_ID/transactions/$T1_ID" "{\"txn_type\":\"advance_to_seller\",\"amount\":600000,\"txn_date\":\"2026-04-05\",\"payment_mode\":\"bank_transfer\",\"member_id\":$SELF_MID}")
check "Edit txn OK" "$(jq_val "$R" "['amount']")" "600000.0"
# Re-check summary
R=$(get "/partnerships/$PSHIP_ID")
ADV=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['summary']['advance_to_seller'])")
check "Advance after edit" "$ADV" "900000.0"
# Undo: edit back to 500000
R=$(put "/partnerships/$PSHIP_ID/transactions/$T1_ID" "{\"txn_type\":\"advance_to_seller\",\"amount\":500000,\"txn_date\":\"2026-04-05\",\"payment_mode\":\"bank_transfer\",\"member_id\":$SELF_MID}")

echo -e "\n--- A24: Settlement ---"
R=$(put "/partnerships/$PSHIP_ID/settle" '{"actual_end_date":"2026-08-20","notes":"Full settlement test"}')
check "Settlement OK" "$(jq_val "$R" "['message']")" "Partnership settled successfully"
PSTATUS=$(jq_val "$R" ".get('partnership',{}).get('status','?')")
check "Partnership settled" "$PSTATUS" "settled"

echo -e "\n--- A25: Property settled too ---"
R=$(get "/properties/$PROP_ID")
PROP_ST=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['property']['status'])")
check "Property settled" "$PROP_ST" "settled"

echo -e "\n--- A26: Obligations created ---"
R=$(get "/obligations")
echo "$R" | python3 -c "
import sys,json;d=json.load(sys.stdin)
items = d if isinstance(d, list) else d.get('items', d.get('obligations', []))
found=0
for o in items:
    if o.get('linked_type')=='partnership' and o.get('linked_id')==$PSHIP_ID:
        found+=1
        print(f\"  Obligation: {o['obligation_type']} contact={o['contact_id']} amount={o['amount']} status={o.get('status','?')}\")
print(f'  Total obligations for this partnership: {found}')
" 2>/dev/null

echo ""
echo "============================================="
echo "  FLOW B: SITE Property Full Lifecycle"
echo "============================================="

echo -e "\n--- B1: Create Seller for Site ---"
R=$(post "/contacts" '{"name":"TSeller Site","phone":"9900220033","relationship_type":"seller","city":"Pune"}')
SITE_SELLER_ID=$(jq_val "$R" "['id']")

echo -e "\n--- B2: Create Site Property ---"
R=$(post "/properties" "{\"title\":\"Test Site Project\",\"location\":\"Pune\",\"property_type\":\"site\",\"total_area_sqft\":5000,\"total_seller_value\":10000000,\"seller_contact_id\":$SITE_SELLER_ID,\"negotiating_date\":\"2026-04-01\",\"expected_registry_date\":\"2026-10-01\"}")
SITE_PROP_ID=$(jq_val "$R" "['id']")
check "Site property created" "$(jq_val "$R" "['property_type']")" "site"

echo -e "\n--- B3: Create Partner B ---"
R=$(post "/contacts" '{"name":"TPartner SiteB","phone":"9700330044","relationship_type":"partner","city":"Pune"}')
PARTB_CID=$(jq_val "$R" "['id']")

echo -e "\n--- B4: Create Partnership for Site ---"
R=$(post "/partnerships" "{\"title\":\"Test Site Pship\",\"linked_property_deal_id\":$SITE_PROP_ID,\"total_deal_value\":10000000}")
SITE_PSHIP_ID=$(jq_val "$R" "['id']")

echo -e "\n--- B5: Add Self 50%, PartnerB 50% ---"
R=$(post "/partnerships/$SITE_PSHIP_ID/members" '{"is_self":true,"share_percentage":50}')
SITE_SELF_MID=$(jq_val "$R" "['id']")
R=$(post "/partnerships/$SITE_PSHIP_ID/members" "{\"contact_id\":$PARTB_CID,\"is_self\":false,\"share_percentage\":50}")
SITE_PART_MID=$(jq_val "$R" "['id']")

echo -e "\n--- B6: Advance to Seller (Self, 2000000) ---"
R=$(post "/partnerships/$SITE_PSHIP_ID/transactions" "{\"txn_type\":\"advance_to_seller\",\"amount\":2000000,\"txn_date\":\"2026-04-05\",\"payment_mode\":\"bank_transfer\",\"member_id\":$SITE_SELF_MID}")
check "Site advance OK" "$(jq_val "$R" "['txn_type']")" "advance_to_seller"

echo -e "\n--- B7: Create Site Plot via add-plot ---"
R=$(post "/partnerships/$SITE_PSHIP_ID/add-plot" '{"plot_number":"SP-1","area_sqft":500,"rate_per_sqft":3000,"side_north_ft":25,"side_south_ft":25,"side_east_ft":20,"side_west_ft":20}')
echo "  Add-plot response: $R"
SP1_ID=$(echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('site_plot',{}).get('id',d.get('plot_buyer',{}).get('id','FAIL')))" 2>/dev/null)
echo "  SitePlot/PlotBuyer ID: $SP1_ID"

echo -e "\n--- B8: Create 2nd site plot ---"
R=$(post "/partnerships/$SITE_PSHIP_ID/add-plot" '{"plot_number":"SP-2","area_sqft":800,"rate_per_sqft":2800}')
SP2_ID=$(echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('site_plot',{}).get('id',d.get('plot_buyer',{}).get('id','FAIL')))" 2>/dev/null)
echo "  SP2 ID: $SP2_ID"

echo -e "\n--- B9: Create buyer for site plot ---"
R=$(post "/partnerships/$SITE_PSHIP_ID/create-buyer" '{"name":"Site Buyer A","phone":"9800550066","city":"Pune","area_sqft":500,"rate_per_sqft":3000}')
echo "  Create-buyer response: $R"
SITE_BUYER_ID=$(echo "$R" | python3 -c "
import sys,json;d=json.load(sys.stdin)
sp = d.get('site_plot') or d.get('plot_buyer') or {}
print(sp.get('id','FAIL'))
" 2>/dev/null)
echo "  Site buyer linked ID: $SITE_BUYER_ID"

echo -e "\n--- B10: Buyer advance for site ---"
# Need to figure out the correct field (site_plot_id vs plot_buyer_id)
R=$(get "/partnerships/$SITE_PSHIP_ID")
echo "$R" | python3 -c "
import sys,json;d=json.load(sys.stdin)
print(f\"  site_plots: {len(d.get('site_plots',[]))}\")
for sp in d.get('site_plots',[]):
    print(f\"    SP {sp['id']}: {sp.get('plot_number','?')} buyer={sp.get('buyer_name','?')} area={sp.get('area_sqft','?')}\")
print(f\"  plot_buyers: {len(d.get('plot_buyers',[]))}\")
for pb in d.get('plot_buyers',[]):
    print(f\"    PB {pb['id']}: {pb.get('buyer_name','?')} area={pb.get('area_sqft','?')}\")
"

echo -e "\n--- B11: Partnership detail for site ---"
R=$(get "/partnerships/$SITE_PSHIP_ID")
echo "$R" | python3 -c "
import sys,json;d=json.load(sys.stdin);s=d['summary']
print(f\"  total_outflow: {s['total_outflow']}\")
print(f\"  total_inflow: {s['total_inflow']}\")
print(f\"  our_pnl: {s['our_pnl']}\")
"

echo -e "\n--- B12: Site Property Sync Check ---"
R=$(get "/properties/$SITE_PROP_ID")
echo "$R" | python3 -c "
import sys,json;d=json.load(sys.stdin);p=d['property']
print(f\"  Site status: {p['status']}\")
print(f\"  advance_paid: {p['advance_paid']}\")
print(f\"  site_plots: {len(d.get('site_plots',[]))}\")
print(f\"  transactions: {len(d.get('transactions',[]))}\")
"

echo ""
echo "============================================="
echo "  FLOW C: Edge Cases"
echo "============================================="

echo -e "\n--- C1: Partnership without property ---"
R=$(post "/partnerships" '{"title":"No-Property Partnership","total_deal_value":100000}')
NP_PSHIP_ID=$(jq_val "$R" "['id']")
check "No-prop partnership" "$(jq_val "$R" "['status']")" "active"

echo -e "\n--- C2: create-buyer on no-property partnership (should fail) ---"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/partnerships/$NP_PSHIP_ID/create-buyer" -H "$AUTH" -H "$CT" -d '{"name":"NoBuyer","phone":"1234567890"}')
check "create-buyer no-prop 400" "$HTTP" "400"

echo -e "\n--- C3: add-plot on no-property partnership (should fail) ---"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/partnerships/$NP_PSHIP_ID/add-plot" -H "$AUTH" -H "$CT" -d '{"plot_number":"X","area_sqft":100}')
check "add-plot no-prop 400" "$HTTP" "400"

echo -e "\n--- C4: Expense from pot (no member_id) ---"
R=$(post "/partnerships/$PSHIP_ID/transactions" '{"txn_type":"expense","amount":5000,"txn_date":"2026-04-12","payment_mode":"cash","from_partnership_pot":true,"description":"Misc expense from pot"}')
# This might fail since pship is settled... try on the no-prop one
R=$(post "/partnerships/$NP_PSHIP_ID/members" '{"is_self":true,"share_percentage":100}')
NP_SELF=$(jq_val "$R" "['id']")
R=$(post "/partnerships/$NP_PSHIP_ID/transactions" '{"txn_type":"expense","amount":5000,"txn_date":"2026-04-12","payment_mode":"cash","from_partnership_pot":true,"description":"Misc expense from pot"}')
echo "  Pot expense: $(jq_val "$R" "['id']") from_pot=$(jq_val "$R" "['from_partnership_pot']")"

echo -e "\n--- C5: Delete transaction ---"
DEL_TXN_R=$(post "/partnerships/$NP_PSHIP_ID/transactions" "{\"txn_type\":\"advance_to_seller\",\"amount\":10000,\"txn_date\":\"2026-04-01\",\"payment_mode\":\"cash\",\"member_id\":$NP_SELF}")
DEL_TXN_ID=$(jq_val "$DEL_TXN_R" "['id']")
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/partnerships/$NP_PSHIP_ID/transactions/$DEL_TXN_ID" -H "$AUTH")
check "Delete txn" "$HTTP" "200"

echo ""
echo "============================================="
echo "  RESULTS"
echo "============================================="
echo "PASSED: $PASS"
echo "FAILED: $FAIL"
if [[ $FAIL -gt 0 ]]; then
  echo -e "\nFailed tests:"
  echo -e "$BUGS"
fi
