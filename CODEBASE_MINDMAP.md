# Codebase Mindmap — Advanced Finance Tracker

> Living index of the entire codebase. Update this file whenever you add, move, rename, or delete anything significant. Treat it as the first thing to read in a new session.
>
> **Last updated:** 2026-07-08 (Activity Logs feature: `activity_logs` table (migration 045) auto-populated by SQLAlchemy flush listeners in `services/activity_logger.py` — every ORM create/update/delete anywhere in the app is logged with field-level before→after diffs, attributed via `session.info` stamped in `get_current_user`; login/logout logged explicitly. Read API `/api/activity-logs` (search/filter/sort/pagination) + `/logs` frontend page under new "System" sidebar section. Prior: 2026-06-12 r3 (perf/async pass: N+1 fixes in analytics overview/assets + dashboard, collateral async-DB offload, deploy/financerbuddy-backend.service. r2: Ledger source-link redesign: migration 042 adds account_transactions.source_type/source_id; two-way void from Accounts page; projected vs realized P&L fields; deprecated property txn/settle endpoints deleted; scripts/recon_report.py read-only prod scanner. Earlier same day: calculation-bug remediation pass — see `CALC_FEATURE_BUG_AUDIT_2026-06-11.md`: voided/deleted-record filters across dashboard/analytics/forecast, opening-balance fix, manual-capitalization rebasing, EMI penalty handling, partnership settlement parity + partner_transfer support, beesi sequential months, recurring forecast expansion. New scenario test suite at `backend/tests/scenarios/` — run with `backend/.venv/bin/python -m pytest tests/ -q`.)

---

## 1. Project Overview

A personal finance tracker for managing lending, property deals, partnerships, expenses, savings pools (beesi/chit funds), cash accounts, and obligations — with analytics, AI-assisted categorization, and PDF/Excel exports.

- **Backend:** FastAPI · SQLAlchemy 2.0 · PostgreSQL · Alembic
- **Frontend:** React 18 · Vite · TailwindCSS · TanStack Query · React Router · Recharts
- **Infra:** Docker Compose (local) · Render.com (backend prod) · Vercel (frontend prod)
- **External APIs:** Google Gemini (chatbot + categorization) · goldpricez.com (gold valuation)

---

## 2. Repository Layout

```
Advanced_Finance_Tracker/
├── backend/                  # FastAPI app
│   ├── app/
│   │   ├── main.py           # FastAPI bootstrap, CORS, route registration, admin seed
│   │   ├── config.py         # Env vars (DB, JWT, Gold API, Gemini, admin creds)
│   │   ├── database.py       # SQLAlchemy engine + session factory + Base
│   │   ├── dependencies.py   # JWT auth dep, DB session dep
│   │   ├── models/           # SQLAlchemy ORM models  (§4)
│   │   ├── schemas/          # Pydantic request/response DTOs
│   │   ├── routers/          # API endpoints  (§5)
│   │   └── services/         # Business logic  (§6)
│   ├── alembic/versions/     # 23 migrations  (§7)
│   ├── alembic.ini
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── prestart.py / start.sh / build.sh
│   └── runtime.txt
├── frontend/                 # React + Vite app
│   ├── src/
│   │   ├── App.jsx           # Router + AuthProvider + QueryClient
│   │   ├── main.jsx          # Vite entry
│   │   ├── index.css
│   │   ├── components/       # Shared UI  (§8)
│   │   ├── contexts/         # AuthContext
│   │   ├── hooks/            # useAuth
│   │   ├── lib/              # api.js (axios), utils.js
│   │   └── pages/            # Feature pages  (§9)
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── Dockerfile
│   └── vercel.json
├── scripts/                  # Active maintenance scripts
│   ├── migrate_legacy_categories.py
│   └── seed_budgets.py
├── docs/                     # Documentation (see §10)
├── docker-compose.yml
├── render.yaml
├── .env.example
├── README.md
└── CODEBASE_MINDMAP.md       # ← this file
```

---

## 3. Domain Concepts (Glossary)

| Concept | What it is |
|---------|-----------|
| **Contact** | A borrower / lender / counterparty. Carries financial summary across loans & obligations. |
| **Loan** | Money given or taken. Three flavors: `interest_only` (accrual), `emi` (amortizing), `short_term` (simple). |
| **Capitalization Event** | Admin action that adds accrued interest into the loan's principal. |
| **Collateral** | Asset securing a loan (gold, property). Gold revalued via live API. |
| **Property Deal** | Real-estate acquisition. Two modes: middleman (flip) or buy-and-hold. Subdivided into site plots and plot buyers. |
| **Site Plot** | A surveyed subdivision of a property; tracks compass-direction roads (N/S/E/W). |
| **Plot Buyer** | A buyer occupying part of a property (area_sqft × rate_per_sqft). |
| **Partnership** | Joint venture with proportional member shares; tracks investments, returns, broker fees, member payouts. |
| **Beesi** | Rotating savings pool / chit fund — fixed monthly installment, periodic withdrawal of the pot. |
| **Cash Account** | Named bank/cash/credit account with auto-posted ledger from loans, beesi, partnerships, obligations. |
| **Money Obligation** | Receivable or payable that isn't a loan; settled by posting against an account. Can be force-closed at a loss (writes off remaining → `loss_amount`, status=`closed`) or collect extra interest/profit on a payment (`interest_amount`). |
| **Expense** | Categorized spending; auto-categorized via Gemini + learning table. |
| **Category Limit** | Monthly cap per category, with optional rollover of unspent balance. |
| **Partner Transfer** | Internal-only: tracking transfers between partners (replaced earlier "Profit Received" concept — see commit b927443). |
| **Legacy flag** | `is_legacy` on records carried over from the v1 sample dataset; preserved during prod migration. |

---

## 4. Backend — Models (`backend/app/models/`)

| File | Tables / classes |
|------|------------------|
| `user.py` | `User` (admin/viewer roles) |
| `contact.py` | `Contact` |
| `loan.py` | `Loan`, `LoanPayment`, `LoanCapitalizationEvent` |
| `collateral.py` | `Collateral` |
| `property_deal.py` | `PropertyDeal`, `SitePlot`, `PlotBuyer`, `PropertyTransaction` |
| `partnership.py` | `Partnership`, `PartnershipMember`, `PartnershipTransaction` |
| `expense.py` | `Expense` |
| `category.py` | `Category` |
| `category_limit.py` | `CategoryLimit` |
| `category_learning.py` | `CategoryLearning` (ML training data) |
| `beesi.py` | `Beesi`, `BeesiInstallment`, `BeesiWithdrawal` |
| `cash_account.py` | `CashAccount`, `AccountTransaction` |
| `obligation.py` | `MoneyObligation`, `ObligationSettlement` |
| `property_anomaly.py` | `PropertyAnomaly` |
| `forecast_override.py` | `ForecastOverride` (per-user, per-item, per-month forecast adjustments) |
| `recurring_transaction.py` | `RecurringTransaction` — user-defined recurring cash flows (title, type inflow/outflow, amount, frequency monthly/weekly/yearly, next_due_date, account_id FK, is_active) |
| `activity_log.py` | `ActivityLog` — append-only audit trail: action/module/entity_type/entity_id, JSON `changes` diff, denormalized amount/account_id/contact_id/loan_id, username, request line |

---

## 5. Backend — Routers (`backend/app/routers/`)

| Router | Prefix | Notable endpoints |
|--------|--------|-------------------|
| `auth.py` | `/auth` | `POST /login`, `POST /refresh` |
| `contacts.py` | `/contacts` | CRUD |
| `loans.py` | `/loans` | CRUD, `POST /{id}/payments`, `POST /{id}/capitalize` |
| `collateral.py` | `/collateral` | CRUD, `GET /gold-price` |
| `property_deals.py` | `/properties` | CRUD, `POST /{id}/transactions`, plot/buyer subroutes (incl. `DELETE` for site_plots & plot_buyers — see commit 8cbbf1c) |
| `partnerships.py` | `/partnerships` | CRUD, `PATCH /{id}/members`, transactions (Partner Transfer replaces Profit Received — commit b927443) |
| `beesi.py` | `/beesi` | CRUD, `POST /{id}/installments`, `POST /{id}/withdrawals` |
| `accounts.py` | `/accounts` | CRUD, `GET /{id}/transactions`, `GET /{id}/balance` |
| `obligations.py` | `/obligations` | CRUD, `POST /{id}/settle` (principal + optional `interest_amount` extra profit; interest-only payments allowed), `POST /{id}/close-loss` (write off remaining → status=`closed`, `loss_amount`), `POST /{id}/reopen` |
| `expenses.py` | `/expenses` | CRUD, `GET /analytics/trends` |
| `categories.py` | `/categories` | CRUD |
| `category_limits.py` | `/category-limits` | CRUD |
| `dashboard.py` | `/dashboard` | `GET /summary`, `GET /quick-links` |
| `analytics.py` | `/analytics` | `/net-worth`, `/expense-trends`, `/money-flow`, `/property` (per-property/plot/partnership money flow + per-partner positions), legacy `/forecast` (used by Analytics dashboard mini-card) |
| `forecast.py` | `/api/forecast` | `GET /` (entity-grouped: loans/EMIs/interest/obligations/beesi/recurring — property excluded; strict-`<` window; EMI 1st/2nd-of-month → previous-month rule; `account_ids[]` filter). `POST /overrides`, `POST /overrides/fulfill`, `POST /overrides/clear`, `GET /overrides` |
| `recurring_transactions.py` | `/api/recurring-transactions` | `GET /` list (include_inactive param), `POST /` create, `PATCH /{id}` update/pause, `DELETE /{id}` delete |
| `reports.py` | `/reports` | `GET /{module}/export` (CSV/Excel) |
| `admin.py` | `/admin` | `POST /mark-legacy`, migration helpers |
| `chatbot.py` | `/chatbot` | `POST /query` (Gemini-backed) |
| `activity_logs.py` | `/api/activity-logs` | `GET` list (search, module/action/entity_type/account/contact/user filters, date range, newest/oldest sort, pagination; contact/account names resolved via outer joins), `GET /filters` (distinct dropdown values) |

---

## 6. Backend — Services (`backend/app/services/`)

| Service | Responsibility |
|---------|---------------|
| `interest.py` | Day-level interest accrual for `interest_only` and `emi` loans, including capitalization. |
| `payment_allocation.py` | Allocates a payment across principal / interest / outstanding dues. |
| `auto_ledger.py` | Mirrors loan/beesi/partnership/obligation events into the cash-account ledger. |
| `expense_categorizer.py` | Gemini-powered auto-categorization with learning-table fallback. |
| `learning.py` | Read/write category-learning patterns. |
| `gold_price.py` | Fetches current gold rate (goldpricez.com) and revalues gold collateral. |
| `excel_generator.py` | `.xlsx` export for any list endpoint via `openpyxl`. |
| `pdf_generator.py` | PDF statements (loan, property, partnership) via `reportlab`. |
| `chatbot_tools.py` | Gemini tool-use definitions for financial queries. |
| `forecast_engine.py` | Forecast & Liquidity engine — generates cash-flow items (loans / obligations / beesi / recurring_transactions; property excluded by design). Applies per-user `ForecastOverride` rows scoped to current calendar month, groups by entity, computes totals + daily timeline + liquidity. `account_ids` param filters Starting Balance + loan items. `RecurringTransaction` items injected with `is_recurring=True`. Loan items carry `principal_amount`, `remaining_principal`, `loan_priority`. True liquidity formula: `Starting Balance + Projected Inflows − Required Outflows`. |
| `activity_logger.py` | Automatic audit logging. Global `Session` flush listeners (`before_flush`/`after_flush`) turn every ORM create/update/delete into an `activity_logs` row **in the same transaction**, with field-level old→new diffs (fetches committed row when attrs were expired post-commit). Soft-deletes (`is_deleted`→True) reclassified as `delete`, voids as `void`. User + request attribution via `session.info` stamped in `get_current_user`; unstamped sessions (scheduler) log as "system". Skips ActivityLog/RefreshTokenBlacklist/CategoryLearning; excludes `password_hash`. `log_auth_event()` for login/logout. Bulk `Query.update()/delete()` not captured (ORM-only). |
| `scheduler.py` | APScheduler `BackgroundScheduler` — daily 00:05 UTC job `process_recurring_transactions`: settles due `RecurringTransaction` rows into `AccountTransaction`, advances `next_due_date` by frequency. Started on FastAPI startup, stopped on shutdown. |

---

## 7. Database Migrations (`backend/alembic/versions/`)

Run in order. The latest is `026_recurring_transactions_loan_priority`.

| # | Slug | Purpose |
|---|------|---------|
| 1 | `e05cc2c9a712_initial_schema_with_all_tables` | Bootstrap |
| 2 | `3bbc02343332_extend_rate_per_sqft_to_3dp` | rate_per_sqft → 3dp |
| 3 | `003_add_plot_dimensions_site_fields` | site_plots, plot_buyers |
| 4 | `004_add_beesi_and_accounts` | Beesi + cash accounts |
| 5 | `005_add_contact_account_to_beesi` | beesi ↔ contact/account |
| 6 | `006_account_linking` | Auto-ledger refs |
| 7 | `007_money_obligations` | Obligations module |
| 8 | `008_partnership_received_by` | Member-level payouts |
| 9 | `009_nullable_obligation_contact` | Optional contact |
| 10 | `010_property_other_expenses` | Misc expenses on deals |
| 11 | `011_nsew_roads_site_plots` | Compass directions on plots |
| 12 | `012_expense_sub_category` | Sub-categories |
| 13 | `013_category_learnings` | Learning table |
| 14 | `014_plot_buyers_site_enh` | Plot-buyer dims + contacts |
| 15 | `015_partnership_txn_enh` | Broker fees, payouts |
| 16 | `016_credit_cards_category_limits` | Credit-card account type, budgets |
| 17 | `017_categories` | Pre-defined categories |
| 18 | `018_is_legacy_flag` | Legacy data flag |
| 19 | `019_category_limit_rollover` | Budget rollover |
| 20 | `020_performance_indexes` | Query indexes |
| 21 | `021_site_plots_missing_columns` | Supabase column fix |
| 22 | `022_site_plots_raw_sql` | Raw SQL (PgBouncer compat) |
| 23 | `023_all_tables_raw_sql` | Comprehensive idempotent column fix |
| 24 | `024_property_anomalies` | Property-anomaly tracker table |
| 25 | `025_forecast_overrides` | `forecast_overrides` — per-user/item/month toggle + amount + fulfilled status |
| 26 | `026_recurring_transactions_loan_priority` | `recurring_transactions` table (RecurringType + RecurringFrequency enums); adds `priority` column (loan_priority_enum: high/medium/low) to `loans` table |
| … | (27–42) | soft-deletes, indexes, penalty/interest fields, simulations, recurring expenses, account-txn source links |
| 43 | `043_obligation_close_loss` | `money_obligations.loss_amount` / `closed_date` / `interest_amount` + `obligation_settlements.interest_amount` — close-with-loss & extra interest/profit |
| 44 | `044_payment_done_rename` | Data fix: orphaned `payment_done` → `fully_paid` on `plot_buyers` / `site_plots` (F4) |
| 45 | `045_activity_logs` | `activity_logs` audit-trail table + indexes (created_at DESC, user/action/module/entity/account/contact/loan) |

---

## 8. Frontend — Shared (`frontend/src/`)

- **components/Layout.jsx** — sidebar shell, role-based menu, logout
- **components/ProtectedRoute.jsx** — auth guard
- **components/ChatBot.jsx** — floating Gemini chat
- **components/GlobalSearch.jsx** — cross-entity search
- **components/AdvancedFilter.jsx** — reusable filter UI
- **components/LinkedRecordSelect.jsx** — entity-picker dropdown
- **components/ui.jsx** — Shadcn/Radix primitives
- **contexts/AuthContext.jsx** — user/token state
- **hooks/useAuth.js** — context accessor
- **lib/api.js** — axios instance with JWT interceptor
- **lib/utils.js** — currency/date formatters

---

## 9. Frontend — Pages (`frontend/src/pages/`)

| Module | Pages | Routes |
|--------|-------|--------|
| Auth | `Login.jsx` | `/login` |
| Core | `Dashboard.jsx` | `/dashboard` |
| Contacts | `ContactList`, `ContactForm`, `ContactDetail` | `/contacts[...]` |
| Loans | `LoanList`, `LoanForm`, `LoanDetail`, `LoanStatement` | `/loans[...]` |
| Properties | `PropertyList`, `PropertyForm`, `PropertyDetail` | `/properties[...]` |
| Partnerships | `PartnershipList`, `PartnershipForm`, `PartnershipDetail` | `/partnerships[...]` |
| Beesi | `BeesiList`, `BeesiForm`, `BeesiDetail` | `/beesi[...]` |
| Accounts | `AccountList`, `AccountForm`, `AccountDetail` | `/accounts[...]` |
| Expenses | `ExpenseList` | `/expenses` |
| Obligations | `ObligationList` | `/obligations` |
| Analytics | `ExpenseAnalytics`, `Forecast` (entity-grouped + persisted overrides), `NetWorth`, `Reconciliation`, `PropertyAnalytics` | `/expense-analytics`, `/forecast`, `/net-worth`, `/reconciliation`, `/analytics/property` |
| Reports | `Reports` | `/reports` |
| Logs | `Logs/ActivityLogs.jsx` — full audit trail: debounced global search (names/amounts/diff contents), module/action/account/date-range filters, newest↔oldest toggle, expandable before→after change tables, "Open record" deep links, pagination | `/logs` |
| Admin | `AdminMigration` | `/admin/migration` |

---

## 10. Documentation Map (`docs/` after cleanup)

| File | Purpose |
|------|---------|
| `README.md` | Top-level getting-started (kept at repo root) |
| `docs/QUICKSTART.md` | First-run guide |
| `docs/DEPLOYMENT.md` | Deployment overview |
| `docs/DEPLOY_RENDER.md` | Render.com step-by-step |
| `docs/TESTING_GUIDE.md` | How to run the test suite |
| `docs/TESTING_PLAN.md` | Latest UAT plan (was V2) |
| `docs/BUG_REPORT.md` | Latest bug-tracker doc (was V2) |
| `docs/PAYMENT_TRACKING_GUIDE.md` | Payment-allocation algorithm reference |
| `docs/PropertyandPartnershipPlan.md` | Property/partnership feature spec |
| `docs/MOMENTO.md` | Living architecture & decision log |
| `docs/PROMPT.md` | Original product spec (historical) |

> Files removed during cleanup are listed in §12.

---

## 11. Active Maintenance Scripts (`scripts/`)

- `migrate_legacy_categories.py` — migrate expenses to new category model
- `seed_budgets.py` — seed default category budgets

---

## 12. Cleanup History

> Append to this section whenever files are removed so the rationale survives in code review.

### 2026-05-02 — Forecast cleanup
**Deleted (unused after Forecast v2 rewrite):**
- `/api/analytics/smart-forecast` endpoint (~376 lines from `app/routers/analytics.py`, 1799–2174). The new [`Forecast.jsx`](frontend/src/pages/Analytics/Forecast.jsx) now calls `/api/forecast` exclusively; nothing else referenced `smart-forecast`. Permission given by user.

### 2026-04-30 — Initial cleanup
**Deleted (superseded / completed scope):**
- `PHASE2_COMPLETE.md`, `QUICKSTART_PHASE2.md` — phase-2 closure docs
- `FIXES_APPLIED.md`, `BUGS.md` — completed fix logs
- `BUG_REPORT.md` (V1), `TESTING_PLAN.md` (V1) — V2s promoted to current name
- `START_HERE.md` — duplicated `README.md` + `QUICKSTART.md`
- `DEPLOYMENT_SUMMARY.md` — duplicated `DEPLOYMENT.md` + `DEPLOY_RENDER.md`

**Deleted (one-shot data-migration artifacts, April 2026 prod migration):**
- `fetch_prod.py`, `migrate_prod_data.py`, `fix_missing_members.py`, `verify_migration.py`
- `prod_data_dump.json`, `migration_id_mappings.json`
- `add_sample_data.sh` — old dev seed
- `_write_analytics.py`, `_write_analytics2.py` — generators; output already in `frontend/src/pages/Analytics.jsx`

**Renamed:**
- `BUG_REPORT_V2.md` → `docs/BUG_REPORT.md`
- `TESTING_PLAN_V2.md` → `docs/TESTING_PLAN.md`

**Moved to `docs/`:**
- `QUICKSTART.md`, `DEPLOYMENT.md`, `DEPLOY_RENDER.md`, `TESTING_GUIDE.md`,
  `PAYMENT_TRACKING_GUIDE.md`, `PropertyandPartnershipPlan.md`, `MOMENTO.md`, `PROMPT.md`

**Kept at root:** `README.md`, `CODEBASE_MINDMAP.md`, `test_api.py`, `test_api.sh`, `run_uat_tests.sh`,
`docker-compose.yml`, `render.yaml`, `.env.example`.

---

## 13. Recent Notable Commits

- **Feature-bug audit fixes F1–F14** (2026-07-02) — from `FEATURE_BUG_AUDIT_2026-06-14.md` (F12 was a false positive: `get_current_user` already enforces `is_active`). (1) **F1** EMI penalty attribution in [interest.py `_emi_schedule_core`](backend/app/services/interest.py): `penalty_collected` now attributed per-payment to the EMI slot that payment settled (surplus falls back oldest-first) instead of a global oldest-first carry — verified against live loan #18. (2) **F4** migration 044 converts orphaned `payment_done` → `fully_paid` on `plot_buyers`/`site_plots`; PropertyDetail counts legacy label as sold. (3) **F3** `category_limits` budget-vs-actual + rollover-preview exclude `is_deleted` expenses. (4) **F2** `/api/expenses` gained a server-side `search` param (text ilike + exact amount); ExpenseList sends debounced search instead of filtering the current page. (5) **F5** P&L report imports the dashboard txn-type vocabulary + `is_voided` filters; **F6** portfolio-summary no longer scoped by `created_by`; **F7** portfolio Excel excludes deleted properties/partnerships/expenses. (6) **F8** category tree promotes children of deactivated parents to roots. (7) **F10** scheduler recurring ledger rows stamped with `source_type/source_id`. (8) **F13** category-limit DELETE accepts numeric id or name. (9) **F14** guarded `.toFixed()` on Dashboard/PartnershipDetail. (10) Dashboard `active_property_deals` now excludes settled (matched analytics). Obligation/Partnership list limits bumped 200→500 (F9 pagination UI still TODO).
- **Forecast v3 Enterprise** (2026-05-02) — (1) New `recurring_transactions` table (migration 026) + `loan.priority` column; (2) APScheduler daily job (`scheduler.py`) auto-settles due recurring items into `AccountTransaction` and advances `next_due_date`; (3) `/api/forecast` now accepts `account_ids[]` — filters Starting Balance to selected accounts, excludes loan items tied to deselected accounts, injects active `RecurringTransaction` items flagged `is_recurring=True`; loan items carry `principal_amount`/`remaining_principal`/`loan_priority`; liquidity formula updated to `Starting Balance + Projected Inflows − Required Outflows`; (4) Frontend smart defaults: low-priority loan items display unchecked (locally via `isItemIncluded()`); "Settle Principal" button sets amount override to `remaining_principal`; blue `RECURRING` pill on injected items; priority badge on loan rows; (5) Account multi-select dropdown at page top: toggling accounts updates Starting Balance + item list in real-time; (6) "Manage Recurring Transactions" modal with full CRUD (create / edit / pause / delete), account assignment, add `/api/recurring-transactions` router.
- **Forecast v2.1 fixes** (2026-05-02) — (1) Property module fully decoupled from forecast: no property deal inflows, no `linked_type='property'` obligations. (2) Strict-`<` window boundary (a 30d view starting May 2 → ends June 1 *exclusive*; June 1 obligations no longer bleed into May). (3) EMI 1st/2nd-of-month rule via `_emi_effective_date`: an EMI due on the 1st/2nd of a month is treated as the prior month's obligation for overdue & period accounting (also applied to beesi installments). (4) Optimistic-cache mutation pattern in [Forecast.jsx](frontend/src/pages/Analytics/Forecast.jsx) — checkboxes/amount-overrides patch the React Query cache locally via `qc.setQueryData`, no full refetch on every click; `EntityCard`/`ItemRow` are `memo()`-wrapped. (5) Outflow column is now interactive too: include checkbox + click-to-edit Expected Amount + Mark-paid action. (6) `/api/analytics/smart-forecast` endpoint removed (was unused after v2 page rewrite).
- **Forecast & Liquidity v2** (2026-05-02) — new `/api/forecast` router + `forecast_engine` service + `forecast_overrides` table (migration 025). Replaces the old [Forecast.jsx](frontend/src/pages/Analytics/Forecast.jsx) — items now grouped by entity (contact/beesi/institution), accordion-expanded; per-item include toggle, amount-override input, "Mark fulfilled" capture; sticky scorecard (Projected Inflows / Required Outflows / Net Liquidity); timeframe presets 15/30/60/90 + custom days + custom date range + "until month end". Overrides persist scoped to current `YYYY-MM` so they auto-clear at month boundaries — items not actually settled reappear next month as overdue, no manual rollover. Old `/api/analytics/forecast` remains in place for the Analytics dashboard mini-card.
- **Property Analytics page** — `GET /api/analytics/property` + `/analytics/property` route. Six money-flow buckets (to-receive/to-pay/already-in/already-out/projected gross+net), per-partner money positions (contributed, received, currently holding, projected share, final settlement) with self highlighted, plain-English summary sentence, multi-scope picker (properties / partnerships / site plots / "Everything Combined"), transaction timeline. Read-only, no migration.
- `b927443` — Replace "Profit Received" with "Partner Transfer" for internal partnership tracking.
- `8cbbf1c` — Delete buttons for site_plots and plot_buyers.
- `1a3729c` — Partnership PUT endpoints use `created_by` instead of removed `user_id`.
- `3ec1d76`, `6607fab` — Migration 023: idempotent raw-SQL column fixes for Supabase.

---

## 14. How to Keep This File Fresh

1. **New feature** → add row in §4 (model), §5 (router), §6 (service if any), §9 (page).
2. **New migration** → append to §7.
3. **File deleted/renamed** → update the affected section AND add a one-line entry in §12.
4. **New domain concept** → glossary entry in §3.
5. **Big architectural decision** → one-line summary here, full detail in `docs/MOMENTO.md`.
6. **Bump `Last updated:`** at the top.
