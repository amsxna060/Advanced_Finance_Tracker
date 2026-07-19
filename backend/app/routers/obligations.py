"""
Money obligations (receivables / payables) router.

Tracks who owes what, settlement progress, and linked deals.
"""
from datetime import date as date_today
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_write_access
from app.models.contact import Contact
from app.models.obligation import MoneyObligation, ObligationSettlement
from app.models.user import User
from app.schemas.obligation import (
    CloseWithLossCreate,
    ObligationCreate,
    ObligationOut,
    ObligationUpdate,
    SettlementCreate,
    SettlementOut,
)
from app.schemas.loan import ContactBrief
from app.services.auto_ledger import auto_ledger, reverse_all_ledger, reverse_ledger_by_source
from app.models.cash_account import AccountTransaction

router = APIRouter(prefix="/api/obligations", tags=["obligations"])

_D = lambda v: Decimal("0") if v is None else Decimal(str(v))


@router.get("", response_model=List[dict])
def list_obligations(
    obligation_type: Optional[str] = None,
    status: Optional[str] = None,
    contact_id: Optional[int] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
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
    current_user: User = Depends(require_write_access),
):
    contact = db.query(Contact).filter(Contact.id == data.contact_id, Contact.is_deleted == False).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    # M-VAL-8: obligation_type is now a Literal in ObligationCreate schema
    # so the runtime string check here is no longer needed; remove it.
    ob = MoneyObligation(**data.model_dump(exclude={"account_id"}), created_by=current_user.id)
    db.add(ob)
    db.flush()  # get ob.id before ledger entry

    # If account selected at creation, record the initial money movement
    if data.account_id:
        # receivable = I paid money out (debit); payable = I received money in (credit)
        txn_type = "debit" if data.obligation_type == "receivable" else "credit"
        auto_ledger(
            db=db,
            account_id=data.account_id,
            txn_type=txn_type,
            amount=_D(data.amount),
            # The money moved NOW (at creation) — due_date is when it comes back.
            # Dating the entry at a future due_date misplaced it in dated reports.
            txn_date=date_today.today(),
            linked_type="obligation",
            linked_id=ob.id,
            description=f"Obligation created: {data.reason or ''}".strip(),
            contact_id=data.contact_id,
            created_by=current_user.id,
            source_type="obligation_create",
            source_id=ob.id,
        )

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

    # "settled" and "closed" obligations are no longer outstanding.
    open_statuses = ("pending", "partial")
    total_receivable = sum(_D(o.amount) - _D(o.amount_settled)
                          for o in obligations if o.obligation_type == "receivable" and o.status in open_statuses)
    total_payable = sum(_D(o.amount) - _D(o.amount_settled)
                        for o in obligations if o.obligation_type == "payable" and o.status in open_statuses)
    total_interest = sum(_D(o.interest_amount) for o in obligations)
    total_loss = sum(_D(o.loss_amount) for o in obligations if o.status == "closed")

    return {
        "total_receivable": float(total_receivable),
        "total_payable": float(total_payable),
        "net_position": float(total_receivable - total_payable),
        "pending_count": sum(1 for o in obligations if o.status in open_statuses),
        "total_interest": float(total_interest),
        "total_loss": float(total_loss),
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
    current_user: User = Depends(require_write_access),
):
    ob = db.query(MoneyObligation).filter(
        MoneyObligation.id == obligation_id,
        MoneyObligation.is_deleted == False,
    ).first()
    if not ob:
        raise HTTPException(status_code=404, detail="Obligation not found")

    update_fields = data.model_dump(exclude_unset=True)

    # If amount is being changed, validate against already-settled amount
    if "amount" in update_fields and update_fields["amount"] is not None:
        new_amount = _D(update_fields["amount"])
        settled = _D(ob.amount_settled)
        if new_amount < settled:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot reduce amount below already settled amount ({settled})",
            )

    for field, value in update_fields.items():
        setattr(ob, field, value)

    # Recalculate status based on current amount vs settled — but never silently
    # un-close an obligation that was closed with loss. Use the dedicated
    # reopen endpoint for that.
    if ob.status != "closed" or "status" in update_fields:
        settled = _D(ob.amount_settled)
        total = _D(ob.amount)
        if settled >= total:
            ob.status = "settled"
        elif settled > 0:
            ob.status = "partial"
        else:
            ob.status = "pending"

    db.commit()
    db.refresh(ob)
    return ob


@router.delete("/{obligation_id}")
def delete_obligation(
    obligation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    ob = db.query(MoneyObligation).filter(
        MoneyObligation.id == obligation_id,
        MoneyObligation.is_deleted == False,
    ).first()
    if not ob:
        raise HTTPException(status_code=404, detail="Obligation not found")
    # Clean up all linked AccountTransaction entries (from settlements)
    reverse_all_ledger(db, "obligation", obligation_id)
    # Delete child settlements
    db.query(ObligationSettlement).filter(
        ObligationSettlement.obligation_id == obligation_id,
    ).delete(synchronize_session=False)
    ob.is_deleted = True
    db.commit()
    return {"message": "Obligation deleted"}


@router.post("/{obligation_id}/settle", response_model=SettlementOut)
def settle_obligation(
    obligation_id: int,
    data: SettlementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    ob = db.query(MoneyObligation).filter(
        MoneyObligation.id == obligation_id,
        MoneyObligation.is_deleted == False,
    ).first()
    if not ob:
        raise HTTPException(status_code=404, detail="Obligation not found")

    if ob.status == "closed":
        raise HTTPException(
            status_code=422,
            detail="Obligation is closed with loss. Reopen it before recording payments.",
        )

    # C-FIN-11: validate settlement amounts before applying them.
    # `amount` is the principal portion (reduces remaining), `interest_amount`
    # is extra interest / profit on top. An interest-only payment is allowed
    # (amount == 0) as long as something is being recorded.
    principal_amount = _D(data.amount)
    interest_amount = _D(data.interest_amount)
    if principal_amount < Decimal("0") or interest_amount < Decimal("0"):
        raise HTTPException(status_code=422, detail="Amounts cannot be negative")
    if principal_amount + interest_amount <= Decimal("0"):
        raise HTTPException(status_code=422, detail="Settlement must record a principal or interest amount")

    remaining = _D(ob.amount) - _D(ob.amount_settled)
    if principal_amount > remaining:
        raise HTTPException(
            status_code=422,
            detail=f"Principal amount ({principal_amount}) exceeds remaining unsettled amount ({remaining}). "
                   f"Record the excess as interest / profit instead.",
        )

    settlement = ObligationSettlement(
        obligation_id=obligation_id,
        created_by=current_user.id,
        **data.model_dump(),
    )
    db.add(settlement)
    db.flush()  # settlement.id needed for the ledger source link

    # Update settled principal, interest total, and status (status tracks principal)
    ob.amount_settled = _D(ob.amount_settled) + principal_amount
    ob.interest_amount = _D(ob.interest_amount) + interest_amount
    if ob.amount_settled >= _D(ob.amount):
        ob.status = "settled"
    elif ob.amount_settled > Decimal("0"):
        ob.status = "partial"
    # else: principal-zero interest-only payment — leave status as is (pending)

    # Auto-ledger if account specified — the cash that actually moved is
    # principal + interest combined.
    ledger_amount = principal_amount + interest_amount
    if data.account_id and ledger_amount > Decimal("0"):
        # receivable settlement = money coming in (credit)
        # payable settlement = money going out (debit)
        txn_type = "credit" if ob.obligation_type == "receivable" else "debit"
        interest_note = f" (+{interest_amount} interest/profit)" if interest_amount > 0 else ""
        auto_ledger(
            db=db,
            account_id=data.account_id,
            txn_type=txn_type,
            amount=ledger_amount,
            txn_date=data.settlement_date,
            linked_type="obligation",
            linked_id=obligation_id,
            description=f"Obligation settlement: {ob.reason or ''}".strip() + interest_note,
            payment_mode=data.payment_mode,
            contact_id=ob.contact_id,
            created_by=current_user.id,
            source_type="obligation_settlement",
            source_id=settlement.id,
        )

    db.commit()
    db.refresh(settlement)
    return settlement


@router.post("/{obligation_id}/close-loss", response_model=ObligationOut)
def close_obligation_with_loss(
    obligation_id: int,
    data: CloseWithLossCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    """Force-close an obligation, writing off the remaining balance as a loss.

    Used when a receivable won't be recovered (or a payable won't be paid).
    No cash moves — the unrecovered remainder is recorded on ``loss_amount``
    for reporting, and the obligation drops out of outstanding totals.
    """
    ob = db.query(MoneyObligation).filter(
        MoneyObligation.id == obligation_id,
        MoneyObligation.is_deleted == False,
    ).first()
    if not ob:
        raise HTTPException(status_code=404, detail="Obligation not found")

    if ob.status == "closed":
        raise HTTPException(status_code=422, detail="Obligation is already closed")
    if ob.status == "settled":
        raise HTTPException(status_code=422, detail="Obligation is already fully settled — nothing to write off")

    remaining = _D(ob.amount) - _D(ob.amount_settled)
    if remaining <= Decimal("0"):
        raise HTTPException(status_code=422, detail="No remaining balance to write off")

    ob.loss_amount = remaining
    ob.closed_date = data.closed_date
    ob.status = "closed"
    if data.notes:
        ob.notes = f"{ob.notes}\n{data.notes}".strip() if ob.notes else data.notes

    db.commit()
    db.refresh(ob)
    return ob


@router.post("/{obligation_id}/reopen", response_model=ObligationOut)
def reopen_obligation(
    obligation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    """Reopen a closed-with-loss obligation, clearing the written-off loss."""
    ob = db.query(MoneyObligation).filter(
        MoneyObligation.id == obligation_id,
        MoneyObligation.is_deleted == False,
    ).first()
    if not ob:
        raise HTTPException(status_code=404, detail="Obligation not found")
    if ob.status != "closed":
        raise HTTPException(status_code=422, detail="Only a closed obligation can be reopened")

    ob.loss_amount = Decimal("0")
    ob.closed_date = None
    settled = _D(ob.amount_settled)
    if settled >= _D(ob.amount):
        ob.status = "settled"
    elif settled > Decimal("0"):
        ob.status = "partial"
    else:
        ob.status = "pending"

    db.commit()
    db.refresh(ob)
    return ob


@router.delete("/{obligation_id}/settlements/{settlement_id}")
def delete_settlement(
    obligation_id: int,
    settlement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    """Delete a settlement and reverse its ledger entry."""
    ob = db.query(MoneyObligation).filter(
        MoneyObligation.id == obligation_id,
        MoneyObligation.is_deleted == False,
    ).first()
    if not ob:
        raise HTTPException(status_code=404, detail="Obligation not found")

    settlement = db.query(ObligationSettlement).filter(
        ObligationSettlement.id == settlement_id,
        ObligationSettlement.obligation_id == obligation_id,
    ).first()
    if not settlement:
        raise HTTPException(status_code=404, detail="Settlement not found")

    # Reverse linked ledger entry (exact source link; legacy rows fall back
    # to the heuristic — void the first live match only, keep audit trail).
    # The ledger entry recorded principal + interest combined.
    ledger_amount = _D(settlement.amount) + _D(settlement.interest_amount)
    if settlement.account_id and reverse_ledger_by_source(db, "obligation_settlement", settlement.id) == 0:
        txn_type = "credit" if ob.obligation_type == "receivable" else "debit"
        matching = db.query(AccountTransaction).filter(
            AccountTransaction.linked_type == "obligation",
            AccountTransaction.linked_id == obligation_id,
            AccountTransaction.txn_type == txn_type,
            AccountTransaction.amount == ledger_amount,
            AccountTransaction.txn_date == settlement.settlement_date,
            AccountTransaction.is_voided == False,
        ).order_by(AccountTransaction.id.desc()).first()
        if matching:
            matching.is_voided = True

    # Reverse settled principal + interest, then recalculate status. A closed
    # obligation stays closed (use reopen to change that).
    ob.amount_settled = max(_D(ob.amount_settled) - _D(settlement.amount), Decimal("0"))
    ob.interest_amount = max(_D(ob.interest_amount) - _D(settlement.interest_amount), Decimal("0"))
    if ob.status != "closed":
        if ob.amount_settled >= _D(ob.amount):
            ob.status = "settled"
        elif ob.amount_settled > 0:
            ob.status = "partial"
        else:
            ob.status = "pending"

    db.delete(settlement)
    db.commit()
    return {"message": "Settlement deleted"}
