"""
Shared helper for auto-creating AccountTransaction entries when money moves.
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
    linked_type: str,       # loan | property | partnership | beesi | expense
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
