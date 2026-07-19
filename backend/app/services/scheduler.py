"""
APScheduler background task runner.

Job: process_recurring_transactions
  - Runs daily at 00:05 UTC
  - For each active RecurringTransaction where next_due_date <= today:
      1. Create an AccountTransaction (credit for inflow, debit for outflow) per missed period
      2. Advance next_due_date by the item's frequency until it is > today

C-FIN-13 (multi-worker): A Postgres advisory lock guards the entire job so only
  one worker runs it even with Gunicorn/Uvicorn multi-process deployments.

C-FIN-12 (missed periods): Loop advances next_due_date until > today, creating
  one ledger entry per missed period (catch-up).

C-FIN-14 (no-account advance): next_due_date is only advanced after an
  AccountTransaction is created. Items without account_id are skipped entirely
  so they do not silently tick forward with no record.

C-FIN-15 (day drift): The original day-of-month is preserved by clamping the
  monthly advance to the item's original due day.
"""

import calendar
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.database import SessionLocal
from app.models.recurring_transaction import RecurringTransaction, RecurringFrequency
from app.models.cash_account import AccountTransaction

scheduler = BackgroundScheduler(timezone="UTC")

# Arbitrary unique integer for pg_try_advisory_lock (same across all workers)
_ADVISORY_LOCK_KEY = 202605081234


def _advance_date(d: date, frequency: RecurringFrequency) -> date:
    """Advance d by one period, preserving the original day-of-month for monthly items."""
    if frequency == RecurringFrequency.weekly:
        return d + timedelta(weeks=1)
    if frequency == RecurringFrequency.yearly:
        return d + relativedelta(years=1)
    # C-FIN-15: monthly — advance by one month, then clamp to the same day-of-month as d
    original_day = d.day
    next_d = d + relativedelta(months=1)
    # Clamp day to the last valid day of the target month (preserves "31st" semantics)
    max_day = calendar.monthrange(next_d.year, next_d.month)[1]
    return next_d.replace(day=min(original_day, max_day))


def process_recurring_transactions():
    """Run once daily; settle all due recurring items and roll their next_due_date forward."""
    today = date.today()
    db = SessionLocal()
    try:
        # C-FIN-13: acquire a Postgres advisory lock so only one worker runs the job
        locked = db.execute(
            __import__("sqlalchemy").text("SELECT pg_try_advisory_lock(:key)"),
            {"key": _ADVISORY_LOCK_KEY},
        ).scalar()
        if not locked:
            return  # another worker is already running the job

        due = (
            db.query(RecurringTransaction)
            .filter(
                RecurringTransaction.is_active == True,
                RecurringTransaction.next_due_date <= today,
            )
            # H-CONC-4: lock each row so a concurrent user edit doesn't race with
            # the scheduler advancing next_due_date on the same row.
            .with_for_update(skip_locked=True)
            .all()
        )

        posted = 0
        for item in due:
            # C-FIN-14: skip items with no account — there is nothing to post
            if not item.account_id:
                continue

            # C-FIN-12: create one ledger entry per missed period and advance date accordingly
            current_due = item.next_due_date
            while current_due <= today:
                txn_type = "credit" if item.type.value == "inflow" else "debit"
                txn = AccountTransaction(
                    account_id=item.account_id,
                    txn_type=txn_type,
                    amount=item.amount,
                    txn_date=current_due,
                    description=f"[Recurring] {item.title}",
                    linked_type="recurring",
                    linked_id=item.id,
                    created_by=item.created_by,
                    # Scheduler sessions have no tenant context (app/tenancy.py
                    # stamps nothing here) — the ledger row must inherit the
                    # tenant of the recurring item that produced it.
                    owner_id=item.owner_id,
                    # F10: stamp the exact source so reversals can match this
                    # row precisely instead of falling back to the heuristic
                    source_type="recurring_transaction",
                    source_id=item.id,
                )
                db.add(txn)
                posted += 1
                # C-FIN-14: only advance next_due_date after a successful ledger entry
                current_due = _advance_date(current_due, item.frequency)

            item.next_due_date = current_due

        db.commit()
        if posted:
            print(f"[scheduler] posted {posted} recurring transaction(s) for {today}")

    except Exception as exc:
        db.rollback()
        print(f"[scheduler] ERROR in process_recurring_transactions: {exc}")
    finally:
        # Release the advisory lock (runs even on exception)
        try:
            db.execute(
                __import__("sqlalchemy").text("SELECT pg_advisory_unlock(:key)"),
                {"key": _ADVISORY_LOCK_KEY},
            )
            db.commit()
        except Exception:
            pass
        db.close()


def start_scheduler():
    scheduler.add_job(
        process_recurring_transactions,
        trigger=CronTrigger(hour=0, minute=5),
        id="recurring_transactions",
        replace_existing=True,
    )
    scheduler.start()


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
