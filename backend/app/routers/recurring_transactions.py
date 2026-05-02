"""
/api/recurring-transactions — CRUD for user-defined recurring cash flows.
"""
from datetime import date
from typing import List, Optional
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.recurring_transaction import RecurringTransaction, RecurringType, RecurringFrequency

router = APIRouter(prefix="/api/recurring-transactions", tags=["recurring-transactions"])


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
    created_at: Optional[date] = None

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
    current_user: User = Depends(get_current_user),
):
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
):
    item = db.query(RecurringTransaction).filter(
        RecurringTransaction.id == item_id,
        RecurringTransaction.created_by == current_user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Recurring transaction not found")
    db.delete(item)
    db.commit()
