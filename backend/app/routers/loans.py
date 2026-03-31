from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import date
from decimal import Decimal

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.user import User
from app.models.loan import Loan, LoanPayment, LoanCapitalizationEvent
from app.models.contact import Contact
from app.schemas.loan import (
    LoanCreate, LoanUpdate, LoanOut, LoanPaymentCreate, LoanPaymentOut,
    OutstandingResponse, PaymentPreviewResponse, CapitalizeRequest, ContactBrief
)
from app.schemas.collateral import CollateralOut
from app.services.interest import (
    calculate_outstanding, generate_emi_schedule, check_capitalization_due,
    calculate_emi_interest_summary, get_emi_schedule_with_payments,
    generate_monthly_interest_schedule,
)
from app.services.payment_allocation import allocate_payment
from app.services.auto_ledger import auto_ledger, reverse_all_ledger
from app.models.cash_account import AccountTransaction

router = APIRouter(prefix="/api/loans", tags=["loans"])


@router.get("", response_model=List[LoanOut])
def get_loans(
    direction: Optional[str] = None,
    loan_type: Optional[str] = None,
    status: Optional[str] = None,
    contact_id: Optional[int] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get list of loans with optional filters and pagination"""
    query = db.query(Loan).options(joinedload(Loan.contact)).filter(Loan.is_deleted == False)
    
    if direction:
        query = query.filter(Loan.loan_direction == direction)
    
    if loan_type:
        query = query.filter(Loan.loan_type == loan_type)
    
    if status:
        query = query.filter(Loan.status == status)
    
    if contact_id:
        query = query.filter(Loan.contact_id == contact_id)
    
    loans = query.order_by(Loan.disbursed_date.desc()).offset(skip).limit(limit).all()
    return loans


@router.post("", response_model=LoanOut)
def create_loan(
    loan_data: LoanCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Create a new loan"""
    # Verify contact exists
    contact = db.query(Contact).filter(
        Contact.id == loan_data.contact_id,
        Contact.is_deleted == False
    ).first()
    
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    # Validate loan type specific fields
    if loan_data.loan_type == "emi":
        if not all([loan_data.emi_amount, loan_data.tenure_months]):
            raise HTTPException(
                status_code=400,
                detail="EMI loans require emi_amount and tenure_months"
            )
    elif loan_data.loan_type == "interest_only":
        if not loan_data.interest_rate:
            raise HTTPException(status_code=400, detail="Interest-only loans require interest_rate")
    elif loan_data.loan_type == "short_term":
        if not loan_data.interest_free_till:
            raise HTTPException(status_code=400, detail="Short-term loans require interest_free_till date")
    
    new_loan = Loan(**loan_data.model_dump(), created_by=current_user.id)
    db.add(new_loan)
    db.flush()  # get new_loan.id

    # Auto-ledger: loan disbursement
    if new_loan.account_id:
        direction = new_loan.loan_direction
        auto_ledger(
            db=db,
            account_id=new_loan.account_id,
            txn_type="debit" if direction == "given" else "credit",
            amount=Decimal(str(new_loan.principal_amount)),
            txn_date=new_loan.disbursed_date,
            linked_type="loan",
            linked_id=new_loan.id,
            description=f"Loan {'disbursed to' if direction == 'given' else 'received from'} {contact.name}",
            payment_mode=None,
            contact_id=new_loan.contact_id,
            created_by=current_user.id,
        )

    db.commit()
    db.refresh(new_loan)
    return new_loan


@router.get("/{loan_id}", response_model=dict)
def get_loan(
    loan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get loan details with payments, outstanding, and collaterals"""
    loan = db.query(Loan).filter(
        Loan.id == loan_id,
        Loan.is_deleted == False
    ).first()
    
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    
    # Calculate outstanding
    outstanding = calculate_outstanding(loan_id, date.today(), db)
    
    # Get payments
    payments = db.query(LoanPayment).filter(
        LoanPayment.loan_id == loan_id
    ).order_by(LoanPayment.payment_date.desc()).all()
    
    # Get collaterals
    from app.models.collateral import Collateral
    collaterals = db.query(Collateral).filter(Collateral.loan_id == loan_id).all()
    
    # Check capitalization status
    cap_status = check_capitalization_due(loan, db)

    # Generate EMI schedule with paid status using carry-forward logic
    schedule = []
    emi_interest_summary = None
    if loan.loan_type == "emi":
        schedule = get_emi_schedule_with_payments(loan, db)
        # Calculate EMI interest summary
        if loan.principal_amount and loan.emi_amount and loan.tenure_months:
            from decimal import Decimal as D
            emi_interest_summary = calculate_emi_interest_summary(
                D(str(loan.principal_amount)),
                D(str(loan.emi_amount)),
                loan.tenure_months,
            )
            # Convert Decimal values to float for JSON serialization
            emi_interest_summary = {
                k: float(v) for k, v in emi_interest_summary.items()
            }

    return {
        "loan": LoanOut.model_validate(loan),
        "contact": ContactBrief.model_validate(loan.contact) if loan.contact else None,
        "outstanding": outstanding,
        "payments": [LoanPaymentOut.model_validate(p) for p in payments],
        "collaterals": [CollateralOut.model_validate(c) for c in collaterals],
        "capitalization_status": cap_status,
        "emi_schedule": schedule,
        "emi_interest_summary": emi_interest_summary,
    }


@router.put("/{loan_id}", response_model=LoanOut)
def update_loan(
    loan_id: int,
    loan_data: LoanUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Update a loan"""
    loan = db.query(Loan).filter(
        Loan.id == loan_id,
        Loan.is_deleted == False
    ).first()
    
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")

    # Capture old values before mutation (to decide if ledger needs updating)
    old_account_id = loan.account_id
    old_principal = Decimal(str(loan.principal_amount))
    old_disbursed_date = loan.disbursed_date
    old_direction = loan.loan_direction

    # Update only provided fields
    update_data = loan_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(loan, field, value)

    # Re-sync disbursement ledger entry if any ledger-relevant field changed
    ledger_fields = {"account_id", "principal_amount", "disbursed_date", "loan_direction"}
    if ledger_fields & set(update_data.keys()):
        # Remove old disbursement ledger entry (if one existed)
        if old_account_id:
            old_entry = db.query(AccountTransaction).filter(
                AccountTransaction.linked_type == "loan",
                AccountTransaction.linked_id == loan_id,
                AccountTransaction.txn_type == ("debit" if old_direction == "given" else "credit"),
                AccountTransaction.amount == old_principal,
                AccountTransaction.txn_date == old_disbursed_date,
            ).first()
            if old_entry:
                db.delete(old_entry)

        # Create new disbursement ledger entry with updated values
        if loan.account_id and loan.disbursed_date:
            contact = db.query(Contact).filter(Contact.id == loan.contact_id).first()
            contact_name = contact.name if contact else "Unknown"
            direction = loan.loan_direction
            auto_ledger(
                db=db,
                account_id=loan.account_id,
                txn_type="debit" if direction == "given" else "credit",
                amount=Decimal(str(loan.principal_amount)),
                txn_date=loan.disbursed_date,
                linked_type="loan",
                linked_id=loan_id,
                description=f"Loan {'disbursed to' if direction == 'given' else 'received from'} {contact_name}",
                payment_mode=None,
                contact_id=loan.contact_id,
                created_by=current_user.id,
            )

    db.commit()
    # Re-fetch with joinedload so LoanOut.contact serializes without lazy-load error
    loan = db.query(Loan).options(joinedload(Loan.contact)).filter(Loan.id == loan_id).first()
    return loan


@router.delete("/{loan_id}")
def delete_loan(
    loan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Soft delete a loan and clean up all linked ledger entries"""
    loan = db.query(Loan).filter(
        Loan.id == loan_id,
        Loan.is_deleted == False
    ).first()
    
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    
    # Reverse all linked AccountTransaction entries (disbursement + payments)
    reverse_all_ledger(db, "loan", loan_id)
    loan.is_deleted = True
    db.commit()
    return {"message": "Loan deleted successfully"}


@router.post("/{loan_id}/payments", response_model=LoanPaymentOut)
def record_payment(
    loan_id: int,
    payment_data: LoanPaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Record a payment against a loan with automatic allocation"""
    loan = db.query(Loan).filter(
        Loan.id == loan_id,
        Loan.is_deleted == False
    ).first()
    
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    
    # Allocate payment
    allocation = allocate_payment(
        loan_id,
        Decimal(str(payment_data.amount_paid)),
        payment_data.payment_date,
        db,
        principal_repayment=Decimal(str(payment_data.principal_repayment)) if payment_data.principal_repayment else None,
        auto_split=payment_data.auto_split,
    )
    
    # Create payment record
    acct_id = payment_data.account_id or loan.account_id
    new_payment = LoanPayment(
        loan_id=loan_id,
        payment_date=payment_data.payment_date,
        amount_paid=payment_data.amount_paid,
        allocated_to_overdue_interest=allocation["allocated_to_overdue_interest"],
        allocated_to_current_interest=allocation["allocated_to_current_interest"],
        allocated_to_principal=allocation["allocated_to_principal"],
        payment_mode=payment_data.payment_mode,
        collected_by=payment_data.collected_by,
        reference_number=payment_data.reference_number,
        account_id=acct_id,
        notes=payment_data.notes,
        created_by=current_user.id
    )
    
    db.add(new_payment)
    db.flush()

    # Auto-ledger: payment
    if acct_id:
        direction = loan.loan_direction
        contact_name = loan.contact.name if loan.contact else "Unknown"
        auto_ledger(
            db=db,
            account_id=acct_id,
            txn_type="credit" if direction == "given" else "debit",
            amount=Decimal(str(payment_data.amount_paid)),
            txn_date=payment_data.payment_date,
            linked_type="loan",
            linked_id=loan_id,
            description=f"Loan payment {'from' if direction == 'given' else 'to'} {contact_name}",
            payment_mode=payment_data.payment_mode,
            contact_id=loan.contact_id,
            created_by=current_user.id,
        )

    db.commit()
    db.refresh(new_payment)

    # Auto-close check: if fully paid, mark loan as closed
    payment_date = payment_data.payment_date
    if loan.loan_type == "emi" and loan.status == "active":
        schedule = get_emi_schedule_with_payments(loan, db)
        if schedule and all(e["status"] == "paid" for e in schedule):
            loan.status = "closed"
            loan.actual_end_date = payment_date
            db.commit()
    elif loan.loan_type in ("interest_only", "short_term") and loan.status == "active":
        outstanding = calculate_outstanding(loan_id, payment_date, db)
        if outstanding["principal_outstanding"] <= Decimal("0.01"):
            loan.status = "closed"
            loan.actual_end_date = payment_date
            db.commit()

    return new_payment


@router.get("/{loan_id}/payments", response_model=List[LoanPaymentOut])
def get_loan_payments(
    loan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all payments for a loan"""
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    
    payments = db.query(LoanPayment).filter(
        LoanPayment.loan_id == loan_id
    ).order_by(LoanPayment.payment_date.desc()).all()
    
    return payments


@router.delete("/{loan_id}/payments/{payment_id}")
def delete_payment(
    loan_id: int,
    payment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Delete a payment record (admin only)"""
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")

    payment = db.query(LoanPayment).filter(
        LoanPayment.id == payment_id,
        LoanPayment.loan_id == loan_id
    ).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    # Reverse linked ledger entry
    acct_id = payment.account_id or loan.account_id
    if acct_id:
        direction = loan.loan_direction
        matching = db.query(AccountTransaction).filter(
            AccountTransaction.linked_type == "loan",
            AccountTransaction.linked_id == loan_id,
            AccountTransaction.txn_type == ("credit" if direction == "given" else "debit"),
            AccountTransaction.amount == payment.amount_paid,
            AccountTransaction.txn_date == payment.payment_date,
        ).all()
        for m in matching:
            db.delete(m)

    # Re-open loan if it was auto-closed
    if loan.status == "closed":
        loan.status = "active"
        loan.actual_end_date = None

    db.delete(payment)
    db.commit()
    return {"message": "Payment deleted successfully"}


@router.get("/{loan_id}/outstanding", response_model=OutstandingResponse)
def get_outstanding(
    loan_id: int,
    as_of_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get outstanding balance for a loan"""
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    
    outstanding_date = as_of_date or date.today()
    outstanding = calculate_outstanding(loan_id, outstanding_date, db)
    
    return OutstandingResponse(**outstanding)


@router.get("/{loan_id}/payment-preview", response_model=PaymentPreviewResponse)
def preview_payment(
    loan_id: int,
    amount: Decimal = Query(..., gt=0),
    payment_date: Optional[date] = None,
    principal_repayment: Optional[Decimal] = Query(None, gt=0),
    auto_split: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Preview how a payment will be allocated before committing"""
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    
    preview_date = payment_date or date.today()
    allocation = allocate_payment(loan_id, amount, preview_date, db, principal_repayment=principal_repayment, auto_split=auto_split)
    
    return PaymentPreviewResponse(
        amount=amount,
        allocated_to_overdue_interest=allocation["allocated_to_overdue_interest"],
        allocated_to_current_interest=allocation["allocated_to_current_interest"],
        allocated_to_principal=allocation["allocated_to_principal"],
        unallocated=allocation["unallocated"]
    )


@router.post("/{loan_id}/capitalize")
def capitalize_interest(
    loan_id: int,
    request: CapitalizeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Capitalize outstanding interest into principal (admin only)"""
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    
    if not loan.capitalization_enabled:
        raise HTTPException(status_code=400, detail="Capitalization not enabled for this loan")
    
    # Calculate current outstanding
    outstanding = calculate_outstanding(loan_id, request.event_date, db)
    interest_outstanding = outstanding["interest_outstanding"]
    principal_before = outstanding["principal_outstanding"]
    
    if interest_outstanding <= 0:
        raise HTTPException(status_code=400, detail="No interest to capitalize")
    
    # Create capitalization event
    new_principal = principal_before + interest_outstanding
    new_rate = request.interest_rate_after or loan.interest_rate
    
    event = LoanCapitalizationEvent(
        loan_id=loan_id,
        event_date=request.event_date,
        outstanding_interest_before=interest_outstanding,
        principal_before=principal_before,
        new_principal=new_principal,
        interest_rate_after=new_rate,
        notes=request.notes,
        created_by=current_user.id
    )
    
    # Update loan
    loan.last_capitalization_date = request.event_date
    if new_rate != loan.interest_rate:
        loan.interest_rate = new_rate
    
    db.add(event)
    db.commit()
    db.refresh(event)
    
    return {
        "message": "Interest capitalized successfully",
        "event": event,
        "old_principal": float(principal_before),
        "capitalized_interest": float(interest_outstanding),
        "new_principal": float(new_principal)
    }


@router.get("/{loan_id}/schedule")
def get_emi_schedule(
    loan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get EMI schedule for EMI-type loans"""
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    
    if loan.loan_type != "emi":
        raise HTTPException(status_code=400, detail="Schedule only available for EMI loans")
    
    schedule = generate_emi_schedule(loan)
    return {"schedule": schedule}


@router.get("/{loan_id}/monthly-interest-schedule")
def get_monthly_interest_schedule(
    loan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get monthly interest/EMI schedule showing payment status per month.
    Status: 'paid' | 'partial' | 'unpaid' | 'future'
    For EMI loans, interest_due represents the full EMI amount.
    """
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")

    schedule = generate_monthly_interest_schedule(loan, db)
    return {"schedule": schedule, "loan_type": loan.loan_type}


@router.get("/{loan_id}/statement")
def get_client_statement(
    loan_id: int,
    from_month: Optional[str] = Query(None, description="Start month YYYY-MM"),
    to_month: Optional[str] = Query(None, description="End month YYYY-MM"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Generate a borrower-facing loan statement showing chronological events:
    disbursement, interest accruals by month, payments, and capitalizations.
    Filterable by month range.
    """
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")

    contact = loan.contact

    # Get all payments
    payments = db.query(LoanPayment).filter(
        LoanPayment.loan_id == loan_id
    ).order_by(LoanPayment.payment_date.asc()).all()

    # Get capitalization events
    cap_events = db.query(LoanCapitalizationEvent).filter(
        LoanCapitalizationEvent.loan_id == loan_id
    ).order_by(LoanCapitalizationEvent.event_date.asc()).all()

    # Get monthly schedule
    schedule = generate_monthly_interest_schedule(loan, db)

    # Get current outstanding
    outstanding = calculate_outstanding(loan_id, date.today(), db)

    # Build chronological statement entries
    entries = []

    # Disbursement entry
    entries.append({
        "date": str(loan.disbursed_date),
        "type": "disbursement",
        "description": "Loan Disbursed",
        "amount": float(loan.principal_amount),
        "balance_effect": "principal",
    })

    # Interest accrual entries from schedule
    for s in schedule:
        if s.get("month") == "interest_free":
            continue
        entries.append({
            "date": s["month"],
            "type": "interest",
            "description": f"Interest for {s['month_label']}",
            "amount": s["interest_due"],
            "paid": s["interest_paid"],
            "outstanding": s["interest_outstanding"],
            "status": s["status"],
            "capitalized": s.get("capitalized", False),
            "capitalized_amount": s.get("capitalized_amount", 0),
            "new_principal_after": s.get("new_principal_after", None),
        })

    # Payment entries
    for p in payments:
        entries.append({
            "date": str(p.payment_date),
            "type": "payment",
            "description": "Payment Received",
            "amount": float(p.amount_paid),
            "interest_portion": float(
                Decimal(str(p.allocated_to_current_interest or 0)) +
                Decimal(str(p.allocated_to_overdue_interest or 0))
            ),
            "principal_portion": float(p.allocated_to_principal or 0),
            "payment_mode": p.payment_mode,
        })

    # Apply month filter if provided
    if from_month or to_month:
        filtered = []
        for e in entries:
            entry_month = e["date"][:7]  # YYYY-MM
            if from_month and entry_month < from_month:
                continue
            if to_month and entry_month > to_month:
                continue
            filtered.append(e)
        entries = filtered

    # Sort by date
    entries.sort(key=lambda x: x["date"])

    return {
        "loan_id": loan.id,
        "contact_name": contact.name if contact else "Unknown",
        "principal_amount": float(loan.principal_amount),
        "interest_rate": float(loan.interest_rate or 0),
        "loan_type": loan.loan_type,
        "disbursed_date": str(loan.disbursed_date),
        "status": loan.status,
        "outstanding": {
            "principal": float(outstanding["principal_outstanding"]),
            "interest": float(outstanding["interest_outstanding"]),
            "total": float(outstanding["total_outstanding"]),
        },
        "entries": entries,
    }
