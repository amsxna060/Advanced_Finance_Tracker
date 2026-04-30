# 🏦 Advanced Finance Tracker — Full Application Build Prompt

## Overview

Build a full-stack personal finance management web application called **Advanced Finance Tracker**.
This is a real-world tool for a money lender and property dealer to track:
- Money lent to people (with interest, EMI, or short-term)
- Money borrowed from people or institutions
- Property dealings (middleman flips, site deals)
- Partnerships in property deals
- General expenses

The application must be **robust, production-ready in architecture**, start on localhost,
and be deployable to AWS later. It must also be general enough to be useful for others
(multi-user, role-based, clean UI).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TailwindCSS + shadcn/ui |
| State & API | TanStack Query (React Query v5) |
| Forms | React Hook Form + Zod validation |
| Charts | Recharts |
| Backend | FastAPI (Python 3.11+) |
| ORM | SQLAlchemy 2.0 + Alembic (migrations) |
| Database | PostgreSQL 15 |
| Auth | JWT (access token 15min + refresh token 7 days) + bcrypt |
| Dev Environment | Docker Compose (3 services: postgres, backend, frontend) |
| Future | React Native (mobile), AWS EC2 + RDS |

---

## Project Structure

```
Advanced_Finance_Tracker/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── README.md
├── PROMPT.md                        ← this file
├── MOMENTO.md                       ← running knowledge base / state tracker
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/                ← auto-generated migration files go here
│   └── app/
│       ├── main.py                  ← FastAPI app init, CORS, router includes
│       ├── database.py              ← SQLAlchemy engine, session, Base
│       ├── dependencies.py          ← get_db, get_current_user, require_admin
│       ├── config.py                ← pydantic-settings Config class
│       ├── models/
│       │   ├── __init__.py          ← import all models here (for Alembic)
│       │   ├── user.py
│       │   ├── contact.py
│       │   ├── loan.py
│       │   ├── collateral.py
│       │   ├── property_deal.py
│       │   ├── partnership.py
│       │   └── expense.py
│       ├── schemas/
│       │   ├── __init__.py
│       │   ├── auth.py
│       │   ├── contact.py
│       │   ├── loan.py
│       │   ├── collateral.py
│       │   ├── property_deal.py
│       │   ├── partnership.py
│       │   └── expense.py
│       ├── routers/
│       │   ├── __init__.py
│       │   ├── auth.py
│       │   ├── contacts.py
│       │   ├── loans.py
│       │   ├── collateral.py
│       │   ├── property_deals.py
│       │   ├── partnerships.py
│       │   ├── expenses.py
│       │   └── dashboard.py
│       └── services/
│           ├── __init__.py
│           ├── interest.py
│           ├── gold_price.py
│           └── payment_allocation.py
│
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css
        ├── lib/
        │   ├── api.js               ← axios instance, JWT interceptors, auto-refresh
        │   └── utils.js             ← formatCurrency, formatDate, cn() helpers
        ├── contexts/
        │   └── AuthContext.jsx      ← login/logout/user state
        ├── hooks/
        │   ├── useAuth.js
        │   └── useApi.js
        ├── components/
        │   ├── ui/                  ← shadcn base components (Button, Input, Dialog etc.)
        │   ├── Layout.jsx           ← sidebar + topbar shell
        │   ├── Sidebar.jsx
        │   ├── Navbar.jsx
        │   ├── ProtectedRoute.jsx
        │   ├── AlertBanner.jsx      ← overdue/collateral warning alerts
        │   └── QuickEntryFAB.jsx    ← floating action button for quick payment entry
        └── pages/
            ├── Login.jsx
            ├── Dashboard.jsx
            ├── Contacts/
            │   ├── ContactList.jsx
            │   └── ContactDetail.jsx
            ├── Loans/
            │   ├── LoanList.jsx
            │   ├── LoanDetail.jsx
            │   └── LoanForm.jsx
            ├── Properties/
            │   ├── PropertyList.jsx
            │   ├── PropertyDetail.jsx
            │   └── PropertyForm.jsx
            ├── Partnerships/
            │   ├── PartnershipList.jsx
            │   ├── PartnershipDetail.jsx
            │   └── PartnershipForm.jsx
            └── Expenses/
                └── ExpenseList.jsx
```

---

## Database Schema — Complete

### Key Design Principles
- All monetary amounts: `DECIMAL(15,2)` — never use float
- All dates: `DATE` type (not timestamp) unless it's an audit field
- Soft deletes everywhere: `is_deleted BOOLEAN DEFAULT FALSE`
- Outstanding balances are NEVER stored — always computed from payment history
- All list endpoints support pagination: `skip` (offset) and `limit`

---

### Table: `users`

```sql
id              SERIAL PRIMARY KEY
username        VARCHAR(100) UNIQUE NOT NULL
email           VARCHAR(255) UNIQUE NOT NULL
password_hash   VARCHAR(255) NOT NULL
full_name       VARCHAR(255)
role            VARCHAR(20) DEFAULT 'viewer'   -- 'admin' | 'viewer'
is_active       BOOLEAN DEFAULT TRUE
created_at      TIMESTAMP DEFAULT NOW()
updated_at      TIMESTAMP DEFAULT NOW()
```

---

### Table: `contacts`

One record per person or institution you deal with.
Same person can be borrower + partner + property contact — single record, relationship_type = 'mixed'.

```sql
id                  SERIAL PRIMARY KEY
name                VARCHAR(255) NOT NULL
phone               VARCHAR(20)
alternate_phone     VARCHAR(20)
address             TEXT
city                VARCHAR(100)
contact_type        VARCHAR(20) DEFAULT 'individual'   -- 'individual' | 'institution'
relationship_type   VARCHAR(30) DEFAULT 'borrower'
                    -- borrower | lender | partner | agent | buyer | seller | mixed
is_handshake        BOOLEAN DEFAULT FALSE   -- trust-based, no formal agreement
notes               TEXT
is_deleted          BOOLEAN DEFAULT FALSE
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

---

### Table: `loans`

Handles ALL lending scenarios:
- `interest_only`: Large loan, monthly interest collected, principal returned at end
- `emi`: Small loan, fixed EMI each month covers principal + interest
- `short_term`: Friendly loan, full return expected by a date, interest may kick in after due

```sql
id                          SERIAL PRIMARY KEY
contact_id                  INT REFERENCES contacts(id) NOT NULL
created_by                  INT REFERENCES users(id) NOT NULL

-- Classification
loan_direction              VARCHAR(10) NOT NULL   -- 'given' (we lent) | 'taken' (we borrowed)
loan_type                   VARCHAR(20) NOT NULL   -- 'interest_only' | 'emi' | 'short_term'

-- Core amounts
principal_amount            DECIMAL(15,2) NOT NULL
disbursed_date              DATE NOT NULL

-- Interest configuration
interest_rate               DECIMAL(6,3)           -- % per MONTH (e.g., 2.000 = 2%)
interest_start_date         DATE                   -- usually = disbursed_date
interest_free_till          DATE                   -- short_term: no interest until this date
post_due_interest_rate      DECIMAL(6,3)           -- short_term: rate after interest_free_till passes

-- EMI configuration (only for loan_type = 'emi')
emi_amount                  DECIMAL(15,2)
tenure_months               INT
emi_day_of_month            INT                    -- e.g. 5 = EMI due on 5th of each month

-- Interest capitalization
capitalization_enabled      BOOLEAN DEFAULT FALSE
capitalization_after_months INT                    -- configurable per loan, NOT fixed at 12
last_capitalization_date    DATE

-- For loans taken from institutions (Bajaj, CRED etc.)
institution_name            VARCHAR(255)
institution_loan_id         VARCHAR(100)

-- Status
status                      VARCHAR(20) DEFAULT 'active'
                            -- active | closed | defaulted | on_hold
expected_end_date           DATE
actual_end_date             DATE

notes                       TEXT
is_deleted                  BOOLEAN DEFAULT FALSE
created_at                  TIMESTAMP DEFAULT NOW()
updated_at                  TIMESTAMP DEFAULT NOW()
```

**Multiple loans to same contact**: Each disbursement is a separate loan record linked via `contact_id`.
No separate tranche table needed — query `loans WHERE contact_id = X` to see all dealings with a person.

---

### Table: `loan_payments`

Every payment made (or received) against a loan.
Payment allocation order is FIXED: overdue interest first → current interest → principal.

```sql
id                              SERIAL PRIMARY KEY
loan_id                         INT REFERENCES loans(id) NOT NULL
payment_date                    DATE NOT NULL
amount_paid                     DECIMAL(15,2) NOT NULL

-- Auto-calculated allocation breakdown (computed by payment_allocation service)
allocated_to_overdue_interest   DECIMAL(15,2) DEFAULT 0
allocated_to_current_interest   DECIMAL(15,2) DEFAULT 0
allocated_to_principal          DECIMAL(15,2) DEFAULT 0

payment_mode                    VARCHAR(30)    -- cash | upi | bank_transfer | cheque
collected_by                    VARCHAR(100)   -- who physically collected (for cash)
reference_number                VARCHAR(100)   -- UPI txn ID, cheque number etc.
notes                           TEXT
created_by                      INT REFERENCES users(id)
created_at                      TIMESTAMP DEFAULT NOW()
```

---

### Table: `loan_capitalization_events`

When unpaid/accumulated interest is added to principal (capitalized).
This is a manual action — admin reviews and triggers it.
System warns when `capitalization_after_months` has passed since last payment or since loan start.

```sql
id                              SERIAL PRIMARY KEY
loan_id                         INT REFERENCES loans(id) NOT NULL
event_date                      DATE NOT NULL
outstanding_interest_before     DECIMAL(15,2) NOT NULL
principal_before                DECIMAL(15,2) NOT NULL
new_principal                   DECIMAL(15,2) NOT NULL   -- principal_before + outstanding_interest_before
interest_rate_after             DECIMAL(6,3)             -- usually same, but can change
notes                           TEXT
created_by                      INT REFERENCES users(id)
created_at                      TIMESTAMP DEFAULT NOW()
```

---

### Table: `collaterals`

Security/guarantee held against a loan.

```sql
id                      SERIAL PRIMARY KEY
loan_id                 INT REFERENCES loans(id) NOT NULL
collateral_type         VARCHAR(30) NOT NULL   -- house | gold | vehicle | land | other
description             TEXT

-- Value tracking
estimated_value         DECIMAL(15,2)          -- final value used for threshold check
warning_threshold_pct   DECIMAL(5,2) DEFAULT 75.0   -- alert when outstanding > X% of this value

-- Gold-specific fields (only populated when collateral_type = 'gold')
gold_carat              INT                    -- 18, 22, or 24
gold_weight_grams       DECIMAL(8,3)
gold_calculated_rate    DECIMAL(15,2)          -- auto: (carat/24) * weight * live_price_per_gram
gold_manual_rate        DECIMAL(15,2)          -- manually overridden by user
gold_use_manual_rate    BOOLEAN DEFAULT FALSE  -- TRUE = use manual_rate, FALSE = use calculated_rate
gold_rate_fetched_at    TIMESTAMP              -- when was live rate last fetched

-- Photo
photo_url               TEXT                   -- local path now, S3 URL in future
photo_uploaded_at       TIMESTAMP

notes                   TEXT
created_at              TIMESTAMP DEFAULT NOW()
updated_at              TIMESTAMP DEFAULT NOW()
```

**Gold value formula**: `estimated_value = (gold_carat / 24.0) * gold_weight_grams * price_per_gram`
- `price_per_gram` from live API (goldpricez.com, cached 1 hour) if `gold_use_manual_rate = FALSE`
- `estimated_value = gold_manual_rate` if `gold_use_manual_rate = TRUE`

**Collateral warning trigger**: `loan.total_outstanding > collateral.estimated_value * (warning_threshold_pct / 100)`

---

### Table: `property_deals`

Tracks a property deal from negotiation through to settlement.

```sql
id                      SERIAL PRIMARY KEY
title                   VARCHAR(255) NOT NULL   -- "1000sqft Plot, Green Valley, Sector 5"
location                TEXT
property_type           VARCHAR(50)             -- plot | site | flat | commercial | agricultural
total_area_sqft         DECIMAL(12,2)

-- Deal type
deal_type               VARCHAR(20) DEFAULT 'middleman'   -- 'middleman' | 'purchase_and_hold'

-- People
seller_contact_id       INT REFERENCES contacts(id)
buyer_contact_id        INT REFERENCES contacts(id)

-- Pricing (for middleman deals)
seller_rate_per_sqft    DECIMAL(12,2)
buyer_rate_per_sqft     DECIMAL(12,2)
total_seller_value      DECIMAL(15,2)          -- seller_rate * area (or manual override)
total_buyer_value       DECIMAL(15,2)          -- buyer_rate * area (or manual override)

-- Advance/token to seller
advance_paid            DECIMAL(15,2) DEFAULT 0
advance_date            DATE

-- Timeline
deal_locked_date        DATE
expected_registry_date  DATE
actual_registry_date    DATE

-- Profit tracking
broker_name             VARCHAR(255)
broker_commission       DECIMAL(15,2) DEFAULT 0
gross_profit            DECIMAL(15,2)          -- buyer_value - seller_value (computed or manual)
net_profit              DECIMAL(15,2)          -- gross_profit - broker_commission - other expenses

-- For purchase_and_hold type only
purchase_price          DECIMAL(15,2)
holding_cost            DECIMAL(15,2) DEFAULT 0
sale_price              DECIMAL(15,2)
sale_date               DATE

-- Status pipeline
status                  VARCHAR(30) DEFAULT 'negotiating'
                        -- negotiating | advance_given | buyer_found | registry_done | settled | cancelled

notes                   TEXT
is_deleted              BOOLEAN DEFAULT FALSE
created_at              TIMESTAMP DEFAULT NOW()
updated_at              TIMESTAMP DEFAULT NOW()
created_by              INT REFERENCES users(id)
```

---

### Table: `property_transactions`

Every money movement in a property deal.

```sql
id                      SERIAL PRIMARY KEY
property_deal_id        INT REFERENCES property_deals(id) NOT NULL
txn_type                VARCHAR(50) NOT NULL
                        -- advance_to_seller | payment_to_seller | received_from_buyer
                        -- commission_paid | expense | refund | sale_proceeds | other
amount                  DECIMAL(15,2) NOT NULL
txn_date                DATE NOT NULL
payment_mode            VARCHAR(30)
description             TEXT
created_by              INT REFERENCES users(id)
created_at              TIMESTAMP DEFAULT NOW()
```

---

### Table: `partnerships`

Tracks our stake in a property deal run by someone else, OR a joint deal we run together.
Key principle: We do NOT track the internal expenses of the deal — we only track what we put in
and what we get back. Final net = total_received - our_investment.

```sql
id                          SERIAL PRIMARY KEY
title                       VARCHAR(255) NOT NULL     -- "6% stake in Ramesh's 20000sqft Site"
linked_property_deal_id     INT REFERENCES property_deals(id)   -- optional

total_deal_value            DECIMAL(15,2)             -- full deal value (for reference)
our_investment              DECIMAL(15,2) DEFAULT 0   -- total advance/money we put in
our_share_percentage        DECIMAL(6,3)              -- e.g. 6.000 for 6%

total_received              DECIMAL(15,2) DEFAULT 0   -- sum of all money received back
-- Net P&L = total_received - our_investment  (simple, no internal expense tracking)

start_date                  DATE
expected_end_date           DATE
actual_end_date             DATE

status                      VARCHAR(30) DEFAULT 'active'   -- active | settled | cancelled

notes                       TEXT
is_deleted                  BOOLEAN DEFAULT FALSE
created_at                  TIMESTAMP DEFAULT NOW()
updated_at                  TIMESTAMP DEFAULT NOW()
created_by                  INT REFERENCES users(id)
```

---

### Table: `partnership_members`

For deals where multiple partners are involved (us + others).
Use `is_self = TRUE` for our own stake entry.

```sql
id                      SERIAL PRIMARY KEY
partnership_id          INT REFERENCES partnerships(id) NOT NULL
contact_id              INT REFERENCES contacts(id)    -- NULL if is_self = TRUE
is_self                 BOOLEAN DEFAULT FALSE          -- TRUE = this is our entry
share_percentage        DECIMAL(6,3) NOT NULL
advance_contributed     DECIMAL(15,2) DEFAULT 0
total_received          DECIMAL(15,2) DEFAULT 0
notes                   TEXT
```

---

### Table: `partnership_transactions`

Every money movement in a partnership (money we gave, money we received).

```sql
id                      SERIAL PRIMARY KEY
partnership_id          INT REFERENCES partnerships(id) NOT NULL
member_id               INT REFERENCES partnership_members(id)
txn_type                VARCHAR(30) NOT NULL
                        -- invested | received | expense | profit_distributed
amount                  DECIMAL(15,2) NOT NULL
txn_date                DATE NOT NULL
payment_mode            VARCHAR(30)
description             TEXT
created_by              INT REFERENCES users(id)
created_at              TIMESTAMP DEFAULT NOW()
```

---

### Table: `expenses`

General or deal-linked expenses.

```sql
id              SERIAL PRIMARY KEY
category        VARCHAR(100)        -- travel | legal | registration | office | commission | misc
amount          DECIMAL(15,2) NOT NULL
expense_date    DATE NOT NULL
linked_type     VARCHAR(30)         -- loan | property | partnership | general
linked_id       INT                 -- ID of the linked record (nullable for general expenses)
description     TEXT
payment_mode    VARCHAR(30)
receipt_url     TEXT
created_by      INT REFERENCES users(id)
created_at      TIMESTAMP DEFAULT NOW()
```

---

## Authentication System

### JWT Flow
```
POST /api/auth/login       → { access_token (15min), refresh_token (7 days) }
POST /api/auth/refresh     → { new access_token }
POST /api/auth/logout      → invalidate refresh token
GET  /api/auth/me          → current user profile
POST /api/auth/register    → admin only, creates new user
```

### Roles
- `admin` → full CRUD on everything
- `viewer` → GET requests only, cannot create/update/delete

### Frontend Token Handling
- Store `access_token` in memory (React state/context)
- Store `refresh_token` in `localStorage`
- Axios interceptor: on 401, auto-call `/refresh`, retry original request
- On refresh failure: logout and redirect to login

---

## All API Endpoints

### Auth
```
POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/logout
GET    /api/auth/me
POST   /api/auth/register          (admin only)
```

### Contacts
```
GET    /api/contacts               ?search=name&type=&skip=0&limit=20
POST   /api/contacts
GET    /api/contacts/{id}          returns: contact info + summary (total lent, outstanding, deal count)
PUT    /api/contacts/{id}
DELETE /api/contacts/{id}          soft delete
```

### Loans
```
GET    /api/loans                  ?direction=given|taken&type=&status=&contact_id=&skip=0&limit=20
POST   /api/loans
GET    /api/loans/{id}             returns: loan + payments + outstanding calculation + collaterals
PUT    /api/loans/{id}
DELETE /api/loans/{id}             soft delete

POST   /api/loans/{id}/payments            record a payment (returns allocation preview + commits)
GET    /api/loans/{id}/payments            payment history
GET    /api/loans/{id}/outstanding         {principal_outstanding, interest_outstanding, total, as_of_date}
GET    /api/loans/{id}/payment-preview     ?amount=X → show allocation before committing
POST   /api/loans/{id}/capitalize          trigger capitalization event (admin only)
GET    /api/loans/{id}/schedule            expected schedule (for EMI type)
```

### Collaterals
```
GET    /api/loans/{id}/collaterals
POST   /api/loans/{id}/collaterals
PUT    /api/collaterals/{id}
DELETE /api/collaterals/{id}
GET    /api/collaterals/{id}/gold-rate     fetch live rate + return {calculated, manual, use_manual}
```

### Property Deals
```
GET    /api/properties             ?status=&type=&skip=0&limit=20
POST   /api/properties
GET    /api/properties/{id}        returns: deal + all transactions + partners + profit summary
PUT    /api/properties/{id}
DELETE /api/properties/{id}        soft delete

POST   /api/properties/{id}/transactions
GET    /api/properties/{id}/transactions
GET    /api/properties/{id}/profit-summary   {gross, net, per_partner_share}
```

### Partnerships
```
GET    /api/partnerships           ?status=&skip=0&limit=20
POST   /api/partnerships
GET    /api/partnerships/{id}      returns: partnership + members + transactions + our P&L
PUT    /api/partnerships/{id}
DELETE /api/partnerships/{id}      soft delete

POST   /api/partnerships/{id}/transactions
GET    /api/partnerships/{id}/transactions
POST   /api/partnerships/{id}/members
PUT    /api/partnerships/{id}/settle       mark settled, record final received amounts
```

### Expenses
```
GET    /api/expenses               ?category=&linked_type=&from_date=&to_date=&skip=0&limit=20
POST   /api/expenses
PUT    /api/expenses/{id}
DELETE /api/expenses/{id}
```

### Dashboard
```
GET    /api/dashboard/summary      key metrics (see below)
GET    /api/dashboard/alerts       overdue, collateral warnings, capitalization due
GET    /api/dashboard/cashflow     monthly inflow/outflow for last 12 months
```

**Dashboard Summary Response:**
```json
{
  "total_lent_out": 0,
  "total_outstanding_receivable": 0,
  "total_borrowed": 0,
  "total_outstanding_payable": 0,
  "net_position": 0,
  "expected_this_month": 0,
  "total_overdue": 0,
  "active_property_deals": 0,
  "active_partnerships": 0,
  "total_partnership_invested": 0,
  "total_partnership_received": 0
}
```

---

## Business Logic — Services

### `services/interest.py`

```python
# calculate_outstanding(loan_id, as_of_date, db)
#   → { principal_outstanding, interest_outstanding, total_outstanding }
#   Algorithm:
#     1. Start with original principal_amount from loan
#     2. Apply all capitalization events (increases principal)
#     3. Subtract all principal payments
#     4. Calculate daily interest from interest_start_date to as_of_date
#        using outstanding principal at each period
#        formula: principal * (monthly_rate / 30) * days
#     5. Subtract all interest payments
#     6. Return breakdown

# generate_emi_schedule(loan)
#   → list of { due_date, due_amount, status }
#   For EMI loans: generate tenure_months entries starting from disbursed_date
#   Each EMI due on emi_day_of_month

# check_capitalization_due(loan, db)
#   → { is_due: bool, months_since_last_payment: int, outstanding_interest: Decimal }
#   Check if capitalization_enabled AND months since last payment >= capitalization_after_months

# calculate_effective_annual_rate(principal, total_repayment, tenure_months)
#   → float (IRR approximation — for EMI loans, show user the real effective rate)
```

### `services/gold_price.py`

```python
# fetch_live_gold_rate_per_gram_inr()
#   → float (price per gram in INR)
#   Source: https://goldpricez.com/api/rates/currency/inr/measure/gram
#   Cache in memory for GOLD_CACHE_TTL_SECONDS (default 3600 = 1 hour)
#   On API failure: return None (frontend shows "rate unavailable, use manual")

# calculate_gold_value(carat: int, weight_grams: float, price_per_gram: float)
#   → float
#   Formula: (carat / 24.0) * weight_grams * price_per_gram
```

### `services/payment_allocation.py`

```python
# allocate_payment(loan_id, payment_amount, payment_date, db)
#   → { allocated_to_overdue_interest, allocated_to_current_interest, allocated_to_principal, unallocated }
#   Fixed order (cannot be changed per payment):
#     1. Overdue interest (any interest that was due before today and unpaid)
#     2. Current period interest (interest accrued up to payment_date)
#     3. Principal reduction
#   Always compute outstanding first, then allocate
```

---

## Frontend — Key Pages

### `Dashboard.jsx`
- 6 summary cards in 2 rows (use card components)
- Alerts section: list of warnings (red = overdue/collateral breach, yellow = due soon)
- Bar chart: last 6 months inflow vs outflow (Recharts)
- Recent activity: last 10 transactions across all modules

### `Loans/LoanDetail.jsx`
- Header: loan type badge, direction badge (Given/Taken), status badge
- Outstanding box: shows principal outstanding + interest outstanding + total (updates on each payment)
- Collateral card: shows collateral type, value, warning if threshold breached, gold value (calculated vs manual toggle)
- Payment history table: date, amount, allocation breakdown (expandable row)
- "Record Payment" button → modal:
  - Enter amount
  - Show allocation preview (call `/payment-preview` endpoint)
  - Confirm → submit
- "Capitalize Interest" button: only shows if `capitalization_enabled = true` and due

### `Loans/LoanForm.jsx`
- Step 1: Select `loan_direction` (Given / Taken) — big toggle button
- Step 2: Select `loan_type` (Interest Only / EMI / Short Term) — card selection
- Step 3: Dynamic fields based on selections:
  - All types: contact, amount, disbursed_date, notes
  - interest_only: interest_rate, interest_start_date, capitalization_enabled, capitalization_after_months
  - emi: interest_rate, emi_amount, tenure_months, emi_day_of_month
  - short_term: interest_free_till, post_due_interest_rate
  - taken + institution: institution_name, institution_loan_id
- Add collateral section (optional, can add after loan creation too)

### `Contacts/ContactDetail.jsx`
- Contact header: name, phone, type badge
- Summary row: Total Lent | Total Borrowed | Outstanding | Active Deals
- Tabs:
  - **Loans**: table of all loans for this contact
  - **Properties**: all property deals involving this contact
  - **Partnerships**: all partnerships involving this contact
  - **Info**: edit contact details

---

## Docker Compose

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: finance_tracker
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: secret
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  backend:
    build: ./backend
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://admin:secret@postgres:5432/finance_tracker
      SECRET_KEY: change-this-secret-key-in-production
      ALGORITHM: HS256
      ACCESS_TOKEN_EXPIRE_MINUTES: 15
      REFRESH_TOKEN_EXPIRE_DAYS: 7
      CORS_ORIGINS: http://localhost:5173
      GOLD_API_URL: https://goldpricez.com/api/rates/currency/inr/measure/gram
      GOLD_CACHE_TTL_SECONDS: 3600
      SEED_ADMIN_USERNAME: admin
      SEED_ADMIN_PASSWORD: admin123
      SEED_ADMIN_EMAIL: admin@finance.local
    depends_on:
      - postgres
    volumes:
      - ./backend:/app

  frontend:
    build: ./frontend
    restart: unless-stopped
    ports:
      - "5173:5173"
    environment:
      VITE_API_URL: http://localhost:8000
    depends_on:
      - backend
    volumes:
      - ./frontend:/app
      - /app/node_modules

volumes:
  postgres_data:
```

---

## Backend `requirements.txt`

```
fastapi==0.111.0
uvicorn[standard]==0.29.0
sqlalchemy==2.0.30
alembic==1.13.1
psycopg2-binary==2.9.9
pydantic==2.7.1
pydantic-settings==2.2.1
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
python-multipart==0.0.9
httpx==0.27.0
python-dotenv==1.0.1
```

---

## Frontend `package.json`

```json
{
  "name": "advanced-finance-tracker",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.23.0",
    "@tanstack/react-query": "^5.40.0",
    "@tanstack/react-query-devtools": "^5.40.0",
    "axios": "^1.7.2",
    "lucide-react": "^0.383.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.3.0",
    "date-fns": "^3.6.0",
    "react-hook-form": "^7.51.5",
    "@hookform/resolvers": "^3.4.2",
    "zod": "^3.23.8",
    "recharts": "^2.12.7",
    "@radix-ui/react-dialog": "^1.0.5",
    "@radix-ui/react-select": "^2.0.0",
    "@radix-ui/react-tabs": "^1.0.4",
    "@radix-ui/react-toast": "^1.1.5",
    "@radix-ui/react-label": "^2.0.2"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.2.12",
    "tailwindcss": "^3.4.3",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38"
  }
}
```

---

## `.env.example`

```env
# ─── Database ───────────────────────────────────────────────
DATABASE_URL=postgresql://admin:secret@localhost:5432/finance_tracker

# ─── JWT ────────────────────────────────────────────────────
SECRET_KEY=your-super-secret-key-change-this-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7

# ─── Gold Price API ─────────────────────────────────────────
GOLD_API_URL=https://goldpricez.com/api/rates/currency/inr/measure/gram
GOLD_CACHE_TTL_SECONDS=3600

# ─── Seed Admin (created on first startup if no users exist) ─
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=admin123
SEED_ADMIN_EMAIL=admin@finance.local

# ─── App ────────────────────────────────────────────────────
APP_ENV=development
CORS_ORIGINS=http://localhost:5173
```

---

## `.gitignore`

```
# Python
__pycache__/
*.py[cod]
*.egg-info/
.env
venv/
.venv/

# Node
node_modules/
dist/
.env.local

# DB
*.sqlite3

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
```

---

## Important Implementation Notes

1. **Outstanding is always computed, never stored**: Query all payments, sum allocations, subtract from principal. This prevents data drift.

2. **Payment preview endpoint**: Before committing a payment, expose `GET /api/loans/{id}/payment-preview?amount=X` so the frontend can show the user exactly how the money will be allocated.

3. **Capitalization is manual**: System only warns when due. Admin must explicitly trigger `POST /api/loans/{id}/capitalize`. Never auto-capitalize.

4. **Gold rate caching**: Cache live gold rate in-memory (Python dict with timestamp). Re-fetch only if cache is older than `GOLD_CACHE_TTL_SECONDS`. On failure, return `null` and let frontend show manual input.

5. **Soft deletes**: All DELETE endpoints set `is_deleted = TRUE`. All GET queries must add `WHERE is_deleted = FALSE`.

6. **Collateral warning**: Computed at query time. If `loan.total_outstanding > collateral.estimated_value * (warning_threshold_pct / 100)`, include a `collateral_warning: true` flag in the loan detail response.

7. **Alembic setup**: Run `alembic revision --autogenerate -m "initial_schema"` after all models are defined. The `alembic/env.py` must import all models from `app.models`.

8. **Seed admin**: On `app/main.py` startup event, check if any user exists. If not, create admin user from env vars.

9. **CORS**: Allow `CORS_ORIGINS` from env. In development: `http://localhost:5173`.

10. **All decimal math**: Use Python's `Decimal` type, not float, for all monetary calculations.

---

## Roadmap (Future Features — Do Not Build Now)

- [ ] SMS / WhatsApp reminders to borrowers (Twilio)
- [ ] PDF report export (monthly P&L, loan statements)
- [ ] Mobile app (React Native + Expo, reuse same API)
- [ ] Multi-currency support
- [ ] AWS deployment (EC2 + RDS + S3 for file uploads)
- [ ] TDS / tax report generation
- [ ] Bulk import from Excel
- [ ] Audit log table (track all changes with old/new values)

---

## Quick Start (After Repo Created)

```bash
# 1. Clone
git clone https://github.com/amsxna060I/Advanced_Finance_Tracker.git
cd Advanced_Finance_Tracker

# 2. Copy env
cp .env.example .env

# 3. Start everything
docker-compose up --build

# 4. Access
# Frontend:  http://localhost:5173
# API Docs:  http://localhost:8000/docs
# Default login: admin / admin123
```