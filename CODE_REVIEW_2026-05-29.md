# Code Review & Security Audit — Advanced Finance Tracker

**Date:** 2026-05-29
**Reviewer:** Senior Python/architecture pass (Claude)
**Scope:** Full backend (FastAPI) + frontend (React/Vite) scan for feature-breaking bugs, security vulnerabilities, and architectural improvements.
**Branch:** `main` @ `4681ec1`

> ## ✅ Remediation status — applied 2026-05-29
>
> All code-level findings below were fixed in this pass. Verified: **121/121 backend tests pass** (against a fresh DB) and **58/58 frontend tests pass**.
>
> | # | Status | What changed |
> |---|--------|--------------|
> | 1 | ✅ Fixed | `config.py` now uses a `@model_validator(mode="after")` so the prod/staging SECRET_KEY + admin-password guards actually fire (verified: raises in prod, silent in dev). |
> | 2 | ✅ Fixed | `unencumbered_assets` CRUD + `analytics /backfill` & `/relink-to-cash-home` → `require_admin`; `analytics /anomalies/scan` & `categories POST` → `require_write_access` (kept usable by non-admins, blocks readonly). |
> | 3 | ✅ Fixed | Refresh token no longer returned in the `/login` body — cookie only (`TokenResponse.refresh_token` now Optional/None). |
> | 4 | ✅ Fixed | Security-headers middleware added (nosniff, X-Frame-Options DENY, Referrer-Policy, HSTS in prod). |
> | 5 | ✅ Fixed | `unencumbered_assets` validates `estimated_value` (numeric, > 0) → 422 instead of 500. |
> | 6 | ⚠️ Deploy-side | Rate-limit keying + per-account lockout need infra config (see note at the end); not a code change. |
> | 7 | ✅ Fixed | Startup `alembic upgrade head` now guarded by a Postgres advisory lock (multi-worker safe; sqlite/CI path unchanged). |
> | 8 | ✅ Fixed | `/docs`, `/redoc`, `/openapi.json` disabled when `APP_ENV=production`. |
> | 9 | ✅ Fixed | `auth.py` bcrypt cost unified to 13 rounds (existing hashes still verify). |
> | 10 | ◻️ Partial | pydantic validators migrated to v2 style (part of #1). `@app.on_event` left as-is intentionally (still functional; lifespan migration deferred to avoid startup-ordering risk on a live prod). |
> | 11 | ✅ Fixed | `admin.py` raw-SQL table names routed through an `_ALLOWED_TABLES` allowlist guard. |
> | 12 | ◻️ Left | LIKE wildcard escaping — cosmetic, no behavior change made to avoid altering search results. |
>
> **Action required before next prod deploy:** none for these fixes *if* prod's `SECRET_KEY` is 32+ chars and the admin password isn't `admin123` (you confirmed it is hardened). The validator will now refuse to boot otherwise — which is the intended safety behavior.
>
> ---

> **Context:** This codebase has already undergone a prior hardening pass (see `BUG_AUDIT_REPORT.md`; the `C-AUTH-*`, `H-SEC-*`, `C-FIN-*` tags in the code reference it). Overall the app is in **good shape** — JWT auth, refresh-token rotation + blacklist, CSRF double-submit, in-memory access tokens, read-only role middleware, advisory-locked scheduler, parameterized queries, DOMPurify on chatbot output, and SELECT-FOR-UPDATE on payments are all present and correct. This review focuses on what is **still open**, with each claim verified against the running code.

---

## Severity summary

| # | Severity | Finding | Type | Verified |
|---|----------|---------|------|----------|
| 1 | 🔴 Critical | Production hardening validators are dead code (weak SECRET_KEY / default admin password accepted in prod) | Security / Config | ✅ Empirically proven |
| 2 | 🟠 High | Inconsistent write authorization — `viewer` role can mutate data | AuthZ | ✅ |
| 3 | 🟠 High | Refresh token returned in response body, defeating httpOnly cookie protection | Security | ✅ |
| 4 | 🟡 Medium | No HTTP security headers (HSTS / CSP / X-Frame-Options / nosniff) | Security | ✅ |
| 5 | 🟡 Medium | `unencumbered_assets` accepts raw `dict` payloads — no schema validation | Robustness | ✅ |
| 6 | 🟡 Medium | Rate limiting keyed on raw peer IP; no per-account login lockout | Security | ✅ |
| 7 | 🟡 Medium | DB migrations auto-run via `subprocess` on every startup, no lock | Ops / Data | ✅ |
| 8 | 🟡 Medium | `/docs` & `/openapi.json` exposed unauthenticated in production | Info disclosure | ✅ |
| 9 | 🟢 Low | Two different bcrypt cost factors (12 vs 13) across modules | Consistency | ✅ |
| 10 | 🟢 Low | Deprecated APIs: pydantic v1 `@validator`, FastAPI `on_event` | Tech debt | ✅ |
| 11 | 🟢 Low | f-string table names in `admin.py` raw SQL (safe today, footgun) | Code smell | ✅ |
| 12 | 🟢 Low | Unescaped `%`/`_` in `ilike` contact search (LIKE wildcard, not injection) | Minor | ✅ |

---

## 🔴 1 — Production config validators never fire (CRITICAL)

**File:** [backend/app/config.py](backend/app/config.py#L49-L77)

The validators meant to *refuse to start* with insecure settings in production are silently disabled.

```python
class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str            # line 28 — validated BEFORE APP_ENV exists
    SEED_ADMIN_PASSWORD: str   # line 29 — same problem
    ...
    APP_ENV: str = "development"   # line 40 — defined LATER

    @validator("SECRET_KEY")
    def secret_key_must_be_strong(cls, v, values):
        env = values.get("APP_ENV", "development")   # ← always "development"
        if env in ("production", "staging") and (...weak...):
            raise ValueError(...)
        return v
```

Pydantic populates `values` with fields **in definition order**. Because `APP_ENV` is declared *after* `SECRET_KEY` and `SEED_ADMIN_PASSWORD`, it is **not yet in `values`** when their validators run, so `env` always resolves to the `"development"` default and the production checks are skipped.

**Proven empirically:**
```
-> Inside SECRET_KEY validator: values seen = {}, resolved env = 'development'
   RESULT: NO error raised. App would START with weak key. APP_ENV=production
```

**Impact:** The app will boot in production with:
- the placeholder `change-this-secret-key-in-production` / any `<32-char` `SECRET_KEY` → all JWTs forgeable, full auth bypass;
- the default `SEED_ADMIN_PASSWORD=admin123` → trivial admin takeover on first boot.

These are exactly the conditions the validators were written to prevent.

**Fix (recommended — pydantic v2 idiom):**
```python
from pydantic import field_validator, model_validator

class Settings(BaseSettings):
    ...
    @model_validator(mode="after")
    def _enforce_production_hardening(self):
        if self.APP_ENV in ("production", "staging"):
            if self.SECRET_KEY == "change-this-secret-key-in-production" or len(self.SECRET_KEY) < 32:
                raise ValueError("SECRET_KEY must be a random 32+ char string in production/staging.")
            if self.SEED_ADMIN_PASSWORD == "admin123":
                raise ValueError("SEED_ADMIN_PASSWORD must be changed from the default in production.")
        return self
```
A `model_validator(mode="after")` sees *all* fields regardless of declaration order. (Minimal-change alternative: move `APP_ENV` above `SECRET_KEY`/`SEED_ADMIN_PASSWORD` in the class — but the `@model_validator` approach is order-independent and future-proof.)

---

## 🟠 2 — Inconsistent write authorization: `viewer` can mutate data (HIGH)

**Files:** [unencumbered_assets.py](backend/app/routers/unencumbered_assets.py#L59), [analytics.py](backend/app/routers/analytics.py#L341), [categories.py](backend/app/routers/categories.py#L64)

Two role layers exist:
- The global `enforce_readonly` middleware blocks **only** `role == "readonly"` from non-safe methods.
- Most write routes additionally require `require_admin`.

But several **data-mutating** endpoints are guarded by `get_current_user` alone — so a user with the default `role == "viewer"` (not readonly, not admin) can write:

| Endpoint | Effect |
|---|---|
| `POST/PUT/DELETE /api/unencumbered-assets` | create/edit/delete assets |
| `POST /api/analytics/backfill` | **creates ledger entries** |
| `POST /api/analytics/relink-to-cash-home` | **mutates transaction links** |
| `POST /api/analytics/anomalies/scan` | writes anomaly rows |
| `POST /api/categories` | create category |

Compare with `loans.py`, `contacts.py`, etc., which correctly use `require_admin`. The `require_write_access` dependency in [dependencies.py](backend/app/dependencies.py#L45) exists for exactly this purpose but is **not applied** to these routes.

**Impact:** Privilege escalation for non-admin accounts; net-worth/ledger data can be altered by a `viewer`. Inconsistent policy is also a maintenance hazard (easy to forget the guard on the next new endpoint).

**Fix:** Decide the policy explicitly. If only admins may write, change these to `Depends(require_admin)`. If "viewer" is allowed to write but "readonly" is not, change them to `Depends(require_write_access)`. Better still, enforce it centrally (a middleware/route-class that denies non-safe methods unless the role is in an allowlist) so individual routes can't drift.

---

## 🟠 3 — Refresh token leaked in the login response body (HIGH)

**Files:** [auth.py](backend/app/routers/auth.py#L74-L78), `schemas/auth.py` (`TokenResponse`)

The whole point of `C-AUTH-4` is to keep the refresh token in an **httpOnly, SameSite=Strict** cookie so XSS can't steal it. But `/login` *also* returns it in the JSON body:

```python
response.set_cookie("refresh_token", refresh_token, httponly=True, ...)   # good
return {"access_token": ..., "refresh_token": refresh_token, "token_type": "bearer"}  # ← leak
```

The frontend never reads `response.data.refresh_token` (it relies on the cookie), so the body copy is pure exposure surface: readable by any injected JS, browser extensions, and likely to land in proxy/access logs and error trackers.

**Fix:** Drop `refresh_token` from `TokenResponse` and the login return value (cookie only). If you must support non-browser API clients that can't hold cookies, gate the body copy behind an explicit opt-in (e.g. a header/flag), don't return it by default.

---

## 🟡 4 — No HTTP security headers (MEDIUM)

**File:** [main.py](backend/app/main.py#L48-L56)

No middleware sets `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`/CSP `frame-ancestors`, or `Referrer-Policy`. The app is therefore exposed to clickjacking and MIME-sniffing, and HTTPS isn't pinned.

**Fix:** add a small response middleware:
```python
@app.middleware("http")
async def security_headers(request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if settings.APP_ENV == "production":
        resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    # Consider a Content-Security-Policy tuned to the SPA's asset origins
    return resp
```

---

## 🟡 5 — `unencumbered_assets` accepts raw `dict` (MEDIUM)

**File:** [unencumbered_assets.py](backend/app/routers/unencumbered_assets.py#L59-L66)

```python
@router.post("", response_model=dict)
def create_asset(payload: dict, ...):   # ← no Pydantic schema
    if not payload.get("title"): ...
```

Unlike every other module (which uses typed `schemas/*`), assets accept an untyped dict with ad-hoc `.get()` validation. This means no type coercion, no bounds checking, silent acceptance of unknown/garbage keys, and inconsistent error shapes. `estimated_value` is checked for truthiness only — `0`, negative, or non-numeric values slip through inconsistently.

**Fix:** define `UnencumberedAssetCreate`/`Update` Pydantic schemas (typed `Decimal` amount with `gt=0`, constrained `category`, etc.) like the other routers.

---

## 🟡 6 — Rate-limit keying & login brute force (MEDIUM)

**Files:** [main.py](backend/app/main.py#L36), [auth.py](backend/app/routers/auth.py#L43)

`slowapi` is keyed by `get_remote_address`, which reads the socket peer. Behind the Oracle Cloud / reverse proxy in `deploy.yml`, that peer is typically the **proxy**, so either all clients share one bucket (false throttling) or the limit is ineffective — depending on proxy config. Also, login throttling is **per-IP only**; there is no per-username lockout, so a botnet/rotating-IP attacker can still spray a single account.

**Fix:**
- Ensure the app trusts `X-Forwarded-For` from the known proxy (e.g. uvicorn `--proxy-headers` + `--forwarded-allow-ips`, or a `ProxyHeadersMiddleware`), and that `get_remote_address` resolves the real client.
- Add a per-account failure counter / temporary lockout on `/login` in addition to the IP limit.

---

## 🟡 7 — Migrations auto-run on startup via subprocess (MEDIUM)

**File:** [main.py](backend/app/main.py#L182-L193)

```python
result = subprocess.run(["alembic", "upgrade", "head"], capture_output=True, text=True, cwd="/app")
```

Running `alembic upgrade head` inside the app `startup` hook means:
- With multiple workers/replicas, several processes race to migrate concurrently (no advisory lock here, unlike the scheduler which *does* lock).
- A failing migration is logged but the app still continues to serve, potentially against a half-migrated schema.
- Hardcoded `cwd="/app"` couples the code to one container layout.

**Fix:** run migrations as a discrete deploy/release step (CI job or an init container / `command` in compose) rather than on every app boot; or, if it must stay inline, wrap it in a `pg_advisory_lock` like `scheduler.py` and **fail fast** (refuse to serve) on non-zero return code.

---

## 🟡 8 — Swagger/OpenAPI exposed in production (MEDIUM)

**File:** [main.py](backend/app/main.py#L38-L42)

`FastAPI(...)` is created without `docs_url=None`/`openapi_url=None`, so `/docs`, `/redoc`, and `/openapi.json` are publicly reachable in every environment, advertising the full API surface.

**Fix:**
```python
_prod = settings.APP_ENV == "production"
app = FastAPI(..., docs_url=None if _prod else "/docs",
                  redoc_url=None if _prod else "/redoc",
                  openapi_url=None if _prod else "/openapi.json")
```

---

## 🟢 9 — Two bcrypt cost factors (LOW)

**Files:** [main.py:149](backend/app/main.py#L149) (`bcrypt__rounds=13`) vs [auth.py:21](backend/app/routers/auth.py#L21) (default = 12).

Seed-admin hashing uses 13 rounds; user registration / readonly-user creation (in `auth.py`) uses 12. Verification still works, but the cost is inconsistent and the `L-SEC-7` intent (raise to 13) isn't actually applied to user-created accounts.

**Fix:** define one shared `pwd_context` (e.g. in a `security.py`) with `bcrypt__rounds=13` and import it everywhere.

---

## 🟢 10 — Deprecated framework APIs (LOW / tech debt)

- **pydantic v1 `@validator`** ([config.py](backend/app/config.py#L49)) — deprecated in pydantic 2 (the repo runs 2.10.x); **removed in pydantic v3**. Migrate to `@field_validator` / `@model_validator` (this also fixes finding #1).
- **`@app.on_event("startup"|"shutdown")`** ([main.py](backend/app/main.py#L157-L163)) — deprecated in modern FastAPI/Starlette. Migrate to the `lifespan=` async context manager.

---

## 🟢 11 — f-string table names in raw SQL (LOW / footgun)

**File:** [admin.py](backend/app/routers/admin.py#L36-L114)

```python
db.execute(text(f"UPDATE {table} SET is_legacy = true WHERE is_legacy = false"))
```

Currently **safe** — `table` only ever comes from a hardcoded local list, never user input. But it's the kind of pattern that becomes an injection bug the moment someone parameterizes the table list. Keep the whitelist explicit and add a comment / assertion that `table in ALLOWED_TABLES` so a future edit can't turn it into a vulnerability.

---

## 🟢 12 — Unescaped LIKE wildcards in contact search (LOW)

**File:** [chatbot_tools.py](backend/app/services/chatbot_tools.py#L322) and similar

`Contact.name.ilike(f"%{contact_name}%")` binds the value safely (no SQL injection), but `%` / `_` supplied by the user act as wildcards, so a search for `_` matches everything. Cosmetic; escape them if exact-ish matching matters.

---

## ✅ Things reviewed and found correct (no action needed)

- **JWT / refresh flow:** rotation on refresh, SHA-256 hashed blacklist, `type` claim checks, generic 401 to prevent username enumeration, role re-read for access tokens — all solid.
- **Admin role checks** (`require_admin`) read the role from the **DB**, not the JWT, so a stale token can't retain admin after a downgrade. Good.
- **SQL:** all dynamic queries use parameter binding (`text(...)` with `:params`, ORM filters). The two raw-SQL routers (`forecast`, `property_deals`) interpolate no user input.
- **Chatbot / LLM:** read-only tools, args filtered to the function signature (`C-INT-1` blocks hallucinated kwargs like `bypass_auth`), role constrained via `Literal`, history capped, upstream errors not leaked, output sanitized with DOMPurify on the frontend. Robust against prompt injection.
- **Concurrency:** payments use `with_for_update()`; the recurring-txn scheduler uses a Postgres advisory lock + `skip_locked` row locks; forecast overrides use `INSERT ... ON CONFLICT`.
- **Frontend token storage:** access token in memory only, refresh via httpOnly cookie, cross-tab logout via `BroadcastChannel`, no `localStorage` token use (verified, including tests).
- **Secret hygiene:** `.env` is **not** git-tracked; `.gitignore` correctly excludes it; only `.env.example` is committed.
- **DB session lifecycle:** `get_db()` rolls back on exception before returning the connection to the pool.

---

## Recommended remediation order

1. **#1 (config validators)** — ship immediately; it nullifies your production secret/password guarantees. ~10 lines.
2. **#3 (refresh token in body)** + **#2 (write authZ)** — close the auth gaps.
3. **#4 (security headers)**, **#8 (disable docs in prod)** — quick wins, one middleware + constructor args.
4. **#5, #6, #7** — robustness/ops hardening.
5. **#9–#12** — tech-debt cleanup, schedule into normal maintenance.

---

## Suggested verification after fixes

```bash
# 1. Config guard now bites in production:
cd backend
APP_ENV=production SECRET_KEY=short SEED_ADMIN_PASSWORD=admin123 \
  DATABASE_URL=sqlite:///x.db python -c "import app.config"   # expect ValidationError

# 2. Viewer cannot write (after #2): log in as a viewer, attempt
curl -X POST .../api/unencumbered-assets -H "Authorization: Bearer <viewer>"  # expect 403

# 3. Headers present (after #4):
curl -I https://<host>/health | grep -iE "x-frame-options|x-content-type|strict-transport"

# 4. Full regression:
pytest -q            # backend
npm test -- --run    # frontend
```
