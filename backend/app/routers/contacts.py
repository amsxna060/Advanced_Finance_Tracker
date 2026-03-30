from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from decimal import Decimal
from datetime import date

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.user import User
from app.models.contact import Contact
from app.models.loan import Loan
from app.models.collateral import Collateral
from app.models.property_deal import PropertyDeal
from app.models.partnership import Partnership, PartnershipMember
from app.models.beesi import Beesi
from app.schemas.contact import ContactCreate, ContactUpdate, ContactOut
from app.services.interest import calculate_outstanding

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


@router.get("", response_model=List[ContactOut])
def get_contacts(
    search: Optional[str] = None,
    contact_type: Optional[str] = None,
    relationship_type: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get list of contacts with optional filters and pagination"""
    query = db.query(Contact).filter(Contact.is_deleted == False)
    
    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            or_(
                Contact.name.ilike(search_filter),
                Contact.phone.ilike(search_filter),
                Contact.city.ilike(search_filter)
            )
        )
    
    if contact_type:
        query = query.filter(Contact.contact_type == contact_type)
    
    if relationship_type:
        query = query.filter(Contact.relationship_type == relationship_type)
    
    contacts = query.order_by(Contact.name).offset(skip).limit(limit).all()
    return contacts


@router.post("", response_model=ContactOut)
def create_contact(
    contact_data: ContactCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Create a new contact"""
    # Check if contact with same name already exists
    existing = db.query(Contact).filter(
        Contact.name == contact_data.name,
        Contact.is_deleted == False
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="Contact with this name already exists")
    
    new_contact = Contact(**contact_data.model_dump())
    db.add(new_contact)
    db.commit()
    db.refresh(new_contact)
    return new_contact


@router.get("/{contact_id}", response_model=dict)
def get_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get contact details with summary of all dealings"""
    contact = db.query(Contact).filter(
        Contact.id == contact_id,
        Contact.is_deleted == False
    ).first()
    
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    # Calculate summary statistics
    loans_given = db.query(Loan).filter(
        Loan.contact_id == contact_id,
        Loan.loan_direction == "given",
        Loan.is_deleted == False
    ).all()
    
    loans_taken = db.query(Loan).filter(
        Loan.contact_id == contact_id,
        Loan.loan_direction == "taken",
        Loan.is_deleted == False
    ).all()
    
    total_lent = sum(Decimal(str(loan.principal_amount)) for loan in loans_given)
    total_borrowed = sum(Decimal(str(loan.principal_amount)) for loan in loans_taken)

    active_loans_count = len([l for l in loans_given + loans_taken if l.status == "active"])

    # Calculate outstanding interest due and overdue across all active loans for this contact
    today = date.today()
    total_interest_due = Decimal("0")
    total_overdue = Decimal("0")
    outstanding_map = {}
    for loan in loans_given + loans_taken:
        if loan.status != "active":
            continue
        try:
            out = calculate_outstanding(loan.id, today, db)
            outstanding_map[loan.id] = out
            total_interest_due += Decimal(str(out.get("interest_outstanding", 0)))
            total_overdue += Decimal(str(out.get("total_outstanding", 0)))
        except Exception:
            pass

    # Total collateral value across all loans for this contact
    all_loan_ids = [l.id for l in loans_given + loans_taken]
    total_collateral = Decimal("0")
    if all_loan_ids:
        collaterals = db.query(Collateral).filter(
            Collateral.loan_id.in_(all_loan_ids)
        ).all()
        total_collateral = sum(
            Decimal(str(c.estimated_value)) for c in collaterals if c.estimated_value
        )

    return {
        "contact": ContactOut.model_validate(contact),
        "summary": {
            "total_lent": float(total_lent),
            "total_borrowed": float(total_borrowed),
            "active_loans_count": active_loans_count,
            "total_loans_count": len(loans_given) + len(loans_taken),
            "total_interest_due": float(total_interest_due),
            "total_outstanding": float(total_overdue),
            "total_collateral_value": float(total_collateral),
        },
        # Detailed loans list for display
        "loans": [
            {
                "id": l.id,
                "loan_direction": l.loan_direction,
                "loan_type": l.loan_type,
                "principal_amount": float(l.principal_amount),
                "current_principal": float(outstanding_map[l.id]["principal_outstanding"]) if l.id in outstanding_map else None,
                "interest_outstanding": float(outstanding_map[l.id]["interest_outstanding"]) if l.id in outstanding_map else None,
                "total_outstanding": float(outstanding_map[l.id]["total_outstanding"]) if l.id in outstanding_map else None,
                "capitalization_enabled": bool(l.capitalization_enabled),
                "disbursed_date": l.disbursed_date.isoformat() if l.disbursed_date else None,
                "status": l.status,
                "interest_rate": float(l.interest_rate) if l.interest_rate else None,
            }
            for l in sorted(
                loans_given + loans_taken,
                key=lambda x: (0 if x.status == "active" else 1, x.disbursed_date or date.min),
                reverse=False,
            )
        ],
        # Properties linked to this contact
        "properties": [
            {
                "id": p.id,
                "title": p.title,
                "role": "seller" if p.seller_contact_id == contact_id else "buyer",
                "status": p.status,
                "property_type": p.property_type,
            }
            for p in db.query(PropertyDeal).filter(
                PropertyDeal.is_deleted == False,
                or_(
                    PropertyDeal.seller_contact_id == contact_id,
                    PropertyDeal.buyer_contact_id == contact_id,
                ),
            ).order_by(PropertyDeal.created_at.desc()).all()
        ],
        # Partnerships where contact is a member
        "partnerships": [
            {
                "id": pm.partnership.id,
                "title": pm.partnership.title,
                "status": pm.partnership.status,
                "share_percentage": float(pm.share_percentage) if pm.share_percentage else None,
            }
            for pm in db.query(PartnershipMember).filter(
                PartnershipMember.contact_id == contact_id
            ).all()
            if pm.partnership and not pm.partnership.is_deleted
        ],
        # Beesis linked to this contact
        "beesis": [
            {"id": b.id, "title": b.title, "status": b.status}
            for b in db.query(Beesi).filter(
                Beesi.contact_id == contact_id, Beesi.is_deleted == False
            ).all()
        ],
    }


@router.put("/{contact_id}", response_model=ContactOut)
def update_contact(
    contact_id: int,
    contact_data: ContactUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Update a contact"""
    contact = db.query(Contact).filter(
        Contact.id == contact_id,
        Contact.is_deleted == False
    ).first()
    
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    # Update only provided fields
    update_data = contact_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(contact, field, value)
    
    db.commit()
    db.refresh(contact)
    return contact


@router.delete("/{contact_id}")
def delete_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Soft delete a contact"""
    contact = db.query(Contact).filter(
        Contact.id == contact_id,
        Contact.is_deleted == False
    ).first()
    
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    # Check if contact has active loans
    active_loans = db.query(Loan).filter(
        Loan.contact_id == contact_id,
        Loan.status == "active",
        Loan.is_deleted == False
    ).count()
    
    if active_loans > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete contact with {active_loans} active loan(s). Close loans first."
        )
    
    contact.is_deleted = True
    db.commit()
    return {"message": "Contact deleted successfully"}
