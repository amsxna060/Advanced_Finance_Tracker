"""\n/api/recurring-transactions — CRUD for user-defined recurring cash flows.\n"""
from datetime import date, datetime
from typing import List, Optional
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_write_access, require_module
from app.models.user import User
from app.models.recurring_transaction import RecurringTransaction, RecurringType, RecurringFrequency

router = APIRouter(prefix="/api/recurring-transactions", tags=["recurring-transactions"], dependencies=[Depends(require_module("forecast"))])


# ── Schemas ────────────────────────────────────────────────────────────────────

class RecurringTransactionIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    type: RecurringType
    amount: Decimal = Field(..., gt=0)
    frequency: RecurringFrequency
    next_due_date: date
    account_id: Optional[int] = None
    is_active: bool = True


class RecurringTransactionPatch(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    type: Optional[RecurringType] = None
    amount: Optional[Decimal] = Field(None, gt=0)
    frequency: Optional[RecurringFrequency] = None
    next_due_date: Optional[date] = None
    account_id: Optional[int] = None
    is_active: Optional[bool] = None


class RecurringTransactionOut(BaseModel):
    id: int
    title: str
    type: RecurringType
    amount: Decimal
    frequency: RecurringFrequency
    next_due_date: date
    account_id: Optional[int]
    is_active: bool
    # M-DI-16: use datetime, not date, to avoid truncating the timestamp
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("", response_model=List[RecurringTransactionOut])
def list_recurring(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(RecurringTransaction).filter(RecurringTransaction.created_by == current_user.id)
    if not include_inactive:
        q = q.filter(RecurringTransaction.is_active == True)
    return q.order_by(RecurringTransaction.next_due_date).all()


@router.post("", response_model=RecurringTransactionOut, status_code=201)
def create_recurring(
    body: RecurringTransactionIn,
    db: Session = Depends(get_db),
    # C-AUTHZ-2: only admins may create recurring transactions (scheduler posts them to accounts)
    current_user: User = Depends(require_write_access),
):
    # H-AUTHZ-3: validate that the provided account_id actually belongs to current_user
    if body.account_id is not None:
        from app.models.cash_account import CashAccount
        acct = db.query(CashAccount).filter(
            CashAccount.id == body.account_id,
            CashAccount.created_by == current_user.id,
            CashAccount.is_deleted == False,
        ).first()
        if not acct:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="account_id not found or not owned by you")
    item = RecurringTransaction(
        created_by=current_user.id,
        title=body.title,
        type=body.type,
        amount=body.amount,
        frequency=body.frequency,
        next_due_date=body.next_due_date,
        account_id=body.account_id,
        is_active=body.is_active,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=RecurringTransactionOut)
def update_recurring(
    item_id: int,
    body: RecurringTransactionPatch,
    db: Session = Depends(get_db),
    # C-AUTHZ-2: only admins may modify recurring transactions
    current_user: User = Depends(require_write_access),
):
    item = db.query(RecurringTransaction).filter(
        RecurringTransaction.id == item_id,
        RecurringTransaction.created_by == current_user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Recurring transaction not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(item, field, value)

    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
def delete_recurring(
    item_id: int,
    db: Session = Depends(get_db),
    # C-AUTHZ-2: only admins may delete recurring transactions
    current_user: User = Depends(require_write_access),
):
    item = db.query(RecurringTransaction).filter(
        RecurringTransaction.id == item_id,
        RecurringTransaction.created_by == current_user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Recurring transaction not found")
    db.delete(item)
    db.commit()
