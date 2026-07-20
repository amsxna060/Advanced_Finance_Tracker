# Launch Runbook — Phase 1 + 2 together (rev 2, 2026-07-20)

> Simpler than rev 1: the cut-over needs **no data migration at all**.
> All production data is already owned by `amolsaxena060` (migration 046
> backfills every row to the first admin — that's him), and
> `enabled_modules NULL` = all modules. The cut-over is just: create the
> read-only platform admin + demote amolsaxena060 to a normal user —
> both driven by four `.env` lines, executed automatically at startup.
> Deploy = the normal GitHub Actions flow (merge to main → CI deploys).

## Step 0 — BACKUP (do this first, nothing else before it) ✋

SSH to the VM (Postgres is self-hosted there) and dump:

```bash
ssh ubuntu@<VM_PUBLIC_IP>
pg_dump -U <DB_USER> -h localhost finance_tracker \
  | gzip > ~/backup_pre_saas_$(date +%Y%m%d_%H%M).sql.gz
# verify it's a real backup:
gunzip -t ~/backup_pre_saas_*.sql.gz && ls -lh ~/backup_pre_saas_*
# copy it OFF the VM too:
exit
scp ubuntu@<VM_PUBLIC_IP>:~/backup_pre_saas_*.sql.gz ~/Desktop/
```

Restore drill (optional but recommended once):
`createdb ft_restore_test && gunzip -c backup.sql.gz | psql ft_restore_test`

## Step 1 — VM `.env` additions (before or right after deploy — the code is
safe either way; all new settings have backward-compatible defaults)

```bash
# signup stays CLOSED (also the default) until Step 5 signs off
SIGNUP_ENABLED=false
REQUIRE_EMAIL_VERIFICATION=true
EMAIL_BACKEND=console            # switch to smtp + SMTP_* when creds ready
FRONTEND_URL=https://financerbuddy.com

# THE CUT-OVER (activates read-only admin + demotes amolsaxena060):
PLATFORM_ADMIN_USERNAME=fbadmin          # pick any name
PLATFORM_ADMIN_EMAIL=<your email>
PLATFORM_ADMIN_PASSWORD=<12+ chars, save it in a password manager>
DEMOTE_OTHER_ADMINS=true

# REDIS_URL stays unset — tasks run in-process (eager mode). Optional later.
```

Omit the `PLATFORM_ADMIN_*` block to deploy WITHOUT the cut-over first
(everything keeps working exactly as today, amolsaxena060 stays admin);
add the block + restart when ready. Both orders are supported.

## Step 2 — Deploy via the existing pipeline

```bash
git checkout main && git merge --no-ff saas-migration && git push origin main
```

CI runs both test suites, then deploys. Watch on the VM:
`journalctl -u financerbuddy-backend -f` — expect alembic 046 → 049 to run
exactly once (advisory-lock guarded), then
`Provisioned platform admin 'fbadmin'` and `Demoted 'amolsaxena060' ...`
(if the env block was present).

**Rollback:** `git revert -m 1 HEAD && git push` + on the VM
`alembic downgrade 045_activity_logs` (all four migrations have tested
downgrades) + restore the Step-0 backup if anything is ambiguous. ✋

## Step 3 — Smoke as amolsaxena060 (now a normal user)

- [ ] Login works; **all data visible** (loans, properties, expenses, dashboard totals match pre-deploy screenshots).
- [ ] All modules visible in the sidebar (grandfathered NULL = all); Settings can toggle them.
- [ ] Can create/edit/delete records exactly as before.
- [ ] `/admin` is NOT reachable (bounced to dashboard) — correct, he's a normal user now.

## Step 4 — Smoke as fbadmin (read-only platform admin)

- [ ] Login works; own tenant is empty; `/admin` shows stats + user list.
- [ ] "View as" amolsaxena060 → sees his data, banner shown; any write attempt → 403.
- [ ] amolsaxena060's Activity Log shows the `admin_view` entries.
- [ ] Any direct write as fbadmin (e.g. create contact) → 403 "Platform admin is read-only".

## Step 5 — Later, when you want public signup

Work through `SECURITY_REVIEW_SIGNUP.md` deploy-time items (SMTP live test,
CORS, HSTS, audits, two-signup isolation smoke), then set
`SIGNUP_ENABLED=true` + restart. Until then the landing page shows but
signup returns 403 — that's intended.

## Optional — enable real async later (no code change)

```bash
sudo apt install -y redis-server && sudo systemctl enable --now redis-server
# .env: REDIS_URL=redis://localhost:6379/0
# two systemd units (copy financerbuddy-backend.service, change ExecStart):
#   celery -A app.celery_app worker --loglevel=info --concurrency=2
#   celery -A app.celery_app beat --loglevel=info
sudo systemctl restart financerbuddy-backend
```
APScheduler switches off automatically; beat takes over the daily job.
