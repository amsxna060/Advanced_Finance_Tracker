# SaaS Migration Backlog

> Jira-style tracker for [PLAN.md](PLAN.md). Statuses: `Todo` · `In Progress` · `Blocked` · `Done`.
> Work top-to-bottom inside a phase. Update this file in the same commit as the code it describes.
> Story IDs: `FB-<epic>.<n>`. Every epic ends with a Tutorial story (learning/ doc).

**Legend for AC:** acceptance criteria that must be demonstrably true (test or manual check) before `Done`.

---

## Phase 1 — Multi-tenant Modular Monolith

### E1 — Tenancy foundation (the "do not fail" epic)

| ID | Story | Status | Notes |
|----|-------|--------|-------|
| FB-1.1 | **Tenant column migration.** Alembic migration adding `owner_id → users.id` (indexed) to all 29 domain tables: nullable → backfill from `created_by` (seed-admin id where absent: `contacts`, `categories`, `collaterals`) → NOT NULL. | Done | Done — `models/mixins.py` TenantMixin + migration `046_tenant_owner_id.py`; rehearsed on Docker Postgres incl. backfill of NULL created_by, parent-join tables, and downgrade/re-upgrade. |
| FB-1.2 | **TenantMixin + automatic query filter.** `TenantMixin` on all domain models; Session-level `with_loader_criteria` filter keyed by `db.info["tenant_id"]`; insert event stamps `owner_id`. New dependency `get_tenant_db` wraps `get_db` + `get_current_user`. | Done | Done — `app/tenancy.py`: `do_orm_execute` + `with_loader_criteria` auto-filter, `before_flush` stamping + fail-closed `TenantViolation`; tenant stamped in `get_current_user` AND at login (auth endpoint = tenant switch). `users.tenant_owner_id` keeps viewer/readonly guests in the owner household. |
| FB-1.3 | **Raw/aggregate query audit.** Grep + fix every query that bypasses ORM loader criteria: `routers/dashboard.py`, `routers/analytics.py`, `routers/forecast.py` + `services/forecast_engine.py`, `routers/reports.py` + pdf/excel generators, `services/chatbot_tools.py`, `scripts/recon_report.py`, `services/scheduler.py`. Each gets explicit `owner_id` filtering. | Done | Done — scoped: forecast upsert, property /stats raw SQL, admin legacy bulk tools, scheduler ledger rows (inherit item.owner_id), activity-log Core insert. Added ownership check in `auto_ledger.py` (chokepoint, caught by FB-1.4). `scripts/recon_report.py` stays a platform script — revisit in E5. |
| FB-1.4 | **Isolation test suite.** New `tests/tenancy/`: fixtures `tenant_a`, `tenant_b` (+ headers); parametrized test hitting every GET list/detail endpoint as B after seeding as A → expect empty/404; write-endpoint test: B cannot update/delete A's records; FK-crossing test: B cannot create a loan against A's contact/account. | Done | Done — `tests/tenancy/` 24 tests: lists/details/writes/FKs/aggregates + engine-level stamping & spoof guard. Full suite 235 passed. |
| FB-1.5 | **Fix latent tenancy bug.** `routers/property_deals.py:87` filters `Contact.created_by` which doesn't exist — replace with new `owner_id`. | Done | Done — now filters `Contact.owner_id`; kept as belt-and-suspenders under the auto filter. |
| FB-1.6 | 📚 **Tutorial: multi-tenancy patterns.** `learning/01-multi-tenancy.md`: shared-schema vs schema-per-tenant vs DB-per-tenant, why we chose shared+column, how `with_loader_criteria` works, how orgs test isolation. | Done | Done — `learning/01-multi-tenancy.md` (incl. the login stale-tenant surprise and identity-map caveat). |

### E2 — Authorization rework

| ID | Story | Status | Notes |
|----|-------|--------|-------|
| FB-2.1 | **Owner-based permissions.** Replace `require_admin` on all domain routers with `require_write_access` (tenancy makes it safe). Keep `require_admin` only for `/api/admin/*` + platform ops. New role meaning: `admin` = platform admin. | Todo | Update role docstrings + `dependencies.py`. |
| FB-2.2 | **Route-gate `/admin/migration` and admin APIs.** Frontend `AdminMigration.jsx` route and any `/api/admin/*` verified admin-only; add `RequireAdmin` route wrapper in `App.jsx`. | Todo | Currently reachable by any logged-in user. |
| FB-2.3 | **Admin actions audit-logged.** When admin views/acts in another user's tenant context, `activity_logger` records it (actor = admin, tenant = target). | Todo | Supports the privacy-policy promise. |
| FB-2.4 | 📚 **Tutorial: AuthZ models.** `learning/02-authorization.md`: RBAC vs ownership vs ABAC, how the role change was executed safely. | Todo | |

### E3 — Public signup, questionnaire, module entitlements

| ID | Story | Status | Notes |
|----|-------|--------|-------|
| FB-3.1 | **Module registry.** `backend/app/modules.py`: `MODULE_REGISTRY` (key, label, description, core?, depends_on, questionnaire mapping). `users.enabled_modules` JSONB + migration; validation against registry; exposed in `/api/auth/me`. | Todo | ADR-2. Core set always present. |
| FB-3.2 | **`require_module` dependency.** Router-level guard → 403 `{"detail": "module_disabled"}` if module not enabled. Applied to every optional-module router. | Todo | |
| FB-3.3 | **Public signup API.** `POST /api/auth/signup` (email, password, full name): password policy, unique email, rate-limited stricter than login, creates `role="viewer"`-equivalent normal user with default modules, sends verification email. `POST /api/auth/verify-email`. Existing admin-gated `/register` stays for platform use. | Todo | Email: start with SMTP (Gmail app password) behind an `EmailService` interface; swap to SES in Phase 3. |
| FB-3.4 | **Signup + questionnaire UI.** `pages/Signup.jsx` (linked from Login), then a 4-5 question onboarding wizard mapping answers → module set (skippable → default). Calls `PUT /api/users/me/modules`. | Todo | |
| FB-3.5 | **Module-aware navigation & routes.** Tag each `navItems` entry in `Layout.jsx` with a module key; filter by `user.enabled_modules`; wrap optional routes in `App.jsx` with a `RequireModule` guard (redirect to dashboard + hint). | Todo | Nav + routes read the same registry mirror (`src/lib/modules.js`). |
| FB-3.6 | **Settings page — manage modules.** User can enable/disable optional modules later; disabling hides, never deletes data. | Todo | |
| FB-3.7 | **Security review before opening signup.** Checklist story: rate limits, captcha decision, password policy, verification required for login?, CORS, cookie flags, dependency audit (`pip-audit`/`npm audit`). | Todo | Do NOT expose signup on prod before this is Done. |
| FB-3.8 | 📚 **Tutorial: feature flags & entitlements.** `learning/03-entitlements.md`: flags vs entitlements, registry pattern, server-enforced vs UI-only gating. | Todo | |

### E4 — Assets module (new, built with service-ready boundaries)

| ID | Story | Status | Notes |
|----|-------|--------|-------|
| FB-4.1 | **Design + model.** `Asset` model: type (gold/silver/vehicle/real_estate/stock/mutual_fund/FD/RD/other), quantity/units, purchase price+date, current value (manual or auto), notes, optional linked account. Own package `app/modules_pkg/assets/` (models, schemas, router, service) — no imports from other domain modules except via interfaces. | Todo | Absorb/supersede `unencumbered_assets` (keep old data via migration). |
| FB-4.2 | **CRUD + valuation.** Endpoints under `/api/assets`; gold/silver auto-valuation reuses `services/gold_price.py`; FD/RD maturity computation. | Todo | |
| FB-4.3 | **Net Worth integration via interface, not join.** `NetWorth` page/dashboard reads assets through a narrow `assets_summary()` service function (future: API call/event). | Todo | This seam is what makes Phase 3 extraction cheap. |
| FB-4.4 | **Frontend pages.** `pages/Assets/` list/form/detail + module registry entry + nav item. | Todo | |
| FB-4.5 | 📚 **Tutorial: modular monolith boundaries.** `learning/04-modular-monolith.md`: package-by-feature, interface seams, why no cross-module FKs, how this pre-pays service extraction. | Todo | |

### E5 — Admin console

| ID | Story | Status | Notes |
|----|-------|--------|-------|
| FB-5.1 | **Admin API.** `/api/admin/users` (list, search, activate/deactivate), `/api/admin/tenant/{user_id}/…` read-only views (or: admin sets tenant context header consumed by `get_tenant_db`). | Todo | Tenant-context approach reuses all existing endpoints — prefer it. |
| FB-5.2 | **Admin UI.** `pages/Admin/`: user list + "view as user" selector (banner: *viewing user X — read only*); reuses existing pages in tenant context. | Todo | |
| FB-5.3 | **Platform stats.** signups, active users, module adoption (from `enabled_modules`), storage/rows per tenant. | Todo | |
| FB-5.4 | 📚 **Tutorial: support tooling & impersonation.** `learning/05-admin-impersonation.md`: how real orgs do "view as", audit trails, least privilege. | Todo | |

### E6 — Launch: data migration, landing page, deploy

| ID | Story | Status | Notes |
|----|-------|--------|-------|
| FB-6.1 | **Personal-data migration script.** Create your normal user; script reassigns all `owner_id` from seed-admin to it. Rehearse on a local DB dump; reversible (stores mapping). | Todo | Run in prod only at cut-over. |
| FB-6.2 | **Landing page + privacy policy.** Public marketing page at `/` for logged-out users (financerbuddy.com), honest privacy policy (ADR-3 wording), Terms; basic SEO (meta tags, sitemap, robots.txt). | Todo | Static page served by nginx or a public SPA route. |
| FB-6.3 | **Phase-1 deploy & smoke test.** Full regression locally → deploy branch to OCI VM → smoke: signup a test user, run questionnaire, log expense, verify isolation from your account, admin console works. Then merge `saas-migration` → `main`. | Todo | First moment `main` changes. |
| FB-6.4 | 📚 **Tutorial: zero-downtime-ish releases.** `learning/06-release-engineering.md`: expand-migrate-contract DB changes, phase-gated branches, smoke tests. | Todo | |

---

## Phase 2 — Async & Event backbone

### E7 — Celery + Redis

| ID | Story | Status | Notes |
|----|-------|--------|-------|
| FB-7.1 | **Infra.** Redis container (docker) on VM + local compose; `celery_app.py`; worker + beat systemd units; healthcheck. | Todo | Memory-budget check first (VM headroom). |
| FB-7.2 | **Move APScheduler → Celery beat.** `process_recurring_transactions` becomes an idempotent Celery task (keep advisory-lock/row-lock guards); remove APScheduler from app startup. | Todo | `services/scheduler.py` retires. |
| FB-7.3 | **Async report generation.** `/api/reports` PDF/Excel become tasks: request → task id → poll/download. First user-visible async flow. | Todo | reportlab/openpyxl already there. |
| FB-7.4 | **Retries, idempotency, DLQ.** Task error handling policy: retry with backoff, idempotency keys, dead-letter queue + admin visibility. | Todo | |
| FB-7.5 | 📚 **Tutorial: Celery in production.** `learning/07-celery.md`: broker vs backend, prefetch, acks_late, idempotency, beat vs cron, monitoring (flower). | Todo | |

### E8 — Domain events + outbox

| ID | Story | Status | Notes |
|----|-------|--------|-------|
| FB-8.1 | **Event schema + outbox table.** `outbox_events` (id, tenant, type, payload, created, published); `emit_event()` writes in-transaction. Define first events: `ExpenseCreated/Updated/Deleted`, `LoanPaymentRecorded`, `AssetValued`, `UserSignedUp`. | Todo | The transactional-outbox pattern — core learning. |
| FB-8.2 | **Relay + first consumers.** Celery task relays outbox → Redis stream (later SNS); consumers: welcome email on `UserSignedUp`, category-limit alert on `ExpenseCreated`. | Todo | |
| FB-8.3 | **auto_ledger via events (design spike).** Design doc: can `AccountTransaction` creation become an `ExpenseCreated` consumer without breaking same-transaction consistency expectations? Decide sync-vs-async per module. | Todo | Honest spike — this is the hardest seam; outcome may be "stay synchronous for loans". |
| FB-8.4 | 📚 **Tutorial: event-driven architecture.** `learning/08-events-outbox.md`: events vs commands, outbox, at-least-once delivery, eventual consistency trade-offs. | Todo | |

---

## Phase 3 — Service extraction & cloud

### E9 — Extract Assets service

| ID | Story | Status | Notes |
|----|-------|--------|-------|
| FB-9.1 | **Standalone FastAPI app** from `assets` package: own container, own Postgres schema `assets`, verifies the same JWTs (shared `SECRET_KEY` → plan move to RS256 keypair), own alembic. | Todo | |
| FB-9.2 | **nginx path routing** `/api/assets/* → assets container`; frontend unchanged. Monolith's `assets_summary()` becomes an HTTP call (with timeout + fallback). | Todo | |
| FB-9.3 | **Independent CI/CD.** `deploy.yml` matrix: change detection per service; assets deploys alone. | Todo | |
| FB-9.4 | 📚 **Tutorial: strangler-fig extraction.** `learning/09-service-extraction.md`. | Todo | |

### E10 — Extract Expense service + AWS messaging

| ID | Story | Status | Notes |
|----|-------|--------|-------|
| FB-10.1 | **Expense service** (expenses + categories + categorizer + learning): own app/schema; emits events; ledger sync via consumer in monolith (per FB-8.3 decision). | Todo | |
| FB-10.2 | **SNS→SQS between services** (AWS free tier): outbox relay publishes to SNS topic; SQS queue per consumer; IAM least-privilege; localstack for local dev. | Todo | |
| FB-10.3 | **Kafka lab (local only).** docker-compose Kafka; re-implement one event flow on Kafka; write comparison (Kafka vs SQS/SNS vs Redis streams) — when each is the right call. | Todo | Deliberately not deployed to prod. |
| FB-10.4 | 📚 **Tutorial: SQS/SNS + Kafka compared.** `learning/10-messaging.md`. | Todo | |

### E11 — WhatsApp bot (the payoff)

| ID | Story | Status | Notes |
|----|-------|--------|-------|
| FB-11.1 | **Bot auth.** Service-token / API-key auth path in Expense service; per-user phone-number linking flow. | Todo | |
| FB-11.2 | **Lambda webhook.** AWS Lambda + API Gateway receiving WhatsApp (Meta Cloud API or Twilio sandbox) messages → parse "spent 250 on lunch" → Expense API; reply with confirmation + running total. | Todo | Serverless learning story. |
| FB-11.3 | 📚 **Tutorial: serverless integration.** `learning/11-lambda-whatsapp.md`. | Todo | |

---

## Done log

*(newest last)*

- 2026-07-19 **FB-1.1, FB-1.2, FB-1.5** Done — tenancy column + automatic filtering landed; all 211 pre-existing tests still green with zero router changes (session.info stamping did the work).
- 2026-07-19 **FB-1.3** Done — raw-SQL audit; real leak found & fixed at the `auto_ledger` chokepoint (expense could reference another tenant's account).
- 2026-07-19 **FB-1.4** Done — 24-test isolation suite is now the merge gate. Full backend: 235 passed.
- 2026-07-19 **FB-1.1 verification** — migration 046 rehearsed on throwaway Docker Postgres: 045-era schema from `main` + live-like seed → upgrade → verify owners → downgrade → re-upgrade. All clean.
- 2026-07-19 **FB-1.6** Done — tutorial written. **Epic E1 complete.**
