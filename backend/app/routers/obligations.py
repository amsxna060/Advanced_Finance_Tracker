"""
Money obligations (receivables / payables) router.

Tracks who owes what, settlement progress, and linked deals.
"""
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.contact import Contact
from app.models.obligation import MoneyObligation, ObligationSettlement
from app.models.user import User
from app.schemas.obligation import (
    ObligationCreate,
    ObligationOut,
    ObligationUpdate,
    SettlementCreate,
    SettlementOut,
)
from app.schemas.loan import ContactBrief
from app.services.auto_ledger import auto_ledger

router = APIRouter(prefix="/api/obligations", tags=["obligations"])

_D = lambda v: Decimal("0") if v is None else Decimal(str(v))


@router.get("", response_model=List[dict])
def list_obligations(
    obligation_type: Optional[str] = None,
    status: Optional[str] = None,
    contact_id: Optional[int] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(MoneyObligation).filter(MoneyObligation.is_deleted == False)
    if obligation_type:
        query = query.filter(MoneyObligation.obligation_type == obligation_type)
    if status:
        query = query.filter(MoneyObligation.status == status)
    if contact_id:
        query = query.filter(MoneyObligation.contact_id == contact_id)
    if search:
        sf = f"%{search}%"
        query = query.filter(
            or_(MoneyObligation.reason.ilike(sf), MoneyObligation.notes.ilike(sf))
        )

    obligations = query.order_by(MoneyObligation.created_at.desc()).offset(skip).limit(limit).all()
    result = []
    for ob in obligations:
        result.append({
            "obligation": ObligationOut.model_validate(ob),
            "contact": ContactBrief.model_validate(ob.contact) if ob.contact else None,
        })
    return result


@router.post("", response_model=ObligationOut)
def create_obligation(
    data: ObligationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    contact = db.query(Contact).filter(Contact.id == data.contact_id, Contact.is_deleted == False).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    if data.obligation_type not in ("receivable", "payable"):
        raise HTTPException(status_code=400, detail="obligation_type must be 'receivable' or 'payable'")

    ob = MoneyObligation(**data.model_dump(), created_by=current_user.id)
    db.add(ob)
    db.commit()
    db.refresh(ob)
    return ob


@router.get("/summary/overview", response_model=dict)
def obligations_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get summary of all receivables and payables."""
    obligations = db.query(MoneyObligation).filter(
        MoneyObligation.is_deleted == False,
    ).all()

    total_receivable = sum(_D(o.amount) - _D(o.amount_settled)
                          for o in obligations if o.obligation_type == "receivable" and o.status != "settled")
    total_payable = sum(_D(o.amount) - _D(o.amount_settled)
                        for o in obligations if o.obligation_type == "payable" and o.status != "settled")

    return {
        "total_receivable": float(total_receivable),
        "total_payable": float(total_payable),
        "net_position": float(total_receivable - total_payable),
        "pending_count": sum(1 for o in obligations if o.status != "settled"),
    }


@router.get("/{obligation_id}", response_model=dict)
def get_obligation(
    obligation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ob = db.query(MoneyObligation).filter(
        MoneyObligation.id == obligation_id,
        MoneyObligation.is_deleted == False,
    ).first()
    if not ob:
        raise HTTPException(status_code=404, detail="Obligation not found")

    settlements = db.query(ObligationSettlement).filter(
        ObligationSettlement.obligation_id == obligation_id,
    ).order_by(ObligationSettlement.settlement_date.desc()).all()

    return {
        "obligation": ObligationOut.model_validate(ob),
        "contact": ContactBrief.model_validate(ob.contact) if ob.contact else None,
        "settlements": [SettlementOut.model_validate(s) for s in settlements],
    }


@router.put("/{obligation_id}", response_model=ObligationOut)
def update_obligation(
    obligation_id: int,
    data: ObligationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    ob = db.query(MoneyObligation).filter(
        MoneyObligation.id == obligation_id,
        MoneyObligation.is_deleted == False,
    ).first()
    if not ob:
        raise HTTPException(status_code=404, detail="Obligation not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(ob, field, value)

    db.commit()
    db.refresh(ob)
    return ob


@router.delete("/{obligation_id}")
def delete_obligation(
    obligation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    ob = db.query(MoneyObligation).filter(
        MoneyObligation.id == obligation_id,
        MoneyObligation.is_deleted == False,
    ).first()
    if not ob:
        raise HTTPException(status_code=404, detail="Obligation not found")
    ob.is_deleted = True
    db.commit()
    return {"message": "Obligation deleted"}


@router.post("/{obligation_id}/settle", response_model=SettlementOut)
def settle_obligation(
    obligation_id: int,
    data: SettlementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    ob = db.query(MoneyObligation).filter(
        MoneyObligation.id == obligation_id,
        MoneyObligation.is_deleted == False,
    ).first()
    if not ob:
        raise HTTPException(status_code=404, detail="Obligation not found")

    settlement = ObligationSettlement(
        obligation_id=obligation_id,
        created_by=current_user.id,
        **data.model_dump(),
    )
    db.add(settlement)

    # Update amount_settled and status
    ob.amount_settled = _D(ob.amount_settled) + _D(data.amount)
    if ob.amount_settled >= _D(ob.amount):
        ob.status = "settled"
    else:
        ob.status = "partial"

    # Auto-ledger if account specified
    if data.account_id:
        # receivable settlement = money coming in (credit)
        # payable settlement = money going out (debit)
        txn_type = "credit" if ob.obligation_type == "receivable" else "debit"
        auto_ledger(
            db=db,
            account_id=data.account_id,
            txn_type=txn_type,
            amount=_D(data.amount),
            txn_date=data.settlement_date,
            linked_type="obligation",
            linked_id=obligation_id,
            description=f"Obligation settlement: {ob.reason or ''}".strip(),
            payment_mode=data.payment_mode,
            contact_id=ob.contact_id,
            created_by=current_user.id,
        )

    db.commit()
    db.refresh(settlement)
    return settlement
