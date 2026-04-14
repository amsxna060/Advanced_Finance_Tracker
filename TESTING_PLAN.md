# Property & Partnership — Manual Testing Plan

## Pre-Test: Known Bugs to Fix Before Testing

### 🔴 CRITICAL (App crashes / data corruption)

| # | Area | Bug | Details |
|---|------|-----|---------|
| C1 | Backend | **SitePlot create-buyer crashes** | `partnerships.py` create-buyer endpoint passes `rate_per_sqft`/`total_value` to SitePlot model — but the columns are named `sold_price_per_sqft`/`calculated_price`. Runtime crash for site deals. |
| C2 | Backend | **Dual transaction system (data inconsistency)** | `property_deals.py` has POST/PUT/DELETE for `PropertyTransaction` AND `partnerships.py` has POST/PUT/DELETE for `PartnershipTransaction`. Two independent tables, no FK link. Data goes out of sync. Plan says: ONLY partnership transactions should exist as write path. |
| C3 | Frontend | **PropertyDetail has Add Buyer CRUD** | PropertyDetail.jsx has full Add/Edit/Delete buyer functionality. Plan says property page must be READ-ONLY — buyers managed from Partnership only. |
| C4 | Frontend | **PropertyDetail has Settle modal** | PropertyDetail.jsx has `showSettleModal`, `settleForm`, `settleMutation`. Plan says settlement is ONLY from Partnership page. |
| C5 | Frontend | **PropertyDetail has transaction mutations** | PropertyDetail.jsx has `addTxnMutation`, `deleteTxnMutation`, `updateTxnMutation` + `setShowAddTxn` is referenced but never declared → runtime error (undefined). |
| C6 | Frontend | **PropertyDetail SitePlotsSection has full CRUD** | SitePlotsSection allows Add/Edit/Delete plots. Plan says read-only on property. |
| C7 | Backend | **Property router has settle endpoint** | `POST /{deal_id}/settle` on property_deals router shouldn't exist. Settlement is on partnership only. |

### 🟠 HIGH (Wrong behavior / plan violations)

| # | Area | Bug | Details |
|---|------|-----|---------|
| H1 | Backend | **Property GET reads PropertyTransaction not PartnershipTransaction** | `GET /properties/{id}` queries PropertyTransaction table. Plan says it should pull from PartnershipTransaction (source of truth). |
| H2 | Backend | **Property summary computed from wrong table** | `_calculate_property_summary()` iterates over PropertyTransaction. Should use PartnershipTransaction. |
| H3 | Backend | **`_sync_linked_partnership` syncs wrong direction** | Pushes from Property→Partnership. Plan says Partnership→Property (one-way). |
| H4 | Backend | **Property schema accepts forbidden fields** | `PropertyDealCreate` accepts `buyer_contact_id`, `broker_name`, `broker_commission`, `advance_paid`, `advance_date`, `my_investment`, `my_share_percentage` etc. and writes them to DB. Should be rejected/ignored. |
| H5 | Backend | **No property_type validation (allows flat/commercial/agricultural)** | Model, schema, and router all accept any string for property_type. Plan says ONLY "plot" and "site". |
| H6 | Backend | **Partnership settlement incomplete** | Partnership settle endpoint does simple formula. Doesn't factor in expense-return to payer, structured P&L breakdown, or broker_commission separately. |
| H7 | Backend | **`broker_commission` not in INVESTMENT_TYPES** | `our_investment` incremental update in create_transaction skips broker_commission, but `_sync_property_from_partnership` includes it → inconsistent total. |
| H8 | Frontend | **Account dropdown shown for ALL outflow txns** | PartnershipDetail shows "From Account" dropdown even when a partner (not Self) is selected as payer. Plan says account only when Self pays. |
| H9 | Frontend | **PartnershipForm only fetches plot-type properties** | Properties query filters `property_type: "plot"` — site properties cannot be linked to partnerships. |
| H10 | Frontend | **PropertyList has flat/commercial/agricultural filter options** | Property type filter includes removed types. |
| H11 | Frontend | **No Quick Contact creation for Seller** | PropertyForm has only a dropdown for seller contact — no inline quick-create option to create a seller without leaving the page. |
| H12 | Frontend | **PropertyForm still has my_share_percentage for site** | Site form section includes my_share_percentage field. Plan says this belongs on Partnership, not Property. |
| H13 | Backend | **account_id not validated as Self-only** | Backend accepts account_id on any transaction regardless of who transacts. Should only be relevant when Self is involved. |

### 🟡 MEDIUM (Incomplete / cosmetic / minor)

| # | Area | Bug | Details |
|---|------|-----|---------|
| M1 | Frontend | **PropertyForm has expected/actual registry_date fields** | Plan doesn't mention these on PropertyForm. |
| M2 | Frontend | **PropertyForm has status dropdown in edit mode** | Status should be auto-derived, not manually editable. |
| M3 | Frontend | **"Use Partnership page" notice only conditional** | Notice only shows when partnership exists AND not settled. Should always be visible. |
| M4 | Frontend | **No Smart Timeline on PropertyDetail** | Plan describes a rich smart timeline (grouped events, milestones). Only basic 3-date timeline exists. |
| M5 | Frontend | **Money Flow sidebar missing for site deals** | PropertyDetail Money Flow sidebar only renders for plot type, not site. |
| M6 | Frontend | **Transaction edit form missing conditional fields** | PartnershipDetail inline edit only shows basic fields — missing Paid By / Received By / Broker fields. |
| M7 | Backend | **Partnership PartnershipForm info box shows broker/advance** | PartnershipForm displays `broker_commission` and `advance_paid` from property — these won't be populated if removed from property. |
| M8 | Frontend | **PropertyList shows deal_type column** | Always "middleman" now, so column is redundant. |
| M9 | Backend | **Contact default is "borrower" not "seller"** | Quick contact creation defaults `relationship_type` to "borrower". Seller contacts need manual override. |
| M10 | Frontend | **Site form missing seller_contact_id** | Site form payload doesn't include seller_contact_id. |
| M11 | Backend | **Property model still has legacy fields** | buyer_contact_id, broker_name, broker_commission, my_investment, my_share_percentage, etc. still on model. Kept for backward compat but can cause confusion. |

---

## Test Flow A: PLOT Property — Full Lifecycle

### A1. Create Property (Plot Type)
- [ ] Navigate to Properties → Create New Property
- [ ] Verify form shows ONLY: Title, Location, Property Type (plot/site), Notes, Seller Contact, Total Area, Seller Rate, Total Seller Value (auto-calc), Plot Dimensions (N/S/E/W), Roads, Negotiating Date
- [ ] Verify form does NOT show: Broker Name, Broker Commission, Buyer Contact, buyer_rate, total_buyer_value, my_investment, my_share_percentage, Advance Paid, Advance Date, deal_type selector
- [ ] Verify property_type dropdown has ONLY "Plot" and "Site" (no flat/commercial/agricultural)
- [ ] Create a seller contact quick (if inline quick-create exists) OR pre-create seller contact first
- [ ] Fill in: Title="Test Plot ABC", Location="Mumbai", Type=Plot, Area=1000, Rate=5000, Dimensions (N=50, S=50, E=20, W=20), Negotiating Date=2026-04-01
- [ ] Verify Total Seller Value auto-calculates: 1000 × 5000 = ₹50,00,000
- [ ] Submit and verify property created with status "negotiating"
- [ ] Verify deal_type is "middleman" in DB (not shown in form)

### A2. Property Detail Page — Verify Read-Only
- [ ] Open the created property detail page
- [ ] Verify NO "Add Transaction" button/form anywhere
- [ ] Verify NO "Settle Deal" button
- [ ] Verify NO "Add Buyer" button
- [ ] Verify "Manage from Partnership" notice is shown
- [ ] Verify property overview card shows correct info
- [ ] Verify transactions section is empty and read-only

### A3. Create Partnership (Linked to Plot Property)
- [ ] Navigate to Partnerships → Create New Partnership
- [ ] Verify the linked property dropdown shows the plot property we created
- [ ] Also verify the dropdown shows SITE properties (not just plot)
- [ ] Select our plot property
- [ ] Add 2 members:
  - Self: Share 60%, Advance ₹10,00,000
  - Partner "Rahul": Share 40%, Advance ₹7,00,000
- [ ] Submit and verify partnership created

### A4. Partnership Detail — Add Transactions (Outflow)

#### A4a. Advance to Seller
- [ ] Open partnership detail page
- [ ] Select transaction type: "Advance to Seller"
- [ ] Verify "Paid By" dropdown shows Self + Rahul
- [ ] Select "Self" → verify "From Account" dropdown appears
- [ ] Select an account, amount=₹5,00,000, date=2026-04-05
- [ ] Submit → verify transaction created
- [ ] Verify Financial Summary sidebar updates: Advance to Seller = ₹5,00,000
- [ ] Now select "Rahul" as payer → verify "From Account" dropdown HIDES (partner doesn't use my accounts)
- [ ] Submit another advance txn: Rahul pays ₹3,00,000, date=2026-04-06
- [ ] Verify Advance to Seller total = ₹8,00,000

#### A4b. Remaining to Seller
- [ ] Select "Remaining to Seller", Self pays ₹20,00,000 from account, date=2026-05-01
- [ ] Rahul pays ₹22,00,000, date=2026-05-02
- [ ] Verify Remaining to Seller total = ₹42,00,000

#### A4c. Expense
- [ ] Select "Expense", Self pays ₹50,000 (Legal Fees), date=2026-04-10
- [ ] Verify Expense total = ₹50,000

#### A4d. Broker Commission
- [ ] Select "Broker Commission"
- [ ] Verify "Broker Name" text field appears
- [ ] Verify "From Partnership Pot" checkbox appears
- [ ] Enter broker name = "Rajesh Broker", amount=₹1,00,000
- [ ] Check "From Partnership Pot" checkbox → submit
- [ ] Verify broker commission displays in summary
- [ ] Verify broker name is stored

### A5. Partnership Detail — Create Buyer
- [ ] Click "Add Buyer" / "Create Buyer" button
- [ ] Verify buyer form asks: Name, Phone, City, Area (sqft), Rate (per sqft), Dimensions (N/S/E/W)
- [ ] Fill: Name="Ramesh Kumar", Phone="9876543210", City="Mumbai", Area=1000, Rate=7000, N=50, S=50, E=20, W=20
- [ ] Submit → verify:
  - Contact created with relationship_type="buyer"
  - PlotBuyer created linked to property
  - PlotBuyer shows on partnership detail page with status "negotiating"
  - Buyer total value = 1000 × 7000 = ₹70,00,000

### A6. Partnership Detail — Add Inflow Transactions

#### A6a. Buyer Advance
- [ ] Select "Buyer Advance"
- [ ] Verify "From Buyer" dropdown shows "Ramesh Kumar"
- [ ] Verify "Received By" dropdown shows Self + Rahul
- [ ] Select buyer=Ramesh, received_by=Self, account=Bank, amount=₹10,00,000, date=2026-06-01
- [ ] Submit → verify:
  - Transaction created
  - Buyer status changes from "negotiating" to "advance_received"
  - Buyer total_paid updates
  - **Obligations auto-created**: PAYABLE to Rahul for 40% of ₹10L = ₹4,00,000

#### A6b. Buyer Payment (subsequent)
- [ ] Select "Buyer Payment", buyer=Ramesh, received_by=Self, amount=₹30,00,000, date=2026-07-01
- [ ] Verify obligation: PAYABLE to Rahul for ₹12,00,000

#### A6c. Buyer Payment (partner receives)
- [ ] Select "Buyer Payment", buyer=Ramesh, received_by=Rahul, amount=₹20,00,000, date=2026-08-01
- [ ] Verify: "Deposit Account" dropdown HIDES (Rahul received, not Self)
- [ ] Verify obligation: RECEIVABLE from Rahul for 60% of ₹20L = ₹12,00,000

#### A6d. Profit Received
- [ ] Select "Profit Received", received_by=Self, amount=₹2,00,000, date=2026-08-15
- [ ] Verify this reduces PAYABLE to Rahul in settlement calc

### A7. Verify Financial Summary
- [ ] Check sidebar Financial Summary:
  - Advance to Seller: ₹8,00,000
  - Remaining to Seller: ₹42,00,000
  - Broker Commission: ₹1,00,000 (from pot)
  - Expenses: ₹50,000
  - Total Outflow: ₹51,50,000
  - Buyer Inflow: ₹60,00,000 (10L + 30L + 20L)
  - Profit Received: ₹2,00,000
  - Net P&L: ₹60,00,000 - ₹51,50,000 = ₹8,50,000

### A8. Property Detail — Verify Synced Data
- [ ] Go back to Property Detail page
- [ ] Verify advance_paid shows ₹8,00,000 (synced from partnership)
- [ ] Verify expenses show ₹50,000
- [ ] Verify broker commission = ₹1,00,000
- [ ] Verify transactions list shows partnership transactions (NOT property transactions)
- [ ] Verify buyers section shows Ramesh Kumar (read-only, no edit/delete)

### A9. Transaction CRUD
- [ ] Edit a transaction from partnership detail → verify amount updates everywhere
- [ ] Delete a transaction → verify financial summary recalculates
- [ ] Verify obligations also update/delete when source transaction changes

### A10. Settlement (from Partnership)
- [ ] Click "Settle" on Partnership Detail page
- [ ] Verify settlement shows P&L breakdown:
  - Total from buyers
  - Total to seller
  - Total expenses
  - Broker commission
  - Gross Profit
  - Net Profit
  - Per partner: advance returned + expense returned + profit share - already received
- [ ] Confirm settlement
- [ ] Verify partnership status = "settled"
- [ ] Verify property status = "settled"
- [ ] Verify NO settle option on Property Detail page

---

## Test Flow B: SITE Property — Full Lifecycle

### B1. Create Property (Site Type)
- [ ] Navigate to Properties → Create New Property
- [ ] Select Type = Site
- [ ] Verify site-specific fields: site_deal_start_date, total_seller_value (manual)
- [ ] Verify NO my_share_percentage field in form
- [ ] Fill: Title="Site Project XYZ", Location="Pune", Total Area=5000, Total Seller Value=₹1,00,00,000
- [ ] Submit and verify property created

### B2. Create Partnership (Linked to Site Property)
- [ ] Create Partnership → verify site property appears in linked property dropdown
- [ ] Select site property link
- [ ] Add 3 members: Self (50%), Partner A (30%), Partner B (20%)
- [ ] Submit

### B3. Partnership Detail — Create Multiple Buyers (Site Plots)
- [ ] Create Buyer 1: "Buyer A", Area=500, Rate=3000
- [ ] Create Buyer 2: "Buyer B", Area=800, Rate=2800
- [ ] Create Buyer 3: "Buyer C", Area=700, Rate=3200
- [ ] Verify all appear as SitePlots (not PlotBuyers) since property is site type
- [ ] Verify each shows area, rate, calculated total value, status

### B4. Partnership Detail — Transactions for Site
- [ ] Add Advance to Seller: Self pays ₹20,00,000
- [ ] Add Buyer Advance from Buyer A: ₹5,00,000 → verify obligations created
- [ ] Add Buyer Payment from Buyer B: ₹10,00,000
- [ ] Verify financial summary aggregates all site plots
- [ ] Verify each transaction can be linked to specific site plot (site_plot_id)

### B5. Property Detail — Verify Site Synced Data
- [ ] Open site property detail
- [ ] Verify site plots displayed (read-only, no add/edit/delete)
- [ ] Verify all transactions from partnership visible
- [ ] Verify aggregate financial summary

### B6. Settlement (Site)
- [ ] Settle from Partnership
- [ ] Verify all plot totals aggregated
- [ ] Verify per-partner distribution computed correctly

---

## Test Flow C: Backward Compatibility

### C1. Existing Data Integrity
- [ ] Existing properties show correctly on list page
- [ ] Existing property detail loads without errors
- [ ] Existing partnerships load without errors
- [ ] Existing partnership detail loads without errors
- [ ] No console errors on any existing page

### C2. Old Transaction Data
- [ ] Existing `PropertyTransaction` records still display on property detail
- [ ] Existing `PartnershipTransaction` records still display on partnership detail
- [ ] Financial summaries calculate correctly from existing data

### C3. Edit Existing Records
- [ ] Can edit existing property (old fields preserved)
- [ ] Can edit existing partnership
- [ ] Can add NEW partnership transactions to existing partnership
- [ ] New transactions use new types (advance_to_seller, etc.)

---

## Test Flow D: Edge Cases

### D1. Property Without Partnership
- [ ] Open property that has no linked partnership
- [ ] Verify "Create Partnership" notice shows
- [ ] Verify no crash on financial summary (all zeros)

### D2. Partnership Without Property
- [ ] Create partnership without linked property
- [ ] Verify transactions still work
- [ ] Verify no sync errors

### D3. Multiple Buyers on Single Plot
- [ ] Create 2 buyers for a plot property (splitting the plot)
- [ ] Verify dimensions recalculate if split

### D4. Transaction Editing
- [ ] Edit transaction amount → verify obligations recalculate
- [ ] Edit transaction type (e.g., buyer_advance → buyer_payment) → verify
- [ ] Delete transaction → verify cleanup

### D5. Account/Ledger
- [ ] Self-paid transaction → bank balance deducted
- [ ] Partner-paid transaction → no bank balance change
- [ ] Self-received inflow → bank balance credited
- [ ] Partner-received inflow → no bank balance change (obligation created instead)

### D6. Obligation Flow
- [ ] Verify PAYABLE obligations appear in Obligations page
- [ ] Verify RECEIVABLE obligations appear
- [ ] Verify settling an obligation doesn't corrupt partnership data

---

## Test Flow E: Validation & Error Handling

### E1. Required Fields
- [ ] Submit property without title → error
- [ ] Submit property without property_type → error
- [ ] Submit partnership without members → error
- [ ] Submit transaction without amount → error

### E2. Boundary Values
- [ ] Zero amount transaction → should error
- [ ] Negative amount → should error
- [ ] Very large amount (999,99,99,999) → should work
- [ ] Future dates → should work (expected registry date)

### E3. Deletion Guards
- [ ] Try deleting property that has linked partnership → should warn/block
- [ ] Try deleting partnership with transactions → should warn/block
- [ ] Try deleting contact used as seller/buyer → should warn/block
