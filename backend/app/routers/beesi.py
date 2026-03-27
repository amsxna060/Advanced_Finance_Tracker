"""
Beesi (BC / Chit Fund) router.

Endpoints:
  GET    /api/beesi                      – list all
  POST   /api/beesi                      – create
  GET    /api/beesi/{id}                 – detail + installments + withdrawal + P&L
  PUT    /api/beesi/{id}                 – update
  DELETE /api/beesi/{id}                 – soft delete
  POST   /api/beesi/{id}/installments    – log monthly installment
  GET    /api/beesi/{id}/installments    – list installments
  DELETE /api/beesi/{id}/installments/{inst_id}  – delete installment
  POST   /api/beesi/{id}/withdraw        – log pot withdrawal
  GET    /api/beesi/{id}/summary         – P&L summary
"""

from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.beesi import Beesi, BeesiInstallment, BeesiWithdrawal
from app.models.user import User

router = APIRouter(prefix="/api/beesi", tags=["beesi"])


def _d(v) -> Decimal:
    return Decimal("0") if v is None else Decimal(str(v))


def _beesi_summary(beesi: Beesi) -> dict:
    """Compute P&L for a Beesi from its installments and withdrawals."""
    total_invested = sum(_d(i.actual_paid) for i in beesi.installments)
    total_withdrawn = sum(_d(w.net_received) for w in beesi.withdrawals)
    months_paid = len(beesi.installments)
    profit_loss = total_withdrawn - total_invested

    return {
        "total_invested": total_invested,
        "total_withdrawn": total_withdrawn,
        "months_paid": months_paid,
        "months_remaining": max(0, beesi.tenure_months - months_paid),
        "profit_loss": profit_loss,
        "profit_loss_pct": float((profit_loss / total_invested * 100).quantize(Decimal("0.01")))
        if total_invested > 0
        else 0.0,
        "has_withdrawn": len(beesi.withdrawals) > 0,
    }


def _beesi_dict(beesi: Beesi) -> dict:
    return {
        "id": beesi.id,
        "title": beesi.title,
        "description": beesi.description,
        "pot_size": _d(beesi.pot_size),
        "member_count": beesi.member_count,
        "tenure_months": beesi.tenure_months,
        "base_installment": _d(beesi.base_installment),
        "start_date": beesi.start_date.isoformat() if beesi.start_date else None,
        "status": beesi.status,
        "notes": beesi.notes,
        "created_at": beesi.created_at.isoformat() if beesi.created_at else None,
        "summary": _beesi_summary(beesi),
    }


# ─────────────────────────────────────────────────────────────────────────────
# LIST / CREATE
# ─────────────────────────────────────────────────────────────────────────────


@router.get("", response_model=list)
def list_beesis(
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Beesi).filter(Beesi.is_deleted == False)
    if status:
        q = q.filter(Beesi.status == status)
    beesis = q.order_by(Beesi.start_date.desc()).all()
    return [_beesi_dict(b) for b in beesis]


@router.post("", response_model=dict)
def create_beesi(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    required = ["title", "pot_size", "member_count", "tenure_months", "base_installment", "start_date"]
    for field in required:
        if field not in payload:
            raise HTTPException(status_code=422, detail=f"Missing required field: {field}")

    beesi = Beesi(
        title=payload["title"],
        description=payload.get("description"),
        pot_size=Decimal(str(payload["pot_size"])),
        member_count=int(payload["member_count"]),
        tenure_months=int(payload["tenure_months"]),
        base_installment=Decimal(str(payload["base_installment"])),
        start_date=date.fromisoformat(payload["start_date"]),
        status=payload.get("status", "active"),
        notes=payload.get("notes"),
        created_by=current_user.id,
    )
    db.add(beesi)
    db.commit()
    db.refresh(beesi)
    return _beesi_dict(beesi)


# ─────────────────────────────────────────────────────────────────────────────
# DETAIL / UPDATE / DELETE
# ─────────────────────────────────────────────────────────────────────────────


def _get_or_404(beesi_id: int, db: Session) -> Beesi:
    beesi = db.query(Beesi).filter(Beesi.id == beesi_id, Beesi.is_deleted == False).first()
    if not beesi:
        raise HTTPException(status_code=404, detail="Beesi not found")
    return beesi


@router.get("/{beesi_id}", response_model=dict)
def get_beesi(
    beesi_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    beesi = _get_or_404(beesi_id, db)
    result = _beesi_dict(beesi)
    result["installments"] = [
        {
            "id": i.id,
            "month_number": i.month_number,
            "payment_date": i.payment_date.isoformat(),
            "base_amount": _d(i.base_amount),
            "dividend_received": _d(i.dividend_received),
            "actual_paid": _d(i.actual_paid),
            "notes": i.notes,
        }
        for i in beesi.installments
    ]
    result["withdrawals"] = [
        {
            "id": w.id,
            "month_number": w.month_number,
            "withdrawal_date": w.withdrawal_date.isoformat(),
            "gross_amount": _d(w.gross_amount),
            "discount_offered": _d(w.discount_offered),
            "net_received": _d(w.net_received),
            "notes": w.notes,
        }
        for w in beesi.withdrawals
    ]
    return result


@router.put("/{beesi_id}", response_model=dict)
def update_beesi(
    beesi_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    beesi = _get_or_404(beesi_id, db)

    for field in ["title", "description", "notes", "status"]:
        if field in payload:
            setattr(beesi, field, payload[field])
    for field, conv in [("pot_size", Decimal), ("base_installment", Decimal)]:
        if field in payload:
            setattr(beesi, field, conv(str(payload[field])))
    for field, conv in [("member_count", int), ("tenure_months", int)]:
        if field in payload:
            setattr(beesi, field, conv(payload[field]))
    if "start_date" in payload:
        beesi.start_date = date.fromisoformat(payload["start_date"])

    db.commit()
    db.refresh(beesi)
    return _beesi_dict(beesi)


@router.delete("/{beesi_id}", response_model=dict)
def delete_beesi(
    beesi_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    beesi = _get_or_404(beesi_id, db)
    beesi.is_deleted = True
    db.commit()
    return {"message": "Beesi deleted"}


# ─────────────────────────────────────────────────────────────────────────────
# INSTALLMENTS
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/{beesi_id}/installments", response_model=list)
def list_installments(
    beesi_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    beesi = _get_or_404(beesi_id, db)
    return [
        {
            "id": i.id,
            "month_number": i.month_number,
            "payment_date": i.payment_date.isoformat(),
            "base_amount": _d(i.base_amount),
            "dividend_received": _d(i.dividend_received),
            "actual_paid": _d(i.actual_paid),
            "notes": i.notes,
        }
        for i in beesi.installments
    ]


@router.post("/{beesi_id}/installments", response_model=dict)
def add_installment(
    beesi_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    beesi = _get_or_404(beesi_id, db)

    for field in ["month_number", "payment_date", "base_amount", "actual_paid"]:
        if field not in payload:
            raise HTTPException(status_code=422, detail=f"Missing required field: {field}")

    base_amount = Decimal(str(payload["base_amount"]))
    dividend = Decimal(str(payload.get("dividend_received", 0)))
    actual_paid = Decimal(str(payload["actual_paid"]))

    inst = BeesiInstallment(
        beesi_id=beesi.id,
        month_number=int(payload["month_number"]),
        payment_date=date.fromisoformat(payload["payment_date"]),
        base_amount=base_amount,
        dividend_received=dividend,
        actual_paid=actual_paid,
        notes=payload.get("notes"),
        created_by=current_user.id,
    )
    db.add(inst)
    db.commit()
    db.refresh(inst)
    return {
        "id": inst.id,
        "month_number": inst.month_number,
        "payment_date": inst.payment_date.isoformat(),
        "base_amount": _d(inst.base_amount),
        "dividend_received": _d(inst.dividend_received),
        "actual_paid": _d(inst.actual_paid),
        "notes": inst.notes,
    }


@router.delete("/{beesi_id}/installments/{inst_id}", response_model=dict)
def delete_installment(
    beesi_id: int,
    inst_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    inst = db.query(BeesiInstallment).filter(
        BeesiInstallment.id == inst_id,
        BeesiInstallment.beesi_id == beesi_id,
    ).first()
    if not inst:
        raise HTTPException(status_code=404, detail="Installment not found")
    db.delete(inst)
    db.commit()
    return {"message": "Installment deleted"}


# ─────────────────────────────────────────────────────────────────────────────
# WITHDRAWAL (POT CLAIM)
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/{beesi_id}/withdraw", response_model=dict)
def add_withdrawal(
    beesi_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    beesi = _get_or_404(beesi_id, db)

    # Only one withdrawal allowed per Beesi (you can claim the pot only once)
    if beesi.withdrawals:
        raise HTTPException(status_code=400, detail="A withdrawal has already been recorded for this Beesi")

    for field in ["month_number", "withdrawal_date", "net_received"]:
        if field not in payload:
            raise HTTPException(status_code=422, detail=f"Missing required field: {field}")

    gross = _d(payload.get("gross_amount", beesi.pot_size))
    discount = _d(payload.get("discount_offered", 0))
    net = _d(payload["net_received"])

    w = BeesiWithdrawal(
        beesi_id=beesi.id,
        month_number=int(payload["month_number"]),
        withdrawal_date=date.fromisoformat(payload["withdrawal_date"]),
        gross_amount=gross,
        discount_offered=discount,
        net_received=net,
        notes=payload.get("notes"),
        created_by=current_user.id,
    )
    db.add(w)
    db.commit()
    db.refresh(w)
    return {
        "id": w.id,
        "month_number": w.month_number,
        "withdrawal_date": w.withdrawal_date.isoformat(),
        "gross_amount": _d(w.gross_amount),
        "discount_offered": _d(w.discount_offered),
        "net_received": _d(w.net_received),
        "notes": w.notes,
    }


# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/{beesi_id}/summary", response_model=dict)
def get_beesi_summary(
    beesi_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    beesi = _get_or_404(beesi_id, db)
    summary = _beesi_summary(beesi)
    summary["beesi_id"] = beesi.id
    summary["title"] = beesi.title
    summary["pot_size"] = _d(beesi.pot_size)
    summary["base_installment"] = _d(beesi.base_installment)
    summary["tenure_months"] = beesi.tenure_months
    summary["status"] = beesi.status
    return summary
