"""E7 — Celery application.

Two modes, switched by REDIS_URL (app/config.py):

  REDIS_URL set    -> real broker: worker + beat processes consume tasks.
                      Beat schedules recurring-transaction processing (which
                      replaces APScheduler — main.py skips it) and the
                      outbox relay.
  REDIS_URL empty  -> task_always_eager: .delay() runs the task inline,
                      synchronously, in-process. No Redis, no workers, no
                      deploy changes — the app behaves exactly as before.

The eager fallback is the deliberate production posture for the current
single-VM, low-load deployment; Redis can be added later by setting one env
var and starting two systemd units (see DEPLOY_RUNBOOK.md).

Run (only needed when REDIS_URL is set):
  celery -A app.celery_app worker --loglevel=info --concurrency=2
  celery -A app.celery_app beat   --loglevel=info
"""

from celery import Celery
from celery.schedules import crontab

from app.config import settings

celery_app = Celery(
    "financerbuddy",
    broker=settings.REDIS_URL or "memory://",
    backend=settings.REDIS_URL or None,
)

celery_app.conf.update(
    task_always_eager=not settings.REDIS_URL,
    # Eager task errors must not propagate into the request that queued them
    # (an email failure must never fail a signup).
    task_eager_propagates=False,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    # At-least-once: worker acks after the task finishes, so a killed worker
    # re-delivers. Handlers must therefore be idempotent (see app/events.py).
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    beat_schedule={
        # Replaces APScheduler's daily 00:05 UTC job when Redis is active
        "process-recurring-transactions": {
            "task": "app.tasks.process_recurring",
            "schedule": crontab(hour=0, minute=5),
        },
        # Outbox relay safety net: picks up any event a request-time enqueue
        # missed (crash between commit and enqueue) within a minute.
        "dispatch-outbox": {
            "task": "app.tasks.dispatch_outbox",
            "schedule": 60.0,
        },
    },
)

# Register tasks on import (worker: -A app.celery_app)
import app.tasks  # noqa: E402, F401
