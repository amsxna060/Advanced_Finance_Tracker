# Codebase Mindmap — Advanced Finance Tracker

> Living index of the entire codebase. Update this file whenever you add, move, rename, or delete anything significant. Treat it as the first thing to read in a new session.
>
> **Last updated:** 2026-04-30 (Property Analytics feature added)

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
| **Money Obligation** | Receivable or payable that isn't a loan; settled by posting against an account. |
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
| `obligations.py` | `/obligations` | CRUD, `POST /{id}/settle` |
| `expenses.py` | `/expenses` | CRUD, `GET /analytics/trends` |
| `categories.py` | `/categories` | CRUD |
| `category_limits.py` | `/category-limits` | CRUD |
| `dashboard.py` | `/dashboard` | `GET /summary`, `GET /quick-links` |
| `analytics.py` | `/analytics` | `/net-worth`, `/expense-trends`, `/money-flow`, `/property` (per-property/plot/partnership money flow + per-partner positions), forecast |
| `reports.py` | `/reports` | `GET /{module}/export` (CSV/Excel) |
| `admin.py` | `/admin` | `POST /mark-legacy`, migration helpers |
| `chatbot.py` | `/chatbot` | `POST /query` (Gemini-backed) |

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

---

## 7. Database Migrations (`backend/alembic/versions/`)

Run in order. The latest is `023_all_tables_raw_sql`.

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
| Analytics | `ExpenseAnalytics`, `Forecast`, `NetWorth`, `Reconciliation`, `PropertyAnalytics` | `/expense-analytics`, `/forecast`, `/net-worth`, `/reconciliation`, `/analytics/property` |
| Reports | `Reports` | `/reports` |
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
