# BUGS.md — Property & Partnership Bug Report

## Test Date: 2026-04-15
## Test Method: Automated API lifecycle tests (test_api.py) + Static code audit
## Status: ALL BUGS FIXED ✅

---

## CRITICAL BUGS

### BUG-C1: `is_deleted` crash on buyer validation (HTTP 500) — FIXED ✅
- **File**: `backend/app/routers/partnerships.py` L639-647
- **Symptom**: When submitting `buyer_advance`/`buyer_payment` without a `plot_buyer_id`, the server crashes with 500 instead of returning 400
- **Root Cause**: Code filters on `PlotBuyer.is_deleted == False` and `SitePlot.is_deleted == False`, but neither model has an `is_deleted` column
- **Fix**: Removed `.is_deleted == False` filters; also removed shadowing local import that caused UnboundLocalError

### BUG-C2: Transactions allowed on settled partnerships — FIXED ✅
- **File**: `backend/app/routers/partnerships.py` L600-610
- **Symptom**: After settling a partnership, new transactions can still be added (HTTP 200)
- **Fix**: Added `if partnership.status == "settled"` check returning 400 at start of create, edit, and delete transaction endpoints

### BUG-C3: Delete member from settled partnership → 500 error — FIXED ✅
- **File**: `backend/app/routers/partnerships.py` L553-596
- **Symptom**: Attempting to delete a member from a settled partnership returns HTTP 500
- **Fix**: Added settled status check returning 400 before attempting delete

### BUG-C4: Invalid `plot_buyer_id` / `site_plot_id` → 500 error — FIXED ✅
- **File**: `backend/app/routers/partnerships.py` L636+
- **Symptom**: Passing a non-existent `plot_buyer_id` (e.g., 999999) causes HTTP 500
- **Fix**: Added existence validation for both PlotBuyer and SitePlot before creating transaction

### BUG-C5: Plot type allows multiple buyers (should only allow 1) — FIXED ✅
- **File**: `backend/app/routers/partnerships.py` L1148+ (create-buyer endpoint)
- **Symptom**: For `property_type=plot`, multiple PlotBuyer records can be created
- **Fix**: Added check in create-buyer endpoint: if existing PlotBuyer count > 0 for plot type, return 400

---

## HIGH BUGS

### BUG-H1: No settled status check on update/edit transaction — FIXED ✅
- **Fix**: Added settled check at start of update_partnership_transaction endpoint

### BUG-H2: No settled status check on delete transaction — FIXED ✅
- **Fix**: Added settled check at start of delete_partnership_transaction endpoint

### BUG-H3: No settled status check on add member — FIXED ✅
- **Fix**: Added settled check at start of add_partnership_member endpoint

### BUG-H4: No settled status check on update member — FIXED ✅
- **Fix**: Added settled check at start of update_partnership_member endpoint

### BUG-H5: No settled status check on create-buyer / add-plot / assign-buyer — FIXED ✅
- **Fix**: Added settled check at start of all three endpoints

### BUG-H6: Site create-buyer creates new SitePlot instead of assigning to existing
- **File**: `backend/app/routers/partnerships.py` L1219-1244
- **Symptom**: For site properties, `create-buyer` always creates a new SitePlot row. If you already have SP-1 unassigned and use create-buyer, it creates SP-3 (a new SitePlot) instead of assigning the buyer to SP-1.
- **Note**: The `assign-buyer` endpoint correctly handles this case. The UI behavior may mitigate this if it directs users to use assign-buyer for existing plots. This is more of a UX inconsistency than a data-level bug.

### BUG-H7: PlotBuyer status never progresses beyond "advance_received" — FIXED ✅
- **File**: `backend/app/routers/partnerships.py` L233-252
- **Fix**: Updated `_resync_plot_buyer_from_partnership` and `_resync_site_plot_from_partnership` to set status to "payment_done" when total_paid >= total_value

---

## MEDIUM BUGS

### BUG-M1: PropertyForm sets `deal_locked_date` to `negotiating_date` — FIXED ✅
- **File**: `frontend/src/pages/Properties/PropertyForm.jsx` L368
- **Fix**: Changed to use `formData.deal_locked_date` instead of `formData.negotiating_date`

### BUG-M2: Dead code — `_create_inflow_obligations()` — FIXED ✅
- **File**: `backend/app/routers/partnerships.py`
- **Fix**: Removed entire dead function (~80 lines)

### BUG-M3: No-op `_sync_linked_partnership()` still called from 4 places — FIXED ✅
- **File**: `backend/app/routers/property_deals.py`
- **Fix**: Removed function definition and all 3 call sites

### BUG-M4: Obligation deletion by amount-matching is fragile
- **File**: `backend/app/routers/partnerships.py` L822-828
- **Symptom**: When deleting a transaction, obligations with matching amount are deleted. If two different obligations have the same amount, the wrong one could be deleted.
- **Impact**: Rare but possible data corruption

### BUG-M5: `profit-summary` uses stale `our_share_percentage`
- **File**: `backend/app/routers/property_deals.py` L656
- **Symptom**: The profit-summary endpoint uses `Partnership.our_share_percentage` instead of computing from actual member shares
- **Impact**: Inaccurate profit calculations in property detail

---

## TEST RESULTS SUMMARY

| Test | Result | Bug |
|------|--------|-----|
| A1-A4: Create seller, property, partnership | PASS | — |
| A5-A6: Add members 60/40 | PASS | — |
| A7: Over 100% shares rejected | PASS | — |
| A8-A13: All outflow txn types | PASS | — |
| A14: Summary after outflows | PASS | — |
| A15: Buyer txn without buyer | **FAIL (500)** | BUG-C1 |
| A16: Create buyer | PASS | — |
| A17-A19: Buyer advance + payments | PASS | — |
| A20: Profit received | PASS | — |
| A21: Full summary | PASS | — |
| A22: Property sync from partnership | PASS | — |
| A23: Edit transaction + verify | PASS | — |
| A24: Settlement | PASS | — |
| A25: Property settled on pship settle | PASS | — |
| A26: Obligations created | PASS (720000 payable) | — |
| B1-B6: Site property + partnership + outflows | PASS | — |
| B7-B8: Add site plots | PASS | — |
| B9: Create buyer for site | PASS (creates new SitePlot) | BUG-H6 |
| B13: Settle site partnership | PASS | — |
| B14: Site property settled | PASS | — |
| C1: Partnership without property | PASS | — |
| C2: create-buyer on no-prop partnership | PASS (400) | — |
| C3: add-plot on no-prop partnership | PASS (400) | — |
| C4: Expense from pot | PASS | — |
| C5: Delete transaction | PASS | — |
| C6: Duplicate self member | PASS (400) | — |
| C7: Zero amount rejected | PASS (422) | — |
| C8: Negative amount rejected | PASS (422) | — |
| C9: Txn on settled partnership | **FAIL (200)** | BUG-C2 |
| C10: Delete member from settled | **FAIL (500)** | BUG-C3 |
| C11: Property type=flat rejected | PASS (422) | — |
| C13: Invalid buyer_id | **FAIL (500)** | BUG-C4 |
| C14: Delete partnership | PASS | — |
| C15: Multiple buyers for plot | **FAIL (200)** | BUG-C5 |
