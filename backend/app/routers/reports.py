"""
Reports Router - PDF and Excel report generation endpoints
"""
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.loan import Loan, LoanPayment
from app.models.property_deal import PropertyDeal, PropertyTransaction
from app.models.partnership import Partnership, PartnershipTransaction
from app.models.expense import Expense
from app.services.interest import calculate_outstanding
from app.services.pdf_generator import PDFReportGenerator
from app.services.excel_generator import ExcelReportGenerator

router = APIRouter(prefix="/api/reports", tags=["reports"])

pdf_generator = PDFReportGenerator()
excel_generator = ExcelReportGenerator()


def _d(value) -> Decimal:
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


@router.get("/loan-statement/{loan_id}")
def generate_loan_statement(
    loan_id: int,
    format: str = Query("pdf", regex="^(pdf|excel)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    loan = db.query(Loan).filter(Loan.id == loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")

    payments = (
        db.query(LoanPayment)
        .filter(LoanPayment.loan_id == loan_id)
        .order_by(LoanPayment.payment_date.asc())
        .all()
    )

    outstanding_data = calculate_outstanding(loan.id, date.today(), db)

    loan_data = {
        "id": loan.id,
        "contact_name": loan.contact.name if loan.contact else "N/A",
        "principal": float(_d(loan.principal_amount)),
        "interest_rate": float(_d(loan.interest_rate)),
        "start_date": loan.disbursed_date,
        "tenure_months": loan.tenure_months or 0,
        "status": loan.status,
        "outstanding": float(_d(outstanding_data["total_outstanding"])),
        "principal_outstanding": float(_d(outstanding_data["principal_outstanding"])),
        "interest_outstanding": float(_d(outstanding_data["interest_outstanding"])),
        "total_paid": float(sum(_d(p.amount_paid) for p in payments)),
        "overdue_amount": float(_d(outstanding_data["interest_outstanding"])),
    }

    payment_data = [
        {
            "payment_date": p.payment_date,
            "payment_type": p.payment_mode or "payment",
            "principal_amount": float(_d(p.allocated_to_principal)),
            "interest_amount": float(_d(p.allocated_to_current_interest) + _d(p.allocated_to_overdue_interest)),
            "total_amount": float(_d(p.amount_paid)),
            "outstanding_after": 0,
        }
        for p in payments
    ]

    if format == "pdf":
        buffer = pdf_generator.generate_loan_statement(loan_data, payment_data)
        filename = f"loan_statement_{loan_id}_{datetime.now().strftime('%Y%m%d')}.pdf"
        media_type = "application/pdf"
    else:
        buffer = _loan_excel(loan_data, payment_data)
        filename = f"loan_statement_{loan_id}_{datetime.now().strftime('%Y%m%d')}.xlsx"
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    return StreamingResponse(
        buffer,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def _loan_excel(loan_data: dict, payment_data: list) -> BytesIO:
    from openpyxl import Workbook
    buffer = BytesIO()
    wb = Workbook()
    ws = wb.active
    ws.title = "Loan Statement"
    ws["A1"] = "Loan Statement"
    ws["A2"] = f"Loan ID: {loan_data['id']}"
    ws["A3"] = f"Contact: {loan_data['contact_name']}"
    ws["A4"] = f"Principal: {loan_data['principal']}"
    ws["A5"] = f"Outstanding: {loan_data['outstanding']}"
    ws["A6"] = f"Total Paid: {loan_data['total_paid']}"
    ws["A7"] = f"Status: {loan_data['status']}"
    ws["A9"] = "Payment History"
    headers = ["Date", "Mode", "Principal", "Interest", "Total Paid", "Balance After"]
    for col, h in enumerate(headers, start=1):
        ws.cell(row=10, column=col, value=h)
    for row, p in enumerate(payment_data, start=11):
        ws.cell(row=row, column=1, value=str(p["payment_date"]))
        ws.cell(row=row, column=2, value=p["payment_type"])
        ws.cell(row=row, column=3, value=p["principal_amount"])
        ws.cell(row=row, column=4, value=p["interest_amount"])
        ws.cell(row=row, column=5, value=p["total_amount"])
        ws.cell(row=row, column=6, value=p["outstanding_after"])
    wb.save(buffer)
    buffer.seek(0)
    return buffer


@router.get("/portfolio-summary")
def generate_portfolio_summary(
    format: str = Query("pdf", regex="^(pdf|excel)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    active_loans = db.query(Loan).filter(Loan.status == "active").all()

    total_lent_out = Decimal("0")
    total_outstanding_receivable = Decimal("0")
    total_borrowed = Decimal("0")
    total_outstanding_payable = Decimal("0")

    for loan in active_loans:
        principal = _d(loan.principal_amount)
        outstanding = calculate_outstanding(loan.id, date.today(), db)
        total_due = _d(outstanding["total_outstanding"])
        if loan.loan_direction == "given":
            total_lent_out += principal
            total_outstanding_receivable += total_due
        else:
            total_borrowed += principal
            total_outstanding_payable += total_due

    active_property_deals = db.query(PropertyDeal).count()
    active_partnerships = db.query(Partnership).filter(
        Partnership.status == "active"
    ).count()

    summary_data = {
        "total_lent_out": float(total_lent_out),
        "total_outstanding_receivable": float(total_outstanding_receivable),
        "total_borrowed": float(total_borrowed),
        "total_outstanding_payable": float(total_outstanding_payable),
        "net_position": float(total_outstanding_receivable - total_outstanding_payable),
        "expected_this_month": 0,
        "total_overdue": 0,
        "active_property_deals": active_property_deals,
        "active_partnerships": active_partnerships,
    }

    if format == "pdf":
        buffer = pdf_generator.generate_portfolio_summary(summary_data)
        filename = f"portfolio_summary_{datetime.now().strftime('%Y%m%d')}.pdf"
        media_type = "application/pdf"
    else:
        loans_list = []
        for loan in active_loans:
            outstanding = calculate_outstanding(loan.id, date.today(), db)
            loans_list.append({
                "id": loan.id,
                "contact_name": loan.contact.name if loan.contact else "N/A",
                "loan_type": loan.loan_direction,
                "principal": float(_d(loan.principal_amount)),
                "interest_rate": float(_d(loan.interest_rate)),
                "outstanding": float(_d(outstanding["total_outstanding"])),
                "status": loan.status,
                "start_date": loan.disbursed_date,
                "tenure_months": loan.tenure_months or 0,
            })

        properties_list = [
            {
                "id": p.id,
                "title": p.title,
                "location": p.location or "",
                "total_investment": float(_d(p.purchase_price or p.advance_paid)),
                "current_value": float(_d(p.sale_price or p.total_buyer_value or p.total_seller_value)),
                "status": p.status,
                "purchase_date": p.deal_locked_date,
                "exit_date": p.actual_registry_date,
            }
            for p in db.query(PropertyDeal).all()
        ]

        partnerships_list = [
            {
                "id": pr.id,
                "name": pr.title,
                "partnership_type": "partnership",
                "total_capital": float(_d(pr.total_deal_value)),
                "your_share_percentage": float(_d(pr.our_share_percentage)),
                "your_investment": float(_d(pr.our_investment)),
                "status": pr.status,
                "start_date": pr.start_date,
            }
            for pr in db.query(Partnership).all()
        ]

        expenses_list = [
            {
                "id": e.id,
                "expense_date": e.expense_date,
                "category": e.category,
                "amount": float(_d(e.amount)),
                "linked_type": e.linked_type or "",
                "payment_mode": e.payment_mode or "",
                "description": e.description or "",
            }
            for e in db.query(Expense).all()
        ]

        buffer = excel_generator.generate_comprehensive_report(
            summary_data, loans_list, properties_list, partnerships_list, expenses_list
        )
        filename = f"portfolio_summary_{datetime.now().strftime('%Y%m%d')}.xlsx"
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    return StreamingResponse(
        buffer,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/profit-loss")
def generate_pnl_report(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    format: str = Query("pdf", regex="^(pdf|excel)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    end = datetime.strptime(end_date, "%Y-%m-%d").date() if end_date else date.today()
    start = datetime.strptime(start_date, "%Y-%m-%d").date() if start_date else end - timedelta(days=30)

    # Income
    income_data = []
    received_payments = (
        db.query(LoanPayment)
        .join(Loan)
        .filter(
            Loan.loan_direction == "given",
            LoanPayment.payment_date.between(start, end),
        )
        .all()
    )
    total_interest_received = sum(
        _d(p.allocated_to_current_interest) + _d(p.allocated_to_overdue_interest)
        for p in received_payments
    )
    if total_interest_received > 0:
        income_data.append({"category": "Interest Income", "amount": float(total_interest_received)})

    prop_inflow = sum(
        _d(t.amount)
        for t in db.query(PropertyTransaction).filter(
            PropertyTransaction.txn_date.between(start, end),
            PropertyTransaction.txn_type.in_(["received_from_buyer", "sale_proceeds", "refund"]),
        ).all()
    )
    if prop_inflow > 0:
        income_data.append({"category": "Property Income", "amount": float(prop_inflow)})

    partnership_income = sum(
        _d(t.amount)
        for t in db.query(PartnershipTransaction).filter(
            PartnershipTransaction.txn_date.between(start, end),
            PartnershipTransaction.txn_type.in_(["received", "profit_distributed"]),
        ).all()
    )
    if partnership_income > 0:
        income_data.append({"category": "Partnership Income", "amount": float(partnership_income)})

    # Expenses
    expense_data = []
    expenses = db.query(Expense).filter(
        Expense.expense_date.between(start, end),
    ).all()
    by_category: dict = {}
    for e in expenses:
        cat = (e.category or "other").capitalize()
        by_category[cat] = by_category.get(cat, Decimal("0")) + _d(e.amount)
    for cat, amt in by_category.items():
        expense_data.append({"category": cat, "amount": float(amt)})

    paid_payments = (
        db.query(LoanPayment)
        .join(Loan)
        .filter(
            Loan.loan_direction == "taken",
            LoanPayment.payment_date.between(start, end),
        )
        .all()
    )
    total_interest_paid = sum(
        _d(p.allocated_to_current_interest) + _d(p.allocated_to_overdue_interest)
        for p in paid_payments
    )
    if total_interest_paid > 0:
        expense_data.append({"category": "Interest Expense", "amount": float(total_interest_paid)})

    prop_outflow = sum(
        _d(t.amount)
        for t in db.query(PropertyTransaction).filter(
            PropertyTransaction.txn_date.between(start, end),
            PropertyTransaction.txn_type.in_(["advance_to_seller", "payment_to_seller", "commission_paid"]),
        ).all()
    )
    if prop_outflow > 0:
        expense_data.append({"category": "Property Payments", "amount": float(prop_outflow)})

    if format == "pdf":
        buffer = pdf_generator.generate_pnl_report(
            datetime.combine(start, datetime.min.time()),
            datetime.combine(end, datetime.min.time()),
            income_data,
            expense_data,
        )
        filename = f"pnl_{start.strftime('%Y%m%d')}_{end.strftime('%Y%m%d')}.pdf"
        media_type = "application/pdf"
    else:
        buffer = _pnl_excel(start, end, income_data, expense_data)
        filename = f"pnl_{start.strftime('%Y%m%d')}_{end.strftime('%Y%m%d')}.xlsx"
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    return StreamingResponse(
        buffer,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def _pnl_excel(start: date, end: date, income_data: list, expense_data: list) -> BytesIO:
    from openpyxl import Workbook
    buffer = BytesIO()
    wb = Workbook()
    ws = wb.active
    ws.title = "P&L Statement"
    ws["A1"] = "PROFIT & LOSS STATEMENT"
    ws["A2"] = f"Period: {start} to {end}"
    row = 4
    ws[f"A{row}"] = "INCOME"
    for item in income_data:
        row += 1
        ws[f"A{row}"] = item["category"]
        ws[f"B{row}"] = item["amount"]
    total_income = sum(i["amount"] for i in income_data)
    row += 1
    ws[f"A{row}"] = "Total Income"
    ws[f"B{row}"] = total_income
    row += 2
    ws[f"A{row}"] = "EXPENSES"
    for item in expense_data:
        row += 1
        ws[f"A{row}"] = item["category"]
        ws[f"B{row}"] = item["amount"]
    total_expense = sum(e["amount"] for e in expense_data)
    row += 1
    ws[f"A{row}"] = "Total Expenses"
    ws[f"B{row}"] = total_expense
    row += 2
    ws[f"A{row}"] = "Net Profit / Loss"
    ws[f"B{row}"] = total_income - total_expense
    wb.save(buffer)
    buffer.seek(0)
    return buffer
