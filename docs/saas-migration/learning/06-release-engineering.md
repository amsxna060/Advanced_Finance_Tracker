# Tutorial 06 — Release Engineering & the Cut-over (Epic E6)

*Written while preparing the Phase-1 launch, 2026-07-19.*

## Why we needed it (the problem in THIS codebase)

Five epics of changes — 3 schema migrations, a permission flip, new auth flows — must land on a live single-user app **without the user (you) losing a rupee of data**, and end with you demoted from god-mode admin to a normal tenant. That final step (the "cut-over") is the riskiest single operation of Phase 1.

## Expand → migrate → contract (the pattern behind every migration we wrote)

- **Expand**: add new structures alongside old ones (nullable `owner_id`, new `assets` table, `enabled_modules` with NULL-means-all). Old code keeps running.
- **Migrate**: backfill/copy data (owner backfill in 046, unencumbered→assets copy in 048), each in the same transaction as its DDL where possible.
- **Contract**: enforce/retire (NOT NULL constraints; legacy rows soft-deleted; legacy API left dormant). We deliberately *haven't* dropped anything — contraction can wait months; premature deletion can't be undone.

Every migration got a **rehearsal on a throwaway Dockerised Postgres** seeded to look like production. The rehearsals paid rent every single time: the 048 downgrade bug, the "sequences don't roll back" surprises, the backfill checks.

## The cut-over tool (FB-6.1)

`backend/scripts/migrate_tenant_owner.py` moves an entire tenant to another user:

- **Table inventory from the mapper registry** (`Base.registry.mappers` filtered to `TenantMixin`) — the script literally cannot forget a table, including ones added after it was written (the new `assets` table appeared automatically).
- **One transaction, all-or-nothing**; `--dry-run` runs the identical UPDATEs and rolls back, so the counts you review are the counts you'll commit.
- **Audit stays honest**: `created_by` is not rewritten — history keeps saying who typed what; only *ownership* moves.
- **Reversible by swapping the arguments.**
- Rehearsed: seed → dry-run (verified zero changes) → real run (verified rows, guests re-pointed, audit untouched) → reversal.

## The runbook (FB-6.3)

`DEPLOY_RUNBOOK.md` encodes the deployment as a checklist with ✋ stop-points:
backup first (and *verify restorability* — a backup you've never restored is a hope, not a backup), deploy the branch **without merging**, watch migrations run once, smoke as the old admin, cut over, smoke as the new user, work the security checklist, only then open signup, and only after production is green does `main` move. The branch-then-merge order means `main` never points at code that hasn't already survived production.

## Mistakes / surprises along the way

- Writing the runbook surfaced an ordering trap: restart the backend after the cut-over script — live sessions hold identity-map references to rows whose owner just changed.
- `robots.txt` needed `Disallow: /api/` and app routes; SEO for a SPA is mostly "make `/`, `/signup`, `/privacy` render something crawlable and don't index the app".
- Honest legal pages are *easier* to write than vague ones: the privacy policy states support access exists, is read-only, and is visible in the user's own activity log — because that's literally what E5 built.

## How big orgs do it at scale

- The runbook becomes automation (Argo/Spinnaker pipelines) with the same stop-points as manual approval gates; feature flags decouple deploy from release (`SIGNUP_ENABLED` is exactly that in miniature).
- Cut-over-style data operations run as reviewed "data migrations" with dry-run output attached to the change ticket — the `--dry-run`-then-commit ritual is industry standard.
- Blue/green or canary deploys replace "watch journalctl", but the invariant is identical: old version keeps working until the new one proves itself.

## Interview drill — you should now be able to answer:

1. Walk through expand → migrate → contract for adding a NOT NULL column to a live table.
2. Why rehearse *downgrades*, and what's the cheapest way to rehearse against production-like data?
3. Design a safe "move all of user A's data to user B" operation. What must NOT move?
4. Why deploy a branch to production *before* merging it to main?
5. What makes a backup real? (A verified restore.)
