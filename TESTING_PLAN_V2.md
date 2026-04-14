# Testing Plan V2 — Property & Partnership UAT

> Generated for Advanced Finance Tracker  
> Scope: All property-deal + partnership workflows (Plot & Site types)

---

## 1. Prerequisites

| Item | Expected |
|------|----------|
| Docker services | postgres, backend, frontend all `Up` |
| Backend URL | `http://localhost:8000` |
| Frontend URL | `http://localhost:5173` |
| Test user | admin / existing login |
| At least 1 Cash Account | "Cash in Hand" (ID 1) |

---

## 2. Test Matrix

### 2A — Contact Management

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| C-01 | Create contact (buyer) | POST /api/contacts | 201, contact returned |
| C-02 | Create duplicate (same name + phone) | POST /api/contacts | 409 conflict |
| C-03 | Create contact same name, different phone | POST /api/contacts | 201 (allowed) |
| C-04 | Create contact same name, no phone on both | POST /api/contacts | 409 (name-only match when no phone) |
| C-05 | List contacts | GET /api/contacts | 200, array |

### 2B — Property CRUD (Plot Type)

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| P-01 | Create plot property | POST /api/properties | 201 with status "negotiating" |
| P-02 | Property has NSEW fields | GET /api/properties/{id} | side_north/south/east/west_ft present |
| P-03 | Edit property (no deal_type sent) | PUT /api/properties/{id} | 200, deal_type unchanged |
| P-04 | Delete property | DELETE /api/properties/{id} | 200 |
| P-05 | List properties | GET /api/properties | 200, array |
| P-06 | Property detail (read-only) | GET /api/properties/{id} | All synced fields correct |

### 2C — Property CRUD (Site Type)

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| S-01 | Create site property | POST /api/properties | 201, property_type="site" |
| S-02 | Site has same model cols as plot | GET /api/properties/{id} | NSEW, total_area_sqft present |

### 2D — Partnership CRUD

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| PS-01 | Create partnership | POST /api/partnerships | 201 |
| PS-02 | Link to property | POST (with linked_property_deal_id) | 201 |
| PS-03 | Get partnership detail | GET /api/partnerships/{id} | 200, includes summary/members/txns/buyers/plots |
| PS-04 | Update partnership | PUT /api/partnerships/{id} | 200 |
| PS-05 | Delete partnership | DELETE /api/partnerships/{id} | 200, reverse ledger |

### 2E — Partnership Members

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| M-01 | Add self member (50%, advance 100000) | POST /{id}/members | 201, auto txn + ledger created |
| M-02 | Add partner member (50%, contact) | POST /{id}/members | 201, no ledger |
| M-03 | Share total > 100% | POST /{id}/members | 400 error |
| M-04 | Update member share | PUT /{id}/members/{mid} | 200 |
| M-05 | Delete self member | DELETE /{id}/members/{mid} | 200, advance reversed |
| M-06 | Self member without contact_id | POST /{id}/members (is_self=true, no contact_id) | 201 |
| M-07 | Non-self member without contact_id | POST /{id}/members (is_self=false, no contact_id) | 400 error |

### 2F — Partnership Transactions (Outflow)

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| T-01 | advance_to_seller (self pays) | POST /{id}/transactions | 201, ledger debit, investment↑ |
| T-02 | remaining_to_seller (self pays) | POST /{id}/transactions | 201, ledger debit, investment↑ |
| T-03 | broker_commission with broker_name | POST /{id}/transactions | 201, property.broker_name synced |
| T-04 | expense (from_partnership_pot=true) | POST /{id}/transactions | 201, NO ledger entry, investment↑ |
| T-05 | Outflow by partner (non-self member_id) | POST /{id}/transactions | 201, account_id nulled |
| T-06 | Amount = 0 | POST /{id}/transactions | Should handle gracefully |

### 2G — Partnership Transactions (Inflow)

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| T-10 | buyer_advance (self receives) | POST /{id}/transactions | 201, ledger credit, total_received↑ |
| T-11 | buyer_advance (partner receives) | POST /{id}/transactions | 201, NO ledger, NO total_received↑ |
| T-12 | buyer_payment with plot_buyer_id | POST /{id}/transactions | 201, PlotBuyer.total_paid synced |
| T-13 | buyer_payment with site_plot_id | POST /{id}/transactions | 201, SitePlot.total_paid synced |
| T-14 | profit_received (self receives) | POST /{id}/transactions | 201, total_received↑ |
| T-15 | profit_received (partner receives) | POST /{id}/transactions | 201, NO total_received↑ |
| T-16 | Obligation: self receives buyer_advance | check obligations | PAYABLE to each partner (their share) |
| T-17 | Obligation: partner receives buyer_advance | check obligations | RECEIVABLE from partner (my share) |

### 2H — Transaction Edit/Delete

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| T-20 | Edit transaction amount | PUT /{id}/transactions/{tid} | 200, old ledger reversed, new created |
| T-21 | Delete transaction | DELETE /{id}/transactions/{tid} | 200, ledger reversed, totals decremented |
| T-22 | Delete buyer payment → PlotBuyer resync | DELETE /{id}/transactions/{tid} | PlotBuyer total_paid back to 0 |

### 2I — Plot Buyers (Plot Property) — Quick Create

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| B-01 | Quick-create buyer | POST /{id}/create-buyer | 201, Contact + PlotBuyer created |
| B-02 | Duplicate buyer (same name+phone) | POST /{id}/create-buyer | 409 with existing contact info |
| B-03 | Buyer with area + rate → total_value auto | POST /{id}/create-buyer | total_value = area × rate |
| B-04 | Property status → "buyer_found" | GET property | status changes |

### 2J — Add Plot (No Buyer) — New Workflow

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| AP-01 | Add plot (plot type) → PlotBuyer, no buyer | POST /{id}/add-plot | 201, status="available", no buyer_contact_id |
| AP-02 | Add site plot (site type) → SitePlot, no buyer | POST /{id}/add-plot | 201, status="available" |
| AP-03 | Add plot with area + rate | POST /{id}/add-plot | total_value calculated |
| AP-04 | Property status → "buyer_found" after plot add | GET property | Status changed |

### 2K — Assign Buyer to Plot — New Workflow

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| AB-01 | Assign existing contact to plot_buyer | PUT /{id}/assign-buyer | 200, buyer_contact_id set, status→"negotiating" |
| AB-02 | Assign new contact (quick-create) | PUT /{id}/assign-buyer | 200, Contact created + assigned |
| AB-03 | Assign duplicate contact (409) | PUT /{id}/assign-buyer | 409 with dedup message |
| AB-04 | Assign to site_plot | PUT /{id}/assign-buyer | 200, SitePlot updated |
| AB-05 | Invalid plot_type | PUT /{id}/assign-buyer | 400 error |
| AB-06 | Non-existent plot_id | PUT /{id}/assign-buyer | 404 error |

### 2L — Site Plots (Site Property)

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| SP-01 | Create site plot via add-plot | POST /{id}/add-plot | 201, plot_number set |
| SP-02 | Assign buyer to site plot | PUT /{id}/assign-buyer | 200 |
| SP-03 | Site plot: buyer payment via transaction | POST /{id}/transactions (site_plot_id) | SitePlot.total_paid synced |
| SP-04 | SitePlot status transitions | record payments | available → negotiating → advance_received |

### 2M — Property ↔ Partnership Sync

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| SY-01 | Partnership txn → Property.advance_paid synced | POST outflow txn | Property shows correct advance |
| SY-02 | Partnership txn → Property.broker_commission synced | POST broker txn | Property shows broker amount |
| SY-03 | Partnership txn → Property.total_buyer_value synced | add buyers | Sum of buyers total_value |
| SY-04 | Partnership txn → Property.status auto-updates | add buyers, advance | negotiating→advance_given→buyer_found |
| SY-05 | Legacy _sync_linked_partnership disabled | edit property | partnership NOT modified (no-op) |

### 2N — Settlement

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| ST-01 | Settle partnership | PUT /{id}/settle | 200, status→"settled" |
| ST-02 | Member total_received = advance + expenses + profit_share - already_taken | Check members | Correct distribution |
| ST-03 | Linked property status → "settled" | Check property | status="settled" |
| ST-04 | Override total_received in settle | PUT /{id}/settle with total_received | Uses override value |

### 2O — Legacy / Deprecated Endpoints

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| L-01 | POST /api/properties/{id}/transactions | POST | Still works (200) but marked deprecated |
| L-02 | PUT /api/properties/{id}/transactions/{tid} | PUT | Still works (200) but marked deprecated |
| L-03 | DELETE /api/properties/{id}/transactions/{tid} | DELETE | Still works but deprecated |
| L-04 | POST /api/properties/{id}/settle | POST | Still works but deprecated |

---

## 3. Frontend UI Verification

### 3A — Property List & Detail

| # | Check | Expected |
|---|-------|----------|
| UI-01 | Property cards: no "Deal Type" stat | Removed |
| UI-02 | Property detail: all data read-only | No edit forms |
| UI-03 | Property detail: shows buyer, seller, financial summary | Correct data |

### 3B — Partnership List

| # | Check | Expected |
|---|-------|----------|
| UI-10 | Partnership cards show "Deal Value" stat | Formatted currency |
| UI-11 | Status badges render correctly | Color-coded |

### 3C — Partnership Detail — Plots/Buyers Section

| # | Check | Expected |
|---|-------|----------|
| UI-20 | "Add Plot" button → blue form | Shows fields: plot_number, area, rate, dimensions |
| UI-21 | Plot card: no buyer → shows "Assign Buyer →" link | Clickable |
| UI-22 | "Assign Buyer" form: existing contact tab | Dropdown populated |
| UI-23 | "Assign Buyer" form: new contact tab | Name/Phone/City fields |
| UI-24 | Buyer cards show plot_number or buyer_name (not plot_label) | Correct |
| UI-25 | "Quick Buyer" form (legacy) still works | Green form, creates Contact + PlotBuyer |
| UI-26 | Status badge: "available" = blue | Correct color |

### 3D — Partnership Detail — Transactions

| # | Check | Expected |
|---|-------|----------|
| UI-30 | Transaction form: all types in dropdown | Outflow/Inflow separated |
| UI-31 | Transaction form: plot_buyer_id / site_plot_id selectable | Dropdowns populated |
| UI-32 | Transaction form: from_partnership_pot toggle | Works |
| UI-33 | Edit transaction inline | Pre-fills, saves, reverses old |
| UI-34 | Delete transaction with confirmation | Removes, reverses ledger |

### 3E — Partnership Detail — Members

| # | Check | Expected |
|---|-------|----------|
| UI-40 | Add self member | Form works, advance auto-recorded |
| UI-41 | Add partner member | Form requires contact_id |
| UI-42 | Edit member share/advance | Inline edit works |
| UI-43 | Delete member | Confirm dialog, properly reverses |

### 3F — Settlement

| # | Check | Expected |
|---|-------|----------|
| UI-50 | Settle button appears for active partnerships | Visible |
| UI-51 | Settlement modal: optional total_received override | Field present |
| UI-52 | After settle: status badge = "settled" | Green badge |

---

## 4. Edge Cases

| # | Scenario | Expected |
|---|----------|----------|
| E-01 | Partnership with no linked property → create-buyer | 400 "no linked property" |
| E-02 | Partnership with no linked property → add-plot | 400 "no linked property" |
| E-03 | Assign buyer to already-assigned plot | Updates buyer (overwrite) |
| E-04 | Delete all transactions → PlotBuyer resets to negotiating | total_paid=0, status reset |
| E-05 | Create partnership but no members → record txn | Still works (member_id optional) |
| E-06 | 0 amount transaction | Should be saved but no ledger effect |
| E-07 | Negative amount | Schema should reject |
| E-08 | Very long notes field | Should truncate/handle gracefully |

---

## 5. Execution Order

1. **Contacts**: C-01 through C-05
2. **Property CRUD**: P-01 through P-06, S-01-S-02
3. **Partnership Setup**: PS-01 through PS-03
4. **Members**: M-01 through M-07
5. **Outflow Transactions**: T-01 through T-06
6. **Add Plot / Assign Buyer**: AP-01 through AP-04, AB-01 through AB-06
7. **Inflow Transactions**: T-10 through T-17
8. **Transaction Edit/Delete**: T-20 through T-22
9. **Quick Buyer**: B-01 through B-04
10. **Property Sync**: SY-01 through SY-05
11. **Settlement**: ST-01 through ST-04
12. **Frontend**: UI-01 through UI-52
13. **Edge Cases**: E-01 through E-08
