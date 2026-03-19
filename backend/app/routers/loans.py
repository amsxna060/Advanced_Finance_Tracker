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
from app.services.interest import calculate_outstanding, generate_emi_schedule, check_capitalization_due
from app.services.payment_allocation import allocate_payment

router = APIRouter(prefix="/api/loans", tags=["loans"])


@router.get("", response_model=List[LoanOut])
def get_loans(
    direction: Optional[str] = None,
    loan_type: Optional[str] = None,
    status: Optional[str] = None,
    contact_id: Optional[int] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
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

    # Generate EMI schedule with paid status (cross-referenced with payments)
    schedule = []
    if loan.loan_type == "emi":
        raw_schedule = generate_emi_schedule(loan)
        # payments are ordered desc; count total payments for simple paid tracking
        paid_count = db.query(LoanPayment).filter(LoanPayment.loan_id == loan_id).count()
        for entry in raw_schedule:
            status = "paid" if entry["emi_number"] <= paid_count else "pending"
            schedule.append({
                "emi_number": entry["emi_number"],
                "due_date": str(entry["due_date"]),
                "due_amount": float(entry["due_amount"]),
                "status": status,
            })

    return {
        "loan": LoanOut.model_validate(loan),
        "contact": ContactBrief.model_validate(loan.contact) if loan.contact else None,
        "outstanding": outstanding,
        "payments": [LoanPaymentOut.model_validate(p) for p in payments],
        "collaterals": [CollateralOut.model_validate(c) for c in collaterals],
        "capitalization_status": cap_status,
        "emi_schedule": schedule,
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
    
    # Update only provided fields
    update_data = loan_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(loan, field, value)
    
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
    """Soft delete a loan"""
    loan = db.query(Loan).filter(
        Loan.id == loan_id,
        Loan.is_deleted == False
    ).first()
    
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    
    if loan.status == "active":
        raise HTTPException(
            status_code=400,
            detail="Cannot delete active loan. Close the loan first by marking status as 'closed'."
        )
    
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
        db
    )
    
    # Create payment record
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
        notes=payment_data.notes,
        created_by=current_user.id
    )
    
    db.add(new_payment)
    db.commit()
    db.refresh(new_payment)
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Preview how a payment will be allocated before committing"""
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    
    preview_date = payment_date or date.today()
    allocation = allocate_payment(loan_id, amount, preview_date, db)
    
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
