# Property & Partnership System — Redesign Plan

## Understanding Summary

The core idea: **Property page = information hub**, **Partnership page = action hub**. All transactions, buyer management, and settlement flow through Partnership. Property page reads and displays the synced data.

---

## Current vs. Proposed Flow

### Current (Messy)

- Transactions can be added from BOTH property and partnership pages
- Settlement can happen from property page
- Buyer creation happens on property page
- Two separate transaction tables (PropertyTransaction + PartnershipTransaction) with overlapping types
- Confusing about where to do what

### Proposed (Clean)

- **Property Page** = Read-only information display (no add transaction, no settle button)
- **Partnership Page** = All actions (transactions, buyer creation, plot management, settlement)
- Data syncs **one-way: Partnership → Property** (property page reads from partnership transactions)
- Single source of truth for money flow

---

## Phase 1: Property Page (Read-Only Information Hub)

### 1.1 Property Form Changes (Create/Edit)

**Keep:**

- Title, Location, Property Type (plot/site), Notes
- Seller Contact (from contacts)
- Total Area (sqft), Seller Rate per sqft, Total Seller Value (auto-calc from rate × area)
- Plot Dimensions (N/S/E/W ft), Roads JSON
- Advance Paid, Advance Date (initial advance to seller at property creation)
- Negotiating Date (= created_at or a new field)
- Site-specific: site_deal_start_date

**Remove from Property Form:**

- ❌ Broker Name, Broker Commission (will come from transactions via partnership)
- ❌ Buyer Contact (buyers are managed via partnership)
- ❌ buyer_rate_per_sqft, total_buyer_value (comes from buyer/plot data)
- ❌ my_investment, my_share_percentage (managed in partnership)
- ❌ deal_type field (always middleman for now; purchase_and_hold can be separate if needed later)
- ❌ gross_profit, net_profit (calculated live)
- ❌ site_deal_end_date (set at settlement)

### 1.2 Property Detail Page (Display-Only)

**Section 1: Property Overview Card**

- Total Area, Seller Rate, Total Seller Value
- Advance Paid (sum of all advance_to_seller txns from partnership)
- Total Expenses (sum of all expense txns from partnership)
- Broker Name & Commission (if broker_commission txn exists in partnership)
- Status badge

**Section 2: Smart Timeline**
Build a timeline from ALL events across property + partnership transactions, grouped by date:

```
📅 15 Jun 2026 — Negotiation Started
📅 23 Jun 2026 — Advance Given ₹2,00,000 (Self → Cash in Hand)
📅 15 Jul 2026 — Advance Given ₹3,00,000 (Self → HDFC Bank)
📅 15 Jul 2026 — 3 Expenses totaling ₹15,000
    • Stamp Duty ₹5,000
    • Legal Fee ₹7,000
    • Transport ₹3,000
📅 01 Aug 2026 — Buyer Found: Ramesh Kumar (Negotiating)
📅 10 Aug 2026 — Buyer Advance Received ₹5,00,000 from Ramesh Kumar
📅 20 Aug 2026 — Broker Commission Paid ₹50,000 to Rajesh Broker
📅 15 Sep 2026 — Registry Done — Buyer: Ramesh Kumar
📅 15 Sep 2026 — Remaining ₹15,00,000 received from Ramesh Kumar
📅 20 Sep 2026 — Remaining ₹10,00,000 given to Seller
📅 25 Sep 2026 — Settlement Complete ✓
```

**Rules for timeline grouping:**

- Same date + same txn_type → group and show count + total (e.g., "3 Expenses totaling ₹15,000" with expandable details)
- Different txn_types on same date → separate entries
- Buyer-related events (found, advance, registry, full payment) → show buyer name
- Advance events → show who gave + which account
- Auto-derive landmark events from status changes

**Section 3: Buyers (read-only, synced from partnership)**

- Show PlotBuyer/SitePlot cards as currently displayed
- Each buyer: Name, Area, Rate, Total Value, Payment Progress bar, Status
- For site: show plot grid with per-plot buyer info

**Section 4: Partnership Info (read-only)**

- Link to partnership page
- Members table: Name, Share %, Advance Contributed
- Quick summary: Total Investment, Total Received, Net Profit

**Section 5: Transactions (read-only, synced from partnership)**

- Full transaction list from partnership, shown per-plot grouping (see Phase 3)
- No add/edit/delete buttons — just display

**Section 6: Money Flow Summary (sidebar)**

- Total Outflow (advance + expenses + broker)
- Total Inflow (from buyers)
- Net Position
- Live P&L

**Removed from Property Detail:**

- ❌ "Add Transaction" button/form
- ❌ "Settle Deal" button/modal
- ❌ "Add Buyer" button (moved to partnership)
- ❌ "Add Plot" button for site (moved to partnership)

---

## Phase 2: Partnership Page (Action Hub)

### 2.1 Partnership Form Changes

**Keep:**

- Title, linked_property_deal_id (required for property-linked partnerships)
- Members with share %, advance contributed
- Start date, Notes

**Add:**

- When linked to property, auto-populate title suggestion
- Show property summary (seller value, area) in form

### 2.2 Partnership Detail Page (Enhanced)

**Section 1: Header Stats**

- Total Investment (our_investment)
- Total Received (from buyers)
- Live Net Profit (calculated)
- My Share % / My Returns

**Section 2: Partners Table** (as-is, keep current)

**Section 3: Buyers Section (NEW — moved from property)**

- "Add Buyer" button
  - Quick form popup: Name\*, Phone, City, Notes
  - Auto-creates Contact with `contact_type=individual`, `relationship_type=buyer`
  - Creates PlotBuyer/SitePlot linked to the property
  - Initial status: "negotiating"
- Buyer cards showing:
  - Name, Area (sqft), Side dimensions (linked from property plot/land)
  - Buying Rate, Total Value (prompted on first payment or manually set)
  - Payment progress bar
  - Status: negotiating → advance_received → registry_done → fully_paid

**Section 4: Plots/Land Section (for tracking area division)**

- For PLOT type:
  - If only 1 buyer → show as single plot (= the property itself)
  - If property splits into 2-3 plots → manage plot divisions here
  - Each plot: area, dimensions, linked buyer
- For SITE type:
  - Grid of plots (can be 15-20)
  - Each plot: number, area, dimensions, buyer, status, price/sqft

**Section 5: Transactions (MAIN ACTION AREA)**

#### Transaction Types (Revised & Consolidated):

| Type                  | Direction | Who Pays/Receives        | Description                         |
| --------------------- | --------- | ------------------------ | ----------------------------------- |
| `advance_to_seller`   | OUTFLOW   | Self or Partner → Seller | Advance/token money to seller       |
| `remaining_to_seller` | OUTFLOW   | Self or Partner → Seller | Balance payment to seller           |
| `broker_commission`   | OUTFLOW   | Self or Partner → Broker | Brokerage payment                   |
| `expense`             | OUTFLOW   | Self or Partner          | Stamp duty, legal, transport, etc.  |
| `buyer_advance`       | INFLOW    | Buyer → Self or Partner  | Advance from buyer                  |
| `buyer_payment`       | INFLOW    | Buyer → Self or Partner  | Subsequent/final payment from buyer |
| `profit_received`     | INFLOW    | — → Self or Partner      | Profit distribution already taken   |

#### Transaction Form Logic:

**For ALL outflow types (advance_to_seller, remaining_to_seller, broker_commission, expense):**

- "Paid By" dropdown: Self / Partner's Name
- If Self → "From Account" dropdown (my bank accounts)
- Amount, Date, Description
- Auto-ledger: debit from selected account

**For ALL inflow types (buyer_advance, buyer_payment):**

- "From Buyer" dropdown (list of buyers attached to this partnership/property)
- "Received By" dropdown: Self / Partner's Name
- If Self → "To Account" dropdown (my bank accounts)
- Amount, Date, Description
- Auto-sync PlotBuyer.total_paid
- If first payment from a buyer and buying_price not set → prompt for buying rate/total value

**For profit_received:**

- "Received By" dropdown: Self / Partner's Name
- If Self → "To Account" dropdown
- Amount, Date, Description
- Track separately — at settlement this is subtracted from what's owed

#### Auto-Obligations on Inflow:

When money comes IN (buyer_advance, buyer_payment):

- If **I received it**: Create PAYABLE obligations to each partner for their proportional share
- If **Partner received it**: Create RECEIVABLE obligation from that partner for my share
- Obligations are partial (proportional to the partial payment received, not the full deal)

When money goes OUT (advance_to_seller, expense, broker_commission):

- If **Partner paid it**: Track it — they get this amount back at settlement (in addition to their profit share)

**For broker_commission specifically:**

- "Broker Name" text field (or pick from contacts)
- Auto-stores broker_name on the property deal for display

#### Plot-wise Transaction Grouping:

- **Default view**: "All" — shows all transactions flat
- **Grouped view**: Plot dropdown to filter by plot/buyer
  - "Global" (not linked to any specific plot) — advance_to_seller, broker_commission go here by default
  - "Plot A / Buyer: Ramesh" — buyer payments and related expenses
  - "Plot B / Buyer: Suresh" — buyer payments and related expenses
- A dropdown on each transaction to "Move to Plot" (reassign)

**Section 6: Settlement**

Settlement is a final action. Requirements:

- All area must be sold (all plots have buyers)
- Auto-compute:
  - Total from buyers = sum of all buyer_advance + buyer_payment txns
  - Total to seller = sum of all advance_to_seller + remaining_to_seller txns
  - Total expenses = sum of expense txns
  - Broker commission = sum of broker_commission txns
  - Gross Profit = Total from buyers − Total to seller
  - Net Profit = Gross − Expenses − Broker
  - Per partner: advance_back + expense_back + (net_profit × share%) − profit_already_received
- Allow manual override if numbers don't match
- Mark partnership + property as "settled"

---

## Phase 3: Data Model Changes

### 3.1 Remove from PropertyDeal model:

- `broker_name` → derive from broker_commission transactions
- `broker_commission` → derive from sum of broker_commission txns
- `my_investment` → lives on Partnership
- `my_share_percentage` → lives on Partnership
- `total_profit_received` → derives from transactions
- `gross_profit`, `net_profit` → calculated live, not stored (or stored only on settlement)
- `buyer_contact_id` → buyers managed through PlotBuyer/SitePlot

Actually — **keep these columns for backward compatibility** but stop writing to them from the property form. They'll be populated by the settlement process or sync from partnership only.

### 3.2 Consolidate Transaction Types

Currently two tables: `PropertyTransaction` and `PartnershipTransaction`.

**Proposed approach**: Keep `PartnershipTransaction` as the single source of truth for all deal transactions. The `PropertyTransaction` table stays for legacy/backward compat, but new transactions are only created in PartnershipTransaction.

**Add to PartnershipTransaction:**

- `plot_buyer_id` (FK → PlotBuyer, nullable) — which buyer this payment relates to
- `site_plot_id` (FK → SitePlot, nullable) — which site plot this relates to
- `broker_name` (String, nullable) — for broker_commission txn type

**New txn_type values for PartnershipTransaction:**

- `advance_to_seller` (replaces "advance_given" when it's about seller payment)
- `remaining_to_seller` (new)
- `broker_commission` (replaces "broker_paid")
- `expense` (keep)
- `buyer_advance` (replaces "buyer_payment_received" for advance specifically)
- `buyer_payment` (for subsequent/final payments from buyer)
- `profit_received` (new — profit already taken by a partner)

### 3.3 PlotBuyer Enhancements

**Add:**

- `buying_rate_per_sqft` (Decimal) — the rate at which buyer is buying
- `side_north_ft`, `side_south_ft`, `side_east_ft`, `side_west_ft` (dimensions of the plot portion for this buyer)
- `roads_json` (Text) — roads for this specific plot
- `contact_id` should be required (since we auto-create contact on buyer add)

### 3.4 Migration Plan

- New migration 015: Add new columns to PartnershipTransaction, enhance PlotBuyer
- Keep old tables/columns for backward compatibility
- Existing data continues to work

---

## Phase 4: Sync Logic (Partnership → Property)

### What syncs to PropertyDeal:

```python
property.advance_paid = SUM(partnership_txns WHERE txn_type='advance_to_seller')
property.broker_commission = SUM(partnership_txns WHERE txn_type='broker_commission')
property.broker_name = FIRST(partnership_txns WHERE txn_type='broker_commission').broker_name
property.other_expenses = SUM(partnership_txns WHERE txn_type='expense')
property.total_buyer_value = SUM(plot_buyers.total_value)  # or derived from buyer txns
property.status = derived from transaction state:
    - negotiating (no txns yet)
    - advance_given (advance_to_seller exists)
    - buyer_found (PlotBuyer exists)
    - registry_done (buyer_payment with registry flag)
    - settled (settlement done)
```

### Property Detail API Enhancement:

The `GET /api/properties/{id}` endpoint will:

1. Fetch partnership transactions (not property transactions) for display
2. Build timeline from partnership transactions
3. Compute live P&L from partnership data
4. Return buyers from PlotBuyer table
5. Return partnership member info

---

## Phase 5: Obligation Auto-Creation (Enhanced)

### On ANY Inflow Transaction:

**If I received the money:**

```
For each non-self partner:
    partial_owed = amount × (partner.share% / 100)
    Create PAYABLE obligation to partner for partial_owed
    Reason: "Partial buyer payment — {buyer_name} — Partnership '{title}'"
```

**If Partner received the money:**

```
my_partial = amount × (my_share% / 100)
Create RECEIVABLE from partner for my_partial
Reason: "My share of buyer payment — {buyer_name} — Partnership '{title}'"
```

### On Outflow (expense/advance paid by partner):

Track via transaction `member_id` — at settlement, they get reimbursed.
No obligation created for outflows (it's handled at settlement).

---

## Phase 6: Site Type — Same Flow as Plot

For site-type properties:

- Property page: area, seller value, seller rate, notes, location, seller contact
- Partnership: members, shares, transactions
- Plots: 15-20 subdivisions created from partnership page
- Each plot goes through same lifecycle: available → negotiating → advance_received → sold → registered
- Transactions are grouped by plot (with "Global" for non-plot-specific ones)
- Settlement: aggregate all plots, compute total profit, distribute

The only difference from plot type:

- A site has many sub-plots (SitePlot table) instead of PlotBuyer
- Each sub-plot has its own buyer, dimensions, and transaction stream
- Global transactions (advance_to_seller) apply to the whole site

---

## Implementation Order

### Step 1: Backend — Data Model + Migration

- Add new fields to PartnershipTransaction (plot_buyer_id, site_plot_id, broker_name)
- Add new fields to PlotBuyer (buying_rate_per_sqft, dimensions)
- New transaction types
- Migration 015

### Step 2: Backend — Partnership Router Enhancements

- New endpoint: `POST /api/partnerships/{id}/create-buyer` (creates contact + PlotBuyer)
- New endpoint: `POST /api/partnerships/{id}/plots` (creates/manages site plots)
- Enhanced transaction create with new types + auto-obligation logic
- Enhanced sync to property
- Settlement endpoint rework

### Step 3: Backend — Property Detail API (Read-Only Data)

- Rewrite `GET /api/properties/{id}` to pull from partnership transactions
- Add timeline builder
- Live P&L computation
- Remove property transaction creation endpoints (or deprecate)

### Step 4: Frontend — Property Detail Page (Read-Only)

- Remove all add/edit/delete transaction UI
- Remove settle button
- Add smart timeline component
- Read-only buyers section
- Read-only partnership info
- Money flow sidebar with live P&L

### Step 5: Frontend — Partnership Detail Page (Action Hub)

- Add Buyer section with quick contact creation
- Add Plot management for site type
- Enhanced transaction form with new types
- Plot-wise transaction grouping/filtering
- Settlement flow with full P&L preview

### Step 6: Frontend — Property Form Cleanup

- Remove broker fields, buyer fields, share fields
- Keep only: title, location, type, area, seller info, dimensions, roads, advance, notes

---

## Open Questions (Need Your Input)

1. **Purchase & Hold deal type** — Should we keep this or remove it entirely? You only mentioned middleman (plot/site) flows.

2. **flat, commercial, agricultural property types** — Remove these or keep them? Your flow describes only plot and site.

3. **Standalone Partnerships** (not linked to property) — Do these still exist? e.g., a partnership for a business, not real estate?

4. **Multiple Partnerships per Property** — Currently one property can (technically) have multiple partnerships. Should we enforce strictly one partnership per property?

5. **Profit Received transaction** — When a partner takes profit early (before settlement), should this reduce the PAYABLE obligation to them, or create a separate tracking?

6. **Plot Division Timing** — For a plot-type property that starts as one piece and later splits into 2-3 plots for different buyers — when the split happens, do we need to recalculate dimensions (e.g., 1000sqft splits into 600+400)?

7. **Registry Event** — Should "Registry Done" be a separate transaction type, or is it just a status change on the buyer when they make their final payment?

8. **Existing Production Data** — All your existing 20 properties and partnerships have data in the old format. Should we migrate them to the new flow, or leave them as-is and only new deals use the new system?

9. **When no partnership exists** — Can a property exist without a partnership? (e.g., you buy and sell alone with no partners) If yes, should we auto-create a "solo partnership" with 100% self?

Q1. Answer Remove it
Q2. Remove them only plot and site.
Q3. As of now they don't exist (if in future exist we will add functionality Mainly money will be involve or invested together in some other asset)
Q4. Actually for Plot it must be strictly one property one partnership, but for site property it can be multiple partnership but then things will be more complex (so better keep one to one for now stricly)
Q5. It should reduce payble obligation
Q6. yes we need to recalculate dimensions
Q7. it just status changed
Q8. Actually data need to be migrated to new flow but data you read is local db data, my actual production database is different on supabase but I m afraid if something went wrong? while migrating data there are so many transactions from different accounts like past 2 months data (As it's Production data and senstive)[so we need to do it carefully but do it later after all changes done or completed tested E2E keeping edge cases]
Q9. Well it will be rare but possible things so we will do this by doing solo partnership but you don't do auto create I will create a solo partnership.

Now my Suggestion and Questions Below

1. Advance Paid and Advance Date also be removed even I Paid advance on creation date I will do it manually from parnership so you can date from there to add in timeline,
   We just need Negotiating Date, and Expected Registry Date at time of Creation.

2. Broker Commision mainly paid after property settlement so it don't go from my self account, and other partner their is chance it goes from whole partnership and will be given later OR it might possible some of us give it from partner so keep both option for brokerage

3. Also I want a Quick Contact creation for Seller as well while creation Property because individual and seller will be same just name and location, and number for quick entry to create a seller contact (if required later I will edit) so I can continue the creating deal directly from Create property form page, because i have go to contact and create seller and come again to property and refill all info.
