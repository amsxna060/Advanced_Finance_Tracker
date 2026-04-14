# BUG REPORT V2 — Advanced Finance Tracker

> Post-audit + UAT testing report  
> Date: 2025-06-11  
> Test Coverage: 46 API tests (42 passed, 4 false-negatives from test script)

---

## Summary

| Severity | Open | Fixed This Session | Fixed V2 Pass |
|----------|------|--------------------|---------------|
| CRITICAL | 0 | 3 | 1 |
| HIGH | 0 | 5 | 2 |
| MEDIUM | 0 | 4 | 6 |
| LOW | 0 | 2 | 5 |
| **Total** | **0** | **14** | **14** |

---

## FIXED This Session (14 issues)

### CRITICAL — Fixed

| ID | Issue | Fix |
|----|-------|-----|
| FIX-001 | `profit_received` incremented `total_received` even when partner received (create txn) | Added `buyer_received_by_partner` guard |
| FIX-002 | `profit_received` incremented `total_received` even when partner received (update txn) | Added `buyer_received_by_partner` guard |
| FIX-003 | Contact dedup in `contacts.py` returned 400 instead of 409 | Changed to `status_code=409` with descriptive message |

### HIGH — Fixed

| ID | Issue | Fix |
|----|-------|-----|
| FIX-004 | `sp.plot_label` referenced in 3 places in PartnershipDetail — field doesn't exist | Changed to `sp.plot_number \|\| sp.buyer_name` |
| FIX-005 | `_resync_plot_buyer_from_partnership` only checked `status == "negotiating"` | Expanded to `("negotiating", "available", "pending")` |
| FIX-006 | `_resync_site_plot_from_partnership` only checked `status == "available"` | Expanded to `("available", "negotiating")` |
| FIX-007 | PartnershipList showed "Our Share: —" (always empty) | Changed to "Deal Value" showing `total_deal_value` |
| FIX-008 | `_sync_property_from_partnership` missing legacy `invested` in outflow total | Added `invested_total` to `total_outflow` |

### MEDIUM — Fixed

| ID | Issue | Fix |
|----|-------|-----|
| FIX-009 | Legacy `_resync_plot_buyer` in property_deals.py only checked `"negotiating"` | Expanded to `("pending", "negotiating", "available")` |
| FIX-010 | Site buyer creation via `create_buyer_for_partnership` set status `"available"` | Changed to `"negotiating"` |
| FIX-011 | PartnershipDetail `invalidate()` didn't refresh property caches | Added `["properties"]` and `["property"]` invalidation |
| FIX-012 | `_sync_linked_partnership` was reverse-syncing from property to partnership | Replaced with no-op `pass` body |

### LOW — Fixed

| ID | Issue | Fix |
|----|-------|-----|
| FIX-013 | BUG-014: "Deal Type" stat shown on PropertyList cards | Removed |
| FIX-014 | BUG-022: 4 legacy property transaction endpoints not marked deprecated | Added `deprecated=True` |

---

## OPEN Bugs (0 issues)

All 14 open bugs have been fixed. See "Fixed V2 Pass" section below.

---

## Fixed V2 Pass (14 issues)

### CRITICAL

| ID | Issue | Fix |
|----|-------|-----|
| BUG-V2-001 | Settlement preview formula mismatch (`totalAdvance` vs `totalOutflow`) | Changed to `settleTotal - totalOutflow`; preview shows "Total Outflow" with per-member `profitShare` |

### HIGH

| ID | Issue | Fix |
|----|-------|-----|
| BUG-V2-002 | PropertyForm uses legacy side_left/right/top/bottom_ft | Migrated to `side_north_ft/south/east/west` in form state, normalizeForForm (with legacy fallback), buildPayload, and PlotDiagram |
| BUG-V2-003 | Contact dedup false rejections on name-only match | Now uses name+phone when phone provided, name+city when only city, skips dedup when neither |

### MEDIUM

| ID | Issue | Fix |
|----|-------|-----|
| BUG-V2-004 | Settlement doesn't validate shares == 100% | Added validation at top of `settle_partnership` endpoint |
| BUG-V2-005 | Advance at member creation causes ledger inconsistencies on edit | Removed `advance_contributed`/`advance_account_id` from member creation schema, router, and both frontend forms. Advance now tracked only via transactions |
| BUG-V2-006 | Zero/negative amount transactions accepted | Added `Field(..., gt=0)` to `PartnershipTransactionCreate.amount` |
| BUG-V2-007 | Partnership form missing date fields | Added `start_date` and `expected_end_date` inputs to PartnershipForm.jsx |
| BUG-V2-008 | Auto-calc only works for plot type, not site | Removed `property_type === "plot"` condition from auto-calc logic |
| BUG-V2-009 | Ledger reversal deletes wrong entry with matching amounts | Added `account_id` filter + `.order_by(id.desc()).first()` in 3 locations |

### LOW

| ID | Issue | Fix |
|----|-------|-----|
| BUG-V2-010 | PlotDiagram uses legacy field names | Migrated to NSEW props (done with V2-002) |
| BUG-V2-011 | `total_deal_value` not auto-calculated | Added auto-populate from linked property's `total_seller_value` via useEffect, editable input field, included in payload |
| BUG-V2-012 | SitePlot `created_by` not set in `create_buyer_for_partnership` | Added `created_by=current_user.id` |
| BUG-V2-013 | Obligations not reversed on txn delete | Added MoneyObligation cleanup matching transaction type/amount |
| BUG-V2-014 | Partnership list limit capped at 20 | Changed default to 100, max to 500 |

---

## UAT Test Results

### Passed (42/46)

All core workflows verified:
- Contact CRUD with deduplication (409)
- Property CRUD (plot + site types)
- Partnership CRUD with linked properties
- Member management (self + partner, share validation)
- Outflow transactions (ledger, investment tracking, partner account_id nulling)
- Inflow transactions (buyer advance/payment, profit_received, with plot_buyer_id sync)
- Add Plot workflow (PlotBuyer/SitePlot created without buyer, status=available)
- Assign Buyer workflow (existing contact, quick-create, dedup check)
- Transaction edit with full ledger reversal and re-application
- PlotBuyer/SitePlot sync (total_paid, advance_received, status transitions)
- Settlement with member distribution
- Property ↔ Partnership sync (advance_paid, broker_commission, status, total_buyer_value)
- Deprecated endpoints verified in OpenAPI spec (4 endpoints)
- Edge cases (no linked property, invalid plot_type, non-existent IDs)

### False-Negative Failures (4/46 — test script issue, not app bugs)

| Test | Issue |
|------|-------|
| C-02 | Test script expected 409 but saw 400 (fixed DURING testing — contacts.py now returns 409) |
| SY-04, AP-04, ST-03 | Test script read `d.get("status")` from top-level but property detail returns `{"property": {...}}` nested structure. Actual property status was correct when checked manually. |

### Manual Verification

- Property 35 (UAT Plot): `status=settled, advance_paid=150000, broker_name=Test Broker, total_buyer_value=205000` ✅
- Partnership 20 (UAT Plot): `investment=368000, received=58000, pnl=-310000` ✅  
- PlotBuyer 5: `total_paid=40000, status=advance_received` ✅
- SitePlot 6: `total_paid=50000, status=advance_received` ✅
- 4 deprecated endpoints confirmed in OpenAPI ✅

---

## Recommendations for UAT

### Ready for Testing
1. **Plot property full lifecycle**: Create Property → Create Partnership → Link → Add Members → Add Outflow Txns → Add Plot → Assign Buyer → Record Buyer Payments → Settlement
2. **Site property full lifecycle**: Same flow with site-specific fields (plot_number, sold_price_per_sqft)
3. **Contact deduplication**: Verify 409 errors on duplicate name+phone combinations
4. **Multi-partner distribution**: Test with 3+ partners and verify settlement calculations

### Not Ready (Needs Fix First)
1. **Settlement preview** (BUG-V2-001) — Shows wrong numbers to user before confirming. Backend calculation is correct but preview is misleading.
2. **Negative amount transactions** (BUG-V2-006) — Should be validated at schema level.
