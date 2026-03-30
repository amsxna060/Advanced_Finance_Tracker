"""
Shared helper for auto-creating AccountTransaction entries when money moves,
and reversing / cleaning up those entries on update or delete.
"""
from decimal import Decimal
from datetime import date as date_type

from sqlalchemy.orm import Session
from app.models.cash_account import AccountTransaction


def auto_ledger(
    db: Session,
    account_id: int,
    txn_type: str,          # "credit" | "debit"
    amount: Decimal,
    txn_date: date_type,
    linked_type: str,       # loan | property | partnership | beesi | expense | obligation
    linked_id: int,
    description: str,
    payment_mode: str | None = None,
    contact_id: int | None = None,
    created_by: int | None = None,
) -> AccountTransaction:
    """Create an AccountTransaction entry linked to a source module."""
    txn = AccountTransaction(
        account_id=account_id,
        txn_type=txn_type,
        amount=amount,
        txn_date=txn_date,
        description=description,
        linked_type=linked_type,
        linked_id=linked_id,
        contact_id=contact_id,
        payment_mode=payment_mode,
        created_by=created_by,
    )
    db.add(txn)
    return txn


def reverse_all_ledger(
    db: Session,
    linked_type: str,
    linked_id: int,
) -> int:
    """Delete ALL AccountTransaction entries for a given linked_type + linked_id.
    Returns the count of rows deleted."""
    rows = db.query(AccountTransaction).filter(
        AccountTransaction.linked_type == linked_type,
        AccountTransaction.linked_id == linked_id,
    ).all()
    for r in rows:
        db.delete(r)
    return len(rows)


def reverse_ledger_match(
    db: Session,
    linked_type: str,
    linked_id: int,
    txn_type: str,
    amount: Decimal,
    txn_date: date_type,
) -> int:
    """Delete AccountTransaction entries matching linked_type/id + txn_type + amount + date.
    Useful when multiple entries exist for the same linked entity (e.g. separate installments).
    Returns the count of rows deleted."""
    rows = db.query(AccountTransaction).filter(
        AccountTransaction.linked_type == linked_type,
        AccountTransaction.linked_id == linked_id,
        AccountTransaction.txn_type == txn_type,
        AccountTransaction.amount == amount,
        AccountTransaction.txn_date == txn_date,
    ).all()
    for r in rows:
        db.delete(r)
    return len(rows)
