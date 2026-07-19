# Tutorial 02 — Authorization Models (Epic E2)

*Written during the E2 rework, 2026-07-19.*

## Why we needed it (the problem in THIS codebase)

The app's permission model was built for one household: `role="admin"` (you) could write everything, `viewer`/`readonly` guests could read everything. Nearly every domain write endpoint carried `Depends(require_admin)` — 69 call sites across 12 routers. In a public SaaS that's exactly wrong: a signed-up user isn't an "admin", yet they must have full control of *their own* loans, expenses and accounts.

## The options considered & trade-offs

- **RBAC (role-based)** — permissions attached to roles ("admin can write loans"). What the app had. Breaks down when *whose data it is* matters more than *what your title is*.
- **Ownership-based** ✅ — you can do anything to data your tenant owns; roles only modulate edge cases. This is what most consumer SaaS actually runs on.
- **ABAC (attribute-based)** — policy engine evaluating arbitrary attributes (department, time, resource labels). Overkill until you have orgs/teams/plans; revisit if FinancerBuddy ever adds team workspaces.

The insight that made the change *safe*: **E1's tenancy layer already does the dangerous part**. Once every query is automatically scoped to the caller's tenant, "who may write?" reduces to "anyone in the tenant who isn't a readonly guest" — the blast radius of a wrong answer is your own data only.

## What we built

1. **The flip** — all 69 `Depends(require_admin)` on domain CRUD became `Depends(require_write_access)` (12 routers, scripted replace + import fix). `require_write_access` blocks only `role="readonly"`. See the rewritten docstrings in [dependencies.py](../../../backend/app/dependencies.py) — they now state the model: *isolation is enforced by tenancy, not roles*.
2. **New role semantics** — `admin` = platform operator. `require_admin` survives only on platform surfaces: `/api/admin/*` (legacy bulk tools), user provisioning in `auth.py` (`/register`, `/create-readonly`), and two legacy one-time migration endpoints in `analytics.py` (`/backfill`, `/relink-to-cash-home` — they contain hardcoded personal account ids; they'll die in a later cleanup).
3. **Frontend gate** — [RequireAdmin.jsx](../../../frontend/src/components/RequireAdmin.jsx) wraps `/admin/migration` (previously reachable by any logged-in user). Nested inside `ProtectedRoute` so loading/login handling stays in one place.
4. **Attribution (FB-2.3)** — when someone acts in a tenant that isn't their own, the activity log records both `user_id` (who acted) and `owner_id` (whose books). The viewer-guest write test in [test_authorization.py](../../../backend/tests/tenancy/test_authorization.py) proves it; the E5 admin support-view will reuse the same mechanism unchanged.

## The proof strategy (how you make a permission flip non-scary)

- Before the flip: run the full suite → 235 green (baseline).
- Flip → run again → still 235 green (nothing depended on the old semantics).
- Then make the *new* semantics load-bearing: the tenancy fixtures switched from `role="admin"` to `role="viewer"`, so the entire 24-test isolation suite now executes as plain users. If ownership-based write ever regresses, the merge gate fails.
- New tests assert the boundaries: normal user CRUDs own data; normal user gets 403 on `/api/admin/*` and `/register`; readonly still blocked; guests read the household tenant.

## Mistakes / surprises along the way

- One `require_admin` occurrence in `partnerships.py` was the *import line*, which a naive find-replace would have turned into a broken import. The script treated imports separately.
- The scary part of a permission migration isn't the replace — it's the *inventory*. `grep -c` per file first, decide per router, then script. The two analytics endpoints only surfaced because we read what each admin-gated endpoint actually did instead of bulk-replacing.

## How big orgs do it at scale

- Same ownership core, plus a **policy layer** (e.g. Oso, OpenFGA, Cedar) once sharing graphs appear ("editor of this workspace", "billing admin").
- Permission checks concentrated in dependencies/middleware, never inline `if user.role == ...` scattered in handlers (we kept the three legacy frontend `role === "admin"` checks for UI-affordance only — server remains the authority).
- Every permission change ships with a test that would have failed before the change.

## Interview drill — you should now be able to answer:

1. RBAC vs ownership vs ABAC — and why tenancy must land *before* an ownership flip.
2. How do you migrate 69 permission call sites without breaking production? (Inventory → per-router decision → scripted change → suite before/after → make new semantics load-bearing in tests.)
3. Why is client-side route gating (RequireAdmin) necessary but never sufficient?
4. What belongs in the audit row when acting in someone else's tenant, and why are actor and owner separate columns?
5. When does role-based *still* make sense? (Platform surfaces, guest read-only credentials.)
