# Tutorial 07 — Celery in a Right-Sized Production (Epic E7)

*Written 2026-07-20, after Phase 3 was dropped — which changed what "done" means here.*

## Why we needed it (and how much of it)

Two real problems: emails (verification/welcome) were sent synchronously on the request thread — an SMTP hiccup would slow signups; and scheduled work lived in an in-process APScheduler, which couples "the API is up" to "jobs run". Classic Celery territory. But with the service split dropped and load tiny, a mandatory Redis dependency would be pure operational cost.

## The key design: broker-optional

`app/celery_app.py` switches on one env var:

- `REDIS_URL` **empty** → `task_always_eager=True`: `.delay()` executes the task inline, synchronously, in-process. No Redis, no worker, no beat, **no deploy change**. APScheduler keeps handling the daily recurring job. The app behaves byte-for-byte like before.
- `REDIS_URL` **set** → real broker. A worker consumes tasks, beat replaces APScheduler for the daily job (main.py skips starting it — running both schedulers would double-post), and the outbox relay runs every minute.

This means the deploy is risk-free today, and "adding Celery to production" later is: install Redis, add one env var, start two systemd units. Both modes are tested — eager in the pytest suite, broker in a live Redis+worker rehearsal (`send_email.delay(...)` executed by a real worker process, result retrieved via the backend).

## The settings that matter in production (and why)

- `task_acks_late=True` + `worker_prefetch_multiplier=1` — at-least-once delivery: a worker killed mid-task re-delivers instead of losing the job. Consequence: **tasks must be idempotent** (why the recurring-transactions body keeps its advisory lock + row locks, and why event handlers dedupe).
- `task_eager_propagates=False` — in eager mode a task exception must not become a 500 on the signup that queued it. Fire-and-forget means *actually* forgetting.
- Retries with backoff only when a broker exists (`self.retry` in `send_email`) — eager retries would block the request thread, the exact thing we're avoiding.
- Task bodies stay thin, logic lives in services — tasks are transport, not home.

## What we deliberately did NOT do

FB-7.3 (async PDF/Excel reports with task-id polling) was **descoped**: report generation takes ~1s at this data size, and the polling UX + frontend rework buys nothing. Wrote it down in the backlog as a decision, not a TODO. Knowing when a queue makes latency *worse* (enqueue + poll overhead > work) is half the skill.

## Mistakes / surprises along the way

- Tasks that open their own `SessionLocal` would have **escaped the per-test transaction rollback** and polluted the test DB. Fix: in eager mode the outbox dispatch reuses the *request's* session; only real workers open their own. Session lifecycle is where Celery codebases rot first.
- The `memory://` broker URL is required even in eager mode — Celery validates config before checking eagerness.

## How big orgs do it at scale

Dedicated queues per priority (`emails`, `reports`, `default`), Flower/Prometheus for depth+latency dashboards, autoscaled workers, and idempotency keys stored per task run. The concepts are exactly the ones above; only the ceremony grows.

## Interview drill

1. `acks_late` vs default acking — what failure mode does each choose?
2. Why must at-least-once consumers be idempotent, and where did we enforce it?
3. When does adding a task queue make a system *slower*? Give the reports example.
4. How do you introduce Celery to a production app with zero deploy risk? (Broker-optional eager fallback.)
5. Why is one scheduler (beat XOR APScheduler) a hard rule, and what guards the same-moment race anyway? (Advisory lock.)
