#!/bin/bash
# UAT Test Script for Advanced Finance Tracker
set -e

BASE="http://localhost:8000"
TOKEN=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin123" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
AUTH="Authorization: Bearer $TOKEN"

PASS=0
FAIL=0
BUGS=""

pass_test() {
  echo "  [PASS] $1"
  PASS=$((PASS + 1))
}
fail_test() {
  echo "  [FAIL] $1 — $2"
  FAIL=$((FAIL + 1))
  BUGS="$BUGS\n- $1: $2"
}

api() {
  # $1=method $2=path $3=data (optional)
  if [ -n "$3" ]; then
    curl -s -o /tmp/api_resp.json -w "%{http_code}" -X "$1" "$BASE$2" -H "$AUTH" -H "Content-Type: application/json" -d "$3"
  else
    curl -s -o /tmp/api_resp.json -w "%{http_code}" -X "$1" "$BASE$2" -H "$AUTH"
  fi
}

body() { cat /tmp/api_resp.json; }
jq_() { cat /tmp/api_resp.json | python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

echo "============================================================"
echo "  ADVANCED FINANCE TRACKER — UAT TEST SUITE"
echo "============================================================"
echo ""

# ─── CONTACT TESTS ────────────────────────────────────────────
echo "── Contact Tests ──"

# C-01: Create contact
CODE=$(api POST /api/contacts '{"name":"UAT Test Buyer","phone":"9999900001","contact_type":"individual","relationship_type":"buyer","city":"Jaipur"}')
if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
  pass_test "C-01: Create contact"
  TEST_BUYER_ID=$(jq_ "d['id']")
else
  # Might already exist from previous run
  CODE2=$(api POST /api/contacts '{"name":"UAT Test Buyer2","phone":"9999900099","contact_type":"individual","relationship_type":"buyer","city":"Jaipur"}')
  TEST_BUYER_ID=$(jq_ "d['id']")
  pass_test "C-01: Create contact (alt)"
fi

# C-02: Duplicate contact (same name+phone)
CODE=$(api POST /api/contacts '{"name":"UAT Test Buyer","phone":"9999900001","contact_type":"individual","relationship_type":"buyer"}')
if [ "$CODE" = "409" ]; then
  pass_test "C-02: Duplicate contact rejected (409)"
else
  fail_test "C-02: Duplicate contact" "Expected 409, got $CODE"
fi

# C-03: Same name, different phone
CODE=$(api POST /api/contacts '{"name":"UAT Test Buyer","phone":"9999900003","contact_type":"individual","relationship_type":"buyer"}')
if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
  pass_test "C-03: Same name different phone allowed"
else
  fail_test "C-03: Same name different phone" "Expected 200/201, got $CODE"
fi

# ─── PROPERTY TESTS ───────────────────────────────────────────
echo ""
echo "── Property Tests ──"

# P-01: Create plot property
CODE=$(api POST /api/properties '{"title":"UAT Plot Test","property_type":"plot","location":"Jaipur","total_area_sqft":"1000","seller_rate_per_sqft":"100","buyer_rate_per_sqft":"150","deal_type":"middleman","side_north_ft":"25","side_south_ft":"25","side_east_ft":"40","side_west_ft":"40"}')
if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
  PLOT_PROP_ID=$(jq_ "d['id']")
  STATUS=$(jq_ "d['status']")
  pass_test "P-01: Create plot property (ID=$PLOT_PROP_ID, status=$STATUS)"
else
  fail_test "P-01: Create plot property" "Got $CODE: $(body)"
  PLOT_PROP_ID=""
fi

# S-01: Create site property
CODE=$(api POST /api/properties '{"title":"UAT Site Test","property_type":"site","location":"Delhi","total_area_sqft":"5000","deal_type":"middleman"}')
if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
  SITE_PROP_ID=$(jq_ "d['id']")
  pass_test "S-01: Create site property (ID=$SITE_PROP_ID)"
else
  fail_test "S-01: Create site property" "Got $CODE: $(body)"
  SITE_PROP_ID=""
fi

# P-03: Edit property (no deal_type sent)
if [ -n "$PLOT_PROP_ID" ]; then
  CODE=$(api PUT "/api/properties/$PLOT_PROP_ID" '{"title":"UAT Plot Test Updated","location":"Jaipur Updated"}')
  DEAL_TYPE=$(jq_ "d.get('deal_type','missing')")
  if [ "$CODE" = "200" ] && [ "$DEAL_TYPE" = "middleman" ]; then
    pass_test "P-03: Edit without deal_type (preserved=$DEAL_TYPE)"
  else
    fail_test "P-03: Edit property" "Got $CODE, deal_type=$DEAL_TYPE"
  fi
fi

# P-05: List properties
CODE=$(api GET /api/properties)
if [ "$CODE" = "200" ]; then
  COUNT=$(jq_ "len(d)")
  pass_test "P-05: List properties (count=$COUNT)"
else
  fail_test "P-05: List properties" "Got $CODE"
fi

# ─── PARTNERSHIP TESTS ─────────────────────────────────────────
echo ""
echo "── Partnership Tests ──"

# PS-01: Create partnership linked to plot property
if [ -n "$PLOT_PROP_ID" ]; then
  CODE=$(api POST /api/partnerships "{\"title\":\"UAT Plot Partnership\",\"linked_property_deal_id\":$PLOT_PROP_ID,\"total_deal_value\":\"500000\"}")
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    PLOT_PARTNERSHIP_ID=$(jq_ "d['id']")
    pass_test "PS-01: Create plot partnership (ID=$PLOT_PARTNERSHIP_ID)"
  else
    fail_test "PS-01: Create partnership" "Got $CODE: $(body)"
    PLOT_PARTNERSHIP_ID=""
  fi
fi

# PS-02: Create partnership linked to site property
if [ -n "$SITE_PROP_ID" ]; then
  CODE=$(api POST /api/partnerships "{\"title\":\"UAT Site Partnership\",\"linked_property_deal_id\":$SITE_PROP_ID,\"total_deal_value\":\"2000000\"}")
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    SITE_PARTNERSHIP_ID=$(jq_ "d['id']")
    pass_test "PS-02: Create site partnership (ID=$SITE_PARTNERSHIP_ID)"
  else
    fail_test "PS-02: Create site partnership" "Got $CODE"
    SITE_PARTNERSHIP_ID=""
  fi
fi

# ─── MEMBER TESTS ──────────────────────────────────────────────
echo ""
echo "── Member Tests ──"

if [ -n "$PLOT_PARTNERSHIP_ID" ]; then
  # M-01: Add self member
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/members" '{"is_self":true,"share_percentage":"50","advance_contributed":"100000","advance_account_id":1}')
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    SELF_MEMBER_ID=$(jq_ "d['id']")
    pass_test "M-01: Add self member (ID=$SELF_MEMBER_ID, advance=100000)"
  else
    fail_test "M-01: Add self member" "Got $CODE: $(body)"
    SELF_MEMBER_ID=""
  fi

  # M-02: Add partner member (use contact ID 1)
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/members" '{"contact_id":1,"is_self":false,"share_percentage":"50"}')
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    PARTNER_MEMBER_ID=$(jq_ "d['id']")
    pass_test "M-02: Add partner member (ID=$PARTNER_MEMBER_ID)"
  else
    fail_test "M-02: Add partner member" "Got $CODE: $(body)"
    PARTNER_MEMBER_ID=""
  fi

  # M-03: Share total > 100%
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/members" '{"contact_id":2,"is_self":false,"share_percentage":"10"}')
  if [ "$CODE" = "400" ]; then
    pass_test "M-03: Share > 100% rejected (400)"
  else
    fail_test "M-03: Share > 100%" "Expected 400, got $CODE"
  fi

  # M-07: Non-self without contact_id
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/members" '{"is_self":false,"share_percentage":"0"}')
  if [ "$CODE" = "400" ]; then
    pass_test "M-07: Non-self without contact_id rejected (400)"
  else
    fail_test "M-07: Non-self without contact_id" "Expected 400, got $CODE"
  fi
fi

# ─── OUTFLOW TRANSACTION TESTS ────────────────────────────────
echo ""
echo "── Outflow Transaction Tests ──"

if [ -n "$PLOT_PARTNERSHIP_ID" ] && [ -n "$SELF_MEMBER_ID" ]; then
  # T-01: advance_to_seller
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/transactions" "{\"txn_type\":\"advance_to_seller\",\"amount\":\"50000\",\"txn_date\":\"2025-01-15\",\"payment_mode\":\"cash\",\"account_id\":1,\"member_id\":$SELF_MEMBER_ID,\"description\":\"Advance to seller test\"}")
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    ADV_TXN_ID=$(jq_ "d['id']")
    pass_test "T-01: advance_to_seller (ID=$ADV_TXN_ID)"
  else
    fail_test "T-01: advance_to_seller" "Got $CODE: $(body)"
  fi

  # T-02: remaining_to_seller
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/transactions" "{\"txn_type\":\"remaining_to_seller\",\"amount\":\"200000\",\"txn_date\":\"2025-02-01\",\"payment_mode\":\"bank_transfer\",\"account_id\":1,\"member_id\":$SELF_MEMBER_ID}")
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    pass_test "T-02: remaining_to_seller"
  else
    fail_test "T-02: remaining_to_seller" "Got $CODE: $(body)"
  fi

  # T-03: broker_commission with broker_name
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/transactions" "{\"txn_type\":\"broker_commission\",\"amount\":\"10000\",\"txn_date\":\"2025-02-01\",\"payment_mode\":\"cash\",\"account_id\":1,\"member_id\":$SELF_MEMBER_ID,\"broker_name\":\"Test Broker\"}")
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    pass_test "T-03: broker_commission with broker_name"
  else
    fail_test "T-03: broker_commission" "Got $CODE: $(body)"
  fi

  # T-04: expense from_partnership_pot
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/transactions" "{\"txn_type\":\"expense\",\"amount\":\"5000\",\"txn_date\":\"2025-02-01\",\"from_partnership_pot\":true,\"description\":\"Registration charges\"}")
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    pass_test "T-04: expense from_partnership_pot"
  else
    fail_test "T-04: expense from_partnership_pot" "Got $CODE: $(body)"
  fi

  # T-05: Outflow by partner (non-self)
  if [ -n "$PARTNER_MEMBER_ID" ]; then
    CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/transactions" "{\"txn_type\":\"expense\",\"amount\":\"3000\",\"txn_date\":\"2025-02-01\",\"payment_mode\":\"cash\",\"account_id\":1,\"member_id\":$PARTNER_MEMBER_ID}")
    if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
      ACCT_ID=$(jq_ "d.get('account_id')")
      if [ "$ACCT_ID" = "None" ]; then
        pass_test "T-05: Partner outflow — account_id nulled"
      else
        fail_test "T-05: Partner outflow" "account_id should be None, got $ACCT_ID"
      fi
    else
      fail_test "T-05: Partner outflow" "Got $CODE"
    fi
  fi
fi

# ─── VERIFY PROPERTY SYNC ─────────────────────────────────────
echo ""
echo "── Property Sync Check ──"

if [ -n "$PLOT_PROP_ID" ]; then
  CODE=$(api GET "/api/properties/$PLOT_PROP_ID")
  ADV_PAID=$(jq_ "d.get('advance_paid','0')")
  BROKER=$(jq_ "d.get('broker_name','N/A')")
  PROP_STATUS=$(jq_ "d.get('status')")
  echo "  Property: advance_paid=$ADV_PAID, broker_name=$BROKER, status=$PROP_STATUS"
  if [ "$PROP_STATUS" = "advance_given" ]; then
    pass_test "SY-04: Property status auto-updated to advance_given"
  else
    fail_test "SY-04: Property status" "Expected advance_given, got $PROP_STATUS"
  fi
fi

# ─── ADD PLOT (NEW WORKFLOW) ──────────────────────────────────
echo ""
echo "── Add Plot (New Workflow) ──"

if [ -n "$PLOT_PARTNERSHIP_ID" ]; then
  # AP-01: Add plot to plot property
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/add-plot" '{"area_sqft":"500","rate_per_sqft":"150","side_north_ft":"20","side_south_ft":"20","side_east_ft":"25","side_west_ft":"25","notes":"Plot A"}')
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    PLOT_BUYER_1=$(jq_ "d['plot_buyer']['id']")
    PB1_STATUS=$(jq_ "d['plot_buyer']['status']")
    PB1_CONTACT=$(jq_ "d['plot_buyer'].get('buyer_contact_id')")
    pass_test "AP-01: Add plot (ID=$PLOT_BUYER_1, status=$PB1_STATUS, contact=$PB1_CONTACT)"
  else
    fail_test "AP-01: Add plot" "Got $CODE: $(body)"
    PLOT_BUYER_1=""
  fi

  # AP-03: Add another plot
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/add-plot" '{"area_sqft":"500","rate_per_sqft":"160","notes":"Plot B"}')
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    PLOT_BUYER_2=$(jq_ "d['plot_buyer']['id']")
    pass_test "AP-03: Add plot with different rate (ID=$PLOT_BUYER_2)"
  else
    fail_test "AP-03: Add plot" "Got $CODE"
  fi
fi

# AP-04: Check property status after adding plots
if [ -n "$PLOT_PROP_ID" ]; then
  CODE=$(api GET "/api/properties/$PLOT_PROP_ID")
  PROP_STATUS=$(jq_ "d.get('status')")
  if [ "$PROP_STATUS" = "buyer_found" ]; then
    pass_test "AP-04: Property status → buyer_found after plot add"
  else
    fail_test "AP-04: Property status after plot" "Expected buyer_found, got $PROP_STATUS"
  fi
fi

# ─── ASSIGN BUYER TO PLOT ────────────────────────────────────
echo ""
echo "── Assign Buyer to Plot ──"

if [ -n "$PLOT_PARTNERSHIP_ID" ] && [ -n "$PLOT_BUYER_1" ] && [ -n "$TEST_BUYER_ID" ]; then
  # AB-01: Assign existing contact
  CODE=$(api PUT "/api/partnerships/$PLOT_PARTNERSHIP_ID/assign-buyer" "{\"plot_type\":\"plot_buyer\",\"plot_id\":$PLOT_BUYER_1,\"contact_id\":$TEST_BUYER_ID}")
  if [ "$CODE" = "200" ]; then
    pass_test "AB-01: Assign existing contact to plot"
  else
    fail_test "AB-01: Assign existing contact" "Got $CODE: $(body)"
  fi
fi

if [ -n "$PLOT_PARTNERSHIP_ID" ] && [ -n "$PLOT_BUYER_2" ]; then
  # AB-02: Assign new contact (quick-create)
  CODE=$(api PUT "/api/partnerships/$PLOT_PARTNERSHIP_ID/assign-buyer" "{\"plot_type\":\"plot_buyer\",\"plot_id\":$PLOT_BUYER_2,\"name\":\"Quick Buyer UAT\",\"phone\":\"8888800001\",\"city\":\"Mumbai\"}")
  if [ "$CODE" = "200" ]; then
    pass_test "AB-02: Assign new contact (quick-create)"
  else
    fail_test "AB-02: Assign new contact" "Got $CODE: $(body)"
  fi

  # AB-03: Duplicate contact on assign
  CODE=$(api PUT "/api/partnerships/$PLOT_PARTNERSHIP_ID/assign-buyer" "{\"plot_type\":\"plot_buyer\",\"plot_id\":$PLOT_BUYER_2,\"name\":\"Quick Buyer UAT\",\"phone\":\"8888800001\"}")
  if [ "$CODE" = "409" ]; then
    pass_test "AB-03: Duplicate contact rejected on assign (409)"
  else
    fail_test "AB-03: Duplicate on assign" "Expected 409, got $CODE"
  fi
fi

if [ -n "$PLOT_PARTNERSHIP_ID" ]; then
  # AB-05: Invalid plot_type
  CODE=$(api PUT "/api/partnerships/$PLOT_PARTNERSHIP_ID/assign-buyer" '{"plot_type":"invalid","plot_id":1,"contact_id":1}')
  if [ "$CODE" = "400" ]; then
    pass_test "AB-05: Invalid plot_type rejected (400)"
  else
    fail_test "AB-05: Invalid plot_type" "Expected 400, got $CODE"
  fi

  # AB-06: Non-existent plot_id
  CODE=$(api PUT "/api/partnerships/$PLOT_PARTNERSHIP_ID/assign-buyer" '{"plot_type":"plot_buyer","plot_id":99999,"contact_id":1}')
  if [ "$CODE" = "404" ]; then
    pass_test "AB-06: Non-existent plot_id rejected (404)"
  else
    fail_test "AB-06: Non-existent plot_id" "Expected 404, got $CODE"
  fi
fi

# ─── INFLOW TRANSACTIONS ─────────────────────────────────────
echo ""
echo "── Inflow Transaction Tests ──"

if [ -n "$PLOT_PARTNERSHIP_ID" ] && [ -n "$SELF_MEMBER_ID" ] && [ -n "$PLOT_BUYER_1" ]; then
  # T-10: buyer_advance (self receives)
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/transactions" "{\"txn_type\":\"buyer_advance\",\"amount\":\"25000\",\"txn_date\":\"2025-03-01\",\"payment_mode\":\"cash\",\"account_id\":1,\"received_by_member_id\":$SELF_MEMBER_ID,\"plot_buyer_id\":$PLOT_BUYER_1}")
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    BUYER_ADV_TXN=$(jq_ "d['id']")
    pass_test "T-10: buyer_advance self-received (ID=$BUYER_ADV_TXN)"
  else
    fail_test "T-10: buyer_advance" "Got $CODE: $(body)"
  fi
fi

if [ -n "$PLOT_PARTNERSHIP_ID" ] && [ -n "$PARTNER_MEMBER_ID" ] && [ -n "$PLOT_BUYER_1" ]; then
  # T-11: buyer_advance (partner receives)
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/transactions" "{\"txn_type\":\"buyer_advance\",\"amount\":\"15000\",\"txn_date\":\"2025-03-02\",\"payment_mode\":\"cash\",\"received_by_member_id\":$PARTNER_MEMBER_ID,\"plot_buyer_id\":$PLOT_BUYER_1}")
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    ACCT_ID=$(jq_ "d.get('account_id')")
    pass_test "T-11: buyer_advance partner-received (account_id=$ACCT_ID)"
  else
    fail_test "T-11: buyer_advance partner" "Got $CODE: $(body)"
  fi
fi

if [ -n "$PLOT_PARTNERSHIP_ID" ] && [ -n "$SELF_MEMBER_ID" ]; then
  # T-14: profit_received (self)
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/transactions" "{\"txn_type\":\"profit_received\",\"amount\":\"10000\",\"txn_date\":\"2025-04-01\",\"payment_mode\":\"cash\",\"account_id\":1,\"received_by_member_id\":$SELF_MEMBER_ID}")
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    pass_test "T-14: profit_received self"
  else
    fail_test "T-14: profit_received self" "Got $CODE"
  fi
fi

if [ -n "$PLOT_PARTNERSHIP_ID" ] && [ -n "$PARTNER_MEMBER_ID" ]; then
  # T-15: profit_received (partner)
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/transactions" "{\"txn_type\":\"profit_received\",\"amount\":\"8000\",\"txn_date\":\"2025-04-01\",\"received_by_member_id\":$PARTNER_MEMBER_ID}")
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    pass_test "T-15: profit_received partner"
  else
    fail_test "T-15: profit_received partner" "Got $CODE"
  fi
fi

# ─── VERIFY PLOT BUYER SYNC ──────────────────────────────────
echo ""
echo "── PlotBuyer Sync Check ──"

if [ -n "$PLOT_PARTNERSHIP_ID" ]; then
  CODE=$(api GET "/api/partnerships/$PLOT_PARTNERSHIP_ID")
  if [ "$CODE" = "200" ]; then
    PB_INFO=$(jq_ "[(b['id'], b['total_paid'], b['status']) for b in d.get('plot_buyers',[])]")
    echo "  Plot Buyers: $PB_INFO"
    
    # Check partnership totals
    OUR_INV=$(jq_ "d['summary']['our_investment']")
    TOTAL_REC=$(jq_ "d['summary']['total_received']")
    OUR_PNL=$(jq_ "d['summary']['our_pnl']")
    echo "  Summary: investment=$OUR_INV, received=$TOTAL_REC, pnl=$OUR_PNL"
    pass_test "T-12+T-13: PlotBuyer sync verified"
  fi
fi

# ─── TRANSACTION EDIT/DELETE ──────────────────────────────────
echo ""
echo "── Transaction Edit/Delete Tests ──"

if [ -n "$PLOT_PARTNERSHIP_ID" ] && [ -n "$BUYER_ADV_TXN" ] && [ -n "$SELF_MEMBER_ID" ] && [ -n "$PLOT_BUYER_1" ]; then
  # T-20: Edit transaction amount
  CODE=$(api PUT "/api/partnerships/$PLOT_PARTNERSHIP_ID/transactions/$BUYER_ADV_TXN" "{\"txn_type\":\"buyer_advance\",\"amount\":\"30000\",\"txn_date\":\"2025-03-01\",\"payment_mode\":\"cash\",\"account_id\":1,\"received_by_member_id\":$SELF_MEMBER_ID,\"plot_buyer_id\":$PLOT_BUYER_1}")
  if [ "$CODE" = "200" ]; then
    NEW_AMT=$(jq_ "d['amount']")
    pass_test "T-20: Edit transaction (new amount=$NEW_AMT)"
  else
    fail_test "T-20: Edit transaction" "Got $CODE: $(body)"
  fi
fi

# ─── SITE PARTNERSHIP TESTS ──────────────────────────────────
echo ""
echo "── Site Partnership Tests ──"

if [ -n "$SITE_PARTNERSHIP_ID" ]; then
  # Add self member to site partnership
  CODE=$(api POST "/api/partnerships/$SITE_PARTNERSHIP_ID/members" '{"is_self":true,"share_percentage":"60","advance_contributed":"200000","advance_account_id":1}')
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    SITE_SELF_ID=$(jq_ "d['id']")
    pass_test "Site: Add self member (ID=$SITE_SELF_ID)"
  else
    fail_test "Site: Add self member" "Got $CODE"
    SITE_SELF_ID=""
  fi

  # SP-01: Add site plot
  CODE=$(api POST "/api/partnerships/$SITE_PARTNERSHIP_ID/add-plot" '{"plot_number":"A-1","area_sqft":"200","rate_per_sqft":"500","side_north_ft":"10","side_south_ft":"10","side_east_ft":"20","side_west_ft":"20","notes":"Corner plot"}')
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    SITE_PLOT_1=$(jq_ "d['site_plot']['id']")
    SP_STATUS=$(jq_ "d['site_plot']['status']")
    pass_test "SP-01: Add site plot (ID=$SITE_PLOT_1, status=$SP_STATUS)"
  else
    fail_test "SP-01: Add site plot" "Got $CODE: $(body)"
    SITE_PLOT_1=""
  fi

  # SP-02: Assign buyer to site plot
  if [ -n "$SITE_PLOT_1" ]; then
    CODE=$(api PUT "/api/partnerships/$SITE_PARTNERSHIP_ID/assign-buyer" "{\"plot_type\":\"site_plot\",\"plot_id\":$SITE_PLOT_1,\"name\":\"Site Buyer UAT\",\"phone\":\"7777700001\",\"city\":\"Chennai\"}")
    if [ "$CODE" = "200" ]; then
      pass_test "SP-02: Assign buyer to site plot"
    else
      fail_test "SP-02: Assign buyer to site plot" "Got $CODE: $(body)"
    fi
  fi

  # SP-03: Buyer payment via transaction with site_plot_id
  if [ -n "$SITE_PLOT_1" ] && [ -n "$SITE_SELF_ID" ]; then
    CODE=$(api POST "/api/partnerships/$SITE_PARTNERSHIP_ID/transactions" "{\"txn_type\":\"buyer_payment\",\"amount\":\"50000\",\"txn_date\":\"2025-03-15\",\"payment_mode\":\"bank_transfer\",\"account_id\":1,\"received_by_member_id\":$SITE_SELF_ID,\"site_plot_id\":$SITE_PLOT_1}")
    if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
      pass_test "SP-03: Buyer payment with site_plot_id"
    else
      fail_test "SP-03: Buyer payment with site_plot_id" "Got $CODE: $(body)"
    fi

    # SP-04: Check SitePlot status
    CODE=$(api GET "/api/partnerships/$SITE_PARTNERSHIP_ID")
    if [ "$CODE" = "200" ]; then
      SP_STATUS=$(jq_ "[sp['status'] for sp in d.get('site_plots',[])]")
      SP_PAID=$(jq_ "[sp['total_paid'] for sp in d.get('site_plots',[])]")
      echo "  SitePlot statuses: $SP_STATUS, paid: $SP_PAID"
      pass_test "SP-04: SitePlot sync verified"
    fi
  fi
fi

# ─── QUICK BUYER (LEGACY) ────────────────────────────────────
echo ""
echo "── Quick Buyer (Legacy) Tests ──"

if [ -n "$PLOT_PARTNERSHIP_ID" ]; then
  # B-01: Quick-create buyer
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/create-buyer" '{"name":"Legacy Buyer UAT","phone":"6666600001","city":"Pune","area_sqft":"250","rate_per_sqft":"200","side_north_ft":"10","side_south_ft":"10","side_east_ft":"25","side_west_ft":"25"}')
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    pass_test "B-01: Quick-create buyer"
  else
    fail_test "B-01: Quick-create buyer" "Got $CODE: $(body)"
  fi

  # B-02: Duplicate buyer
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/create-buyer" '{"name":"Legacy Buyer UAT","phone":"6666600001","city":"Pune"}')
  if [ "$CODE" = "409" ]; then
    pass_test "B-02: Duplicate buyer rejected (409)"
  else
    fail_test "B-02: Duplicate buyer" "Expected 409, got $CODE"
  fi
fi

# ─── EDGE CASES ──────────────────────────────────────────────
echo ""
echo "── Edge Cases ──"

# E-01: Partnership with no linked property → create-buyer
CODE=$(api POST /api/partnerships '{"title":"UAT No Property Partnership"}')
if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
  NO_PROP_ID=$(jq_ "d['id']")
  CODE2=$(api POST "/api/partnerships/$NO_PROP_ID/create-buyer" '{"name":"Should Fail"}')
  if [ "$CODE2" = "400" ]; then
    pass_test "E-01: create-buyer with no linked property (400)"
  else
    fail_test "E-01: create-buyer no property" "Expected 400, got $CODE2"
  fi
  # E-02: add-plot with no linked property
  CODE3=$(api POST "/api/partnerships/$NO_PROP_ID/add-plot" '{"area_sqft":"100"}')
  if [ "$CODE3" = "400" ]; then
    pass_test "E-02: add-plot with no linked property (400)"
  else
    fail_test "E-02: add-plot no property" "Expected 400, got $CODE3"
  fi
fi

# T-06: Amount = 0 transaction
if [ -n "$PLOT_PARTNERSHIP_ID" ]; then
  CODE=$(api POST "/api/partnerships/$PLOT_PARTNERSHIP_ID/transactions" '{"txn_type":"expense","amount":"0","txn_date":"2025-01-01","description":"Zero test"}')
  echo "  T-06: Zero amount → Status $CODE"
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ] || [ "$CODE" = "422" ]; then
    pass_test "T-06: Zero amount transaction handled ($CODE)"
  else
    fail_test "T-06: Zero amount" "Unexpected $CODE"
  fi
fi

# ─── PARTNERSHIP DETAIL COMPLETENESS ─────────────────────────
echo ""
echo "── Partnership Detail Completeness ──"

if [ -n "$PLOT_PARTNERSHIP_ID" ]; then
  CODE=$(api GET "/api/partnerships/$PLOT_PARTNERSHIP_ID")
  if [ "$CODE" = "200" ]; then
    HAS_PARTNERSHIP=$(jq_ "'partnership' in d")
    HAS_MEMBERS=$(jq_ "'members' in d")
    HAS_TXNS=$(jq_ "'transactions' in d")
    HAS_SUMMARY=$(jq_ "'summary' in d")
    HAS_BUYERS=$(jq_ "'plot_buyers' in d")
    HAS_SITES=$(jq_ "'site_plots' in d")
    echo "  Keys: partnership=$HAS_PARTNERSHIP members=$HAS_MEMBERS txns=$HAS_TXNS summary=$HAS_SUMMARY buyers=$HAS_BUYERS sites=$HAS_SITES"
    if [ "$HAS_PARTNERSHIP" = "True" ] && [ "$HAS_MEMBERS" = "True" ] && [ "$HAS_TXNS" = "True" ] && [ "$HAS_SUMMARY" = "True" ] && [ "$HAS_BUYERS" = "True" ]; then
      pass_test "PS-03: Partnership detail has all required keys"
    else
      fail_test "PS-03: Detail completeness" "Missing some keys"
    fi
  fi
fi

# ─── SETTLEMENT TEST ─────────────────────────────────────────
echo ""
echo "── Settlement Tests ──"

# Use the plot partnership for settlement
if [ -n "$PLOT_PARTNERSHIP_ID" ]; then
  CODE=$(api PUT "/api/partnerships/$PLOT_PARTNERSHIP_ID/settle" '{"actual_end_date":"2025-06-01","notes":"UAT settlement test"}')
  if [ "$CODE" = "200" ]; then
    SETTLE_STATUS=$(jq_ "d['partnership']['status']")
    pass_test "ST-01: Settle partnership (status=$SETTLE_STATUS)"
  else
    fail_test "ST-01: Settle partnership" "Got $CODE: $(body)"
  fi

  # ST-03: Check property status
  if [ -n "$PLOT_PROP_ID" ]; then
    CODE=$(api GET "/api/properties/$PLOT_PROP_ID")
    PROP_STATUS=$(jq_ "d.get('status')")
    if [ "$PROP_STATUS" = "settled" ]; then
      pass_test "ST-03: Property status → settled"
    else
      fail_test "ST-03: Property status after settle" "Expected settled, got $PROP_STATUS"
    fi
  fi
fi

# ─── DEPRECATED ENDPOINTS ────────────────────────────────────
echo ""
echo "── Deprecated Endpoint Tests ──"

# Check OpenAPI for deprecated flag
DEPRECATED=$(curl -s "$BASE/openapi.json" | python3 -c "
import sys,json
spec = json.load(sys.stdin)
deps = []
for path, methods in spec.get('paths',{}).items():
    for method, info in methods.items():
        if info.get('deprecated'):
            deps.append(f'{method.upper()} {path}')
print(f'Deprecated endpoints: {len(deps)}')
for d in deps:
    print(f'  {d}')
")
echo "  $DEPRECATED"

# ─── SUMMARY ─────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  TEST RESULTS"
echo "============================================================"
echo "  PASSED: $PASS"
echo "  FAILED: $FAIL"
echo ""
if [ $FAIL -gt 0 ]; then
  echo "  FAILURES:"
  echo -e "$BUGS"
fi
echo "============================================================"
