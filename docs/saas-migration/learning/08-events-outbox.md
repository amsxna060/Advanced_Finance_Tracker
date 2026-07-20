# Tutorial 08 — The Transactional Outbox, In-App Edition (Epic E8, trimmed)

*Written 2026-07-20. Original scope (SNS/SQS/Kafka) was cut with Phase 3; the pattern survived because it's useful even inside one process.*

## The problem the outbox solves

"When an expense is created, also check the category limit and maybe alert" — the naive version either does it inline (coupling: expense creation now knows about alerting, mails, and whatever comes next) or fires an async job after commit (lost forever if the process dies between commit and enqueue). The outbox closes that gap:

1. `emit_event(db, "expense.created", {...})` writes an `outbox_events` row **in the same transaction** as the expense → the event exists *iff* the change committed. Rollback kills both (tested).
2. A relay delivers pending rows to handlers **at least once**: inline (`flush_events` after commit) in eager mode; a Celery task + a 60s beat sweep in broker mode. The sweep is the safety net for a crash between commit and enqueue.
3. Failures are per-event: `attempts` + `last_error` columns; after `MAX_ATTEMPTS=5` the row is **parked** — a poor man's dead-letter queue you can inspect with plain SQL and retry by resetting `attempts`.

## At-least-once forces idempotent handlers

The limit-alert handler can run twice for the same event (redelivery) or for two events in the same month (60 + 70 + 80). It therefore dedupes on a natural key — one alert per `(category, month)` — checked before insert. The test asserts exactly this: three over-limit expenses, one alert. **This is the single most transferable lesson in the epic**: delivery guarantees are a contract between infrastructure and handler code; "at least once" is only safe when handlers are "at most once effective".

## Tenancy meets background work

Handlers may run in a worker session that has **no tenant context** — E1's automatic filter protects nothing there. So the event row carries `owner_id`, and handlers scope every query by it *explicitly* (with `skip_tenant_filter` to make the bypass grep-able). Rule of thumb we adopted: request code gets implicit tenancy, background code gets explicit tenancy, and the event payload is the handoff.

## What events exist, and what deliberately doesn't

- `user.signed_up` → welcome email (via the E7 email task).
- `expense.created` → category-limit alert into the activity log.
- **FB-8.3 resolved: the ledger stays synchronous.** Moving `auto_ledger` behind events would make account balances eventually consistent — a user logging an expense expects the account balance on the next screen to be right. Financial consistency > architectural fashion. The spike's conclusion is recorded in the backlog.

## Mistakes / surprises along the way

- First version of the month filter was a dialect-branching `strftime`/`to_char` mess; a half-open date range (`>= month_start AND < next_month`) is portable, index-friendly, and readable. SQL portability is usually a modelling problem, not a function problem.
- The outbox table is deliberately **not** a `TenantMixin`: the relay must sweep all tenants, and the table has no user-facing endpoint. Knowing when *not* to apply your own pattern matters.
- The audit logger had to skip `OutboxEvent` rows — otherwise every event would generate a meta-log entry (noise, and a subtle infinite-ish loop with handlers that write logs).

## How big orgs do it at scale

Same table, but the relay publishes to Kafka/SNS instead of calling local handlers (Debezium can even tail the WAL so the relay is zero-code); consumer groups replace the handler registry; DLQs are real queues with redrive tooling. The in-app version we built is the same pattern minus the broker — if the broker ever arrives, `dispatch_pending` is the only function that changes.

## Interview drill

1. What exact failure does the outbox close that "commit, then enqueue" leaves open?
2. Why must the event row be written *before* commit but delivered *after*?
3. Design an idempotent handler for "send an alert when a limit is exceeded". What's the natural key?
4. Why do background handlers need explicit tenant scoping when request code gets it implicitly?
5. When is eventual consistency the wrong choice? (Ledger example.)
