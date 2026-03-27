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
from app.models.collateral import Collateral
from app.models.expense import Expense
from app.models.loan import Loan, LoanPayment
from app.models.partnership import Partnership, PartnershipTransaction
from app.models.property_deal import PropertyDeal, PropertyTransaction
from app.models.user import User
from app.services.interest import calculate_outstanding, check_capitalization_due

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
        return (principal * rate) / Decimal("100")
    if loan.loan_type == "short_term" and loan.post_due_interest_rate:
        return (principal * _decimal(loan.post_due_interest_rate)) / Decimal("100")
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
            else:
                total_borrowed += principal
                total_outstanding_payable += total_due
        except Exception:
            # Skip loans that error (e.g. missing data) so the summary still loads
            pass

    total_partnership_invested = sum(_decimal(item.our_investment) for item in active_partnerships)
    total_partnership_received = sum(_decimal(item.total_received) for item in active_partnerships)

    return {
        "total_lent_out": total_lent_out,
        "total_outstanding_receivable": total_outstanding_receivable,
        "total_borrowed": total_borrowed,
        "total_outstanding_payable": total_outstanding_payable,
        "net_position": total_outstanding_receivable - total_outstanding_payable,
        "expected_this_month": expected_this_month,
        "total_overdue": total_overdue,
        "active_property_deals": active_properties,
        "active_partnerships": len(active_partnerships),
        "total_partnership_invested": total_partnership_invested,
        "total_partnership_received": total_partnership_received,
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
