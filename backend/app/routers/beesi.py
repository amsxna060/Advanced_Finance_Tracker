"""
Beesi (BC / Chit Fund) router.

Endpoints:
  GET    /api/beesi                              – list all
  POST   /api/beesi                              – create
  GET    /api/beesi/{id}                         – detail + installments + withdrawal + P&L
  PUT    /api/beesi/{id}                         – update
  DELETE /api/beesi/{id}                         – soft delete
  POST   /api/beesi/{id}/installments            – log monthly installment (auto-derives month#, dividend)
  GET    /api/beesi/{id}/installments            – list installments
  DELETE /api/beesi/{id}/installments/{inst_id}  – delete installment
  POST   /api/beesi/{id}/withdraw                – log pot withdrawal (auto-derives month#, discount)
  GET    /api/beesi/{id}/summary                 – P&L + best-month-to-withdraw analysis
"""

from calendar import monthrange
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func as sqlfunc
from sqlalchemy.orm import Session, selectinload, joinedload

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.beesi import Beesi, BeesiInstallment, BeesiWithdrawal
from app.models.cash_account import AccountTransaction
from app.models.user import User
from app.services.auto_ledger import reverse_all_ledger, reverse_ledger_by_source

router = APIRouter(prefix="/api/beesi", tags=["beesi"])


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _d(v) -> Decimal:
    return Decimal("0") if v is None else Decimal(str(v))


def _calc_month_number(start_date: date, target_date: date) -> int:
    """Return 1-based month number: month 1 = same month as start_date."""
    months = (
        (target_date.year - start_date.year) * 12
        + (target_date.month - start_date.month)
        + 1
    )
    return max(1, months)


def _add_months(d: date, months: int) -> date:
    """Add months to a date, clamping day to the last valid day of target month."""
    m = d.month - 1 + months
    yr = d.year + m // 12
    mo = m % 12 + 1
    day = min(d.day, monthrange(yr, mo)[1])
    return date(yr, mo, day)


def _best_month_analysis(beesi: Beesi) -> dict:
    """
    Bidding guidance for a Beesi member deciding when to take the pot.

    Future installments are estimated by stepping down ₹100/month from the
    last actually-paid installment (dividends tend to grow, so you pay less
    each month).  P&L at a given bid discount is constant regardless of which
    month you take the pot; what DOES change per month is how much cash you
    still owe after receiving the pot.
    """
    pot = _d(beesi.pot_size)
    tenure = beesi.tenure_months

    months_paid = len(beesi.installments)
    total_invested_so_far = sum(_d(i.actual_paid) for i in beesi.installments)

    # Estimate future installments: each month is ₹100 less than the previous.
    # Seed from the last actually-paid installment; fall back to base if none.
    if months_paid > 0:
        last_paid_installment = _d(beesi.installments[-1].actual_paid)
    else:
        last_paid_installment = _d(beesi.base_installment)

    step = _d("100")
    months_remaining = tenure - months_paid
    future_ests = [
        max(_d("0"), last_paid_installment - step * (k + 1))
        for k in range(months_remaining)
    ]

    total_est_remaining = sum(future_ests)
    total_remaining_cost = total_invested_so_far + total_est_remaining
    max_discount_to_breakeven = pot - total_remaining_cost
    min_bid_to_breakeven = total_remaining_cost

    projections = []
    for i, m in enumerate(range(months_paid + 1, tenure + 1)):
        paid_by_then = total_invested_so_far + sum(future_ests[: i + 1])
        installments_left = tenure - m
        cash_still_owed = sum(future_ests[i + 1 :]) if (i + 1) < len(future_ests) else _d("0")
        proj_date = _add_months(beesi.start_date, m - 1)
        projections.append({
            "month": m,
            "date": proj_date.isoformat(),
            "est_installment": float(future_ests[i]),
            "paid_by_then": float(paid_by_then),
            "installments_left": installments_left,
            "cash_still_owed": float(cash_still_owed),
            "is_recommended": m == tenure,  # last month = no bidding needed
        })
        # No cap — show every remaining month

    if max_discount_to_breakeven > 0:
        reason = (
            f"Month {tenure} (last) is financially best — no bidding needed, "
            f"you receive the full ₹{float(pot):,.0f}. "
            f"If taking it earlier, keep your bid discount under "
            f"₹{float(max_discount_to_breakeven):,.0f} to stay profitable."
        )
        recommended_month = tenure
    elif max_discount_to_breakeven == 0:
        reason = (
            f"This BC breaks exactly even. Month {tenure} guarantees zero discount."
        )
        recommended_month = tenure
    else:
        reason = (
            f"Total installments exceed the pot — you lose ₹{float(abs(max_discount_to_breakeven)):,.0f} "
            f"at zero discount. Consider taking the pot early to limit losses."
        )
        recommended_month = months_paid + 1 if months_paid < tenure else tenure

    return {
        "theoretical_profit_at_no_discount": float(max_discount_to_breakeven),
        "max_discount_to_breakeven": float(max_discount_to_breakeven),
        "min_bid_to_breakeven": float(min_bid_to_breakeven),
        "last_paid_installment": float(last_paid_installment),
        "pot_size": float(pot),
        "total_expected_cost": float(total_remaining_cost),
        "recommended_month": recommended_month,
        "reason": reason,
        "projections": projections,
    }


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
        "best_month_analysis": _best_month_analysis(beesi) if not beesi.withdrawals else None,
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
        "contact_id": beesi.contact_id,
        "contact_name": beesi.contact.name if beesi.contact else None,
        "account_id": beesi.account_id,
        "account_name": beesi.account.name if beesi.account else None,
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
    # M-PERF-5: Use SQL aggregates instead of selectinload(all installments + withdrawals).
    # Loading all rows per beesi is O(N*M) on a large dataset; aggregating in DB is O(N).
    q = db.query(Beesi).filter(Beesi.is_deleted == False)
    if status:
        q = q.filter(Beesi.status == status)
    beesis = (q.options(
        joinedload(Beesi.contact),
        joinedload(Beesi.account),
    ).order_by(Beesi.start_date.desc()).all())

    if not beesis:
        return []

    beesi_ids = [b.id for b in beesis]

    # Aggregate installments: total_invested, months_paid
    inst_rows = (
        db.query(
            BeesiInstallment.beesi_id,
            sqlfunc.coalesce(sqlfunc.sum(BeesiInstallment.actual_paid), 0).label("total_invested"),
            sqlfunc.count(BeesiInstallment.id).label("months_paid"),
        )
        .filter(BeesiInstallment.beesi_id.in_(beesi_ids))
        .group_by(BeesiInstallment.beesi_id)
        .all()
    )
    inst_by_id = {r.beesi_id: r for r in inst_rows}

    # Aggregate withdrawals: total_withdrawn, has_withdrawn
    wdraw_rows = (
        db.query(
            BeesiWithdrawal.beesi_id,
            sqlfunc.coalesce(sqlfunc.sum(BeesiWithdrawal.net_received), 0).label("total_withdrawn"),
            sqlfunc.count(BeesiWithdrawal.id).label("withdrawal_count"),
        )
        .filter(BeesiWithdrawal.beesi_id.in_(beesi_ids))
        .group_by(BeesiWithdrawal.beesi_id)
        .all()
    )
    wdraw_by_id = {r.beesi_id: r for r in wdraw_rows}

    results = []
    for b in beesis:
        inst = inst_by_id.get(b.id)
        wdraw = wdraw_by_id.get(b.id)
        total_invested = _d(inst.total_invested if inst else 0)
        total_withdrawn = _d(wdraw.total_withdrawn if wdraw else 0)
        months_paid = inst.months_paid if inst else 0
        has_withdrawn = bool(wdraw and wdraw.withdrawal_count > 0)
        profit_loss = total_withdrawn - total_invested
        summary = {
            "total_invested": total_invested,
            "total_withdrawn": total_withdrawn,
            "months_paid": months_paid,
            "months_remaining": max(0, b.tenure_months - months_paid),
            "profit_loss": profit_loss,
            "profit_loss_pct": float((profit_loss / total_invested * 100).quantize(Decimal("0.01")))
            if total_invested > 0 else 0.0,
            "has_withdrawn": has_withdrawn,
            # best_month_analysis omitted in list view (requires full installment data — use detail endpoint)
            "best_month_analysis": None,
        }
        results.append({
            "id": b.id,
            "title": b.title,
            "description": b.description,
            "pot_size": _d(b.pot_size),
            "member_count": b.member_count,
            "tenure_months": b.tenure_months,
            "base_installment": _d(b.base_installment),
            "start_date": b.start_date.isoformat() if b.start_date else None,
            "status": b.status,
            "notes": b.notes,
            "contact_id": b.contact_id,
            "contact_name": b.contact.name if b.contact else None,
            "account_id": b.account_id,
            "account_name": b.account.name if b.account else None,
            "created_at": b.created_at.isoformat() if b.created_at else None,
            "summary": summary,
        })
    return results


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
        contact_id=payload.get("contact_id"),
        account_id=payload.get("account_id"),
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
    beesi = (db.query(Beesi).filter(Beesi.id == beesi_id, Beesi.is_deleted == False)
             .options(
                 selectinload(Beesi.installments),
                 selectinload(Beesi.withdrawals),
                 joinedload(Beesi.contact),
                 joinedload(Beesi.account),
             ).first())
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
    if "contact_id" in payload:
        beesi.contact_id = payload["contact_id"]
    if "account_id" in payload:
        beesi.account_id = payload["account_id"]

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
    # Clean up all linked AccountTransaction entries
    reverse_all_ledger(db, "beesi", beesi.id)
    # Delete child installments and withdrawals
    for inst in list(beesi.installments):
        db.delete(inst)
    for w in list(beesi.withdrawals):
        db.delete(w)
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
    current_user: User = Depends(require_admin),
):
    """
    Log a monthly installment payment.

    Caller only needs to provide:
      - payment_date   (YYYY-MM-DD)
      - actual_paid    (amount actually paid this month)
      - notes          (optional)

    Backend auto-derives:
      - month_number        from payment_date relative to beesi.start_date
      - base_amount         from beesi.base_installment
      - dividend_received   = base_amount - actual_paid
    Also auto-logs a debit on the linked account if account_id is set.
    """
    beesi = _get_or_404(beesi_id, db)

    for field in ["payment_date", "actual_paid"]:
        if field not in payload:
            raise HTTPException(status_code=422, detail=f"Missing required field: {field}")

    try:
        payment_date = date.fromisoformat(payload["payment_date"])
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="payment_date must be a valid YYYY-MM-DD date")
    try:
        actual_paid = Decimal(str(payload["actual_paid"]))
    except Exception:
        raise HTTPException(status_code=422, detail="actual_paid must be a valid number")
    if actual_paid <= Decimal("0"):
        raise HTTPException(status_code=422, detail="actual_paid must be greater than zero")

    # Month number: explicit value wins; otherwise the next unpaid month in
    # sequence. (Deriving it from the payment date broke for late payments —
    # month 3 paid 5 days late was recorded as month 4 and then blocked the
    # real month-4 installment with a duplicate error.)
    if payload.get("month_number") is not None:
        try:
            month_number = int(payload["month_number"])
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail="month_number must be an integer")
    else:
        existing_months = {i.month_number for i in beesi.installments}
        month_number = 1
        while month_number in existing_months:
            month_number += 1
    base_amount = _d(beesi.base_installment)
    dividend_received = max(Decimal("0"), base_amount - actual_paid)

    # H-DI-10: enforce month_number within [1, tenure_months]
    if beesi.tenure_months and month_number > beesi.tenure_months:
        raise HTTPException(
            status_code=422,
            detail=f"month_number {month_number} exceeds beesi tenure of {beesi.tenure_months} months",
        )
    if month_number < 1:
        raise HTTPException(status_code=422, detail="payment_date is before beesi start_date")

    # H-DI-11: prevent duplicate month_number for the same beesi
    existing = (
        db.query(BeesiInstallment)
        .filter(
            BeesiInstallment.beesi_id == beesi.id,
            BeesiInstallment.month_number == month_number,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"An installment for month {month_number} already exists for this beesi",
        )

    inst = BeesiInstallment(
        beesi_id=beesi.id,
        month_number=month_number,
        payment_date=payment_date,
        base_amount=base_amount,
        dividend_received=dividend_received,
        actual_paid=actual_paid,
        notes=payload.get("notes"),
        created_by=current_user.id,
    )
    db.add(inst)
    db.flush()  # inst.id needed for the ledger source link

    # Auto-log a debit on the linked account (money paid out)
    acct_id = payload.get("account_id") or beesi.account_id
    if acct_id:
        txn = AccountTransaction(
            account_id=acct_id,
            txn_type="debit",
            amount=actual_paid,
            txn_date=payment_date,
            description=f"BC installment – Month {month_number} – {beesi.title}",
            linked_type="beesi",
            linked_id=beesi.id,
            source_type="beesi_installment",
            source_id=inst.id,
            created_by=current_user.id,
        )
        db.add(txn)

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
    # Reverse linked ledger entry (debit for this installment).
    # Void only the FIRST live match (C-FIN-6 policy) — hard-deleting every
    # same-amount same-date row destroyed unrelated entries.
    if reverse_ledger_by_source(db, "beesi_installment", inst.id) == 0:
        matching = db.query(AccountTransaction).filter(
            AccountTransaction.linked_type == "beesi",
            AccountTransaction.linked_id == beesi_id,
            AccountTransaction.txn_type == "debit",
            AccountTransaction.amount == inst.actual_paid,
            AccountTransaction.txn_date == inst.payment_date,
            AccountTransaction.is_voided == False,
        ).order_by(AccountTransaction.id.desc()).first()
        if matching:
            matching.is_voided = True
    db.delete(inst)
    db.commit()
    return {"message": "Installment deleted"}


@router.delete("/{beesi_id}/withdrawals/{withdrawal_id}", response_model=dict)
def delete_withdrawal(
    beesi_id: int,
    withdrawal_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    w = db.query(BeesiWithdrawal).filter(
        BeesiWithdrawal.id == withdrawal_id,
        BeesiWithdrawal.beesi_id == beesi_id,
    ).first()
    if not w:
        raise HTTPException(status_code=404, detail="Withdrawal not found")
    # Reverse linked ledger entry (credit for this withdrawal).
    # Void only the FIRST live match (C-FIN-6 policy).
    if reverse_ledger_by_source(db, "beesi_withdrawal", w.id) == 0:
        matching = db.query(AccountTransaction).filter(
            AccountTransaction.linked_type == "beesi",
            AccountTransaction.linked_id == beesi_id,
            AccountTransaction.txn_type == "credit",
            AccountTransaction.amount == w.net_received,
            AccountTransaction.txn_date == w.withdrawal_date,
            AccountTransaction.is_voided == False,
        ).order_by(AccountTransaction.id.desc()).first()
        if matching:
            matching.is_voided = True
    db.delete(w)
    db.commit()
    return {"message": "Withdrawal deleted"}


# ─────────────────────────────────────────────────────────────────────────────
# WITHDRAWAL (POT CLAIM)
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/{beesi_id}/withdraw", response_model=dict)
def add_withdrawal(
    beesi_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Record claiming the pot.

    Caller only needs to provide:
      - withdrawal_date  (YYYY-MM-DD)
      - net_received     (actual amount received after discount)
      - notes            (optional)

    Backend auto-derives:
      - month_number     from withdrawal_date relative to beesi.start_date
      - gross_amount     = beesi.pot_size
      - discount_offered = gross_amount - net_received
    Also auto-logs a credit on the linked account if account_id is set.
    """
    beesi = _get_or_404(beesi_id, db)

    if beesi.withdrawals:
        raise HTTPException(status_code=400, detail="A withdrawal has already been recorded for this Beesi")

    for field in ["withdrawal_date", "net_received"]:
        if field not in payload:
            raise HTTPException(status_code=422, detail=f"Missing required field: {field}")

    try:
        withdrawal_date = date.fromisoformat(payload["withdrawal_date"])
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="withdrawal_date must be a valid YYYY-MM-DD date")
    try:
        net_received = Decimal(str(payload["net_received"]))
    except Exception:
        raise HTTPException(status_code=422, detail="net_received must be a valid number")
    if net_received <= Decimal("0"):
        raise HTTPException(status_code=422, detail="net_received must be greater than zero")

    if payload.get("month_number") is not None:
        try:
            month_number = int(payload["month_number"])
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail="month_number must be an integer")
    else:
        month_number = _calc_month_number(beesi.start_date, withdrawal_date)
    if beesi.tenure_months and not (1 <= month_number <= beesi.tenure_months):
        raise HTTPException(
            status_code=422,
            detail=f"month_number {month_number} is outside the beesi tenure of {beesi.tenure_months} months",
        )
    gross_amount = _d(beesi.pot_size)
    discount_offered = max(Decimal("0"), gross_amount - net_received)

    w = BeesiWithdrawal(
        beesi_id=beesi.id,
        month_number=month_number,
        withdrawal_date=withdrawal_date,
        gross_amount=gross_amount,
        discount_offered=discount_offered,
        net_received=net_received,
        notes=payload.get("notes"),
        created_by=current_user.id,
    )
    db.add(w)
    db.flush()  # w.id needed for the ledger source link

    # Auto-log a credit on the linked account (money received)
    w_acct_id = payload.get("account_id") or beesi.account_id
    if w_acct_id:
        txn = AccountTransaction(
            account_id=w_acct_id,
            txn_type="credit",
            amount=net_received,
            txn_date=withdrawal_date,
            description=f"BC pot withdrawal – Month {month_number} – {beesi.title}",
            linked_type="beesi",
            linked_id=beesi.id,
            source_type="beesi_withdrawal",
            source_id=w.id,
            created_by=current_user.id,
        )
        db.add(txn)

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
