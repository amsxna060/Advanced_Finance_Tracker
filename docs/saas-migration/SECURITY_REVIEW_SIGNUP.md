# FB-3.7 — Security review before opening public signup

> Gate: production keeps `SIGNUP_ENABLED=false` until every ☐ below is ✅ and
> this file is marked APPROVED. Re-run the full checklist during the E6
> deploy — config drifts.

## Already in place (verified while building E3)

- ✅ Tenant isolation with automatic query scoping + 24-test merge-gate suite (E1)
- ✅ Ownership-based authorization; `admin` = platform-only surfaces (E2)
- ✅ Signup rate limit `10/hour` per IP, stricter than login's `10/minute`
- ✅ Resend-verification rate-limited `5/hour`, constant response (no account enumeration); login uses a single generic "Invalid credentials"
- ✅ Password policy: ≥8 chars, letters + digits, bcrypt rounds 13
- ✅ Role injection blocked: `/signup` ignores any role field, always `viewer` (tested)
- ✅ Email verification tokens: JWT `type=email_verify`, 48h expiry; token-type confusion tested (access token rejected as verify token)
- ✅ Refresh-token rotation + blacklist, httpOnly SameSite=Strict cookie (pre-existing)
- ✅ `SIGNUP_ENABLED` master switch, off-able without deploy

## To verify at deploy time (E6)

- ☐ `APP_ENV=production` on the server (activates secret-strength validators, secure cookies)
- ☐ `REQUIRE_EMAIL_VERIFICATION=true` in prod `.env`
- ☐ `EMAIL_BACKEND=smtp` configured and a real signup receives the mail
- ☐ `CORS_ORIGINS` lists only `https://financerbuddy.com` (+www)
- ☐ nginx: HTTPS enforced, HSTS header present
- ☐ `pip-audit` on backend requirements — no known-exploited CVEs
- ☐ `npm audit --omit=dev` on frontend — no high/critical
- ☐ Global rate limit (60/min) still active behind proxy: confirm slowapi sees the real client IP (`--forwarded-allow-ips` + `X-Forwarded-For` from nginx), otherwise all users share one bucket
- ☐ Decide captcha: launch WITHOUT captcha but monitor signups/day; add hCaptcha/Turnstile on `/signup` if abuse appears (revisit after first 50 signups)
- ☐ Supabase DB: confirm daily backups enabled + restore once as a drill
- ☐ Privacy policy + ToS pages live (FB-6.2) — legally required before collecting emails
- ☐ Smoke test on prod: two fresh signups cannot see each other's data

**APPROVED:** ☐ (date, by)
