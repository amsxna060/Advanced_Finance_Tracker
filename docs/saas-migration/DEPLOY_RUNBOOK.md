# Phase-1 Launch Runbook (FB-6.3)

> Executes the cut-over from personal app → multi-tenant SaaS on the OCI VM.
> Everything below is idempotent or has a stated rollback. Do it top to
> bottom; stop at any ✋ if something looks wrong.

## 0. Pre-flight (day before)

- [ ] `git log main..saas-migration --oneline` — review what ships (5 epic commits).
- [ ] Supabase: take a **manual backup/snapshot** and verify you can download it. ✋ Do not proceed without a restorable backup.
- [ ] Run the full suites locally one last time:
      `cd backend && ../.venv/bin/python -m pytest -q` (expect 282+)
      `cd frontend && npm test -- --run && npm run build`

## 1. New environment variables (server `.env`)

Add to `/home/ubuntu/Advanced_Finance_Tracker/backend/.env`:

```bash
# E3 — signup stays CLOSED until step 6 signs off
SIGNUP_ENABLED=false
REQUIRE_EMAIL_VERIFICATION=true
EMAIL_BACKEND=smtp                 # console until SMTP creds are ready
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<your gmail>
SMTP_PASSWORD=<gmail app password>
EMAIL_FROM="FinancerBuddy <no-reply@financerbuddy.com>"
FRONTEND_URL=https://financerbuddy.com
```

## 2. Deploy the branch

Push `saas-migration` to GitHub **without** merging to main, then on the VM:

```bash
cd /home/ubuntu/Advanced_Finance_Tracker
git fetch && git checkout saas-migration && git pull
./deploy.sh        # or: systemctl restart financerbuddy-backend after pip install
```

Migrations 046 → 048 run automatically at startup (advisory-lock guarded).
**Watch the logs**: `journalctl -u financerbuddy-backend -f` — you must see
alembic run 046, 047, 048 exactly once.

Rollback at this step: `git checkout main && ./deploy.sh` +
`alembic downgrade 045_activity_logs` (all three migrations have tested
downgrades) + restore backup if anything is ambiguous. ✋

## 3. Smoke test as the existing admin

- [ ] Log in with your current credentials — all data visible exactly as before (you are grandfathered: all modules, all rows now owner-stamped).
- [ ] Dashboard totals match a screenshot taken before the deploy.
- [ ] Admin Console (`/admin`) loads; stats show 1 owner; Activity Logs work.

## 4. Cut-over: become a normal user (FB-6.1)

```bash
# temporarily: SIGNUP_ENABLED=true, REQUIRE_EMAIL_VERIFICATION as you prefer
# sign up your personal account (e.g. "amol") via the UI, complete the questionnaire
cd backend
python scripts/migrate_tenant_owner.py --from-user admin --to-user amol --dry-run   # counts sane? ✋
python scripts/migrate_tenant_owner.py --from-user admin --to-user amol
sudo systemctl restart financerbuddy-backend    # drop stale sessions
```

- [ ] Log in as **amol** — all historical data present; set enabled modules as you like.
- [ ] Log in as **admin** — sees an EMPTY tenant (correct!), uses Admin Console + "View as" for support.
- [ ] Reversal if needed: swap `--from-user/--to-user`.

## 5. Frontend + domain

- [ ] CI builds the frontend from the branch (or `npm run build` + scp `dist/` to `/var/www/finance-frontend`).
- [ ] nginx serves the SPA for `/`, `/signup`, `/privacy`, `/terms` (SPA fallback already handles client routes).
- [ ] `https://financerbuddy.com/` shows the landing page logged-out; robots.txt + sitemap.xml reachable.

## 6. Security review → open signup

Work through **SECURITY_REVIEW_SIGNUP.md** deploy-time items (SMTP live test,
CORS, HSTS, `pip-audit`/`npm audit`, rate-limit-behind-proxy check, backup
drill, two-signup isolation smoke). When every box is ✅ and APPROVED:

```bash
# .env: SIGNUP_ENABLED=true   → restart backend
```

- [ ] Final smoke: sign up two fresh throwaway users, verify each sees only their own data, run the questionnaire, log an expense each.

## 7. Merge

Only after 1–6 are green in production:

```bash
git checkout main && git merge --no-ff saas-migration && git push origin main
```

(CI will redeploy main — a no-op since the VM already runs this code.)

## Memory budget note

Phase 1 adds no new processes (no Redis/Celery yet — that's Phase 2). The
VM's footprint is unchanged: uvicorn 2 workers + nginx.
