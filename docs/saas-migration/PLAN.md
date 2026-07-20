# FinancerBuddy — Personal App → Public SaaS Migration Plan

> **Status:** Draft v1 (2026-07-19) · **Owner:** Amol · **Tracking:** see [BACKLOG.md](BACKLOG.md)
> **Learning notes:** every epic produces a tutorial in [learning/](learning/) — that's how we turn this project into senior-level experience.

---

## 1. Context & Goal

Today this is a **single-operator personal finance app**: one admin user (you), all data global, deployed on one Oracle Cloud VM (`financerbuddy.com`), FastAPI + React + Supabase Postgres.

Goal: turn it into a **public multi-tenant SaaS** where:

1. Anyone can **sign up**; a **questionnaire** decides which modules they see (a salaried user gets Expenses + Accounts + Net Worth; a lender/property dealer gets Loans/Property/Partnership too).
2. Every user's data is **strictly isolated** from every other user's.
3. A **platform admin** (you) can view any user's data (with a user filter) for support/debugging.
4. You yourself become a normal user; your current data migrates into your new user account.
5. A new **Assets module** lets users log gold, silver, vehicles, home, stocks, FD/RD, etc.
6. Long-term, modules become **independently deployable services** with **event-driven** communication (Celery, SQS/SNS, Kafka) — so e.g. the Expense module alone can power a WhatsApp bot or mobile app.

**Working agreement:** develop on branch `saas-migration` (never push to `main` until done — `main` keeps the current app working). Local commits on the branch ARE allowed and strongly recommended: they are our save-points and don't affect the deployed app. Test locally (docker-compose) per story; deploy only after a full phase is verified.

---

## 2. What the codebase audit found (facts the plan is built on)

| Area | Finding |
|---|---|
| Auth | Real JWT auth exists (`backend/app/routers/auth.py`): login, refresh rotation + blacklist, bcrypt, roles (`admin/viewer/readonly`), CSRF, rate limits. But `/register` is **admin-gated** — no public signup. |
| Tenancy | **None.** ~26 of 31 tables carry `created_by` as an *audit stamp only* — **no read query filters by it**. `contacts`, `categories`, `collaterals` have no owner column at all. Everyone with a login sees everything. |
| Coupling | Two hub tables couple all modules: `cash_accounts` (shared ledger — every module writes `AccountTransaction` via `services/auto_ledger.py`) and `contacts` (counterparty for loans, obligations, beesi, property, partnership). Property ⇄ Partnership are cross-linked both directions. |
| Authorization | Role-based, not owner-based: most writes require `require_admin`. In SaaS, each user must be admin **of their own data**. |
| Background work | In-process APScheduler (recurring transactions daily, advisory-lock guarded). No task queue. |
| Frontend | React SPA; nav = static `navItems` array in `src/components/Layout.jsx`; routes hard-coded in `App.jsx`; no signup page, no feature flags, `/admin/migration` not role-gated. |
| Deploy | GitHub Actions → SSH to OCI VM → systemd uvicorn (2 workers) behind nginx; frontend built in CI, scp'd to `/var/www/finance-frontend`; DB = Supabase Postgres. |
| Tests | Good pytest suite (unit/integration/scenarios) with auth fixtures — but zero multi-tenant fixtures/tests. |

---

## 3. Strategy: Modular Monolith first, Services second

**We do NOT split into microservices first.** Splitting a codebase whose modules share a ledger and a contacts table, before tenancy and module boundaries exist, is the classic way these projects fail (distributed monolith: every service calls every other, one bug leaks data across tenants).

Instead, three phases. Each phase leaves the app **fully working and deployable on its own**.

```
Phase 1 — Multi-tenant Modular Monolith        (the SaaS launch)
  signup + questionnaire + module entitlements + tenant isolation
  + admin console + Assets module + your data migrated

Phase 2 — Async & Event backbone               (the plumbing)
  Celery + Redis, domain events + outbox pattern, notifications
  APScheduler jobs → Celery beat

Phase 3 — Service extraction (strangler)        (the microservices)
  Assets service first (it's new & decoupled), then Expense service,
  API gateway routing, SQS/SNS integration, WhatsApp-bot Lambda
```

> **DECISION 2026-07-20 (owner): Phase 3 is DROPPED.** No service split, no
> SQS/Kafka in prod, no WhatsApp bot for now. Rationale: single operator,
> modest load — deployment independence isn't worth the operational cost on
> free-tier infra. The app stays ONE deployable unit; the modular boundaries
> built in Phase 1 (e.g. modules_pkg/assets) remain as code hygiene and keep
> the option open. Phase 2 is right-sized accordingly: Celery/Redis with a
> no-Redis fallback, and in-app events only (outbox pattern for learning +
> notifications — no external brokers).

Why this order works:
- Phase 1 is the actual product change users see; it's shippable alone.
- Tenancy done in the monolith is enforced in **one place**; done after a split it must be re-solved per service.
- Phase 2 introduces every async concept (queues, workers, events, idempotency) **without** the operational cost of splitting deployments — that's where 80% of the "senior" learning is.
- Phase 3 extracts services along the boundaries Phase 1/2 hardened. Assets goes first because it is brand new (no legacy coupling) — a real strangler-fig move; Expense second because that's your WhatsApp-bot goal.

---

## 4. Key architecture decisions (ADRs)

### ADR-1: Tenancy model — shared database, `owner_id` column, enforced centrally
- Add `owner_id → users.id` (indexed, NOT NULL) to **all 29 domain tables**. Keep `created_by` as the audit stamp (they differ once family-sharing ever exists).
- Migration is 3 steps so it can't fail on live data: add nullable → backfill (`owner_id = created_by`, or seed-admin id where no `created_by` exists) → set NOT NULL.
- **Enforcement is automatic, not per-query**: a `TenantMixin` on models + SQLAlchemy `with_loader_criteria` event on the Session, keyed by `db.info["tenant_id"]` (the same `db.info` channel `activity_logger.py` already uses). Every ORM SELECT gets `WHERE owner_id = :tenant` injected; an insert event stamps `owner_id`. Aggregate/raw queries (dashboard, forecast, reports, chatbot_tools) are audited and filtered explicitly.
- Platform admin bypass: dependency sets `db.info["tenant_id"] = <target user or None>`; `None` (admin only) disables the filter.
- **Safety net:** a dedicated isolation test suite — two tenants, hit every list/detail endpoint, assert tenant B never sees tenant A (404/empty). This suite is the "do not fail" guarantee; nothing merges without it green.

### ADR-2: Module entitlements — registry + JSONB, questionnaire maps to modules
- Single source of truth `backend/app/modules.py`: `MODULE_REGISTRY` with key, label, dependencies, and the routers/nav items it owns.
  - **Core (always on):** `dashboard`, `accounts`, `contacts`, `expenses`, `obligations` (Money Flow), `net_worth`.
  - **Optional:** `loans` (incl. collateral), `property`, `partnerships` (auto-implies `property` linkage awareness), `beesi`, `assets`, `forecast`, `expense_analytics`, `reconciliation`, `recurring`, `reports`, `chatbot`.
- `users.enabled_modules` JSONB, validated against the registry. Exposed in `/api/auth/me`.
- **Backend enforces** (a router-level dependency `require_module("loans")` → 403 if not enabled); **frontend filters** `navItems` and route registration from the same list. Users can change modules later in Settings (turning off hides, never deletes).
- Questionnaire = 4-5 plain questions ("Do you lend or borrow money with people?", "Do you deal in property/land?", "Do you invest in gold/stocks/FDs?", "Are you in a beesi/chit committee?", "Do you run shared ventures with partners?") mapped to module sets. Skippable → sensible default (core + assets).

### ADR-3: Authorization rework — owner of your data, platform admin above
- Replace `require_admin` on domain writes with `require_write_access` + tenancy (every user is full owner of their own data). `viewer/readonly` roles remain meaningful only for accounts a user shares (future) and for platform staff.
- New role semantics: `role="admin"` = **platform admin** (you). Admin console gets a user selector; selecting a user sets the tenant context to that user (read-only by default). CSRF middleware already special-cases `/api/admin/*` — the console lives there.
- **Honesty on privacy:** data is encrypted in transit (TLS) and at rest (Supabase), and never shared with third parties — but platform admin *can* view data for support. Say exactly that in the privacy policy. Never claim end-to-end encryption we don't have.

### ADR-4: Async ladder — Celery/Redis → SQS/SNS → Kafka (learning-driven)
- **Celery + Redis on the existing VM** is step one: real broker, real workers, real retries/idempotency, near-zero cost. APScheduler jobs move to Celery beat. FastAPI `BackgroundTasks` only for fire-and-forget trivia (emails).
- **Domain events with a transactional outbox**: services emit `ExpenseCreated`, `LoanPaymentRecorded`, … into an `outbox_events` table in the same DB transaction; a relay publishes them. This is the pattern that makes Phase 3 possible and it's the single most valuable "real org" pattern to learn.
- **SQS/SNS (AWS free tier)** replaces/augments the relay target in Phase 3 for cross-service messaging (SNS fan-out → SQS per consumer). **Kafka is learned locally in docker-compose only** — it does not fit free-tier ops budget in production, and knowing *when not to use Kafka* is itself the senior lesson. Each gets a tutorial.

### ADR-5: Service extraction — strangler fig, Assets first, Expense second
- Phase 1 builds Assets **inside** the monolith but with strict boundaries (own package, talks to other modules only via service interfaces + events, no cross-module FK joins). In Phase 3 it extracts first (own FastAPI app, own schema `assets` in the same Postgres, JWT verified locally with the shared public key/secret).
- Expense service second: it owns expenses + categories + categorizer/learning; it *references* accounts by id and emits `ExpenseCreated` events that the monolith's ledger consumes (this decouples `auto_ledger` — the hardest seam).
- Routing: nginx path-based (`/api/assets/* → assets service`) — no new gateway product needed. Loans/Property/Partnership/Beesi stay in the monolith indefinitely (their ledger+contact coupling makes extraction cost > value; saying so is an architecture decision, not a failure).
- WhatsApp bot = AWS Lambda (webhook) + API Gateway calling the Expense service with a bot service-token. This is the payoff demo.

### ADR-6: Deployment topology — one VM until it hurts
- Phase 1 ships on the **existing OCI VM unchanged** (same systemd + nginx + Supabase).
- Phase 2 adds Redis (docker) + `celery worker`/`celery beat` systemd units on the same VM.
- Phase 3: each extracted service is a docker container on the same VM (or the second free OCI A1 instance if RAM gets tight — free tier allows up to 4 OCPU / 24 GB across A1 instances). AWS free tier is used only for SQS/SNS/Lambda. **No paid infra until there are real users.**
- CI: extend the existing `deploy.yml` with per-service change detection (it already does `backend/` vs `frontend/` detection — same pattern).

---

## 5. Phase summaries & definition of done

### Phase 1 — Multi-tenant SaaS (Epics E1–E6 in backlog)
Signup + email verification, questionnaire, `owner_id` tenancy + isolation test suite, authorization rework, module gating (backend + frontend), Assets module, admin console with user filter, landing page on financerbuddy.com, your data migrated to your personal account.
**DoD:** two fresh signups cannot see each other's data (proven by the isolation suite); you use the app daily as a *non-admin* user; admin console shows any user's data; current `main` behaviour reproducible for your account.

### Phase 2 — Async & events (Epics E7–E8)
Celery + Redis workers, beat schedule replaces APScheduler, transactional outbox + domain events, report generation and (future) notifications moved to tasks, idempotent consumers, dead-letter handling.
**DoD:** recurring transactions run via Celery beat only; killing the worker mid-task loses nothing (retry proves idempotency); every money-moving action emits an event visible in the outbox/consumer log.

### Phase 3 — Services (Epics E9–E11)
Assets extracted, Expense extracted, nginx routing, SNS/SQS between services, Kafka lab locally, WhatsApp-bot Lambda against Expense API.
**DoD:** monolith down ≠ Assets/Expense down (and vice versa); an expense logged via WhatsApp appears in the web app; each service deploys independently from CI.

---

## 6. Risk register (what could make this fail, and the counter)

| Risk | Counter |
|---|---|
| Tenant data leak (worst case) | ADR-1 automatic filtering + isolation test suite gating every merge; explicit audit of all raw/aggregate queries (dashboard, forecast, reports, chatbot_tools, recon script). |
| Big-bang breakage of your live app | Branch `saas-migration`; `main` untouched & deployable throughout; phase-gated deploys; your data migration is a rehearsed, reversible script (run on a DB copy first). |
| Free-tier resource exhaustion (Redis+Celery+services on 1 VM) | Memory budget check per phase; second free A1 instance as relief valve; Kafka kept local-only. |
| Scope explosion | Backlog is the contract: stories not in it don't get built mid-phase. Loans/Property/Partnership explicitly stay monolith. |
| Auth/security regressions with public signup | Keep existing hardening (rotation, blacklist, rate limits); add email verification, signup rate-limit + captcha option, password policy; security review story before opening signup publicly. |
| Admin privacy claims vs reality | ADR-3 wording in privacy policy; admin views are audit-logged via existing `activity_logger`. |
| Scheduler double-runs with more workers/services | Advisory-lock pattern already exists; Phase 2 moves scheduling to a single Celery beat instance. |

---

## 7. How we work each story (the "real organisation" loop)

1. Pick the top `Todo` story in [BACKLOG.md](BACKLOG.md) → mark `In Progress`.
2. Implement on `saas-migration` (small local commits).
3. Test locally: targeted pytest + isolation suite + `docker-compose up` manual check.
4. Mark `Done` with a one-line note (what changed, anything learned).
5. Write/extend the epic's tutorial in [learning/](learning/) — the tutorial is part of the story's DoD, not an afterthought.
6. End of phase: full regression + deploy + smoke test on financerbuddy.com.
