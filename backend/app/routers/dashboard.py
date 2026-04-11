import csv
import io
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.beesi import Beesi, BeesiInstallment, BeesiWithdrawal
from app.models.cash_account import CashAccount, AccountTransaction
from app.models.collateral import Collateral
from app.models.expense import Expense
from app.models.loan import Loan, LoanPayment
from app.models.obligation import MoneyObligation
from app.models.partnership import Partnership, PartnershipTransaction
from app.models.property_deal import PropertyDeal, PropertyTransaction
from app.models.user import User
from app.services.interest import calculate_outstanding, check_capitalization_due, _days_in_year, _calc_period_interest

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

INFLOW_PROPERTY_TXN_TYPES = {"received_from_buyer", "sale_proceeds", "refund"}
OUTFLOW_PROPERTY_TXN_TYPES = {"advance_to_seller", "payment_to_seller", "commission_paid", "expense", "other"}
INFLOW_PARTNERSHIP_TXN_TYPES = {"received", "profit_distributed"}
OUTFLOW_PARTNERSHIP_TXN_TYPES = {"invested", "expense"}


def _decimal(value: Optional[Decimal]) -> Decimal:
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def _month_key(value: date) -> str:
    return value.strftime("%Y-%m")


def _generate_months(count: int = 12) -> List[date]:
    today = date.today().replace(day=1)
    months = []
    year = today.year
    month = today.month
    for _ in range(count):
        months.append(date(year, month, 1))
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    months.reverse()
    return months


def _loan_monthly_expected(loan: Loan) -> Decimal:
    principal = _decimal(loan.principal_amount)
    rate = _decimal(loan.interest_rate)
    if loan.loan_type == "emi" and loan.emi_amount:
        return _decimal(loan.emi_amount)
    if loan.loan_type == "interest_only":
        # Calendar-month daily rate: principal * rate/100/days_in_year * days_in_month
        import calendar
        today = date.today()
        days_in_month = calendar.monthrange(today.year, today.month)[1]
        return _calc_period_interest(principal, rate, today.replace(day=1), days_in_month)
    if loan.loan_type == "short_term" and loan.post_due_interest_rate:
        import calendar
        today = date.today()
        days_in_month = calendar.monthrange(today.year, today.month)[1]
        return _calc_period_interest(principal, _decimal(loan.post_due_interest_rate), today.replace(day=1), days_in_month)
    return Decimal("0")


def _recent_activity(db: Session, limit: int = 10) -> List[dict]:
    items = []

    loan_payments = db.query(LoanPayment).order_by(LoanPayment.created_at.desc()).limit(limit).all()
    for payment in loan_payments:
        items.append(
            {
                "type": "loan_payment",
                "title": f"Loan payment for #{payment.loan_id}",
                "amount": _decimal(payment.amount_paid),
                "date": payment.created_at.isoformat() if payment.created_at else payment.payment_date.isoformat(),
                "description": payment.notes or payment.payment_mode or "Loan payment recorded",
            }
        )

    property_transactions = db.query(PropertyTransaction).order_by(PropertyTransaction.created_at.desc()).limit(limit).all()
    for transaction in property_transactions:
        items.append(
            {
                "type": "property_transaction",
                "title": f"Property transaction for #{transaction.property_deal_id}",
                "amount": _decimal(transaction.amount),
                "date": transaction.created_at.isoformat() if transaction.created_at else transaction.txn_date.isoformat(),
                "description": transaction.description or transaction.txn_type,
            }
        )

    partnership_transactions = db.query(PartnershipTransaction).order_by(PartnershipTransaction.created_at.desc()).limit(limit).all()
    for transaction in partnership_transactions:
        items.append(
            {
                "type": "partnership_transaction",
                "title": f"Partnership transaction for #{transaction.partnership_id}",
                "amount": _decimal(transaction.amount),
                "date": transaction.created_at.isoformat() if transaction.created_at else transaction.txn_date.isoformat(),
                "description": transaction.description or transaction.txn_type,
            }
        )

    expenses = db.query(Expense).order_by(Expense.created_at.desc()).limit(limit).all()
    for expense in expenses:
        items.append(
            {
                "type": "expense",
                "title": expense.category or "Expense",
                "amount": _decimal(expense.amount),
                "date": expense.created_at.isoformat() if expense.created_at else expense.expense_date.isoformat(),
                "description": expense.description or expense.linked_type or "Expense logged",
            }
        )

    items.sort(key=lambda item: item["date"], reverse=True)
    return items[:limit]


@router.get("/summary", response_model=dict)
def get_dashboard_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    active_loans = db.query(Loan).filter(Loan.is_deleted == False, Loan.status == "active").all()
    active_properties = db.query(PropertyDeal).filter(PropertyDeal.is_deleted == False, PropertyDeal.status != "cancelled").count()
    active_partnerships = db.query(Partnership).filter(Partnership.is_deleted == False, Partnership.status == "active").all()

    total_lent_out = Decimal("0")
    total_borrowed = Decimal("0")
    total_outstanding_receivable = Decimal("0")
    total_outstanding_payable = Decimal("0")
    expected_this_month = Decimal("0")
    total_overdue = Decimal("0")
    total_interest_earned = Decimal("0")
    total_principal_recovered = Decimal("0")

    for loan in active_loans:
        try:
            principal = _decimal(loan.principal_amount)
            outstanding = calculate_outstanding(loan.id, date.today(), db)
            total_due = _decimal(outstanding["total_outstanding"])
            interest_due = _decimal(outstanding["interest_outstanding"])
            expected_this_month += _loan_monthly_expected(loan)

            if loan.loan_direction == "given":
                total_lent_out += principal
                total_outstanding_receivable += total_due
                total_overdue += interest_due
                # Sum historical payments
                for p in loan.payments:
                    total_interest_earned += _decimal(p.allocated_to_current_interest) + _decimal(p.allocated_to_overdue_interest)
                    total_principal_recovered += _decimal(p.allocated_to_principal)
            else:
                total_borrowed += principal
                total_outstanding_payable += total_due
        except Exception:
            pass

    total_partnership_invested = sum(_decimal(item.our_investment) for item in active_partnerships)
    total_partnership_received = sum(_decimal(item.total_received) for item in active_partnerships)

    # Beesi (chit fund) summary
    active_beesis = db.query(Beesi).filter(Beesi.is_deleted == False, Beesi.status == "active").all()
    beesi_total_invested = Decimal("0")
    for b in active_beesis:
        beesi_total_invested += sum(_decimal(i.actual_paid) for i in b.installments)

    return {
        "total_lent_out": total_lent_out,
        "total_outstanding_receivable": total_outstanding_receivable,
        "total_borrowed": total_borrowed,
        "total_outstanding_payable": total_outstanding_payable,
        "net_position": total_outstanding_receivable - total_outstanding_payable,
        "expected_this_month": expected_this_month,
        "total_overdue": total_overdue,
        "total_interest_earned": total_interest_earned,
        "total_principal_recovered": total_principal_recovered,
        "active_property_deals": active_properties,
        "active_partnerships": len(active_partnerships),
        "total_partnership_invested": total_partnership_invested,
        "total_partnership_received": total_partnership_received,
        "active_beesis": len(active_beesis),
        "beesi_total_invested": beesi_total_invested,
    }


@router.get("/alerts", response_model=dict)
def get_dashboard_alerts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    alerts = {"overdue": [], "collateral": [], "capitalization": []}
    active_loans = db.query(Loan).filter(Loan.is_deleted == False, Loan.status == "active").all()

    for loan in active_loans:
        try:
            outstanding = calculate_outstanding(loan.id, date.today(), db)
            interest_due = _decimal(outstanding["interest_outstanding"])
            total_outstanding = _decimal(outstanding["total_outstanding"])

            if interest_due > 0 and loan.disbursed_date and loan.disbursed_date <= date.today() - timedelta(days=30):
                alerts["overdue"].append(
                    {
                        "loan_id": loan.id,
                        "contact_id": loan.contact_id,
                        "contact_name": loan.contact.name if loan.contact else f"Contact #{loan.contact_id}",
                        "interest_outstanding": interest_due,
                        "total_outstanding": total_outstanding,
                        "days_since_disbursal": (date.today() - loan.disbursed_date).days,
                    }
                )

            collaterals = db.query(Collateral).filter(Collateral.loan_id == loan.id).all()
            for collateral in collaterals:
                estimated_value = _decimal(collateral.estimated_value)
                threshold_pct = _decimal(collateral.warning_threshold_pct)
                threshold_value = (estimated_value * threshold_pct) / Decimal("100") if estimated_value else Decimal("0")
                if estimated_value > 0 and total_outstanding > threshold_value:
                    alerts["collateral"].append(
                        {
                            "loan_id": loan.id,
                            "collateral_id": collateral.id,
                            "collateral_type": collateral.collateral_type,
                            "contact_name": loan.contact.name if loan.contact else f"Contact #{loan.contact_id}",
                            "total_outstanding": total_outstanding,
                            "estimated_value": estimated_value,
                            "warning_threshold_pct": threshold_pct,
                        }
                    )

            cap_status = check_capitalization_due(loan, db)
            if cap_status.get("is_due"):
                alerts["capitalization"].append(
                    {
                        "loan_id": loan.id,
                        "contact_name": loan.contact.name if loan.contact else f"Contact #{loan.contact_id}",
                        "outstanding_interest": _decimal(cap_status.get("outstanding_interest")),
                        "months_since_last_action": cap_status.get("months_since_last_action", 0),
                        "reference_date": cap_status.get("reference_date"),
                    }
                )
        except Exception:
            # Skip loans that error so all alerts still load
            pass

    return alerts


@router.get("/cashflow", response_model=dict)
def get_dashboard_cashflow(
    months: int = Query(12, ge=3, le=24),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    month_buckets = _generate_months(months)
    inflow_map: Dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    outflow_map: Dict[str, Decimal] = defaultdict(lambda: Decimal("0"))

    for payment in db.query(LoanPayment).all():
        key = _month_key(payment.payment_date)
        loan = payment.loan
        if not loan:
            continue
        amount = _decimal(payment.amount_paid)
        if loan.loan_direction == "given":
            inflow_map[key] += amount
        else:
            outflow_map[key] += amount

    for transaction in db.query(PropertyTransaction).all():
        key = _month_key(transaction.txn_date)
        amount = _decimal(transaction.amount)
        if transaction.txn_type in INFLOW_PROPERTY_TXN_TYPES:
            inflow_map[key] += amount
        elif transaction.txn_type in OUTFLOW_PROPERTY_TXN_TYPES:
            outflow_map[key] += amount

    for transaction in db.query(PartnershipTransaction).all():
        key = _month_key(transaction.txn_date)
        amount = _decimal(transaction.amount)
        if transaction.txn_type in INFLOW_PARTNERSHIP_TXN_TYPES:
            inflow_map[key] += amount
        elif transaction.txn_type in OUTFLOW_PARTNERSHIP_TXN_TYPES:
            outflow_map[key] += amount

    for expense in db.query(Expense).all():
        key = _month_key(expense.expense_date)
        outflow_map[key] += _decimal(expense.amount)

    cashflow = []
    for month in month_buckets:
        key = _month_key(month)
        inflow = inflow_map[key]
        outflow = outflow_map[key]
        cashflow.append(
            {
                "month": month.strftime("%b %Y"),
                "month_key": key,
                "inflow": inflow,
                "outflow": outflow,
                "net": inflow - outflow,
            }
        )

    return {"cashflow": cashflow}


@router.get("/recent-activity", response_model=dict)
def get_recent_activity(
    limit: int = Query(10, ge=5, le=25),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return {"items": _recent_activity(db, limit)}


@router.get("/export")
def export_dashboard_data(
    dataset: str = Query("summary"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    buffer = io.StringIO()
    writer = csv.writer(buffer)

    if dataset == "summary":
        summary = get_dashboard_summary(db=db, current_user=current_user)
        writer.writerow(["metric", "value"])
        for key, value in summary.items():
            writer.writerow([key, value])
    elif dataset == "cashflow":
        cashflow = get_dashboard_cashflow(db=db, current_user=current_user)["cashflow"]
        writer.writerow(["month", "inflow", "outflow", "net"])
        for row in cashflow:
            writer.writerow([row["month"], row["inflow"], row["outflow"], row["net"]])
    elif dataset == "expenses":
        expenses = db.query(Expense).order_by(Expense.expense_date.desc(), Expense.id.desc()).all()
        writer.writerow(["date", "category", "amount", "linked_type", "description", "payment_mode"])
        for expense in expenses:
            writer.writerow([
                expense.expense_date,
                expense.category,
                expense.amount,
                expense.linked_type,
                expense.description,
                expense.payment_mode,
            ])
    else:
        writer.writerow(["message"])
        writer.writerow(["Unknown dataset"])

    buffer.seek(0)
    filename = f"dashboard_{dataset}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/this-month", response_model=dict)
def get_this_month_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns metrics specific to the current calendar month:
    - emis_expected:    sum of EMI amounts for all active EMI loans (loans given)
    - emis_collected:   sum of loan payments received this month
    - emis_pending:     emis_expected - emis_collected (approx remaining)
    - interest_expected: total interest due this month across interest-only loans
    - interest_collected: interest portion of payments received this month
    - overdue_interest:  total interest outstanding across all given loans
    """
    today = date.today()
    month_start = today.replace(day=1)

    active_loans_given = (
        db.query(Loan)
        .filter(Loan.is_deleted == False, Loan.status == "active", Loan.loan_direction == "given")
        .all()
    )

    emis_expected = Decimal("0")
    interest_expected = Decimal("0")
    overdue_interest = Decimal("0")

    for loan in active_loans_given:
        try:
            if loan.loan_type == "emi" and loan.emi_amount:
                emis_expected += _decimal(loan.emi_amount)
            elif loan.loan_type == "interest_only" and loan.interest_rate:
                # Calendar-month daily rate for current month
                import calendar as _cal
                _dim = _cal.monthrange(today.year, today.month)[1]
                interest_expected += _calc_period_interest(_decimal(loan.principal_amount), _decimal(loan.interest_rate), today.replace(day=1), _dim)
            outstanding = calculate_outstanding(loan.id, today, db)
            overdue_interest += _decimal(outstanding.get("interest_outstanding"))
        except Exception:
            pass

    # Payments received this month
    this_month_payments = (
        db.query(LoanPayment)
        .join(Loan, Loan.id == LoanPayment.loan_id)
        .filter(
            Loan.loan_direction == "given",
            LoanPayment.payment_date >= month_start,
            LoanPayment.payment_date <= today,
        )
        .all()
    )
    emis_collected = sum(_decimal(p.amount_paid) for p in this_month_payments)
    interest_collected = sum(
        _decimal(p.allocated_to_current_interest) + _decimal(p.allocated_to_overdue_interest)
        for p in this_month_payments
    )
    principal_collected = sum(
        _decimal(p.allocated_to_principal)
        for p in this_month_payments
    )

    return {
        "month": today.strftime("%B %Y"),
        "emis_expected": emis_expected,
        "emis_collected": emis_collected,
        "emis_pending": max(emis_expected - emis_collected, Decimal("0")),
        "principal_collected": principal_collected,
        "interest_expected": interest_expected,
        "interest_collected": interest_collected,
        "overdue_interest": overdue_interest,
    }


@router.get("/payment-behavior", response_model=list)
def get_payment_behavior(
    contact_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns payment behavior aggregated per contact (one row per contact).
    Optional contact_id filter for the contact detail page.
    Score is based on weighted-average repayment rate across all active loans.
    """
    loan_query = (
        db.query(Loan)
        .filter(
            Loan.is_deleted == False,
            Loan.loan_direction == "given",
            Loan.status == "active",
        )
    )
    if contact_id:
        loan_query = loan_query.filter(Loan.contact_id == contact_id)
    active_loans = loan_query.all()

    # Group loans by contact
    by_contact: dict = defaultdict(list)
    for loan in active_loans:
        by_contact[loan.contact_id].append(loan)

    rows = []
    today = date.today()

    for cid, loans in by_contact.items():
        try:
            contact = loans[0].contact
            contact_name = contact.name if contact else f"Contact #{cid}"
            total_principal = sum(_decimal(l.principal_amount) for l in loans)
            active_loans_count = len(loans)

            total_months = 0
            total_payments = 0
            last_payment_date = None

            for loan in loans:
                start = loan.interest_start_date or loan.disbursed_date
                if not start:
                    continue
                months = max(
                    (today.year - start.year) * 12 + (today.month - start.month), 1
                )
                total_months += months
                payments = loan.payments
                total_payments += len(payments)
                if payments:
                    lpd = payments[-1].payment_date
                    if last_payment_date is None or lpd > last_payment_date:
                        last_payment_date = lpd

            if total_months == 0:
                continue

            avg_rate = round((total_payments / total_months) * 100)
            days_since = (
                (today - last_payment_date).days if last_payment_date else total_months * 30
            )

            # Score: Good if avg rate >= 80% and paid recently; Bad if 0% or >90 days silent
            if avg_rate >= 80 and days_since <= 45:
                score = "Good"
                score_color = "green"
            elif avg_rate == 0 or days_since > 90:
                score = "Bad"
                score_color = "red"
            else:
                score = "Irregular"
                score_color = "yellow"

            rows.append({
                "contact_id": cid,
                "contact_name": contact_name,
                "active_loans": active_loans_count,
                "total_principal": total_principal,
                "total_payments_made": total_payments,
                "avg_payment_rate_pct": avg_rate,
                "last_payment_date": last_payment_date.isoformat() if last_payment_date else None,
                "days_since_payment": days_since,
                "score": score,
                "score_color": score_color,
            })
        except Exception:
            pass

    # Sort: Bad first, then Irregular, then Good
    order = {"Bad": 0, "Irregular": 1, "Good": 2}
    rows.sort(key=lambda r: (order.get(r["score"], 3), -(r["days_since_payment"] or 0)))
    return rows


# ---------------------------------------------------------------------------
# V2 — Consolidated dashboard endpoint (single call)
# ---------------------------------------------------------------------------

@router.get("/v2", response_model=dict)
def get_dashboard_v2(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = date.today()
    month_start = today.replace(day=1)

    # Last month range
    if today.month == 1:
        last_month_start = date(today.year - 1, 12, 1)
    else:
        last_month_start = date(today.year, today.month - 1, 1)
    last_month_end = month_start - timedelta(days=1)

    _f = float  # shorthand Decimal → float

    # ── All loans ────────────────────────────────────────────────────────
    all_loans = db.query(Loan).filter(Loan.is_deleted == False).all()
    loans_given = [l for l in all_loans if l.loan_direction == "given"]
    loans_taken = [l for l in all_loans if l.loan_direction == "taken"]

    # Pre-compute outstanding for every *active* loan (cache to avoid dup work)
    outstanding_cache: Dict[int, dict] = {}
    for loan in all_loans:
        if loan.status == "active":
            try:
                outstanding_cache[loan.id] = calculate_outstanding(loan.id, today, db)
            except Exception:
                pass

    # ── LENDING (all-time: active + closed) ──────────────────────────────
    total_lent_all_time = Decimal("0")
    total_outstanding_receivable = Decimal("0")
    total_interest_earned = Decimal("0")
    total_principal_recovered = Decimal("0")

    by_type: Dict[str, dict] = {}
    for lt in ("interest_only", "emi", "short_term"):
        by_type[lt] = {
            "active_count": 0, "closed_count": 0,
            "total_principal": Decimal("0"),
            "total_outstanding": Decimal("0"),
            "total_interest_earned": Decimal("0"),
            "loans": [],
        }

    for loan in loans_given:
        principal = _decimal(loan.principal_amount)
        total_lent_all_time += principal

        out_amount = Decimal("0")
        if loan.id in outstanding_cache:
            out_amount = _decimal(outstanding_cache[loan.id]["total_outstanding"])
        total_outstanding_receivable += out_amount

        loan_interest = sum(
            _decimal(p.allocated_to_current_interest) + _decimal(p.allocated_to_overdue_interest)
            for p in loan.payments
        )
        loan_principal_rec = sum(_decimal(p.allocated_to_principal) for p in loan.payments)
        total_interest_earned += loan_interest
        total_principal_recovered += loan_principal_rec

        lt = loan.loan_type if loan.loan_type in by_type else "short_term"
        by_type[lt]["total_principal"] += principal
        by_type[lt]["total_outstanding"] += out_amount
        by_type[lt]["total_interest_earned"] += loan_interest
        if loan.status == "active":
            by_type[lt]["active_count"] += 1
        elif loan.status == "closed":
            by_type[lt]["closed_count"] += 1

        by_type[lt]["loans"].append({
            "id": loan.id,
            "contact_name": loan.contact.name if loan.contact else f"#{loan.contact_id}",
            "principal": _f(principal),
            "outstanding": _f(out_amount),
            "interest_earned": _f(loan_interest),
            "status": loan.status,
            "loan_type": lt,
            "disbursed_date": loan.disbursed_date.isoformat() if loan.disbursed_date else None,
        })

    # ── BORROWING ────────────────────────────────────────────────────────
    total_borrowed = Decimal("0")
    total_outstanding_payable = Decimal("0")
    total_interest_paid = Decimal("0")
    borrowing_loans: List[dict] = []

    for loan in loans_taken:
        principal = _decimal(loan.principal_amount)
        total_borrowed += principal
        out_amount = Decimal("0")
        if loan.id in outstanding_cache:
            out_amount = _decimal(outstanding_cache[loan.id]["total_outstanding"])
        total_outstanding_payable += out_amount

        lip = sum(
            _decimal(p.allocated_to_current_interest) + _decimal(p.allocated_to_overdue_interest)
            for p in loan.payments
        )
        total_interest_paid += lip

        if loan.status == "active":
            borrowing_loans.append({
                "id": loan.id,
                "contact_name": loan.contact.name if loan.contact else None,
                "institution_name": loan.institution_name,
                "principal": _f(principal),
                "outstanding": _f(out_amount),
                "interest_paid": _f(lip),
                "status": loan.status,
                "loan_type": loan.loan_type,
            })

    # ── OBLIGATIONS ──────────────────────────────────────────────────────
    active_obligations = (
        db.query(MoneyObligation)
        .filter(MoneyObligation.is_deleted == False, MoneyObligation.status.in_(["pending", "partial"]))
        .all()
    )
    recv_total = recv_pending = pay_total = pay_pending = Decimal("0")
    obligation_items: List[dict] = []

    for ob in active_obligations:
        amt = _decimal(ob.amount)
        settled = _decimal(ob.amount_settled)
        pend = amt - settled
        if ob.obligation_type == "receivable":
            recv_total += amt; recv_pending += pend
        else:
            pay_total += amt; pay_pending += pend
        obligation_items.append({
            "id": ob.id, "type": ob.obligation_type,
            "contact_name": ob.contact.name if ob.contact else None,
            "reason": ob.reason, "amount": _f(amt),
            "settled": _f(settled), "pending": _f(pend),
            "due_date": ob.due_date.isoformat() if ob.due_date else None,
            "status": ob.status,
        })

    # ── EXPENSES ─────────────────────────────────────────────────────────
    this_month_expenses = (
        db.query(Expense)
        .filter(Expense.expense_date >= month_start, Expense.expense_date <= today)
        .all()
    )
    last_month_expenses = (
        db.query(Expense)
        .filter(Expense.expense_date >= last_month_start, Expense.expense_date <= last_month_end)
        .all()
    )
    this_m_total = sum(_decimal(e.amount) for e in this_month_expenses)
    last_m_total = sum(_decimal(e.amount) for e in last_month_expenses)

    cat_totals: Dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for e in this_month_expenses:
        cat_totals[e.category or "Other"] += _decimal(e.amount)
    top_cats = sorted(
        [{"name": k, "amount": _f(v)} for k, v in cat_totals.items()],
        key=lambda x: x["amount"], reverse=True,
    )[:5]

    trend_pct = float(((this_m_total - last_m_total) / last_m_total) * 100) if last_m_total > 0 else 0.0

    # ── INVESTMENTS ──────────────────────────────────────────────────────
    properties = db.query(PropertyDeal).filter(PropertyDeal.is_deleted == False, PropertyDeal.status != "cancelled").all()
    partnerships = db.query(Partnership).filter(Partnership.is_deleted == False).all()
    all_beesis = db.query(Beesi).filter(Beesi.is_deleted == False).all()

    prop_invested = sum(
        _decimal(p.my_investment) if p.my_investment else _decimal(p.purchase_price) if p.purchase_price else Decimal("0")
        for p in properties
    )
    prop_profit = sum(_decimal(p.net_profit) for p in properties if p.net_profit)

    part_invested = sum(_decimal(p.our_investment) for p in partnerships)
    part_received = sum(_decimal(p.total_received) for p in partnerships)

    beesi_paid = beesi_received = Decimal("0")
    for b in all_beesis:
        beesi_paid += sum(_decimal(i.actual_paid) for i in b.installments)
        beesi_received += sum(_decimal(w.net_received) for w in b.withdrawals)

    # ── NET WORTH ────────────────────────────────────────────────────────
    cash_accounts = db.query(CashAccount).filter(CashAccount.is_deleted == False).all()
    total_cash = Decimal("0")
    for acc in cash_accounts:
        bal = _decimal(acc.opening_balance)
        for txn in acc.transactions:
            bal += _decimal(txn.amount) if txn.txn_type == "credit" else -_decimal(txn.amount)
        total_cash += bal

    total_assets = total_cash + total_outstanding_receivable + prop_invested + part_invested + recv_pending
    total_liabilities = total_outstanding_payable + pay_pending

    # ── ALERTS (priority: EMI > Collateral 75 % > Interest overdue) ──────
    alerts: List[dict] = []
    for loan in loans_given:
        if loan.status != "active":
            continue
        cached = outstanding_cache.get(loan.id)
        if not cached:
            continue
        interest_due = _decimal(cached["interest_outstanding"])
        total_out = _decimal(cached["total_outstanding"])
        cname = loan.contact.name if loan.contact else f"#{loan.contact_id}"

        # EMI overdue
        if loan.loan_type == "emi" and interest_due > 0:
            alerts.append({
                "type": "emi_overdue", "priority": 1, "loan_id": loan.id,
                "contact_name": cname,
                "title": f"{cname} — EMI overdue",
                "description": f"Outstanding \u20b9{total_out:,.0f} \u00b7 Interest due \u20b9{interest_due:,.0f}",
            })

        # Collateral risk (>75 %)
        for col in db.query(Collateral).filter(Collateral.loan_id == loan.id).all():
            est = _decimal(col.estimated_value)
            if est > 0 and total_out > est * Decimal("0.75"):
                pct = total_out / est * 100
                alerts.append({
                    "type": "collateral", "priority": 2, "loan_id": loan.id,
                    "contact_name": cname,
                    "title": f"{cname} — Collateral risk",
                    "description": f"Outstanding \u20b9{total_out:,.0f} vs Collateral \u20b9{est:,.0f} ({pct:.0f}%)",
                })

        # Interest overdue (non-EMI, >30 days old)
        if loan.loan_type != "emi" and interest_due > 0:
            if loan.disbursed_date and loan.disbursed_date <= today - timedelta(days=30):
                alerts.append({
                    "type": "interest_overdue", "priority": 3, "loan_id": loan.id,
                    "contact_name": cname,
                    "title": f"{cname} — Interest overdue",
                    "description": f"Interest due \u20b9{interest_due:,.0f} \u00b7 {loan.loan_type.replace('_', ' ').title()}",
                })

    alerts.sort(key=lambda a: a["priority"])

    # ── THIS MONTH COLLECTIONS ───────────────────────────────────────────
    tm_payments = (
        db.query(LoanPayment)
        .join(Loan, Loan.id == LoanPayment.loan_id)
        .filter(Loan.loan_direction == "given", LoanPayment.payment_date >= month_start, LoanPayment.payment_date <= today)
        .all()
    )
    coll_total = sum(_decimal(p.amount_paid) for p in tm_payments)
    coll_principal = sum(_decimal(p.allocated_to_principal) for p in tm_payments)
    coll_interest = sum(
        _decimal(p.allocated_to_current_interest) + _decimal(p.allocated_to_overdue_interest)
        for p in tm_payments
    )
    expected_this = Decimal("0")
    for loan in loans_given:
        if loan.status == "active":
            expected_this += _loan_monthly_expected(loan)
    coll_rate = float(coll_total / expected_this * 100) if expected_this > 0 else 0

    # ── CASHFLOW (6 months) ──────────────────────────────────────────────
    month_buckets = _generate_months(6)
    inflow_map: Dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    outflow_map: Dict[str, Decimal] = defaultdict(lambda: Decimal("0"))

    for pay in db.query(LoanPayment).all():
        key = _month_key(pay.payment_date)
        loan_obj = pay.loan
        if not loan_obj:
            continue
        amt = _decimal(pay.amount_paid)
        if loan_obj.loan_direction == "given":
            inflow_map[key] += amt
        else:
            outflow_map[key] += amt

    for txn in db.query(PropertyTransaction).all():
        key = _month_key(txn.txn_date)
        amt = _decimal(txn.amount)
        if txn.txn_type in INFLOW_PROPERTY_TXN_TYPES:
            inflow_map[key] += amt
        elif txn.txn_type in OUTFLOW_PROPERTY_TXN_TYPES:
            outflow_map[key] += amt

    for txn in db.query(PartnershipTransaction).all():
        key = _month_key(txn.txn_date)
        amt = _decimal(txn.amount)
        if txn.txn_type in INFLOW_PARTNERSHIP_TXN_TYPES:
            inflow_map[key] += amt
        elif txn.txn_type in OUTFLOW_PARTNERSHIP_TXN_TYPES:
            outflow_map[key] += amt

    for exp in db.query(Expense).all():
        outflow_map[_month_key(exp.expense_date)] += _decimal(exp.amount)

    cashflow = []
    for m in month_buckets:
        key = _month_key(m)
        cashflow.append({
            "month": m.strftime("%b"),
            "inflow": _f(inflow_map[key]),
            "outflow": _f(outflow_map[key]),
        })

    # ── BUILD RESPONSE ───────────────────────────────────────────────────
    return {
        "net_worth": {
            "total_assets": _f(total_assets),
            "total_liabilities": _f(total_liabilities),
            "net_worth": _f(total_assets - total_liabilities),
            "cash_balance": _f(total_cash),
        },
        "lending": {
            "total_lent_all_time": _f(total_lent_all_time),
            "total_outstanding": _f(total_outstanding_receivable),
            "total_interest_earned": _f(total_interest_earned),
            "total_principal_recovered": _f(total_principal_recovered),
            "active_count": sum(1 for l in loans_given if l.status == "active"),
            "by_type": {
                lt: {
                    "active_count": d["active_count"],
                    "closed_count": d["closed_count"],
                    "total_principal": _f(d["total_principal"]),
                    "total_outstanding": _f(d["total_outstanding"]),
                    "total_interest_earned": _f(d["total_interest_earned"]),
                    "loans": d["loans"],
                }
                for lt, d in by_type.items()
            },
        },
        "borrowing": {
            "total_borrowed": _f(total_borrowed),
            "total_outstanding": _f(total_outstanding_payable),
            "total_interest_paid": _f(total_interest_paid),
            "loans": borrowing_loans,
        },
        "obligations": {
            "receivable_total": _f(recv_total),
            "receivable_pending": _f(recv_pending),
            "payable_total": _f(pay_total),
            "payable_pending": _f(pay_pending),
            "items": obligation_items,
        },
        "expenses": {
            "this_month_total": _f(this_m_total),
            "last_month_total": _f(last_m_total),
            "trend_pct": round(trend_pct, 1),
            "top_categories": top_cats,
        },
        "investments": {
            "properties": {"count": len(properties), "total_invested": _f(prop_invested), "total_profit": _f(prop_profit)},
            "partnerships": {"count": len(partnerships), "total_invested": _f(part_invested), "total_received": _f(part_received)},
            "beesi": {"count": len(all_beesis), "total_paid": _f(beesi_paid), "total_received": _f(beesi_received)},
        },
        "alerts": alerts,
        "this_month": {
            "month_name": today.strftime("%B %Y"),
            "total_collected": _f(coll_total),
            "principal_portion": _f(coll_principal),
            "interest_portion": _f(coll_interest),
            "expected": _f(expected_this),
            "pending": _f(max(expected_this - coll_total, Decimal("0"))),
            "collection_rate_pct": round(coll_rate, 1),
        },
        "cashflow": cashflow,
    }
