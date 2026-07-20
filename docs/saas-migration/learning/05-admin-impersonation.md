# Tutorial 05 — Support Tooling & Impersonation (Epic E5)

*Written while building the admin console, 2026-07-19.*

## Why we needed it (the problem in THIS codebase)

Once tenancy landed, even the platform admin (you) sees only their own tenant — correct for security, useless for support. "The admin will be able to see all the data, otherwise how will I debug?" The answer must NOT be "give admin's queries a global bypass": that reverts to the pre-tenancy world and makes every admin request a breach surface.

## The design: context switching, not bypass

The admin console does "view as user" by sending `X-Tenant-Context: <user_id>` on every request. `get_current_user` (the single choke point) validates it and **swaps the session's tenant to the target** — after which every existing endpoint, dashboard aggregate and chart just works, serving that tenant's data through the *same* filtered paths a real user gets. ~15 lines server-side, zero endpoint changes.

Three properties made it safe:

1. **Read-only, enforced twice.** `require_write_access` rejects any write while the context is active, and the destructive legacy admin tools refuse to run in context. Inspecting books must never be able to change them.
2. **Audited into the *inspected* tenant.** Every context request writes an `admin_view` activity row with `user_id = admin` and `owner_id = target` — so the user can open their own Activity Log and see exactly when support looked at their account. This is the honest implementation of "your data is private": not "admin can't look", but "you can see when they did".
3. **Fail closed on the header.** A non-admin sending `X-Tenant-Context` gets 403 — never silently ignored. A security header that is ignored for some callers is a bug you'll never find.

Frontend: the context lives in `sessionStorage` (dies with the tab, unlike localStorage), an interceptor adds the header, the React Query cache is **cleared on enter/exit** (cached queries belong to the previous tenant — a subtle leak we caught in design), and a sticky amber banner makes the state unmissable.

## The rest of the console

- `/api/admin/users` — search, role/tenancy/entitlement info, activate/deactivate (blocks login instantly via the `is_active` filter in `get_current_user`; can't deactivate yourself).
- `/api/admin/stats` — signups, verified counts, module adoption, rows-per-tenant. The rows-per-tenant query iterates `Base.registry.mappers` filtered to `TenantMixin` subclasses — the mixin gives us a free inventory of every tenant-scoped table.

## Mistakes / surprises along the way

- **The platform stats query returned only the admin's own rows** — E1's automatic filter applied to the admin's session like anyone else's. Exactly what it should do! Platform-wide queries must *opt out* explicitly via `execution_options(skip_tenant_filter=True)`, which makes every bypass grep-able: `grep -rn skip_tenant_filter` is the complete list of cross-tenant reads in the codebase.
- Query-cache leakage between tenant contexts (fixed with `qc.clear()`) is the SPA twin of the identity-map gotcha from Tutorial 01: caches don't know about tenants unless you tell them.

## How big orgs do it at scale

- Same pattern with more ceremony: time-boxed support sessions, user *consent* prompts ("support wants access — allow for 24h?"), reason codes required, session recordings, and SOC2-audited logs.
- Impersonation tokens (a JWT minted *for* the target with an `act` (actor) claim — RFC 8693 token exchange) replace per-request headers once multiple services need the context.
- Deactivation is also the abuse/incident lever — it's why it must be instant (checked at token *use*, not token *issue*).

## Interview drill — you should now be able to answer:

1. Context-switching vs filter-bypass for admin access — why is the first strictly safer?
2. Where is the single right place to implement tenant context in a FastAPI app, and why does it make every endpoint "just work"?
3. Why must impersonation be read-only and audited into the *target's* log, not just the admin's?
4. What client-side state (two kinds) leaks across tenant contexts in a SPA, and how do you clear each?
5. What is RFC 8693 token exchange and when does a header-based context stop being enough?
