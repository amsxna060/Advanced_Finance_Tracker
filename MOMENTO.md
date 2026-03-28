# 🧠 MOMENTO — Advanced Finance Tracker

> Living knowledge base. Update this file as the project evolves.
> This file is the single source of truth for "where things are, why decisions were made, and what's next."

---

## 📅 Project Started

- Date: 2026-03-18
- Owner: amsxna060I (acting on behalf of father too)
- Purpose: Personal finance tracking for money lending + property dealings business

---

## 🏗️ Current Project State

| Module         | Backend Models | Backend API | Frontend Pages          | Status      |
| -------------- | -------------- | ----------- | ----------------------- | ----------- |
| Auth (JWT)     | ✅ Done        | ✅ Done     | ✅ Login + Dashboard    | ✅ Complete |
| Contacts       | ✅ Done        | ✅ Done     | ✅ List + Detail + Form | ✅ Complete |
| Loans          | ✅ Done        | ✅ Done     | ✅ List + Detail + Form | ✅ Complete |
| Collaterals    | ✅ Done        | ✅ Done     | ✅ Integrated in Loans  | ✅ Complete |
| Property Deals | ✅ Done        | ✅ Done     | ✅ List + Detail + Form | ✅ Complete |
| Partnerships   | ✅ Done        | ✅ Done     | ✅ List + Detail + Form | ✅ Complete |
| Expenses       | ✅ Done        | ✅ Done     | ✅ List + Form          | ✅ Complete |
| Dashboard      | N/A            | ✅ Done     | ✅ Full Dashboard       | ✅ Complete |
| Reports        | N/A            | ✅ Done     | ✅ PDF + Excel Export   | ✅ Complete |
| Beesi (BC/CF)  | ✅ Done        | ✅ Done     | ✅ List + Detail + Form | ✅ Complete |
| Accounts       | ✅ Done        | ✅ Done     | ✅ List + Detail + Form | ✅ Complete |

> **🎉 PHASE 2 COMPLETE - READY FOR TESTING (2026-03-18):**
>
> **System Status:**
>
> - ✅ All Docker containers up and healthy
> - ✅ Database migrated (all 12 tables created)
> - ✅ Admin user seeded: admin/admin123
> - ✅ Frontend accessible: http://localhost:5173
> - ✅ Backend API: http://localhost:8000
> - ✅ API Docs: http://localhost:8000/docs
>
> **Features Complete:**
>
> - ✅ Login flow working with JWT auto-refresh
> - ✅ Contacts module: CRUD + search + filtering + financial summary + **FORM**
> - ✅ Loans module: CRUD + payments + outstanding calculation + **3-STEP WIZARD FORM**
> - ✅ Payment recording with **real-time allocation preview**
> - ✅ Payment allocation (overdue interest → current interest → principal)
> - ✅ Interest capitalization (admin only)
> - ✅ Gold rate API integration with 1-hour cache
> - ✅ Collateral management with auto gold value calculation
> - ✅ All 3 loan types supported (Interest Only, EMI, Short Term)
> - ✅ Form validation and error handling
> - ✅ Responsive design (mobile, tablet, desktop)
>
> **What You Can Do Now:**
>
> - ✅ Login at http://localhost:5173 with admin/admin123
> - ✅ Create contacts using "+ Add Contact" button
> - ✅ Create loans using "+ New Loan" button (3-step wizard)
> - ✅ Record payments with allocation preview
> - ✅ View outstanding balances in real-time
> - ✅ Search and filter contacts and loans
> - ✅ View financial summaries per contact
>
> **Next Steps:**
>
> - 📝 Test all features using TESTING_GUIDE.md
> - 🐛 Fix any issues found during testing
> - 🚀 Start Phase 3 (Property Deals & Partnerships)

> Update this table as you build each piece.

---

## 🗄️ Database

- **Engine**: PostgreSQL 15
- **ORM**: SQLAlchemy 2.0
- **Migrations**: Alembic
- **Connection string**: `postgresql://admin:secret@localhost:5432/finance_tracker` (local dev)

### Migration Commands

```bash
cd backend

# Create new migration after model changes
alembic revision --autogenerate -m "describe_your_change"

# Apply all pending migrations
alembic upgrade head

# Rollback last migration
alembic downgrade -1

# See migration history
alembic history
```

### Tables in Database (in creation order)

1. `users`
2. `contacts`
3. `loans`
4. `loan_payments`
5. `loan_capitalization_events`
6. `collaterals`
7. `property_deals`
8. `property_transactions`
9. `partnerships`
10. `partnership_members`
11. `partnership_transactions`
12. `expenses`
13. `beesis`
14. `beesi_installments`
15. `beesi_withdrawals`
16. `cash_accounts`
17. `account_transactions`

---

## 🔐 Auth System

| Item                 | Value                                   |
| -------------------- | --------------------------------------- |
| Algorithm            | HS256                                   |
| Access token expiry  | 15 minutes                              |
| Refresh token expiry | 7 days                                  |
| Password hashing     | bcrypt (passlib)                        |
| Roles                | admin (full access), viewer (read-only) |
| Default admin        | username: `admin`, password: `admin123` |

### JWT Flow

```
Login → access_token (memory) + refresh_token (localStorage)
API call → Bearer access_token in Authorization header
401 received → auto-call /refresh → get new access_token → retry original request
/refresh fails → logout → redirect to /login
```

---

## 💰 Loan Business Logic

### Loan Types

| Type            | Description                                       | Key Fields                                        |
| --------------- | ------------------------------------------------- | ------------------------------------------------- |
| `interest_only` | Large loan, monthly interest only                 | `interest_rate`, `interest_start_date`            |
| `emi`           | Small loan, fixed monthly EMI                     | `emi_amount`, `tenure_months`, `emi_day_of_month` |
| `short_term`    | Friendly loan, return by date, interest after due | `interest_free_till`, `post_due_interest_rate`    |

### Loan Direction

- `given` = we lent money to someone (receivable)
- `taken` = we borrowed money from someone (payable)

### Interest Calculation (Day-Level Precision)

```
daily_interest = outstanding_principal × (monthly_rate / 100 / 30)
period_interest = daily_interest × number_of_days
```

### Payment Allocation Order (FIXED — cannot change per payment)

```
1. Overdue interest (oldest unpaid interest first)
2. Current period interest (accrued up to payment date)
3. Principal reduction
```

### Interest Capitalization

- **Not automatic** — admin must manually trigger
- System warns when `capitalization_after_months` has elapsed without full interest payment
- On capitalization: `new_principal = current_principal + outstanding_interest`
- Rate stays same (95% of cases), but can be changed on the event record
- Each capitalization is logged in `loan_capitalization_events` table permanently

### Outstanding Calculation (Always Computed, Never Stored)

```python
# Pseudocode
principal_outstanding = original_principal
interest_outstanding = 0

for event in capitalization_events:
    principal_outstanding = event.new_principal    # reset to capitalized amount

for payment in payments (sorted by date):
    # Already allocated at time of payment recording
    principal_outstanding -= payment.allocated_to_principal
    interest_outstanding -= payment.allocated_to_overdue_interest
    interest_outstanding -= payment.allocated_to_current_interest

# Add accrued interest from last payment to today
interest_outstanding += calculate_accrued_interest(principal_outstanding, rate, days_since_last_payment)
```

---

## 🥇 Gold Collateral

### Value Formula

```
value = (carat / 24) × weight_grams × price_per_gram_inr
```

### API Used

- **Source**: goldpricez.com free API
- **Endpoint**: `https://goldpricez.com/api/rates/currency/inr/measure/gram`
- **Cache**: 1 hour in-memory cache (dict with timestamp)
- **Fallback**: If API fails, return `null` → frontend prompts manual entry

### Two-Rate System

| Field                  | Description                                                                     |
| ---------------------- | ------------------------------------------------------------------------------- |
| `gold_calculated_rate` | Auto-computed from formula using live API rate                                  |
| `gold_manual_rate`     | Admin-entered override                                                          |
| `gold_use_manual_rate` | Toggle: TRUE = use manual, FALSE = use calculated                               |
| `estimated_value`      | Final value used for threshold check — always reflects whichever rate is active |

---

## 🏘️ Property Deals

### Status Pipeline

```
negotiating → advance_given → buyer_found → registry_done → settled → cancelled
```

### Deal Types

- `middleman`: We connect seller and buyer, earn spread profit, never own the property
- `purchase_and_hold`: We actually buy and then sell later (rare)

### Profit Calculation

```
gross_profit = total_buyer_value - total_seller_value
net_profit = gross_profit - broker_commission - other_expenses
```

### Key Design Decisions

- Advance paid to seller is a **recoverable deposit** (NOT an expense) — comes back at registry
- All money flows recorded in `property_transactions` table
- Broker commission stored separately on deal record for quick visibility

---

## 🤝 Partnerships

### Our Tracking Philosophy

> We do NOT track the internal expenses or plot-level sales of the partner's deal.
> We only track: **what we put in** and **what we get back**.
> Final P&L = `total_received - our_investment`

### Settlement Process

1. All plots sell / deal closes
2. Partner transfers our share (advance returned + profit share)
3. Record via `partnership_transactions` with `txn_type = received`
4. Mark partnership `status = settled`, set `actual_end_date`

### Member Roles in a Partnership

- `is_self = TRUE` → our entry
- `is_self = FALSE` → other partners (contacts from contacts table)
- Percentages must sum to 100% (validate on create/update)

---

## 🌐 API Structure

- Base URL (local): `http://localhost:8000`
- All routes prefixed with `/api`
- Auto-docs: `http://localhost:8000/docs` (Swagger UI)
- ReDoc: `http://localhost:8000/redoc`
- Auth: `Bearer <access_token>` in `Authorization` header

### Response Format (standard)

```json
{
  "data": { ... },
  "message": "success"
}
```

### Error Format

```json
{
  "detail": "Error description"
}
```

### Pagination (all list endpoints)

```
GET /api/loans?skip=0&limit=20
```

---

## ⚛️ Frontend Structure

### Routing

```
/                     → redirect to /dashboard (if logged in) or /login
/login                → Login.jsx ✅
/dashboard            → Dashboard.jsx ✅
/contacts             → ContactList.jsx ✅
/contacts/:id         → ContactDetail.jsx ✅
/contacts/new         → ContactForm.jsx ✅
/contacts/:id/edit    → ContactForm.jsx ✅
/loans                → LoanList.jsx ✅
/loans/:id            → LoanDetail.jsx ✅
/loans/new            → LoanForm.jsx ✅
/loans/:id/edit       → LoanForm.jsx ✅
/properties           → PropertyList.jsx ✅
/properties/new       → PropertyForm.jsx ✅
/properties/:id       → PropertyDetail.jsx ✅
/properties/:id/edit  → PropertyForm.jsx ✅
/partnerships         → PartnershipList.jsx ✅
/partnerships/new     → PartnershipForm.jsx ✅
/partnerships/:id     → PartnershipDetail.jsx ✅
/partnerships/:id/edit → PartnershipForm.jsx ✅
/expenses             → ExpenseList.jsx ✅
/reports              → Reports.jsx ✅
/beesi                → BeesiList.jsx ✅
/beesi/new            → BeesiForm.jsx ✅
/beesi/:id            → BeesiDetail.jsx ✅
/beesi/:id/edit       → BeesiForm.jsx ✅
/accounts             → AccountList.jsx ✅
/accounts/new         → AccountForm.jsx ✅
/accounts/:id         → AccountDetail.jsx ✅
/accounts/:id/edit    → AccountForm.jsx ✅
```

### State Management

- **Server state**: TanStack Query (all API calls, caching, refetch)
- **Auth state**: React Context (AuthContext)
- **Form state**: React Hook Form + Zod
- **No Redux / Zustand** — not needed at this scale

### Key Utility Functions (`src/lib/utils.js`)

```javascript
formatCurrency(amount); // → "₹1,23,456.00"
formatDate(date); // → "31 Mar 2025"
formatDateInput(date); // → "2025-03-31" (for input[type=date])
cn(...classes); // tailwind-merge + clsx helper
getLoanStatusColor(status); // → tailwind color class
getDaysOverdue(date); // → number of days
```

---

## 🐳 Docker

### Start all services

```bash
docker-compose up --build       # first time
docker-compose up               # subsequent times
docker-compose up -d            # run in background
```

### Stop all services

```bash
docker-compose down
docker-compose down -v          # also delete postgres data volume
```

### Useful commands

```bash
# View backend logs
docker-compose logs -f backend

# Open postgres CLI
docker-compose exec postgres psql -U admin -d finance_tracker

# Rebuild only backend
docker-compose up --build backend

# Run alembic migrations manually inside container
docker-compose exec backend alembic upgrade head
```

### Service Ports

| Service         | Port |
| --------------- | ---- |
| PostgreSQL      | 5432 |
| FastAPI backend | 8000 |
| React frontend  | 5173 |

---

## 📦 Key Dependencies

### Backend

| Package           | Purpose                          |
| ----------------- | -------------------------------- |
| `fastapi`         | Web framework                    |
| `uvicorn`         | ASGI server                      |
| `sqlalchemy`      | ORM                              |
| `alembic`         | DB migrations                    |
| `psycopg2-binary` | PostgreSQL driver                |
| `pydantic`        | Request/response validation      |
| `python-jose`     | JWT encoding/decoding            |
| `passlib[bcrypt]` | Password hashing                 |
| `httpx`           | Async HTTP client (for gold API) |

### Frontend

| Package                 | Purpose                      |
| ----------------------- | ---------------------------- |
| `react-router-dom`      | Client-side routing          |
| `@tanstack/react-query` | Server state, caching        |
| `axios`                 | HTTP client                  |
| `react-hook-form`       | Form management              |
| `zod`                   | Schema validation            |
| `recharts`              | Charts on dashboard          |
| `lucide-react`          | Icons                        |
| `@radix-ui/*`           | Headless UI primitives       |
| `tailwindcss`           | Utility CSS framework        |
| `date-fns`              | Date formatting/manipulation |

---

## 🐛 Known Issues / Decisions Log

| Date       | Decision / Issue                  | Resolution                                                                                         |
| ---------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| 2026-03-18 | Single currency only (INR)        | Confirmed by owner, no multi-currency needed                                                       |
| 2026-03-18 | Capitalization timing             | NOT fixed at 12 months — configurable per loan via `capitalization_after_months` field             |
| 2026-03-18 | Payment allocation order          | FIXED: overdue interest → current interest → principal. No per-payment override                    |
| 2026-03-18 | Large site deal internal tracking | We only track our money in/out — NOT internal expenses or per-plot sales                           |
| 2026-03-18 | Property hold tracking            | Rare case — keep simple: purchase_price, holding_cost, sale_price, sale_date only                  |
| 2026-03-18 | Gold API                          | Using goldpricez.com free API, 1hr cache, fallback to manual entry                                 |
| 2026-03-18 | Auth                              | JWT with roles (admin/viewer). Start single user, expand to multi-user                             |
| 2026-03-18 | Notifications                     | Deferred to future phase — not in initial build                                                    |
| 2026-03-18 | Outstanding balance               | Always computed from payment history — NEVER stored as a column                                    |
| 2026-03-18 | Docker & Database                 | ✅ All services running, database migrated, admin user seeded                                      |
| 2026-03-18 | Backend API                       | ✅ Auth, Contacts, Loans, Collaterals APIs complete with business logic                            |
| 2026-03-18 | Frontend                          | ✅ Contact and Loan pages complete with full CRUD, payment recording, outstanding calculation      |
| 2026-03-18 | Payment Allocation                | ✅ Implemented with preview before record, shows breakdown of overdue/current interest + principal |

---

## 🗺️ Build Phases

### ✅ Phase 0 — Planning & Design

- [x] Business requirements gathered
- [x] All scenarios documented
- [x] Schema finalized
- [x] Tech stack decided

### ✅ Phase 1 — Foundation (COMPLETED 2026-03-18)

- [x] Repo created on GitHub
- [x] Docker Compose working
- [x] PostgreSQL + Alembic migrations configured
- [x] All database models created (User, Contact, Loan, Collateral, PropertyDeal, Partnership, Expense)
- [x] Auth endpoints (login, refresh, me, register)
- [x] Login page in React
- [x] Basic dashboard page
- [x] JWT authentication flow with auto-refresh
- [x] All schemas (Pydantic) created
- [x] Service layer created (interest, gold_price, payment_allocation)

**What's Working:**

- ✅ Docker services defined (postgres, backend, frontend)
- ✅ User can login at http://localhost:5173/login with admin/admin123
- ✅ Dashboard shows authenticated user info
- ✅ Token refresh works automatically on 401
- ✅ All 12 database tables modeled in SQLAlchemy

**Next Steps:**

- [ ] Start Docker and run first migration to create tables
- [ ] Build API endpoints for Contacts CRUD
- [ ] Build API endpoints for Loans CRUD with payment recording
- [ ] Build frontend pages for Contacts and Loans

### ✅ Phase 2 — Core Lending (COMPLETED 2026-03-18)

**Backend APIs:**

- [x] Contacts CRUD with search, pagination, filtering
- [x] Loans CRUD with payment recording
- [x] Outstanding balance calculation API
- [x] Payment preview API (shows allocation before committing)
- [x] Interest capitalization API (admin only)
- [x] EMI schedule generation
- [x] Collateral CRUD with gold rate integration
- [x] Live gold rate API with 1-hour cache
- [x] Business logic services (interest calculation, payment allocation)

**Frontend Pages:**

- [x] ContactList with search, filter by type, responsive grid
- [x] ContactDetail with financial summary (total lent/borrowed, active loans)
- [x] LoanList with filters (direction, type, status, contact)
- [x] LoanDetail with outstanding display, payment history, collateral cards
- [x] Payment recording modal with real-time allocation preview
- [x] Interest capitalization button (admin only)
- [x] Dashboard with quick navigation cards

**Key Features:**

- ✅ Payment allocation follows fixed order: overdue interest → current interest → principal
- ✅ Outstanding calculation uses day-level precision
- ✅ Gold collateral value auto-calculated from live API
- ✅ All CRUD operations with soft deletes
- ✅ Real-time payment preview before recording
- ✅ Role-based access (admin can capitalize interest)

**API Endpoints Created:**

**Auth:**

- POST /api/auth/login
- POST /api/auth/refresh
- POST /api/auth/logout
- POST /api/auth/register
- GET /api/auth/me

**Contacts:**

- GET /api/contacts (search, filter, pagination)
- POST /api/contacts
- GET /api/contacts/{id}
- PUT /api/contacts/{id}
- DELETE /api/contacts/{id}

**Loans:**

- GET /api/loans (filter by direction, type, status, contact)
- POST /api/loans
- GET /api/loans/{id}
- PUT /api/loans/{id}
- DELETE /api/loans/{id}
- GET /api/loans/{id}/outstanding
- POST /api/loans/{id}/payments
- GET /api/loans/{id}/payment-preview
- POST /api/loans/{id}/capitalize
- GET /api/loans/{id}/schedule

**Collaterals:**

- GET /api/loans/{loan_id}/collaterals
- POST /api/loans/{loan_id}/collaterals
- PUT /api/collaterals/{id}
- DELETE /api/collaterals/{id}
- GET /api/collaterals/{id}/gold-rate

### 🔴 Phase 3 — Property & Partnerships

- [ ] Property deals CRUD (backend + frontend)
- [ ] Property transactions (backend + frontend)
- [ ] Partnership tracking (backend + frontend)
- [ ] Partnership transactions (backend + frontend)

### 🔴 Phase 4 — Dashboard & Reports

- [ ] Dashboard summary API
- [ ] Dashboard UI with charts
- [ ] Alerts (overdue, collateral warning, capitalization due)
- [ ] Expenses module

### 🔴 Phase 5 — Polish & Deploy

- [ ] Notifications (deferred)
- [ ] PDF reports (deferred)
- [ ] AWS deployment
- [ ] React Native mobile app

---

## ✅ Phase 7 — Beesi, Accounts, Enhanced Dashboard (2026-03-19)

> Added three new feature areas: Beesi (chit fund) tracking, Cash/Bank account ledger, and a significantly richer dashboard with monthly EMI metrics and payment behavior analytics.

### New Backend

- `backend/app/models/beesi.py` — Beesi + BeesiInstallment + BeesiWithdrawal models
- `backend/app/models/cash_account.py` — CashAccount + AccountTransaction models
- `backend/app/routers/beesi.py` — Full CRUD + installments + withdrawal + P&L summary
- `backend/app/routers/accounts.py` — Full CRUD + transaction ledger + running balance
- `backend/app/routers/dashboard.py` — Added `GET /api/dashboard/this-month` + `GET /api/dashboard/payment-behavior`; summary now includes `active_beesis` + `beesi_total_invested`
- `backend/app/main.py` — registered `beesi` + `accounts` routers
- `backend/alembic/versions/004_add_beesi_and_accounts.py` — migration for 5 new tables

### New Frontend

- `frontend/src/pages/Beesi/BeesiList.jsx` — card grid with progress bar + P&L badge + status filter
- `frontend/src/pages/Beesi/BeesiForm.jsx` — create/edit form
- `frontend/src/pages/Beesi/BeesiDetail.jsx` — summary cards + inline installment log + pot withdrawal form
- `frontend/src/pages/Accounts/AccountList.jsx` — total balance banner + account cards
- `frontend/src/pages/Accounts/AccountForm.jsx` — create/edit form
- `frontend/src/pages/Accounts/AccountDetail.jsx` — running balance ledger + inline transaction form

### Modified Frontend

- `frontend/src/App.jsx` — added 8 new routes for Beesi + Accounts
- `frontend/src/pages/Dashboard.jsx` — Beesi + Accounts quick links; new metric cards for EMIs this month, overdue interest, Beesi invested; payment behavior table
- `frontend/src/pages/Loans/LoanList.jsx` — search now also matches `institution_name`, `loan_type`, loan ID, and `principal_amount`

---

## ✅ Phase 6 — Comprehensive Bug Fixes & Auto-Calculations (2026-03-18)

> Major fix pass addressing field name mismatches, broken data flows, and adding smart auto-calculations.

### Backend Fixes

1. **LoanOut schema**: Added `ContactBrief` (id, name, phone, city) embedded in `LoanOut` so loan list shows contact info
2. **Loan list query**: Added `joinedload(Loan.contact)` to eagerly load contacts in GET /api/loans
3. **LoanOut**: Added `is_deleted` field to schema

### Backend — Critical Serialization Fixes (SQLAlchemy → Pydantic)

> **Root cause**: FastAPI's `response_model=dict` cannot auto-serialize raw SQLAlchemy ORM objects nested inside dict responses. Must call `.model_validate()` explicitly.

4. **loans.py** GET /{id}: Added `CollateralOut` import. Serialized `contact` with `ContactBrief.model_validate()`, `collaterals` with `[CollateralOut.model_validate(c) for c in collaterals]` — was causing 500 "Failed to load loan" error
5. **property_deals.py** GET /{id}: Added `ContactBrief` + `PartnershipOut` imports. Serialized `seller`, `buyer` with `ContactBrief.model_validate()`, `partnerships` with `[PartnershipOut.model_validate(p) for p in linked_partnerships]` — was causing 500 "Failed to load property" error
6. **partnerships.py** GET /{id}: Added `PropertyDealOut` + `ContactBrief` imports. Serialized `linked_property` with `PropertyDealOut.model_validate()`, member `contact` with `ContactBrief.model_validate()` — was causing 500 "Failed to load partnership" error
7. **loans.py** POST "" (create): Removed `interest_rate` requirement for `emi` (needs emi_amount + tenure_months) and `short_term` (needs interest_free_till only). `interest_rate` only required for `interest_only` type.

### Frontend — Loan Fixes

8. **LoanList.jsx**: Fixed filter param `type` → `loan_type`, field names `direction` → `loan_direction`, `type` → `loan_type`, `start_date` → `disbursed_date`, interest rate label "% p.a." → "% /mo"
9. **LoanDetail.jsx**: Fixed data destructuring — API returns `{loan, contact, outstanding, payments, collaterals}`, not flat object. Fixed payment recording (`amount` → `amount_paid`), payment preview param (`payment_amount` → `amount`), preview display fields (`principal_paid` → `allocated_to_principal`, etc.), capitalize request (`capitalization_date` → `event_date`), all field name references throughout
10. **LoanForm.jsx**: `interest_rate` only included in payload if non-empty; only validated for `interest_only` type. EMI validates `emi_amount` + `tenure_months`. Short-term validates `interest_free_till` only.

### Frontend — Contact Fixes

11. **ContactForm.jsx**: Fixed edit mode to extract `response.data.contact` from nested `{contact, summary}` response. Added all schema fields (`alternate_phone`, `relationship_type`, `is_handshake`). Fixed `contact_type` options from "borrower/lender" to "individual/institution". Added relationship_type dropdown (7 options). Added is_handshake checkbox.

### Frontend — Property Deal Fixes

12. **PropertyForm.jsx**: Added auto-calculation with `useEffect`:
    - `total_seller_value = seller_rate_per_sqft × total_area_sqft` (auto, read-only)
    - `total_buyer_value = buyer_rate_per_sqft × total_area_sqft` (auto, read-only)
    - `gross_profit = total_buyer_value − total_seller_value` (middleman) or `sale_price − purchase_price` (hold)
    - `net_profit = gross_profit − broker_commission` (middleman) or `gross_profit − holding_cost` (hold)
    - Buyer section marked as optional ("fill when buyer is found")
    - Auto-calc fields shown with blue "(auto)" labels and gray read-only styling
13. **PropertyDetail.jsx**: Added `isError` handling with `retry: 2`, added seller/buyer rate & value display in deal details

### Frontend — Partnership Fixes

14. **PartnershipForm.jsx**: Complete auto-fill and partner management rewrite:
    - `total_deal_value` now auto-fills from `net_profit − advance_paid` (distributable profit), not `total_seller_value`
    - Field label changes to "Net Profit to Distribute (net profit − advance paid, auto)" when property linked
    - Linked property profit summary card: Gross Profit, Net Profit, Distributable (after advance), Our Share
    - `linkedPropertyProfit` includes `distributable` = max(0, net_profit − advance_paid)
    - **Inline Partner Members section** (create mode only):
      - "+ Add Partner" button adds rows with: Contact (dropdown), Share %, Advance Given, Notes, Remove (×)
      - On submit: after partnership created, bulk-posts each partner to `POST /api/partnerships/{id}/members`
      - Skips rows with no `contact_id`
      - Empty state: helpful message "You can also add them after creating the partnership"
    - Contacts loaded via `useQuery(["contacts"])` for the partner select dropdowns
15. **PartnershipDetail.jsx**: Added `isError` handling with `retry: 2`

### Navigation & Error Handling Fixes

16. **All Detail Pages** (Loan, Contact, Property, Partnership): Added `isError` handling to distinguish "not found" from "failed to load"
17. **PropertyForm + PartnershipForm**: Fixed `onSuccess` handler — in create mode, uses `data.id`; in edit mode, uses `id` from params. Fixed `invalidateQueries` to only invalidate specific keys in edit mode.
18. **ContactDetail.jsx**: Added `isError` + `retry: 2`

### Key Field Name Mappings (Backend ↔ Frontend)

| Backend Field                             | Frontend Was Using    | Fixed To                  |
| ----------------------------------------- | --------------------- | ------------------------- |
| `loan_direction`                          | `direction`           | ✅ `loan_direction`       |
| `loan_type`                               | `type`                | ✅ `loan_type`            |
| `disbursed_date`                          | `start_date`          | ✅ `disbursed_date`       |
| `expected_end_date`                       | `maturity_date`       | ✅ `expected_end_date`    |
| `emi_day_of_month`                        | `emi_day`             | ✅ `emi_day_of_month`     |
| `amount_paid`                             | `amount` (payment)    | ✅ `amount_paid`          |
| `allocated_to_principal`                  | `principal_paid`      | ✅ `allocated_to_*`       |
| `event_date`                              | `capitalization_date` | ✅ `event_date`           |
| `collateral_type`                         | `type` (collateral)   | ✅ `collateral_type`      |
| `contact_type` (individual/institution)   | (borrower/lender)     | ✅ individual/institution |
| `relationship_type` (borrower/lender/...) | (was missing)         | ✅ Added                  |

### Important: Partnership total_deal_value Meaning

> `total_deal_value` in PartnershipCreate = the **distributable** portion of the property profit.
> Formula: `net_profit (from PropertyDeal) − advance_paid (already disbursed)`
> This is what gets divided among partners by their `share_percentage`.
> The `PartnershipMemberCreate.advance_contributed` field = how much that partner gave upfront.

---

## 🏦 Beesi (BC / Chit Fund) Tracking

### What is a Beesi / BC?

A BC (Beesi Committee) is a rotating savings pool. N members each pay a fixed monthly installment. Each month, one member claims the pot (usually by bidding — the person who agrees to take the smallest discount wins). The difference between the full pot and the discounted amount is split among all members as a **dividend** (reducing their next installment).

### Key Calculations

```
actual_paid (per month) = base_installment - dividend_received
```

If you win the pot early:

```
net_received = gross_amount (pot_size) - discount_offered
```

Profit/Loss at any point:

```
profit_loss = total_withdrawn - total_invested
total_invested = sum of actual_paid across all installments
total_withdrawn = net_received on pot claim
```

### Business Rules

- Only **one withdrawal** allowed per Beesi (the pot can only be claimed once)
- `profit_loss_pct = profit_loss / total_invested × 100`
- If you take the pot early and receive dividends after, `total_invested` keeps growing → `profit_loss` narrows over time
- If you take the pot late (after paying many installments), your return is higher

### Database Tables

- `beesis` — one row per committee pool
- `beesi_installments` — one row per monthly payment paid
- `beesi_withdrawals` — one row when the pot is claimed (max 1 per beesi)

### API Endpoints

- `GET /api/beesi` — list with `?status=active|completed|cancelled`
- `POST /api/beesi` — create (admin)
- `GET /api/beesi/{id}` — detail with installments + withdrawal + P&L
- `PUT /api/beesi/{id}` — update (admin)
- `DELETE /api/beesi/{id}` — soft delete (admin)
- `GET /api/beesi/{id}/installments` — list installments
- `POST /api/beesi/{id}/installments` — log monthly payment
- `DELETE /api/beesi/{id}/installments/{inst_id}` — remove (admin)
- `POST /api/beesi/{id}/withdraw` — record pot claim
- `GET /api/beesi/{id}/summary` — P&L summary

---

## 💳 Cash & Bank Accounts (Liquidity Tracking)

### Purpose

Track named accounts (cash at home, savings accounts, current accounts, wallets like GPay) with a full debit/credit ledger.

### Account Types

`cash | savings | current | wallet | fixed_deposit`

### Balance Calculation

```
current_balance = opening_balance + sum(credits) - sum(debits)
```

Always computed from transaction history — never stored as a column. Consistent with the pattern used for loan outstanding.

### Transaction Linking

Each transaction can optionally link to another module:

- `linked_type`: `loan | property | partnership | beesi | expense | manual`
- `linked_id`: The ID in that module's table

This allows traceability: e.g., a ₹50,000 debit could link to `loan #12` as a disbursement.

### API Endpoints

- `GET /api/accounts` — list with `current_balance` computed per account
- `POST /api/accounts` — create (admin)
- `GET /api/accounts/{id}` — detail with all transactions
- `PUT /api/accounts/{id}` — update (admin)
- `DELETE /api/accounts/{id}` — soft delete (admin)
- `GET /api/accounts/{id}/transactions` — list (limit 1–1000, default 200)
- `POST /api/accounts/{id}/transactions` — record credit/debit
- `DELETE /api/accounts/transactions/{txn_id}` — remove (admin)

---

## 📊 Enhanced Dashboard (Phase 7)

### New Endpoints Added

- `GET /api/dashboard/this-month` — EMIs expected/collected/pending + interest expected/collected + overdue interest for current calendar month
- `GET /api/dashboard/payment-behavior` — Per-borrower payment scoring based on payment regularity

### Payment Behavior Scoring Logic

```
months_active = months from disbursed_date to today
payment_rate = payments_made / months_active × 100

GOOD:       payments_made >= months_active AND days_since_payment <= 35
BAD:        payments_made == 0 OR days_since_payment > 90
IRREGULAR:  everything else
```

Results sorted: Bad first → Irregular → Good (worst offenders visible at top)

### Dashboard Summary Now Includes

- `active_beesis` — count of active Beesi pools
- `beesi_total_invested` — sum of all installments paid across all Beesis

---

| Person                  | Role in System                     | Contact Type                              |
| ----------------------- | ---------------------------------- | ----------------------------------------- |
| Owner (you)             | Admin user, creates all entries    | User (not contact)                        |
| Father                  | Admin user, co-manages             | User                                      |
| Kanhaiya (example)      | Borrower — big loan 12L @ 2%/month | Contact → Loan (interest_only, given)     |
| Ram Shankar (example)   | Property partner                   | Contact → Partnership member              |
| Bajaj Finance (example) | Institution lender                 | Contact (institution) → Loan (emi, taken) |

---

> 📝 **Update this file** every time you:
>
> - Add a new table or column
> - Make a major architectural decision
> - Complete a phase or module
> - Discover a bug or edge case with a fix
> - Change a business rule
