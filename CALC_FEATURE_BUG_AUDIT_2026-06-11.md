# Calculation & Feature Bug Audit — Advanced Finance Tracker

**Date:** 2026-06-11
**Scope:** Full backend (FastAPI) + frontend (React) — **calculation logic and feature-breaking bugs only**. Security findings are intentionally excluded (see `CODE_REVIEW_2026-05-29.md` for those).
**Method:** Manual line-by-line review of every money-touching service, router and page: `interest.py`, `payment_allocation.py`, `auto_ledger.py`, `forecast_engine.py`, loans, partnerships, property_deals, beesi, accounts, expenses, obligations, recurring, dashboard, analytics, contacts, and the corresponding frontend pages.

> ## ✅ Remediation status — applied 2026-06-12
>
> All 🔴/🟠 findings and most 🟡/🟢 findings below were **fixed** and verified by a new
> scenario test suite (`backend/tests/scenarios/`, 45 tests + 1 xfail). Validation:
> the scenario suite was run against the *pre-fix* code (via `git stash`) — **31/45
> failed**, proving the tests detect the original bugs; with the fixes restored the
> full backend suite is **166 passed, 1 xfailed** and the frontend suite is 58/58.
>
> Fixed: S1 (all listed locations), L1–L7, L9.1/L9.3, A1, A2, P1–P7, PR1, PR2, PR5,
> B1–B3, D1, D2, D3 (analytics overview), AN1–AN4, F1, F2, E1, O1, plus the two
> frontend touch-ups (AccountDetail credit-card running balance, PartnershipDetail
> voided-transfer filter).
>
> **Deliberately NOT fixed (need a product decision or are by-design):**
> - **PR3** — property page (cash-basis) vs partnership page (committed-cost) profit
>   still use different bases; needs a labeling/UX decision, not a code patch.
> - **PR4** — deprecated `POST /properties/{id}/settle` still only counts
>   `other_expense`; the live settle path is partnerships. Recommend deleting it.
> - **L8** — interest payments are applied oldest-first regardless of payment date
>   (carry-forward model); changing it would re-state existing auto-cap loans.
> - **FE1** — PartnershipDetail still re-implements settlement math locally (only the
>   voided filter was fixed); should consume `/settlement-preview` instead.
> - **P8** — `delete_partnership` hard-deletes child rows (restore impossible).
>
> **New findings discovered during testing (not in the original audit):**
> 1. `GET /api/dashboard/cashflow` uses Postgres-only `func.to_char` — it 500s on the
>    SQLite dev DB (documented as `xfail` in
>    `tests/scenarios/test_dashboard_consistency.py`). Works in prod PG; should use a
>    dialect-neutral month key.
> 2. Local dev environment: `passlib 1.7.4` is incompatible with `bcrypt 5.x`
>    (system Python) — **all password hashing/login breaks** outside Docker; and
>    `psycopg2-binary==2.9.9` does not build on Python 3.13. A pinned virtualenv was
>    created at `backend/.venv` (with `psycopg2-binary>=2.9.10`). Recommend bumping
>    the pin in `requirements.txt`.
>
> Run everything: `cd backend && .venv/bin/python -m pytest tests/ -q`
>
> ## ✅ Round 2 — follow-ups applied 2026-06-12 (evening)
>
> Per user direction, the previously deferred items were resolved:
>
> 1. **Ledger redesign (the reconciliation follow-up).** `account_transactions`
>    now carries an exact `(source_type, source_id)` link to the record that
>    created each entry (migration `042_account_txn_source` — additive, nullable,
>    safe on existing data). All auto-ledger creators stamp it; all reversals
>    match on it first and fall back to the old (amount, date) heuristic only for
>    legacy pre-042 rows.
> 2. **Two-way sync from the Accounts page.** Voiding a ledger row now cascades:
>    loan-payment rows void the payment (loan reopens, later payments
>    re-allocate); expense rows soft-delete the expense. Other module-managed
>    rows return 409 with guidance to the owning page (`?force=true` overrides).
>    Shared logic lives in `app/services/loan_void.py` so the two paths can't drift.
> 3. **PR3 resolved by labeling.** Summaries expose both `projected_pnl`
>    (committed deal cost) and `realized_pnl` (cash so far); PartnershipDetail
>    hero shows "Projected P&L" with realized as subtitle; PropertyDetail shows
>    projected while active and realized once settled.
> 4. **PR4 resolved by deletion.** The four deprecated property endpoints
>    (transaction create/update/delete + settle) were removed — no frontend,
>    test, or script referenced them.
> 5. **FE1 resolved.** The Partner Net Position card and who-pays-whom section
>    now take the settlement-position figure from `GET /settlement-preview`
>    (the same math `/settle` uses), local calc only as a loading fallback.
> 6. **Recon tooling.** `scripts/recon_report.py` — strictly read-only API-based
>    scan for the six historical-corruption patterns (R1–R6); verified against a
>    seeded local server.
> 7. `psycopg2-binary` bumped to 2.9.10 (builds on modern Python; cp311 wheels
>    for the Docker image unchanged).
>
> Suite after round 2: **backend 173 passed + 1 xfail · frontend 58 passed ·
> vite build clean · alembic head = 042**.

> ## ✅ Round 3 — performance & async pass (2026-06-12, late)
>
> 1. **Event-loop blockers removed.** The three collateral endpoints were
>    `async def` running sync SQLAlchemy on the event loop — DB work now goes
>    through `run_in_threadpool`. (All other endpoints are sync `def`, which
>    FastAPI already runs in the threadpool — they never blocked the loop; the
>    gold-rate fetcher already used async httpx; Gemini endpoints are sync `def`.)
> 2. **N+1 queries eliminated** in the hottest read paths: analytics `/overview`
>    (~3 SQL/loan ×2 passes + 1–2/property + 1–2/partnership + 1/contact →
>    ~8 constant queries), analytics `/assets` (same + a Contact query per loan),
>    dashboard `/summary`, `/alerts`, `/this-month`, `/payment-behavior`
>    (per-loan outstanding now computed from eager-loaded rows), property detail
>    (a Contact query per transaction side → 2 batch queries).
> 3. **Anomaly scan deliberately kept synchronous** — the frontend awaits it and
>    immediately fetches results; it runs in the threadpool, so no loop impact.
> 4. **Deployment:** `deploy/financerbuddy-backend.service` reference unit
>    (uvloop, 2 workers, `--proxy-headers` — the latter also closes the old
>    review's rate-limit-keying gap). No new Python deps needed: httpx already
>    present, uvloop ships with `uvicorn[standard]`.
>
> Suite after round 3: **backend 173 passed + 1 xfail · frontend 58 passed · build clean**.

> ## ✅ Round 4 — L8 fixed (2026-06-12, production bug report: loan #41)
>
> Production loan #41 proved L8 ("payments applied oldest-first regardless of
> date") is not acceptable: a ₹2,90,000 payment on 9 Jun 2026 retroactively
> shrank the 14 Mar 2026 capitalization from ₹43,200 to ₹31,141.16, principal
> "fell" below the payment's principal allocation, and the loan wrongly
> auto-closed — forgiving ₹5,258.84.
>
> **Fix:** interest payments are now released chronologically in all three
> engines (`_compute_outstanding`, `generate_monthly_interest_schedule`,
> contact-statement segments): a payment offsets only interest accrued by its
> payment date and can never rewrite an earlier capitalization. Verified
> against loan #41's exact numbers — after the payment the engine reports
> ₹5,258.84 principal remaining and the loan stays ACTIVE.
>
> **Production remediation for loan #41 (after deploy, 2 clicks, no DB surgery):**
> void the ₹2,90,000 payment on the loan page, then re-record it identically
> (₹2,90,000, 09 Jun 2026, Cash). The loan reopens showing ₹5,258.84 + accrued
> interest since 9 Jun.
>
> Suite after round 4: **backend 176 passed + 1 xfail** (3 new regression tests
> in `tests/scenarios/test_autocap_payment_timing.py`).

---

## Severity legend

| Level | Meaning |
|---|---|
| 🔴 Critical | Money numbers are wrong in a way that compounds or corrupts stored data |
| 🟠 High | Wrong numbers shown / feature breaks in a common workflow |
| 🟡 Medium | Wrong numbers in a specific scenario, or inconsistency between two screens |
| 🟢 Low | Edge case, cosmetic math, or stale docs that will mislead future work |

---

## Index of findings

| # | Sev | Module | One-liner |
|---|-----|--------|-----------|
| S1 | 🔴 | Systemic | Voided payments / voided ledger rows / deleted expenses leak into ~20 calculation paths |
| L1 | 🔴 | Loans/Interest | Manual capitalization double-counts interest (rate & principal applied retroactively from loan start; `last_cap_date` computed but never used) |
| L2 | 🟠 | Loans/Interest | EMI outstanding counts penalty as repayment (inconsistent with EMI schedule) |
| L3 | 🟠 | Loans/Interest | Two EMI-schedule engines disagree (penalty handling + overdue-day rule) — dashboard/forecast vs loan page |
| L4 | 🟠 | Loans | Voiding a payment does not re-allocate later payments — splits go stale |
| L5 | 🟡 | Loans | Borrower statement includes voided payments |
| L6 | 🟡 | Loans | Force-close posts a phantom cash debit; account no longer matches the real bank |
| L7 | 🟡 | Loans | Auto-close / reconcile silently forgives outstanding interest |
| L8 | 🟡 | Loans/Interest | Interest payments applied oldest-first regardless of date → retroactively cancels auto-capitalization |
| L9 | 🟢 | Loans/Interest | Short-term schedule ignores `banking_365`; foreclose preview assumes all EMIs paid on time; stale "% per MONTH" comment |
| A1 | 🔴 | Accounts | Editing opening balance applies the delta **twice** |
| A2 | 🟡 | Accounts | Credit-card balance ignores `opening_balance`; AccountDetail rows use wrong semantics for credit cards |
| P1 | 🔴 | Partnerships | Settlement **preview ≠ created obligations** when pot money was spent |
| P2 | 🟠 | Partnerships | Editing a transaction corrupts `total_received` (reverses amounts that were never added) |
| P3 | 🟠 | Partnerships | `partner_transfer` is half-implemented — invisible to ledger, summary and settlement |
| P4 | 🟠 | Partnerships | Deleting a partner with transactions crashes (FK violation); only legacy advance types reversed |
| P5 | 🟡 | Partnerships | `our_investment` counts pot-recycled money as new capital |
| P6 | 🟡 | Partnerships | Plot/site endpoints filter by `created_by` — other admins get 404 |
| P7 | 🟡 | Partnerships | Undocumented statuses `payment_done` / `pending` written by resync helpers |
| P8 | 🟢 | Partnerships | Settle response summary includes voided txns; member fallback uses pot-inflated `advance_contributed` |
| PR1 | 🟠 | Properties | Editing a transaction's type keeps the **old** ledger direction |
| PR2 | 🟠 | Properties | `/stats` liability ignores `remaining_to_seller` payments; expenses include voided + pot-funded |
| PR3 | 🟡 | Properties | Property "Net Profit" and Partnership "Net P&L" use different cost bases for the same deal |
| PR4 | 🟡 | Properties | Deprecated settle endpoint misses `expense`-type costs and voided filtering |
| PR5 | 🟢 | Properties | Plot/buyer edits leave `total_value` stale when only area changes |
| B1 | 🟡 | Beesi | Month number derived from payment date — late payment lands in the wrong month and blocks the real one |
| B2 | 🟡 | Beesi | Deleting installment/withdrawal hard-deletes **all** matching ledger rows |
| B3 | 🟢 | Beesi | Raw dict payloads — negative amounts accepted, bad dates → 500; start-date edits don't re-derive months |
| D1 | 🟠 | Dashboard | `/summary` scoped to `created_by` but `/v2` and loan list are not — two dashboards disagree |
| D2 | 🟠 | Dashboard | Cashflow ignores all new-style partnership transaction types |
| D3 | 🟡 | Dashboard | Net worth double-counts settled investments and beesi withdrawals |
| AN1 | 🟠 | Analytics | Overview account balances & money-flow include voided rows → Analytics ≠ Accounts page |
| AN2 | 🟡 | Analytics | Loans-given: short-term accrual uses wrong rate field → performance always "open" |
| AN3 | 🟡 | Analytics | Member breakdown can double-count a buyer payment (payer = receiver) |
| AN4 | 🟢 | Analytics | 28-day month bucketing drifts (overview cashflow) |
| F1 | 🟠 | Forecast | Starting balances include voided txns; remaining principal includes voided payments |
| F2 | 🟡 | Forecast | Recurring items appear only once per window (monthly item in 90-day view shows 1× not 3×) |
| E1 | 🟡 | Expenses | Adding an account to an existing expense never creates the ledger debit |
| O1 | 🟢 | Obligations | Initial ledger entry dated at (future) due date — distorts dated cashflow |
| FE1 | 🟡 | Frontend | PartnershipDetail re-implements settlement math locally and drifts from the backend |

---

# S1 — 🔴 SYSTEMIC: voided / deleted records leak into calculations

This is the single biggest class of bugs in the app. The core engines (`calculate_outstanding`, `accounts._current_balance`, `reports.py`) correctly filter `is_voided == False` / `is_deleted == False`. But a large number of aggregation paths read raw relationships (`loan.payments`, `account.transactions`) or run raw queries **without those filters**. The moment you void a payment or delete an expense, the app contradicts itself: the loan page shows the corrected outstanding, while the dashboard/analytics still count the dead row.

**Where it fails (each location verified):**

### Voided loan payments still counted
- [dashboard.py:172-174](backend/app/routers/dashboard.py#L172-L174) — `/summary` "interest earned" / "principal recovered" iterate `loan.payments` raw.
- [dashboard.py:289-299](backend/app/routers/dashboard.py#L289-L299) — `/cashflow` LoanPayment GROUP BY has no `is_voided` filter.
- [dashboard.py:463-472](backend/app/routers/dashboard.py#L463-L472) — `/this-month` collected amounts.
- [dashboard.py:653-708](backend/app/routers/dashboard.py#L653-L708), [dashboard.py:727-755](backend/app/routers/dashboard.py#L727-L755) — `/v2` lending & borrowing interest-earned totals (`loan.payments` raw).
- [dashboard.py:1115-1126](backend/app/routers/dashboard.py#L1115-L1126) — `/v2` this-month / last-month collections queries.
- [dashboard.py:1140-1144](backend/app/routers/dashboard.py#L1140-L1144) — closed-loan profit uses raw `loan.payments`.
- [dashboard.py:84-133](backend/app/routers/dashboard.py#L84-L133) — recent activity lists voided payments/txns as real events.
- [analytics.py:3501-3509](backend/app/routers/analytics.py#L3501-L3509) — `/loans-given` loads raw `Loan.payments`; every per-loan metric (interest earned, penalty, monthly trend at [analytics.py:3931-3937](backend/app/routers/analytics.py#L3931-L3937)) includes voided payments.
- [interest.py:855-857](backend/app/services/interest.py#L855-L857) — `generate_monthly_interest_schedule` **interest-only branch** queries payments *without* the voided filter (the short_term branch at line 774 and EMI branch do filter). The monthly interest schedule on the loan page shows voided payments as "paid".
- [loans.py:766-768](backend/app/routers/loans.py#L766-L768) — borrower statement (see L5).
- [contacts.py:89-93](backend/app/routers/contacts.py#L89-L93) — `_build_interest_segments` (contact statement) sums interest-paid from raw `loan.payments`.
- [forecast_engine.py:114-122](backend/app/services/forecast_engine.py#L114-L122), [forecast_engine.py:145-147](backend/app/services/forecast_engine.py#L145-L147) — confidence heuristic and `_remaining_principal` include voided payments → forecast shows smaller principal returns than reality.
- [dashboard.py:537-549](backend/app/routers/dashboard.py#L537-L549) — payment-behavior score counts voided payments as payments.

### Voided account transactions still counted
- [analytics.py:195-203](backend/app/routers/analytics.py#L195-L203) — `/overview` per-account balances (no `is_voided` filter) → **Analytics "Total Cash" ≠ Accounts page balance** the moment anything is voided.
- [analytics.py:1799-1808](backend/app/routers/analytics.py#L1799-L1808) — `/money-flow` sums every txn including voided.
- [forecast_engine.py:774-780](backend/app/services/forecast_engine.py#L774-L780) — forecast starting balance (`_compute_balances`) includes voided txns → wrong runway/liquidity.

### Voided partnership/property transactions still counted
- [analytics.py:2527-2531](backend/app/routers/analytics.py#L2527-L2531) — `_compute_partnership_member_breakdown` loads all partnership txns unfiltered.
- [analytics.py:2670-2722](backend/app/routers/analytics.py#L2670-L2722), [analytics.py:2737-2745](backend/app/routers/analytics.py#L2737-L2745) — buyer txn lists and member event logs unfiltered.
- [dashboard.py:307-336](backend/app/routers/dashboard.py#L307-L336), [dashboard.py:1170-1192](backend/app/routers/dashboard.py#L1170-L1192) — property/partnership cashflow queries unfiltered.
- [dashboard.py:856-865](backend/app/routers/dashboard.py#L856-L865) — `/v2` partnership "received by self" sum unfiltered.
- [property_deals.py:232-237](backend/app/routers/property_deals.py#L232-L237) — `/stats` `personal_expenses` SQL has no `pt.is_voided = FALSE` condition.

### Deleted expenses still counted
- [dashboard.py:339-348](backend/app/routers/dashboard.py#L339-L348) — `/cashflow` expense query: no `is_deleted` filter.
- [dashboard.py:797-805](backend/app/routers/dashboard.py#L797-L805) — `/v2` this-month / last-month expense totals: no filter. **The dashboard expense card counts deleted expenses.**
- [dashboard.py:1194-1199](backend/app/routers/dashboard.py#L1194-L1199) — `/v2` cashflow expenses: no filter.
- [analytics.py:213-221](backend/app/routers/analytics.py#L213-L221) — `/overview` `total_expenses` / `expenses_this_month`: no filter.
- [analytics.py:1865-1872](backend/app/routers/analytics.py#L1865-L1872) — `/money-flow` expense breakdown: no filter.
- [dashboard.py:397](backend/app/routers/dashboard.py#L397) — CSV export of expenses includes deleted rows.

**Concrete failure:** record a ₹50,000 loan payment, then void it. Loan page outstanding goes back up (correct), but: Dashboard "Interest Earned", This-Month Collections, Cashflow chart, Loan Analytics, Contact statement, and Forecast all still count the ₹50,000. Same story for a deleted expense and the expense dashboard card.

**Fix direction:** add `is_voided == False` / `is_deleted == False` everywhere; better, add filtered relationship accessors (e.g. `Loan.active_payments` via `primaryjoin`) and ban raw `loan.payments` in aggregations.

---

# Loans & Interest Engine

## L1 — 🔴 Manual capitalization double-counts interest from the loan start

**Files:** [interest.py:258-267](backend/app/services/interest.py#L258-L267), [interest.py:310-318](backend/app/services/interest.py#L310-L318), [interest.py:371](backend/app/services/interest.py#L371), [loans.py:653-706](backend/app/routers/loans.py#L653-L706)

`_compute_outstanding` walks cap events to get `calc_principal = last_event.new_principal` and `current_rate = last_event.interest_rate_after`, **but then accrues interest from `interest_start_date` (loan start), not from the cap-event date**. The variable `last_cap_date` is computed in the loop and *never used afterwards* — clear evidence the period start was supposed to move.

**Where it fails:** loan of ₹1,00,000 @ 24% p.a. disbursed 1 Jan. On 1 Jul you manually capitalize ₹12,000 unpaid interest → `new_principal = 1,12,000`. Outstanding on 31 Dec is now computed as **12 months of interest on ₹1,12,000** (≈ ₹26,880) instead of 6 months on ₹1,00,000 + 6 months on ₹1,12,000 (≈ ₹25,440) — and the ₹12,000 that was already rolled into principal is **accrued a second time** for Jan–Jun. Every capitalized loan's outstanding inflates and keeps compounding with each statement view.

Related: a rate change via `interest_rate_after` is also applied retroactively to all pre-event periods.

Also note: the `/capitalize` endpoint *requires* `capitalization_enabled=True` ([loans.py:665](backend/app/routers/loans.py#L665)), but if `capitalization_after_months > 0` (auto-cap mode), `_compute_outstanding` **ignores manual DB cap events entirely** ([interest.py:313-314](backend/app/services/interest.py#L313-L314)) — the endpoint reports "Interest capitalized successfully" while having zero effect on the math.

## L2 — 🟠 EMI outstanding treats penalty as repayment

**File:** [interest.py:286](backend/app/services/interest.py#L286)

EMI branch: `total_paid = sum(p.amount_paid)` — `amount_paid` **includes** `penalty_paid`. The schedule function (`get_emi_schedule_with_payments`, [interest.py:620-640](backend/app/services/interest.py#L620-L640)) explicitly subtracts penalty before crediting EMIs ("penalty_paid is a separate charge — it must NOT count toward EMI coverage"), but the outstanding calc does not.

**Where it fails:** EMI loan, borrower pays ₹10,000 EMI + ₹500 penalty (one payment of ₹10,500). The EMI schedule correctly credits ₹10,000; the loan's `total_outstanding` shrinks by ₹10,500. Over a late-paying loan's life, outstanding is understated by the total of all penalties, and the auto-close check ([loans.py:410-420](backend/app/routers/loans.py#L410-L420)) can close the loan early.

## L3 — 🟠 Two EMI schedule engines disagree

**Files:** [interest.py:167-218](backend/app/services/interest.py#L167-L218) (`get_emi_schedule_preloaded`) vs [interest.py:588-718](backend/app/services/interest.py#L588-L718) (`get_emi_schedule_with_payments`)

The preloaded variant (used by **dashboard v2 alerts** and the **forecast engine**) differs from the DB variant (used by the **loan page**):
1. `total_paid = sum(p.amount_paid)` — does **not** exclude `penalty_paid` (the other one does).
2. Overdue penalty days: `(today - due_date).days` vs `(today - due_date).days - 1` — off-by-one between screens.
3. Paid-late penalty (effective coverage date) isn't computed at all in the preloaded variant.

**Where it fails:** a borrower who has paid penalties shows EMI #n as "paid" in dashboard alerts / forecast but "partial" on the loan page; penalty figures differ by one day's amount between screens.

## L4 — 🟠 Voiding a payment leaves later payments mis-allocated

**File:** [loans.py:555-605](backend/app/routers/loans.py#L555-L605)

`allocate_payment` splits each payment into interest/principal based on the outstanding *at the time it was recorded*. When you void an earlier payment, the later payments keep their old splits — but those splits were computed assuming the voided money existed.

**Where it fails:** interest-only loan; Payment A (₹20k) clears all interest; Payment B (₹50k) then goes mostly to principal. Void Payment A → interest was never actually paid, but Payment B still says "₹48k to principal, ₹2k to interest". `principal_outstanding` is now wrong (too low), interest outstanding too high, and totals like "interest earned" are permanently skewed. There is no re-allocation pass (the `/reconcile` endpoint only handles a narrow over-payment case).

## L5 — 🟡 Borrower statement includes voided payments

**File:** [loans.py:766-768](backend/app/routers/loans.py#L766-L768)

`GET /loans/{id}/statement` queries `LoanPayment` with **no `is_voided` filter** while the schedule beside it excludes them. A client statement (the document you hand to a borrower) shows "Payment Received" rows for voided payments and the running math doesn't tie out.

## L6 — 🟡 Force-close posts a phantom cash movement

**File:** [loans.py:503-520](backend/app/routers/loans.py#L503-L520)

On force-close with a principal shortfall, a **debit ledger entry** for the write-off is posted to the cash account. No cash actually moved — the loss already happened at disbursement time. The app's account balance now diverges from the real bank/cash balance by the write-off amount, which defeats reconciliation. (Also, the `profit_above_principal > 0` condition at line 503 is dead — the body only handles the shortfall branch.)

## L7 — 🟡 Auto-close forgives outstanding interest silently

**Files:** [loans.py:421-433](backend/app/routers/loans.py#L421-L433), [loans.py:236-244](backend/app/routers/loans.py#L236-L244), [interest.py:247-255](backend/app/services/interest.py#L247-L255)

A loan auto-closes when `principal_outstanding <= ₹1`, even if interest is still outstanding — and closed loans return **zero** outstanding everywhere. Unpaid interest just vanishes from receivables with no note/write-off record.

**Where it fails:** interest-only loan, borrower returns exactly the principal while owing 2 months of interest → loan closes, the interest receivable disappears from dashboard, contact summary, and analytics. If this is intended ("principal back = done"), it should at least record the forgiven interest like force-close records the write-off.

## L8 — 🟡 Payments applied oldest-first regardless of date cancels auto-capitalization retroactively

**File:** [interest.py:353-404](backend/app/services/interest.py#L353-L404)

The carry-forward model applies *total* interest paid against months oldest-first, ignoring **when** payments occurred. For auto-cap loans this rewrites history: a payment made in month 12 reduces month-1's unpaid interest, which retroactively undoes a capitalization that should have happened at month 3 — so the principal trajectory (and all subsequent interest) changes every time any payment arrives. Statement and outstanding stay self-consistent, but the figures a borrower was previously shown (capitalized principal) silently change after later payments.

## L9 — 🟢 Smaller interest-engine issues

1. **Short-term schedule ignores banking mode** — [interest.py:809-811](backend/app/services/interest.py#L809-L811) calls `_calc_period_interest` without `banking=`, while `_compute_outstanding` ([interest.py:368](backend/app/services/interest.py#L368)) applies banking_365 for short_term too → schedule ≠ outstanding for a banking-mode short-term loan.
2. **Foreclose preview assumes punctual payment** — [interest.py:543-572](backend/app/services/interest.py#L543-L572) derives `emis_paid` from elapsed months, not actual payments. A borrower 3 EMIs behind sees a foreclose amount that's too low.
3. **Stale model comment** — [loan.py:30](backend/app/models/loan.py#L30) says `interest_rate` is "% per MONTH"; every calculation and the UI ("% p.a.", `/1200`) treats it as **annual**. Fix the comment before it misleads a future change.
4. **`_loan_monthly_expected` uses original principal** — [dashboard.py:62-78](backend/app/routers/dashboard.py#L62-L78) — "expected this month" overstated after partial principal repayments.

---

# Accounts

## A1 — 🔴 Editing opening balance applies the delta twice

**File:** [accounts.py:181-202](backend/app/routers/accounts.py#L181-L202)

`update_account` posts a **balance-adjustment ledger entry for the delta** *and* **also sets `opening_balance = new value`**. `_current_balance` = `opening_balance + credits − debits` and does **not** exclude `balance_adjustment` rows — so the change is counted twice.

**Where it fails:** account with opening balance ₹1,000. Edit it to ₹2,000 → a +₹1,000 credit entry is created **and** opening becomes ₹2,000 → displayed balance jumps by **₹2,000**. Every opening-balance correction permanently corrupts the balance by the delta. (Either keep the old opening and post the adjustment, or update the opening with no entry — not both.)

## A2 — 🟡 Credit-card balance semantics inconsistent

**Files:** [accounts.py:44-55](backend/app/routers/accounts.py#L44-L55), [AccountDetail.jsx:105-112](frontend/src/pages/Accounts/AccountDetail.jsx#L105-L112)

1. For `credit_card` accounts, `_current_balance` returns `debits − credits` and **ignores `opening_balance`** — an existing card balance entered at account creation disappears.
2. The frontend AccountDetail computes per-row running balance as `opening + credits − debits` **for all account types** — for credit cards the rows use opposite semantics from the header figure, so the last row never matches "Current balance".
3. `forecast_engine._compute_balances` ([forecast_engine.py:781-788](backend/app/services/forecast_engine.py#L781-L788)) silently skips credit cards from liquidity — card dues never appear as upcoming outflow anywhere in the forecast.

---

# Partnerships

## P1 — 🔴 Settlement preview ≠ obligations actually created

**Files:** preview math [partnerships.py:1120-1146](backend/app/routers/partnerships.py#L1120-L1146) & [partnerships.py:1170-1172](backend/app/routers/partnerships.py#L1170-L1172) vs settle [partnerships.py:1335-1376](backend/app/routers/partnerships.py#L1335-L1376)

`_build_settlement_breakdown` computes each member's `net_obligation = final_entitlement − buyer_cash_held` where `buyer_cash_held` is **net of pot disbursements** (broker/expenses/seller payments made from the buyer money the member is holding). The **settle endpoint** instead computes `net_entitlement = entitlement − already_collected` where `already_collected` is the **gross** buyer collections ([partnerships.py:1336-1340](backend/app/routers/partnerships.py#L1336-L1340)) — pot disbursements are ignored.

**Where it fails:** Partner R collected ₹5,00,000 from a buyer and paid ₹1,00,000 broker commission from it (`from_partnership_pot=True`). Preview (Step 2 of the settle modal) says R owes `entitlement − 4,00,000`. Clicking **Settle** creates an obligation for `entitlement − 5,00,000` — **₹1,00,000 worse for R than what the screen showed**. The created receivable/payable is simply wrong whenever any pot money was spent.

## P2 — 🟠 Editing a transaction corrupts partnership totals

**File:** [partnerships.py:941-949](backend/app/routers/partnerships.py#L941-L949) (reverse) vs [partnerships.py:756-764](backend/app/routers/partnerships.py#L756-L764) (create)

On **create**, `total_received` is incremented only when the inflow was *not* received by a non-self partner. On **update**, the reversal subtracts the old amount **unconditionally**. Editing a buyer payment that a partner collected subtracts money that was never added (clamped at 0, so the error then hides). For partnerships **without** a linked property there is no recompute to repair it, so `total_received` (shown on list & detail) stays wrong.

Also in the same endpoint: the old ledger row is **hard-deleted** with no `is_voided` filter ([partnerships.py:928-939](backend/app/routers/partnerships.py#L928-L939)) — it can match and delete an already-voided row while leaving the live one.

Additionally, `_sync_property_from_partnership` ([partnerships.py:148-152](backend/app/routers/partnerships.py#L148-L152)) recomputes `total_received` **including** partner-held buyer money — the opposite convention from the create path. Property-linked and standalone partnerships therefore use two different definitions of `total_received`.

## P3 — 🟠 `partner_transfer` is half-implemented

**Files:** [PartnershipDetail.jsx:16-28](frontend/src/pages/Partnerships/PartnershipDetail.jsx#L16-L28), [PartnershipDetail.jsx:1434](frontend/src/pages/Partnerships/PartnershipDetail.jsx#L1434) (creatable in UI); backend type sets [partnerships.py:41-56](backend/app/routers/partnerships.py#L41-L56); settlement [partnerships.py:1050-1245](backend/app/routers/partnerships.py#L1050-L1245)

The UI lets you record a **Partner Transfer** (member ↔ member rebalancing). The schema accepts any string, so it saves. But in the partnerships router it is in *no* type set, so:
- **No ledger entry is ever created**, even when an account is selected — cash moves in real life, account balances in the app don't.
- `_calculate_summary` and `_build_settlement_breakdown` ignore it completely — **settlement entitlements don't account for mid-deal withdrawals**.
- Only `analytics.py` (property analytics) understands it, and the PartnershipDetail "Partner Net Position" card counts it locally — so three screens give three different answers.

**Where it fails:** Partner takes ₹2,00,000 out mid-deal recorded as Partner Transfer. Live tracker on PartnershipDetail shows the reduced stake; settlement preview & obligations pay them as if they never took the money; account balances never saw it.

## P4 — 🟠 Removing a partner with transactions crashes

**File:** [partnerships.py:570-620](backend/app/routers/partnerships.py#L570-L620)

`delete_partnership_member` only cleans up txns of legacy type `advance_given`, then `db.delete(member)`. Any remaining `partnership_transactions.member_id` / `received_by_member_id` rows referencing the member raise a **foreign-key violation → HTTP 500**. With the current UI (which writes `advance_to_seller`, `expense`, `buyer_payment`…), removing any partner that has activity is impossible; the legacy-only cleanup also means a self-member's modern advances are *not* reversed even when deletion succeeds.

## P5 — 🟡 `our_investment` counts recycled pot money as fresh capital

**Files:** [partnerships.py:756-758](backend/app/routers/partnerships.py#L756-L758), [partnerships.py:148-151](backend/app/routers/partnerships.py#L148-L151), [partnerships.py:767-772](backend/app/routers/partnerships.py#L767-L772)

Every `INVESTMENT_TYPES` txn increments `our_investment` (and `advance_contributed` for advances) **regardless of `from_partnership_pot`**. Settlement math carefully separates pocket vs pot — but the headline "Total Invested" and the member's `advance_contributed` don't.

**Where it fails:** buyer pays ₹10,00,000 → partner forwards it to the seller as `remaining_to_seller` with `from_partnership_pot=True`. No new capital entered the deal, yet `our_investment` +₹10,00,000 and the dashboard/Analytics "partnership invested" figures inflate. The settlement fallback `member_investments.get(m.id, advance_contributed)` ([partnerships.py:1161](backend/app/routers/partnerships.py#L1161)) can then reimburse a pot-funded advance as if it were pocket money.

## P6 — 🟡 Plot/site update & delete endpoints 404 for other admins

**Files:** [partnerships.py:1718-1724](backend/app/routers/partnerships.py#L1718-L1724), [partnerships.py:1781-1787](backend/app/routers/partnerships.py#L1781-L1787), [partnerships.py:1841-1847](backend/app/routers/partnerships.py#L1841-L1847), [partnerships.py:1880-1886](backend/app/routers/partnerships.py#L1880-L1886)

These four endpoints filter `Partnership.created_by == current_user.id` — unlike every other partnership endpoint. An admin who didn't create the partnership gets "Partnership not found" when editing/deleting plots ("Close Deal" flow breaks for them).

## P7 — 🟡 Resync helpers write undocumented statuses

**Files:** [partnerships.py:183-186](backend/app/routers/partnerships.py#L183-L186) (`payment_done`), [property_deals.py:64-68](backend/app/routers/property_deals.py#L64-L68) (`pending`, and it *downgrades* `negotiating` → `pending` after a void)

The model documents `negotiating | advance_received | registry_done | fully_paid` for buyers. `payment_done` is only styled in PropertyAnalytics; PartnershipDetail and PropertyDetail render it as an unknown grey chip, and status-based filters/guards (e.g. `assign_buyer` allows only `available|negotiating`) treat these rows inconsistently.

## P8 — 🟢 Minor settlement issues

1. Settle response summary is computed from **unfiltered** transactions ([partnerships.py:1300-1302](backend/app/routers/partnerships.py#L1300-L1302) + `_calculate_summary` has no voided filter) — the post-settle summary the UI displays includes voided txns.
2. `delete_partnership` hard-deletes members & transactions while soft-deleting the partnership ([partnerships.py:464-483](backend/app/routers/partnerships.py#L464-L483)) — restore is impossible, history is gone, and linked obligations are left behind.
3. Obligation reversal on txn delete matches **by amount only** ([partnerships.py:869-877](backend/app/routers/partnerships.py#L869-L877)) — deletes any same-amount obligation for the partnership.

---

# Properties

## PR1 — 🟠 Editing a transaction's type keeps the old ledger direction

**File:** [property_deals.py:612-637](backend/app/routers/property_deals.py#L612-L637)

`update_property_transaction` computes `is_inflow` from **`old_txn_type`** and then uses it for the **new** ledger entry too. Change a txn from `expense` (outflow) to `received_from_buyer` (inflow) and the replacement ledger row is still a **debit** — the account balance moves the wrong way by 2× the amount.

## PR2 — 🟠 `/properties/stats` liability & capital are wrong

**File:** [property_deals.py:223-271](backend/app/routers/property_deals.py#L223-L271)

1. `my_liability = (total_seller_value − advance_paid) × share%` — but `advance_paid` is synced **only from advance-type txns** ([partnerships.py:115](backend/app/routers/partnerships.py#L115)). Payments recorded as `remaining_to_seller` (or buyer-direct-to-seller) never reduce it. **A fully paid seller still shows as a liability.**
2. `personal_expenses` SQL counts voided txns and pot-funded expenses (no `is_voided`, no `from_partnership_pot` exclusion) → `my_capital` inflated.

## PR3 — 🟡 Property page vs Partnership page disagree on profit for the same deal

**Files:** [property_deals.py:124-155](backend/app/routers/property_deals.py#L124-L155) vs [partnerships.py:259-272](backend/app/routers/partnerships.py#L259-L272)

For the same linked deal, the property summary computes `net_profit = inflow − outflow − paid_to_seller` on a **cash basis** (only what's been paid so far), while the partnership summary uses the **full committed seller value** (`total_deal_value`) as cost. Mid-deal the two pages show very different "profit" (the partnership one is deeply negative until buyers pay, by design per the recent "Add Profit in Partner Net position" change). Pick one basis or label them differently ("realized so far" vs "projected at completion") — right now it reads as a bug to anyone comparing screens.

## PR4 — 🟡 Deprecated settle endpoint mis-sums expenses

**File:** [property_deals.py:862-895](backend/app/routers/property_deals.py#L862-L895)

`settle_property_deal` (still wired and callable) gathers expenses by `txn_type == "other_expense"` only — the modern type `expense` is skipped — and has no `is_voided` filter. Settling a deal whose costs were logged as `expense` (the type the current UI writes) computes `net_profit` too high and the partner reimbursements miss those expenses.

## PR5 — 🟢 Plot/buyer partial edits leave totals stale

**Files:** [property_deals.py:1053-1057](backend/app/routers/property_deals.py#L1053-L1057), [property_deals.py:1130-1134](backend/app/routers/property_deals.py#L1130-L1134)

With `exclude_unset=True`, editing only `area_sqft` doesn't recalculate `calculated_price` / `total_value` (the recalc needs both fields in the payload). The partnerships-router versions ([partnerships.py:1737-1744](backend/app/routers/partnerships.py#L1737-L1744)) handle this correctly — only the property-router versions are broken.

---

# Beesi (BC / Chit fund)

## B1 — 🟡 Month number derived from payment date breaks for late payments

**Files:** [beesi.py:44-51](backend/app/routers/beesi.py#L44-L51), [beesi.py:473-499](backend/app/routers/beesi.py#L473-L499)

`month_number` is derived purely from the calendar distance between `start_date` and `payment_date`. Pay month-3's installment 5 days late (in calendar month 4) → it is recorded as **month 4**. Then the real month-4 payment hits the duplicate guard → **HTTP 409 "installment for month 4 already exists"**. The user cannot record the correct months without lying about dates. (The withdrawal endpoint has the same derivation, plus no tenure bound check.)

## B2 — 🟡 Deleting installment/withdrawal nukes all matching ledger rows

**Files:** [beesi.py:554-564](backend/app/routers/beesi.py#L554-L564), [beesi.py:582-591](backend/app/routers/beesi.py#L582-L591)

Reversal matches ledger rows by `(linked beesi, type, amount, date)` and **hard-deletes every match** (`.all()` + `db.delete`). This contradicts the C-FIN-6 policy used in loans (void only the first match) and destroys audit history. Two same-day same-amount entries (e.g. a manual correction) get wiped together.

## B3 — 🟢 Validation gaps

- Raw `dict` payloads: `actual_paid: -5000` is accepted (no `gt=0`); a malformed date string raises an unhandled `ValueError` → 500. ([beesi.py:443-538](backend/app/routers/beesi.py#L443-L538))
- Editing `start_date` doesn't re-derive existing installments' `month_number`s → projections and duplicate checks operate on stale months. ([beesi.py:386-387](backend/app/routers/beesi.py#L386-L387))

---

# Dashboard

## D1 — 🟠 Two dashboards, two scoping rules

**Files:** [dashboard.py:141-148](backend/app/routers/dashboard.py#L141-L148) vs [dashboard.py:614-624](backend/app/routers/dashboard.py#L614-L624)

`/dashboard/summary` filters loans/properties/partnerships by `created_by == current_user.id`. `/dashboard/v2`, `/loans`, `/analytics/*` do **not**. With more than one admin user, the old summary cards and the v2 dashboard show different totals for the same data. Pick one scoping rule app-wide.

## D2 — 🟠 Cashflow charts ignore all new-style partnership transactions

**Files:** [dashboard.py:33-34](backend/app/routers/dashboard.py#L33-L34) used at [dashboard.py:322-336](backend/app/routers/dashboard.py#L322-L336) and [dashboard.py:1182-1192](backend/app/routers/dashboard.py#L1182-L1192)

`INFLOW_PARTNERSHIP_TXN_TYPES = {"received", "profit_distributed"}` and `OUTFLOW = {"invested", "expense"}` are the **legacy** types. Every transaction the current UI writes (`advance_to_seller`, `remaining_to_seller`, `buyer_advance`, `buyer_payment`, `profit_received`, `broker_commission`, …) falls through both sets — partnership money is essentially **absent from the dashboard cashflow charts**.

## D3 — 🟡 Net-worth double counting

**Files:** [dashboard.py:882-948](backend/app/routers/dashboard.py#L882-L948), [analytics.py:286-292](backend/app/routers/analytics.py#L286-L292)

1. **Beesi:** analytics overview net worth = `… − beesi_invested + beesi_withdrawn` → after you claim the pot, the credited cash sits in `total_cash` *and* `beesi_withdrawn` adds it again — permanent double count; meanwhile months of paid installments are never an asset (receivable) before withdrawal.
2. **Settled deals:** `prop_invested` / `advance_contributed` keep counting as assets after settlement (`status != "cancelled"` is the only exclusion) while the returned money is also in cash/obligations → settled deals inflate assets.
3. v2 `recv_pending`/`pay_pending` (obligations) overlap with `_part_net_asset` when settlement obligations exist for the same partnership.

---

# Analytics

## AN1 — 🟠 Overview balances / money-flow include voided rows

Covered in **S1** — called out separately because it produces a visible contradiction: **Accounts page balance ≠ Analytics "Total Cash" / money-flow** as soon as one transaction is voided ([analytics.py:195-203](backend/app/routers/analytics.py#L195-L203), [analytics.py:1799-1808](backend/app/routers/analytics.py#L1799-L1808)).

## AN2 — 🟡 Loans-given: short-term accrual uses the wrong rate field

**File:** [analytics.py:3535-3551](backend/app/routers/analytics.py#L3535-L3551)

`_interest_accrued_to` reads `loan.interest_rate`, but short-term loans store their rate in **`post_due_interest_rate`** (`interest_rate` is typically null for them). Accrued-expected is 0 → every short-term loan's `performance` shows "open"/never "under", and `interest_coverage_pct` for the type is meaningless.

## AN3 — 🟡 Member breakdown can double-count a buyer payment

**File:** [analytics.py:2566-2590](backend/app/routers/analytics.py#L2566-L2590)

`collected_from_buyers` adds the amount when `t.member_id == m.id` **and again** when `t.received_by_member_id == m.id`. A buyer payment saved with both fields set to the same member (the txn form allows it) counts twice in "Collected from Buyers" and `current_holding`.

## AN4 — 🟢 28-day month bucketing

**File:** [analytics.py:224-232](backend/app/routers/analytics.py#L224-L232)

Overview monthly cashflow steps back `i × 28` days and normalizes to the 1st — the accumulated drift (≈29 days/year) can make two iterations land in the same month (duplicate bucket, one month skipped) for some anchor dates. Use `relativedelta(months=i)` like `/loans-given` does at [analytics.py:3921](backend/app/routers/analytics.py#L3921).

---

# Forecast

## F1 — 🟠 Forecast balances & principal include voided data

**Files:** [forecast_engine.py:763-801](backend/app/services/forecast_engine.py#L763-L801), [forecast_engine.py:145-147](backend/app/services/forecast_engine.py#L145-L147)

Starting liquidity (`_compute_balances`) sums all transactions with no voided filter; `_remaining_principal` (drives "Principal return" / "Short-term return" inflow amounts) includes voided payments → forecast inflows understated, starting balance wrong. The whole liquidity verdict (`ok`, runway days) inherits both errors.

## F2 — 🟡 Recurring items appear only once per window

**File:** [forecast_engine.py:564-575](backend/app/services/forecast_engine.py#L564-L575)

Only rows whose **single** `next_due_date` falls inside the window are injected. A monthly ₹50,000 salary in a 90-day forecast contributes ₹50,000, not ₹1,50,000 — no expansion by frequency. Net liquidity over any window longer than the frequency is misstated.

---

# Expenses & Obligations

## E1 — 🟡 Adding an account to an existing expense never creates the ledger entry

**File:** [expenses.py:464](backend/app/routers/expenses.py#L464)

The ledger re-sync runs only `if old_account_id and (…)`. An expense created **without** an account, later edited to attach one, silently never debits that account. (Reverse direction works.)

## O1 — 🟢 Obligation creation ledger entry dated at due date

**File:** [obligations.py:94](backend/app/routers/obligations.py#L94)

`txn_date = data.due_date or today` — for a receivable due next month, the cash-out entry lands on a **future** date. Balances are fine (they ignore dates) but dated views (reconciliation, money-flow, monthly cashflow) put the movement in the wrong month.

---

# Frontend

## FE1 — 🟡 PartnershipDetail re-implements settlement math locally

**File:** [PartnershipDetail.jsx:795-940](frontend/src/pages/Partnerships/PartnershipDetail.jsx#L795-L940)

The "Partner Net Position" card recomputes investments, pot disbursements, pool attribution and profit shares **client-side**, duplicating `_build_settlement_breakdown` with real differences:
- Pool-pot attribution uses a different proportion basis than the backend (current vs gross holdings).
- It counts `partner_transfer` (backend settlement doesn't — see P3).
- `withdrawals` filter doesn't exclude `is_voided`.

So the live card, the settlement preview, and the created obligations can be three different numbers. Long-term: the card should consume `summary.member_cashflows` / the preview endpoint instead of recomputing.

Minor: [AccountList.jsx:147-150](frontend/src/pages/Accounts/AccountList.jsx#L147-L150) computes `totalBalance` including credit-card *owed* amounts as positive (currently unused — delete it before someone displays it).

---

# Cross-cutting consistency notes (not single bugs, but the source of many)

1. **Ledger reversal policy is inconsistent** — loans void the *first* match (C-FIN-6), beesi hard-deletes *all* matches, partnership update hard-deletes, partnership delete voids, property update hard-deletes all, property delete voids. Matching is always by `(type, amount, date)` heuristics rather than a stored `ledger_txn_id` FK on the source row. Storing the created `AccountTransaction.id` on the payment/txn row would eliminate this whole class (wrong-row deletion, voided-row matching, multi-row collateral damage).
2. **Two type vocabularies (legacy vs new)** for partnership/property transactions are mapped differently in: partnerships router, property summary, dashboard cashflow (legacy-only — D2), analytics property buckets, and the deprecated settle endpoint (PR4). A single shared constants module would prevent the drift.
3. **`total_received` / `our_investment` semantics differ by code path** (P2, P5) — define them once (pocket-capital vs gross flow; self vs all members) and recompute from transactions rather than incrementally mutating.
4. **Raw-dict endpoints** (beesi, accounts) bypass the validation discipline the rest of the app has — typed schemas with `gt=0` would have prevented B3.

---

# Suggested fix order

1. **A1** (opening-balance double count) + **L1** (capitalization double-accrual) — both corrupt stored/displayed money and compound over time.
2. **S1** (voided/deleted filters) — mechanical, high-volume, restores trust that all screens agree. Do it together with **AN1/F1** since they're the same change.
3. **P1, P2, P3, P4** — partnership settlement correctness (preview≠obligation, edit corruption, partner_transfer, member delete crash).
4. **L2/L3/L4** — EMI penalty handling + schedule unification + void re-allocation.
5. **PR1, PR2, D1, D2** — ledger direction on edit, stats liability, dashboard scoping & partnership cashflow types.
6. The rest (B1/B2, E1, F2, D3, AN2-4, P5-P8, PR3-PR5, L5-L9, O1, FE1) as a cleanup batch.

---

*Each finding above was verified against the code at `main` (working tree, 2026-06-11). Line numbers reference the current files. No fixes have been applied.*
