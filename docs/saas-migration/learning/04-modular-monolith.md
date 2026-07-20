# Tutorial 04 — Modular Monolith Boundaries (Epic E4)

*Written while building the Assets module, 2026-07-19.*

## Why we needed it (the problem in THIS codebase)

The audit showed why this codebase can't be split into services naively: every module writes the shared ledger (`cash_accounts` via `auto_ledger`), joins `contacts` freely, and dashboard/analytics reach into every table directly (e.g. three separate files ran their own `SUM(unencumbered_assets.estimated_value)`). The Assets module is our chance to build ONE module the way a service must be built — while still living in the monolith. It's the Phase-3 extraction rehearsal.

## Package-by-feature vs package-by-layer

The old code is layered: `models/`, `schemas/`, `routers/`, `services/` — a change to "assets" touches four distant folders, and nothing stops `routers/dashboard.py` importing `models/unencumbered_asset.py` directly (it did). The new module is a feature package:

```
app/modules_pkg/assets/
├── __init__.py    # boundary rules, written down
├── models.py      # Asset (its ONLY table)
├── schemas.py     # pydantic in/out
├── service.py     # business logic + the PUBLIC INTERFACE
└── router.py      # /api/assets HTTP surface
```

## The boundary rules (each one maps to a service-extraction property)

1. **No imports from other domain modules.** Assets knows nothing about Loan, PropertyDeal, CashAccount. → When extracted, it has no reason to share a database with them.
2. **Others consume ONLY `service.assets_summary()` or the HTTP API.** Dashboard and analytics no longer query the table; they call the interface and receive plain dicts (never ORM objects — those would leak the schema). → Extraction turns one function body into an HTTP call; callers don't change.
3. **No cross-module FK joins against `assets`.** → No JOIN to break at extraction time.
4. **The interface needs no user argument** — tenant scoping rides on the session context (E1's `with_loader_criteria`). A narrow interface stays narrow.
5. **The rules are written in the package `__init__` docstring**, because boundaries that live only in someone's head last one refactor.

## Absorbing a legacy table (expand–migrate–contract in miniature)

`unencumbered_assets` was the old flat table. Migration 048: create `assets` → `INSERT..SELECT` legacy rows (mapping title→name, category→asset_type, estimated_value→current_value, preserving owner/audit columns and is_deleted flags) → soft-delete every original so no sum ever double counts. The legacy table and API stay alive but dormant (rollback insurance + old clients don't 404). Frontend's NetWorth section got a 20-line **adapter** (legacy field names ⇄ new API) instead of a rewrite — the full-featured UI lives at `/assets`.

## What the module itself does (FB-4.2)

- 11 asset types; quantity/unit/carat for weighables; FD/RD terms.
- **Gold auto-valuation**: `POST /{id}/refresh-value` recomputes from the live gold rate (reuses `services/gold_price.py` — shared *infra* is fine to import; shared *domain* is not). Manual value edits clear the `auto_valuation` flag.
- **Deposit projections** in pure functions: FD `A = P(1+r/n)^(nt)`, RD `M = R·[((1+i)^n−1)/i]·(1+i)` — unit-tested against the formulas, exposed as computed fields (`projected_maturity_value`, `days_to_maturity`).

## Mistakes / surprises along the way

- **The migration rehearsal caught a downgrade bug**: `UPDATE ... SET is_deleted = false` on rollback would have resurrected rows the user deleted *before* the migration. Fixed to restore only rows whose copy in `assets` is live. Lesson: rehearse downgrades too — everyone tests upgrade, nobody tests the escape hatch.
- Analytics wanted per-item lists, not just totals — the interface grew a controlled `items` list of primitives instead of letting analytics import the model "just this once". The first "just this once" is how boundaries die.
- Postgres sequences don't roll back with transactions (bit us again in seeding) — remember it for any migration that inserts with explicit FKs.

## How big orgs do it at scale

- Import-boundary rules get *enforced*, not documented: `import-linter` contracts (Python), ArchUnit (JVM), Nx module boundaries (JS). Worth adding to CI when a second package appears in `modules_pkg/`.
- The interface layer often becomes an explicit "port" (hexagonal architecture); events (Phase 2's outbox) replace synchronous interface calls where eventual consistency is acceptable.
- Shopify, GitHub and Stripe all famously run modular monoliths at enormous scale — extraction is a cost you pay when *deployment independence* matters, not a virtue in itself.

## Interview drill — you should now be able to answer:

1. Package-by-feature vs package-by-layer — what does each optimise for?
2. What five properties must a module have so that extracting it to a service is cheap?
3. Why must a module interface return plain data instead of ORM objects?
4. How do you absorb a legacy table without downtime or double counting? (expand → copy → soft-delete originals → keep rollback path)
5. When should you NOT extract a service, even from a well-bounded module?
