# Tutorial 03 — Feature Flags, Entitlements & Public Signup (Epic E3)

*Written during E3, 2026-07-19.*

## Why we needed it (the problem in THIS codebase)

Opening signup to strangers raised two product problems: (a) `/register` was admin-gated and there was no verification, password policy or abuse control; (b) the app shows 16 feature areas — a salaried user who just wants expense tracking drowns in Loans/Property/Partnership/Beesi menus. We needed *entitlements*: per-account feature sets chosen via a questionnaire.

## Feature flags vs entitlements (know the difference in interviews)

- **Feature flag**: operator-controlled, temporary, for rollout/kill-switch ("enable new dashboard for 10%"). Lives in config/flag service, changes without deploys.
- **Entitlement**: user/account-controlled or plan-controlled, permanent, part of the product ("this account has the Loans module"). Lives in the database next to the account.
- We built entitlements — but `SIGNUP_ENABLED` is a classic operator flag; one epic shipped both.

## What we built

1. **Registry as single source of truth** — [backend/app/modules.py](../../../backend/app/modules.py): 6 core + 10 optional modules with labels/descriptions. Two invariants enforced in one place: unknown keys are rejected, core keys are force-included. The frontend keeps a *display mirror* ([src/lib/modules.js](../../../frontend/src/lib/modules.js)) — the server never trusts it.
2. **Storage with a grandfather clause** — `users.enabled_modules` JSON, where `NULL = all modules`. Migration 047 touches nothing: every existing account (yours) keeps full features with zero backfill risk. Explicit lists are only ever written by signup/questionnaire/Settings.
3. **Server-side gate** — `require_module(key)` ([dependencies.py](../../../backend/app/dependencies.py)) attached at **router level** (`APIRouter(..., dependencies=[...])`), so all ~10 optional routers got gated in one line each, and new endpoints in those routers are gated automatically. Household guests resolve entitlements from the tenant *owner*. Key honesty note in the docstring: this is UX/API hygiene — *tenancy* is the security boundary. Mixed routers (analytics) stay ungated: a user without the property module just has zero property rows.
4. **Signup done properly** — `POST /api/auth/signup`: pydantic password policy, username pattern, always `role="viewer"` (role injection tested), 10/hour rate limit, `SIGNUP_ENABLED` kill switch, email verification via a typed JWT (`type=email_verify`, 48h — no token table needed), constant-response `/resend-verification` against account enumeration, `REQUIRE_EMAIL_VERIFICATION` toggle so dev works without SMTP. Email goes through [email_service.py](../../../backend/app/services/email_service.py) — a 60-line backend interface (console/smtp) that swaps to SES later without touching callers.
5. **Frontend** — Signup page (+ link from Login), a 5-question yes/no onboarding wizard mapping answers → modules (skippable → sensible default), `RequireModule` route guard (deep links to disabled modules bounce to dashboard), module-filtered sidebar (with empty-section divider cleanup), and a Settings page with toggles ("turning off hides, never deletes").

## Mistakes / surprises along the way

- **Both ends must gate.** Filtering the sidebar looks done until you paste `/loans` into the URL bar; guarding routes looks done until a bot hits the API directly. Nav filter + `RequireModule` + `require_module` = three layers, each cheap because the registry is shared.
- **`NULL` as "everything" is the cheapest migration you'll ever write** — but it must be *documented at the column* or a future dev will "fix" it to `[]` and brick legacy accounts. The semantics live in the model comment and the registry docstring.
- **Router-level `dependencies=[...]`** beats per-endpoint decoration: 10 routers gated in 10 lines, and it's impossible to forget the guard on a new endpoint.
- React StrictMode double-mounts effects in dev — the verify-email page needed a `useRef` guard so the token isn't consumed twice.

## How big orgs do it at scale

- Entitlements move from a JSON column to a `plans`/`subscriptions` join once billing exists (Stripe products ↔ module sets); the check-site (`require_module`) doesn't change.
- Flags graduate to a flag service (LaunchDarkly/Unleash) with percentage rollouts and audit.
- Signup abuse: velocity rules + IP reputation + captcha-on-suspicion rather than captcha-for-everyone.
- Verification emails via a queue (our Phase 2 Celery work will move `send_verification_email` off the request thread — today it's a synchronous best-effort call).

## Interview drill — you should now be able to answer:

1. Feature flag vs entitlement — definitions, storage, who flips them.
2. Why must entitlement validation be server-side, and where's the cheapest single place to enforce it in FastAPI?
3. How do you add entitlements to an existing user base with zero migration risk? (NULL = grandfathered.)
4. Design an email-verification flow with no extra tables. What claim prevents token-type confusion?
5. What are the three layers of module gating in a SPA + API app, and what does each protect against?
