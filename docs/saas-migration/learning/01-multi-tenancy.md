# Tutorial 01 — Multi-Tenancy (Epic E1)

*Written while converting FinancerBuddy from single-user to multi-tenant, 2026-07-19. Everything below happened in this codebase — file paths are real.*

## Why we needed it (the problem in THIS codebase)

The app had real JWT auth but **all data was global**: `db.query(Loan).all()` returned every loan to every logged-in user. ~26 tables had a `created_by` column, but it was only an *audit stamp* — not one read query filtered on it. Three tables (`contacts`, `categories`, `collaterals`) had no user column at all. To let strangers sign up, every row needed an owner and every query needed to respect it.

## The options considered & trade-offs

| Model | How | Why we didn't / did |
|---|---|---|
| Database-per-tenant | each user gets a DB | Strongest isolation, but operationally impossible on a free tier (migrations × N, connections × N). Used by B2B products with few, big tenants. |
| Schema-per-tenant | Postgres schema per user | Same ops burden, slightly less. Also breaks Supabase pooling assumptions. |
| **Shared schema + tenant column** ✅ | `owner_id` on every table | One DB, one migration path, scales to thousands of small tenants. The cost: isolation is now *code correctness*, so it must be automatic + tested, never per-query discipline. |
| Postgres Row-Level Security | `CREATE POLICY` in the DB | The "belt" we may add later. Needs per-request `SET app.tenant`, awkward through PgBouncer transaction pooling. |

The key decision: with a shared schema, **never rely on developers remembering to add `.filter(owner_id=...)`**. One forgotten filter = data breach. Enforcement must live in one place.

## What we built

**1. The column** — [backend/app/models/mixins.py](../../../backend/app/models/mixins.py): `TenantMixin` with a `declared_attr owner_id` (FK → users.id, NOT NULL, indexed). All 28 domain model classes inherit it; `ActivityLog` overrides it nullable (system events have no tenant). We kept `created_by` separate: *who typed it* (audit) vs *whose books it belongs to* (tenancy) — they diverge once household guests exist.

**2. The automatic filter** — [backend/app/tenancy.py](../../../backend/app/tenancy.py). Two global Session event listeners:
- `do_orm_execute`: injects `with_loader_criteria(TenantMixin, lambda cls: cls.owner_id == tenant_id)` into every ORM SELECT/UPDATE/DELETE when `session.info["tenant_id"]` is set. Routers can't forget the filter because they never write it.
- `before_flush`: stamps `owner_id` on new rows from the session tenant, and **raises `TenantViolation`** if a new row's owner contradicts the session tenant (fail-closed against spoofed payloads).

The tenant is stamped in `get_current_user` ([dependencies.py](../../../backend/app/dependencies.py)) — the same `session.info` channel the activity logger already used, so every authenticated request is scoped with zero router changes. `tenant_id = user.tenant_owner_id or user.id` — a new self-FK on `users` lets viewer/readonly "household guests" operate inside their owner's tenant (preserving old behaviour for existing readonly users).

**3. The migration** — [backend/alembic/versions/046_tenant_owner_id.py](../../../backend/alembic/versions/046_tenant_owner_id.py). Three steps so it can't fail on live data: add nullable → backfill → NOT NULL + index + FK. Backfill fidelity ladder: own `created_by`/`user_id` → parent row's owner (collaterals←loans, partnership_members←partnerships) → seed admin (contacts, categories, and as COALESCE fallback for NULLs).

**4. The chokepoints raw SQL can't hide behind.** `with_loader_criteria` only covers ORM statements. We audited every `text()` / Core query and scoped it explicitly: forecast upsert (`routers/forecast.py`), property portfolio stats (`routers/property_deals.py`), admin legacy bulk tools (`routers/admin.py`), the scheduler's generated ledger rows (`services/scheduler.py` — inherits `owner_id` from the recurring item, since scheduler sessions have no tenant), and the activity logger's Core insert. `scripts/recon_report.py` remains a cross-tenant platform script (documented, admin-run only).

**5. The proof** — [backend/tests/tenancy/](../../../backend/tests/tenancy/). Two tenants created through the real API; 24 tests assert: list endpoints return nothing of the other tenant, details 404, writes 404, cross-tenant FKs rejected, aggregates (dashboard, property stats, expense analytics) contain nothing foreign, inserts get stamped, spoofed owners raise. **This suite is the merge gate for everything that follows.**

## Mistakes / surprises along the way

1. **"It passes individually but fails in the suite."** Tests share one Session across simulated requests. User A's tenant stayed stamped on the session; when user B logged in, the login endpoint (no `get_current_user`!) wrote B's login log inside A's tenant context — and our own `TenantViolation` guard aborted the flush. The guard was *right*. Fix: the login endpoint re-stamps the session tenant after verifying credentials ([routers/auth.py](../../../backend/app/routers/auth.py)). Lesson: any endpoint that authenticates *is* a tenant switch.
2. **`session.get(Model, pk)` bypassed the filter** — identity-map hits return without SQL. Harmless in production (fresh session per request), but a real caveat for long-lived sessions (workers!). Documented in the test.
3. **Trust but verify the ORM.** Before relying on `with_loader_criteria` we probed all seven query shapes (entity, column-only, `func.sum`, 2.0-style select, PK get, cross-id filter) against SQLite. All filtered. Never assume — an ORM feature you misunderstand becomes a security hole here.
4. **The isolation suite immediately caught a real leak**: `create_expense` accepted another tenant's `account_id`. Instead of patching that one router, we added the ownership check in `services/auto_ledger.py` — the chokepoint every module posts ledger rows through. One fix closed the whole class.
5. **Migration rehearsal caught reality gaps**: the historical migration chain can't replay from an empty DB (pre-existing issue), so we rehearsed by building the 045-era schema from `main` in a git worktree, seeding live-like data (including a NULL `created_by` row), then running 046 + downgrade + re-upgrade on a throwaway Dockerised Postgres. Also relearned: **Postgres sequences don't roll back** with transactions.

## How big orgs do it at scale

- Same shared-schema pattern, but often with **Postgres RLS as a second layer** (defense in depth) and the tenant carried in a request-scoped context (contextvars / middleware) rather than session.info.
- Tenant id in the JWT claims, verified per request; never trusted from the payload body.
- CI runs the isolation suite per PR; some orgs fuzz endpoints with two-tenant property tests.
- Very large tenants get "sharded out" to their own DB later — the `owner_id` column makes that a data move, not a rewrite.

## Interview drill — you should now be able to answer:

1. Compare shared-schema, schema-per-tenant, DB-per-tenant. When does each win?
2. How does `with_loader_criteria` + `do_orm_execute` enforce tenancy globally, and what are its blind spots (raw SQL, Core inserts, identity-map hits)?
3. Why must the tenant column be backfilled in three steps on a live database?
4. Why is "every user filter in the router" an anti-pattern for tenancy?
5. How would you *prove* to a security reviewer that tenant isolation holds? (Answer: the two-tenant endpoint suite + fail-closed write guard + raw-SQL audit checklist.)
