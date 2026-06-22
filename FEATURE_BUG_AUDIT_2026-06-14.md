# Feature & End-User Bug Audit — Advanced Finance Tracker

**Date:** 2026-06-14
**Scope:** Every module, backend + frontend — feature-breaking and end-user-facing bugs (not limited to money math). Several findings were **verified against live production data** via the read-only `aicopilot` credential.
**Status:** Report only — nothing fixed yet. Review and tell me which to fix.

> This is a *new* hunt across modules I had not deeply audited before (categories,
> category-limits, reports, auth, scheduler, search/filter, list pages, EMI
> penalty display). Money-math findings from the earlier rounds are already
> fixed; this list is mostly **non-money feature breakage** plus the EMI penalty
> bug you flagged.

---

## Severity legend
| Level | Meaning |
|---|---|
| 🔴 High | A feature is broken or shows wrong info the user acts on; verified live |
| 🟡 Medium | Wrong/missing data in a specific flow, or cross-screen inconsistency |
| 🟢 Low | Edge case, latent-at-scale, dead code, or cosmetic |

## Index
| # | Sev | Module | One-liner |
|---|-----|--------|-----------|
| F1 | 🔴 | Loans / EMI | EMI penalty shown against the **wrong (earliest) month**, not the month it was paid for — *verified live, loan #18* |
| F2 | 🔴 | Expenses (frontend) | Expense **search only searches the current page**, not all expenses |
| F3 | 🔴 | Category Limits | Budget-vs-actual & rollover **count deleted expenses** → wrong budget % and overspend alerts |
| F4 | 🔴 | Properties/Partnerships | Orphaned `payment_done` status from an incomplete rename → wrong "sold" count + broken badges (*3 live rows*) |
| F5 | 🟡 | Reports | P&L / portfolio reports use **legacy-only** txn types + count **voided/deleted** rows → under/over-report |
| F6 | 🟡 | Reports | Reports scoped by `created_by` while rest of app isn't → other users get **empty/partial** reports |
| F7 | 🟡 | Reports | Portfolio Excel lists **all** properties (deleted + other users') |
| F8 | 🟡 | Categories | A sub-category under a **deactivated parent vanishes** from the tree view |
| F9 | 🟢 | Lists (frontend) | List pages **silently truncate** at a hard-coded limit (no pagination UI) |
| F10 | 🟢 | Scheduler | Recurring auto-posted ledger rows **miss the source link** (can't two-way void) |
| F11 | 🟢 | Search/Filter | `GlobalSearch` + `AdvancedFilter` are **dead, unmounted** components (search is a "coming soon" stub) |
| F12 | 🟢 | Auth | Revoking a read-only user **doesn't kill its active token** (valid up to 30 min) |
| F13 | 🟢 | Category Limits | DELETE uses raw category in the URL path — names with `/` or special chars can't be deleted |
| F14 | 🟢 | Frontend | A few `.toFixed()` calls on possibly-undefined values (crash risk if API shape drifts) |
| F15 | 🟢 | Contacts | Contact page mixes original principal vs compounded outstanding for capitalizing loans |

---

## 🔴 F1 — EMI penalty attributed to the wrong month

**File:** [interest.py `_emi_schedule_core`](backend/app/services/interest.py#L697-L704)
**Verified live:** loan **#18** — borrower paid penalty on 3 separate payments; the schedule shows penalties stacked on EMIs #1 (₹400), #2 (₹700), #3 (₹700) regardless of which month each penalty was actually for.

The collected penalty is attributed **oldest-EMI-first** via a carry-forward remainder:
```python
total_penalty_collected = sum(p.penalty_paid for p in payments)
penalty_collected_remaining = total_penalty_collected
...
# per EMI, in order 1,2,3...:
if penalty_accrued > 0 and penalty_collected_remaining > 0:
    this_penalty_collected = min(penalty_collected_remaining, penalty_accrued)
    penalty_collected_remaining -= this_penalty_collected
```
So a penalty the borrower paid **for EMI #5** is displayed as covering **EMI #2's** pending penalty (the earliest unpaid one). The borrower's statement then shows the wrong months as "penalty paid", and a month whose penalty is genuinely still owed looks settled.

**Where it fails:** EMI #1 on time (no penalty), EMI #2 late & penalty still pending, EMI #3 late & borrower paid ₹400 penalty for it → the ₹400 is shown against EMI #2, and EMI #3 still looks like it owes penalty. The "month the penalty came from" is exactly what's lost.

**Fix direction:** attribute each payment's `penalty_paid` to the EMI slot that *that payment* was settling (the slot its EMI-portion brought current), not blindly oldest-first. The data is there — `penalty_paid` lives on the specific `LoanPayment`, and the cumulative timeline already knows which slot each payment covers.

---

## 🔴 F2 — Expense search only searches the current page

**File:** [ExpenseList.jsx](frontend/src/pages/Expenses/ExpenseList.jsx#L537-L551)

The expense list is **server-paginated** (`paginated: true`, 20/page), but the search box filters **client-side over the loaded page only**:
```js
const filtered = useMemo(() => {
  if (!searchQuery.trim()) return expenses;       // `expenses` = current page (20 rows)
  const q = searchQuery.trim().toLowerCase()...
  return expenses.filter(...);                    // searches only those 20
}, [expenses, searchQuery]);
```
**Where it fails:** a user types "petrol" and sees nothing because the matching expense is on page 3. Search silently lies. Either send the search term to the backend (`/api/expenses` would need a `search` param — it doesn't have one today) or fetch-all for searching.

---

## 🔴 F3 — Category budgets count deleted expenses

**File:** [category_limits.py](backend/app/routers/category_limits.py#L122-L126) (`budget-vs-actual`) and [#L204-L208](backend/app/routers/category_limits.py#L204-L208) (`rollover-preview`)

Both endpoints sum expenses with **no `is_deleted == False` filter**:
```python
expenses = db.query(Expense).filter(
    Expense.expense_date >= from_date, Expense.expense_date < to_date,
).all()
```
**Where it fails:** delete an expense and the category's "actual spent" / `pct_used` stays inflated; a category can show as **over budget** purely from deleted rows, and the rollover surplus carried to next month is understated. This is the same voided/deleted-leak class fixed elsewhere, but this router was never swept.

---

## 🔴 F4 — Orphaned `payment_done` status (incomplete rename)

**Files:** code now writes `fully_paid` ([partnerships.py](backend/app/routers/partnerships.py#L183-L186)); old rows still say `payment_done`; frontend [PropertyDetail.jsx:213](frontend/src/pages/Properties/PropertyDetail.jsx#L213)
**Verified live:** 3 plot buyers still have `status = "payment_done"`.

In a prior round the "fully paid" buyer status was renamed `payment_done → fully_paid` in code, but **no data migration** converted existing rows. Result on production:
- `PropertyDetail` counts only `["sold","registered","fully_paid"]` as sold → those 3 plots are **not counted as sold** (wrong sold count).
- `PropertyAnalytics` happens to map both labels, but `PartnershipDetail`/`PropertyDetail` don't, so the badge renders inconsistently / as an unknown chip.

**Fix direction:** one-line data migration `UPDATE plot_buyers SET status='fully_paid' WHERE status='payment_done'` (+ same for `site_plots`), or keep backward-compat by treating both labels equally everywhere.

---

## 🟡 F5 — Reports under/over-report (legacy types + voided/deleted)

**File:** [reports.py `generate_pnl_report`](backend/app/routers/reports.py#L312-L375)

- **Partnership income** only counts legacy types `["received","profit_distributed"]` — misses every current type (`buyer_payment`, `profit_received`, `buyer_advance`…). **Property income** only counts `PropertyTransaction` legacy rows and ignores partnership-managed deals entirely (where the real money lives now).
- Property in/out-flow and partnership income queries have **no `is_voided == False`** filter → voided transactions inflate the report.
- Same `D2`-class type-vocabulary drift fixed for the dashboard, not yet for reports.

**Where it fails:** a P&L PDF/Excel shows far less income than reality for anyone using the modern partnership flow, and includes voided amounts.

## 🟡 F6 — Reports scoped to the creator only

**File:** [reports.py](backend/app/routers/reports.py#L145) (`portfolio-summary`) and the partnership/expense lists in it.

`portfolio-summary` filters `Loan.created_by == current_user.id`, `Partnership.created_by`, `Expense.created_by`. The rest of the app shows all data regardless of creator (that scoping was deliberately removed from the dashboard). So a second admin — or the read-only accountant credential — generating a report gets **empty or partial** output even though they can see everything on screen. Inconsistent and confusing.

## 🟡 F7 — Portfolio Excel includes deleted / other users' properties

**File:** [reports.py](backend/app/routers/reports.py#L219-L231)

`properties_list = [... for p in db.query(PropertyDeal).all()]` — no `is_deleted` filter and no `created_by` scope, while the loans in the same report *are* scoped. So the Excel mixes deleted properties (and, in a multi-user setup, everyone's) into a report whose other sections are filtered. Internally inconsistent.

## 🟡 F8 — Sub-category under a deactivated parent disappears

**File:** [categories.py `list_categories` tree mode](backend/app/routers/categories.py#L54-L59)

The tree only queries `is_active == True`. A child whose parent was deactivated matches neither `parent_id in by_id` (parent filtered out) nor `not c.parent_id`, so the node is **dropped from the tree entirely** — it still exists and is still used by expenses, but vanishes from the category picker's tree view (flat view still shows it). Users "lose" sub-categories after deactivating a parent.

---

## 🟢 Lower priority

**F9 — Silent list truncation.** [LoanList](frontend/src/pages/Loans/LoanList.jsx#L54) (limit 500), Contacts (500), [PartnershipList](frontend/src/pages/Partnerships/PartnershipList.jsx#L113) / [ObligationList](frontend/src/pages/Obligations/ObligationList.jsx#L54) (limit 200) hard-code a cap with **no pagination/load-more UI**. Past the cap, records are invisible. Fine at today's volume; a scale time-bomb. (ExpenseList *does* paginate correctly.)

**F10 — Scheduler ledger rows miss the source link.** [scheduler.py](backend/app/services/scheduler.py#L90-L100) creates recurring `AccountTransaction`s without `source_type`/`source_id` (the round-2 exact-reversal link), so they fall back to legacy heuristic matching and can't be cleanly two-way-voided.

**F11 — Dead search/filter components.** `GlobalSearch.jsx` (a "Advanced search coming soon" stub that calls no API) and `AdvancedFilter.jsx` are **not mounted anywhere**. No header search exists. Dead code — not user-facing, but misleading to maintainers and a missing feature.

**F12 — Readonly revoke leaves a live token.** [auth.py `revoke_readonly_user`](backend/app/routers/auth.py#L306-L318) sets `is_active=False` but doesn't blacklist outstanding tokens; the revoked user's access token stays valid until it expires (≤30 min). Refresh is correctly blocked. (Relevant now — the `aicopilot` recon credential should be revoked.)

**F13 — Category-limit delete by raw path.** [category_limits.py](backend/app/routers/category_limits.py#L79) `DELETE /{category}` — a category named e.g. `Food/Dining` or with a slash can't be addressed; should accept the category in the body or URL-encode.

**F14 — Unguarded `.toFixed()`.** e.g. [PartnershipDetail.jsx:461](frontend/src/pages/Partnerships/PartnershipDetail.jsx#L461) `m.final_entitlement.toFixed(2)`, [Dashboard.jsx:356](frontend/src/pages/Dashboard.jsx#L356) `lending.avg_lending_rate_pa.toFixed(2)` — crash the page if the field is ever missing/null. Cheap to guard.

**F15 — Contact page principal mix.** [contacts.py get_contact](backend/app/routers/contacts.py#L386-L398) shows `total_lent` from *original* principal but `given_principal` from *compounded* outstanding for capitalizing loans — two different principals side by side. Intentional per a code comment, but reads as inconsistent to a user.

---

## Suggested triage order
1. **F1** (EMI penalty month) — you flagged it, it's live and visible on statements.
2. **F4** (orphaned `payment_done`) — 3 live rows; needs a tiny data migration. Quick win.
3. **F3** (deleted expenses in budgets) + **F2** (expense search) — both mislead the user daily.
4. **F5/F6/F7** (reports) — batch the reports module fixes together.
5. **F8–F15** — cleanup as a maintenance pass.

*All findings verified against code at the current `main`; F1/F4 and endpoint health additionally verified against live production data (read-only). Nothing was changed on the server.*
