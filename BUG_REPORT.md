# Bug Report — Property & Partnership System

> Generated from full code audit against `PropertyandPartnershipPlan.md` and `TESTING_PLAN.md`  
> Date: 14 April 2026

---

## 🔴 CRITICAL — App crashes / blocks user workflow

### BUG-001: Create Buyer crashes — Contact model column mismatch
- **File**: `backend/app/routers/partnerships.py` (line ~1093)
- **What happens**: When clicking "Create Buyer" from Partnership Detail, the API crashes with an SQLAlchemy error
- **Root cause**: Contact model has `relationship_type` column, but code sets `relationship="buyer"` (wrong column name). Also passes `created_by=current_user.id` but Contact model has NO `created_by` column.
- **Impact**: **Cannot create any buyer** — completely blocks the buyer creation flow
- **Repro**: Partnership Detail → Add Buyer → Fill name → Click "Create Buyer" → 500 error
- **Fix**: Change `relationship="buyer"` → `relationship_type="buyer"`, remove `created_by=current_user.id`

### BUG-002: Create Buyer — PlotBuyer missing `buyer_name` and `created_by`
- **File**: `backend/app/routers/partnerships.py` (line ~1107)
- **What happens**: For plot-type properties, PlotBuyer is created without `buyer_name` field
- **Root cause**: Code sets `buyer_contact_id` but not `buyer_name=buyer_data.name` or `created_by=current_user.id`
- **Impact**: PlotBuyer shows as "Buyer #3" instead of actual name in the UI
- **Fix**: Add `buyer_name=buyer_data.name, created_by=current_user.id` to PlotBuyer constructor

### BUG-003: Property Detail shows NO transactions (legacy table query)
- **File**: `backend/app/routers/property_deals.py` (line ~282)
- **What happens**: Property Detail page always shows "No transactions recorded yet" even after adding transactions from Partnership
- **Root cause**: `GET /api/properties/{id}` queries `PropertyTransaction` table (legacy), but all new transactions go into `PartnershipTransaction` table
- **Impact**: Transactions section on Property Detail is always empty for new deals
- **Fix**: Query `PartnershipTransaction` via linked partnership instead of `PropertyTransaction`

### BUG-004: Property summary always shows zeros
- **File**: `backend/app/routers/property_deals.py` (line ~131)
- **What happens**: Financial summary (total_invested, total_received, net_profit) on Property Detail are all zero
- **Root cause**: `_calculate_property_summary()` computes from `PropertyTransaction` list which is empty for new deals
- **Impact**: Property Detail hero stats and Money Flow sidebar show wrong numbers
- **Fix**: Rewrite summary to use PartnershipTransaction data

---

## 🟠 HIGH — Wrong behavior / plan violations

### BUG-005: No Quick Seller Contact creation on PropertyForm
- **File**: `frontend/src/pages/Properties/PropertyForm.jsx` (line ~838)
- **What happens**: Seller Contact is a plain dropdown only — user must leave the form to create a seller contact first
- **Root cause**: No inline quick-create popup implemented
- **Impact**: Poor UX — user loses form data when navigating to Contacts page
- **Plan reference**: User explicitly requested: _"I want a Quick Contact creation for Seller as well while creating Property because I have to go to contact and create seller and come again to property and refill all info"_
- **Fix**: Add a "+ Create Seller" button next to the dropdown that opens a small inline form (Name, Phone, City)

### BUG-006: Settlement computes `profit_received` from wrong column
- **File**: `backend/app/routers/partnerships.py` (line ~1046)
- **What happens**: Settlement deducts "already received" profit using `t.member_id == member.id`, but profit_received transactions store the recipient in `t.received_by_member_id`
- **Root cause**: Inconsistency between inflow obligation code (uses `received_by_member_id`) and settlement code (uses `member_id`)
- **Impact**: Partners get double profit — the deduction is always zero
- **Fix**: Check `t.received_by_member_id == member.id` instead of `t.member_id`

### BUG-007: Settlement doesn't return expenses to the member who paid them
- **File**: `backend/app/routers/partnerships.py` (line ~1030-1050)
- **What happens**: If Partner A paid ₹50,000 in expenses, settlement doesn't reimburse them separately — the expense just reduces total profit equally
- **Root cause**: Settlement formula is `advance_back + profit_share - already_received`. Missing `expense_back` component.
- **Impact**: Partners who paid expenses out-of-pocket are shortchanged at settlement
- **Fix**: Add per-member expense tracking: sum expenses where `member_id == member.id`, add as `expense_returned` to their settlement amount

### BUG-008: Sync to property ignores SitePlot data
- **File**: `backend/app/routers/partnerships.py` (line ~199-215)
- **What happens**: `_sync_property_from_partnership` only queries `PlotBuyer` for `total_buyer_value` and status derivation — never checks `SitePlot`
- **Root cause**: Code only does `db.query(PlotBuyer)`, missing `db.query(SitePlot)` for site-type properties
- **Impact**: For site properties: `total_buyer_value` stays at 0, status never reaches "buyer_found"
- **Fix**: If property_type == "site", also sum SitePlot.calculated_price and check SitePlot statuses

### BUG-009: PropertyForm Status dropdown in edit mode
- **File**: `frontend/src/pages/Properties/PropertyForm.jsx` (line ~980)
- **What happens**: When editing a property, a Status dropdown appears letting user manually set status to "settled", "cancelled" etc.
- **Root cause**: Edit mode renders a `<select>` with all status options
- **Impact**: User can set "settled" status without going through proper settlement flow, creating inconsistencies
- **Fix**: Remove the status dropdown from PropertyForm — status should be auto-derived from partnership state

### BUG-010: Site PropertyForm is missing key fields
- **File**: `frontend/src/pages/Properties/PropertyForm.jsx` (line ~582-635)
- **What happens**: Site form only shows: Total Area, Total Seller Value, Deal Start Date. Missing: Seller Contact dropdown, Seller Rate, Negotiating Date, Expected Registry Date, Location
- **Root cause**: Site form section was designed minimally; unlike the plot section which has full seller details
- **Impact**: Site properties created without seller contact, no seller rate data, no dates
- **Note**: `EMPTY_FORM_SITE` (line 275) also doesn't include `seller_contact_id`
- **Fix**: Add Seller Contact dropdown, Seller Rate, Negotiating Date, Expected Registry Date to site form section

### BUG-011: PartnershipForm label says "Plot deals only"
- **File**: `frontend/src/pages/Partnerships/PartnershipForm.jsx` (line 277)
- **What happens**: The label for "Linked Property Deal" says "(Plot deals only)" but the dropdown now correctly shows both plot AND site properties
- **Root cause**: Label text not updated when filter was fixed
- **Impact**: Confuses user into thinking site properties can't be linked
- **Fix**: Change label to "(Plot & Site deals)" or remove the parenthetical

### BUG-012: Transaction edit form is incomplete
- **File**: `frontend/src/pages/Partnerships/PartnershipDetail.jsx` (line ~710-750)
- **What happens**: When editing a transaction, only Amount, Date, Account, Description can be changed. Cannot change: who paid, transaction type, which buyer, broker name
- **Root cause**: Inline edit form only renders basic fields
- **Impact**: To change who paid or the type, user must delete and recreate the transaction (losing history)
- **Fix**: Add member_id, received_by_member_id, txn_type, plot_buyer_id/site_plot_id, broker_name to edit form

### BUG-013: `account_id` sent for non-Self payers (potential wrong ledger entries)
- **File**: `frontend/src/pages/Partnerships/PartnershipDetail.jsx` (line ~206) + `backend/app/routers/partnerships.py` (line ~670)
- **What happens**: When a partner (not Self) pays an outflow, the `account_id` from the form's last value still gets sent to backend. Backend stores it and may create a ledger entry.
- **Root cause**: Frontend sends `account_id` unconditionally in the payload; backend doesn't null it out for non-Self
- **Impact**: Partner-paid transactions may incorrectly appear in Self's bank account ledger
- **Fix**: Frontend: set `account_id = null` when payer is not Self. Backend: null out `account_id` if the paying member is not `is_self`

---

## 🟡 MEDIUM — Incomplete / cosmetic / data inconsistency

### BUG-014: PropertyList shows "Deal Type" column
- **File**: `frontend/src/pages/Properties/PropertyList.jsx` (line ~170)
- **What happens**: Every property card shows "Deal Type: middleman" which is always the same
- **Impact**: Redundant information, wastes screen space
- **Fix**: Remove the deal_type stat from property cards

### BUG-015: PropertyForm silently hardcodes `deal_type: "middleman"`
- **File**: `frontend/src/pages/Properties/PropertyForm.jsx` (line ~263, 310)
- **What happens**: Form always sends `deal_type: "middleman"` in the payload, even when editing an old `purchase_and_hold` property
- **Impact**: Editing any old property silently overwrites its deal_type
- **Fix**: Don't send `deal_type` in payload for edits (or remove entirely since plan says it's always middleman)

### BUG-016: PropertyForm still sends `my_share_percentage` in payload for sites
- **File**: `frontend/src/pages/Properties/PropertyForm.jsx` (line ~322)
- **What happens**: Although the site form UI no longer shows my_share_percentage field (correctly removed), `EMPTY_FORM_SITE` still has `my_share_percentage: ""` and `buildPayload()` sends it
- **Impact**: Could overwrite existing data to null/zero
- **Fix**: Remove `my_share_percentage` from `EMPTY_FORM_SITE` and don't send in site payload

### BUG-017: Property sync ignores legacy `invested` transaction type in settlement
- **File**: `backend/app/routers/partnerships.py` (line ~1003)
- **What happens**: Settlement sums only `advance_to_seller`, `remaining_to_seller`, `advance_given` for outflow. The `invested` type (in INVESTMENT_TYPES) is excluded
- **Impact**: If legacy `invested` transactions exist, they're not counted — inflated net_profit
- **Fix**: Add `"invested"` to the settlement outflow sum

### BUG-018: `_sync_linked_partnership` in property_deals.py syncs wrong direction
- **File**: `backend/app/routers/property_deals.py` (line ~56-77)
- **What happens**: This function pushes data FROM PropertyTransaction TO Partnership (`partnership.our_investment = total_advance`). The plan says sync should be Partnership → Property only.
- **Impact**: If legacy property transaction endpoints are accidentally used, they'll overwrite correct partnership data
- **Fix**: Remove this function or disable it; only `_sync_property_from_partnership` (in partnerships.py) should run

### BUG-019: PartnershipDetail default `account_id: "1"` 
- **File**: `frontend/src/pages/Partnerships/PartnershipDetail.jsx` (line ~80)
- **What happens**: Transaction form defaults `account_id` to `"1"`, assuming account #1 exists
- **Impact**: If user has no accounts or account 1 was deleted, transactions silently link to nonexistent account
- **Fix**: Default to `""` (no account) and let user choose

### BUG-020: PartnershipList shows "—" for partner count
- **File**: `frontend/src/pages/Partnerships/PartnershipList.jsx` (line ~142)
- **What happens**: "Partners" stat always shows "—" 
- **Impact**: Useless info on the list page
- **Fix**: Either show actual count from API or remove the stat

### BUG-021: PropertyList stats use stale property-level fields
- **File**: `frontend/src/pages/Properties/PropertyList.jsx` (line ~46-50)
- **What happens**: Total invested/revenue stats at top of list sum from `property.advance_paid` and `property.total_buyer_value` — these are populated by sync, which may be stale
- **Impact**: Dashboard stats may be inaccurate
- **Fix**: This will self-correct once BUG-008 (sync for site) is fixed

### BUG-022: Legacy transaction CRUD endpoints still active on property router
- **File**: `backend/app/routers/property_deals.py` (lines 417-570, 624-870)
- **What happens**: POST/PUT/DELETE for PropertyTransaction and POST /settle are still active endpoints
- **Impact**: Could be accidentally called, creating data in the wrong table
- **Fix**: Consider adding deprecation warning or commenting out these endpoints

---

## 📊 Test Plan Coverage Map

| Test Step | Bugs That Block It | Status |
|-----------|-------------------|--------|
| **A1**: Create Property (Plot) | BUG-005 (no quick seller create) | ⚠️ Partial — works but UX poor |
| **A2**: Property Detail Read-Only | BUG-003, BUG-004 (empty txns/summary) | ❌ Blocked |
| **A3**: Create Partnership | BUG-011 (misleading label) | ⚠️ Works but confusing |
| **A4**: Add Outflow Transactions | BUG-013 (account_id for non-Self) | ⚠️ Partial |
| **A5**: Create Buyer | **BUG-001** (crash), BUG-002 (missing name) | ❌ **BLOCKED** |
| **A6**: Add Inflow Transactions | BUG-001 blocks buyer creation first | ❌ Blocked by A5 |
| **A7**: Financial Summary | BUG-004 (stale summary) | ❌ Blocked |
| **A8**: Property Synced Data | BUG-003 (empty txns), BUG-004 | ❌ Blocked |
| **A9**: Transaction CRUD | BUG-012 (incomplete edit form) | ⚠️ Partial |
| **A10**: Settlement | BUG-006 (wrong profit calc), BUG-007 (no expense return) | ❌ Wrong results |
| **B1**: Create Site Property | BUG-010 (missing fields) | ⚠️ Partial |
| **B2**: Partnership for Site | BUG-011 (label only) | ✅ Works |
| **B3**: Create Site Buyers | BUG-001 (same crash) | ❌ **BLOCKED** |
| **B4**: Site Transactions | Blocked by B3 | ❌ Blocked |
| **B5**: Site Synced Data | BUG-008 (no site sync) | ❌ Blocked |
| **B6**: Site Settlement | BUG-006, BUG-007, BUG-008 | ❌ Wrong results |
| **C1**: Backward Compat | BUG-003 (old txns from legacy table still show) | ✅ Works for old data |
| **D1**: Property Without Partnership | — | ✅ Works |
| **D5**: Account/Ledger | BUG-013 (wrong account for partner txns) | ⚠️ Partial |

---

## 🎯 Recommended Fix Order

1. **BUG-001** — Create Buyer crash (blocks entire buyer flow)
2. **BUG-002** — PlotBuyer missing buyer_name (blocks buyer display)
3. **BUG-003** — Property Detail shows legacy transactions (empty page)
4. **BUG-004** — Property summary zeros (meaningless stats)
5. **BUG-005** — Quick Seller Contact creation (major UX request)
6. **BUG-006** — Settlement profit_received wrong column
7. **BUG-007** — Settlement expense return missing
8. **BUG-008** — Sync ignores SitePlot
9. **BUG-009** — Remove status dropdown from PropertyForm edit
10. **BUG-010** — Site form missing fields
11. **BUG-011** — PartnershipForm label text
12. **BUG-012** — Transaction edit form incomplete
13. **BUG-013** — account_id for non-Self payers
14. **BUG-014 to BUG-022** — Medium priority cleanups
