"""E7 — Celery tasks. Keep task bodies thin: real logic lives in services.

Every task here is safe in BOTH modes (eager without Redis, worker with):
  - send_email: retries with backoff only when a real broker exists.
  - process_recurring: reuses the battle-tested APScheduler job body, which
    is already advisory-lock guarded and idempotent.
  - dispatch_outbox: drains pending outbox events (see app/events.py).
    Worker mode opens its own session; handlers scope by event.owner_id
    explicitly, so no tenant context is needed.
"""

import logging

from app.celery_app import celery_app
from app.config import settings

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.send_email", bind=True,
                 max_retries=3, default_retry_delay=60)
def send_email(self, to: str, subject: str, body: str) -> bool:
    from app.services.email_service import send_email as _send
    ok = _send(to, subject, body)
    if not ok and settings.REDIS_URL:
        # Only retry with a real broker; eager retries would block the request
        raise self.retry(exc=RuntimeError(f"email to {to} failed"))
    return ok


@celery_app.task(name="app.tasks.process_recurring")
def process_recurring() -> None:
    from app.services.scheduler import process_recurring_transactions
    process_recurring_transactions()


@celery_app.task(name="app.tasks.dispatch_outbox")
def dispatch_outbox(limit: int = 100) -> int:
    from app.database import SessionLocal
    from app.events import dispatch_pending

    db = SessionLocal()
    try:
        return dispatch_pending(db, limit=limit)
    finally:
        db.close()


@celery_app.task(name="app.tasks.revalue_gold")
def revalue_gold() -> dict:
    import asyncio
    from app.database import SessionLocal
    from app.services.settings_store import get_setting
    from app.services.gold_revaluation import revalue_all_gold

    db = SessionLocal()
    try:
        if not get_setting(db, "gold_auto_refresh_enabled"):
            return {"ok": False, "reason": "disabled"}
        return asyncio.run(revalue_all_gold(db))
    finally:
        db.close()
