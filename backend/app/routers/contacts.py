from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from decimal import Decimal

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.user import User
from app.models.contact import Contact
from app.models.loan import Loan
from app.schemas.contact import ContactCreate, ContactUpdate, ContactOut

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


@router.get("", response_model=List[ContactOut])
def get_contacts(
    search: Optional[str] = None,
    contact_type: Optional[str] = None,
    relationship_type: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
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
    
    # Note: Outstanding calculation would need the interest service
    # For now, just return basic info
    
    return {
        "contact": ContactOut.model_validate(contact),
        "summary": {
            "total_lent": float(total_lent),
            "total_borrowed": float(total_borrowed),
            "active_loans_count": active_loans_count,
            "total_loans_count": len(loans_given) + len(loans_taken)
        }
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
