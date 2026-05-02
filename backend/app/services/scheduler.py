"""
APScheduler background task runner.

Job: process_recurring_transactions
  - Runs daily at 00:05 UTC
  - For each active RecurringTransaction where next_due_date <= today:
      1. Create an AccountTransaction (credit for inflow, debit for outflow)
      2. Advance next_due_date by the item's frequency
"""

from datetime import date
from dateutil.relativedelta import relativedelta

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.database import SessionLocal
from app.models.recurring_transaction import RecurringTransaction, RecurringFrequency
from app.models.cash_account import AccountTransaction

scheduler = BackgroundScheduler(timezone="UTC")


def _advance_date(d: date, frequency: RecurringFrequency) -> date:
    if frequency == RecurringFrequency.weekly:
        from datetime import timedelta
        return d + timedelta(weeks=1)
    if frequency == RecurringFrequency.yearly:
        return d + relativedelta(years=1)
    # monthly default
    return d + relativedelta(months=1)


def process_recurring_transactions():
    """Run once daily; settle all due recurring items and roll their next_due_date forward."""
    today = date.today()
    db = SessionLocal()
    try:
        due = (
            db.query(RecurringTransaction)
            .filter(
                RecurringTransaction.is_active == True,
                RecurringTransaction.next_due_date <= today,
            )
            .all()
        )

        for item in due:
            if item.account_id:
                txn_type = "credit" if item.type.value == "inflow" else "debit"
                txn = AccountTransaction(
                    account_id=item.account_id,
                    txn_type=txn_type,
                    amount=item.amount,
                    txn_date=item.next_due_date,
                    description=f"[Recurring] {item.title}",
                    linked_type="recurring",
                    linked_id=item.id,
                    created_by=item.created_by,
                )
                db.add(txn)

            item.next_due_date = _advance_date(item.next_due_date, item.frequency)

        db.commit()
        if due:
            print(f"[scheduler] processed {len(due)} recurring transaction(s) for {today}")
    except Exception as exc:
        db.rollback()
        print(f"[scheduler] ERROR in process_recurring_transactions: {exc}")
    finally:
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
