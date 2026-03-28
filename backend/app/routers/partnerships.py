from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.contact import Contact
from app.models.partnership import Partnership, PartnershipMember, PartnershipTransaction
from app.models.property_deal import PropertyDeal
from app.models.user import User
from app.schemas.partnership import (
    PartnershipCreate,
    PartnershipMemberCreate,
    PartnershipMemberOut,
    PartnershipOut,
    PartnershipSettleRequest,
    PartnershipTransactionCreate,
    PartnershipTransactionOut,
    PartnershipUpdate,
)
from app.schemas.property_deal import PropertyDealOut
from app.schemas.loan import ContactBrief
from app.services.auto_ledger import auto_ledger

router = APIRouter(prefix="/api/partnerships", tags=["partnerships"])


def _decimal(value: Optional[Decimal]) -> Decimal:
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def _get_partnership_or_404(partnership_id: int, db: Session) -> Partnership:
    partnership = db.query(Partnership).filter(
        Partnership.id == partnership_id,
        Partnership.is_deleted == False,
    ).first()
    if not partnership:
        raise HTTPException(status_code=404, detail="Partnership not found")
    return partnership


def _ensure_contact_exists(contact_id: Optional[int], db: Session) -> None:
    if not contact_id:
        return
    contact = db.query(Contact).filter(
        Contact.id == contact_id,
        Contact.is_deleted == False,
    ).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")


def _ensure_property_exists(property_id: Optional[int], db: Session) -> None:
    if not property_id:
        return
    property_deal = db.query(PropertyDeal).filter(
        PropertyDeal.id == property_id,
        PropertyDeal.is_deleted == False,
    ).first()
    if not property_deal:
        raise HTTPException(status_code=404, detail="Linked property deal not found")


def _calculate_summary(
    partnership: Partnership,
    members: List[PartnershipMember],
    transactions: List[PartnershipTransaction],
) -> dict:
    invested_total = sum(
        _decimal(txn.amount) for txn in transactions if txn.txn_type == "invested"
    )
    received_total = sum(
        _decimal(txn.amount)
        for txn in transactions
        if txn.txn_type in {"received", "profit_distributed"}
    )
    expense_total = sum(
        _decimal(txn.amount) for txn in transactions if txn.txn_type == "expense"
    )
    our_pnl = _decimal(partnership.total_received) - _decimal(partnership.our_investment)

    return {
        "our_investment": _decimal(partnership.our_investment),
        "total_received": _decimal(partnership.total_received),
        "our_pnl": our_pnl,
        "invested_total": invested_total,
        "received_total": received_total,
        "expense_total": expense_total,
        "member_count": len(members),
    }


@router.get("", response_model=List[PartnershipOut])
def get_partnerships(
    status: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Partnership).filter(Partnership.is_deleted == False)
    if status:
        query = query.filter(Partnership.status == status)
    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            or_(
                Partnership.title.ilike(search_filter),
                Partnership.notes.ilike(search_filter),
            )
        )

    return query.order_by(Partnership.created_at.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=PartnershipOut)
def create_partnership(
    partnership_data: PartnershipCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _ensure_property_exists(partnership_data.linked_property_deal_id, db)
    partnership = Partnership(
        **partnership_data.model_dump(),
        created_by=current_user.id,
    )
    db.add(partnership)
    db.commit()
    db.refresh(partnership)
    return partnership


@router.get("/{partnership_id}", response_model=dict)
def get_partnership(
    partnership_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    partnership = _get_partnership_or_404(partnership_id, db)
    members = db.query(PartnershipMember).filter(
        PartnershipMember.partnership_id == partnership_id,
    ).order_by(PartnershipMember.id.asc()).all()
    transactions = db.query(PartnershipTransaction).filter(
        PartnershipTransaction.partnership_id == partnership_id,
    ).order_by(PartnershipTransaction.txn_date.desc(), PartnershipTransaction.id.desc()).all()

    members_payload = []
    for member in members:
        members_payload.append(
            {
                "member": PartnershipMemberOut.model_validate(member),
                "contact": ContactBrief.model_validate(member.contact) if member.contact else None,
            }
        )

    return {
        "partnership": PartnershipOut.model_validate(partnership),
        "linked_property": PropertyDealOut.model_validate(partnership.linked_deal) if partnership.linked_deal else None,
        "members": members_payload,
        "transactions": [PartnershipTransactionOut.model_validate(txn) for txn in transactions],
        "summary": _calculate_summary(partnership, members, transactions),
    }


@router.put("/{partnership_id}", response_model=PartnershipOut)
def update_partnership(
    partnership_id: int,
    partnership_data: PartnershipUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    partnership = _get_partnership_or_404(partnership_id, db)
    update_data = partnership_data.model_dump(exclude_unset=True)
    if "linked_property_deal_id" in update_data:
        _ensure_property_exists(update_data["linked_property_deal_id"], db)

    for field, value in update_data.items():
        setattr(partnership, field, value)

    db.commit()
    db.refresh(partnership)
    return partnership


@router.delete("/{partnership_id}")
def delete_partnership(
    partnership_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    partnership = _get_partnership_or_404(partnership_id, db)
    partnership.is_deleted = True
    db.commit()
    return {"message": "Partnership deleted successfully"}


@router.post("/{partnership_id}/members", response_model=PartnershipMemberOut)
def add_partnership_member(
    partnership_id: int,
    member_data: PartnershipMemberCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _get_partnership_or_404(partnership_id, db)

    if not member_data.is_self and not member_data.contact_id:
        raise HTTPException(status_code=400, detail="contact_id is required for non-self members")
    if member_data.is_self and member_data.contact_id:
        raise HTTPException(status_code=400, detail="Self member should not have a contact_id")

    _ensure_contact_exists(member_data.contact_id, db)

    member = PartnershipMember(partnership_id=partnership_id, **member_data.model_dump())
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.post("/{partnership_id}/transactions", response_model=PartnershipTransactionOut)
def create_partnership_transaction(
    partnership_id: int,
    transaction_data: PartnershipTransactionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    partnership = _get_partnership_or_404(partnership_id, db)

    if transaction_data.member_id:
        member = db.query(PartnershipMember).filter(
            PartnershipMember.id == transaction_data.member_id,
            PartnershipMember.partnership_id == partnership_id,
        ).first()
        if not member:
            raise HTTPException(status_code=404, detail="Partnership member not found")

    transaction = PartnershipTransaction(
        partnership_id=partnership_id,
        created_by=current_user.id,
        **transaction_data.model_dump(),
    )
    db.add(transaction)
    db.flush()

    # Auto-ledger
    if transaction.account_id:
        is_outflow = transaction_data.txn_type in {"invested", "expense"}
        auto_ledger(
            db=db,
            account_id=transaction.account_id,
            txn_type="debit" if is_outflow else "credit",
            amount=_decimal(transaction_data.amount),
            txn_date=transaction_data.txn_date,
            linked_type="partnership",
            linked_id=partnership_id,
            description=f"Partnership ({partnership.title}): {transaction_data.txn_type}",
            payment_mode=transaction_data.payment_mode,
            created_by=current_user.id,
        )

    amount = _decimal(transaction_data.amount)
    if transaction_data.txn_type == "invested":
        partnership.our_investment = _decimal(partnership.our_investment) + amount
    elif transaction_data.txn_type in {"received", "profit_distributed"}:
        partnership.total_received = _decimal(partnership.total_received) + amount

    db.commit()
    db.refresh(transaction)
    return transaction


@router.get("/{partnership_id}/transactions", response_model=List[PartnershipTransactionOut])
def get_partnership_transactions(
    partnership_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_partnership_or_404(partnership_id, db)
    return db.query(PartnershipTransaction).filter(
        PartnershipTransaction.partnership_id == partnership_id,
    ).order_by(PartnershipTransaction.txn_date.desc(), PartnershipTransaction.id.desc()).all()


@router.put("/{partnership_id}/settle", response_model=dict)
def settle_partnership(
    partnership_id: int,
    request: PartnershipSettleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    partnership = _get_partnership_or_404(partnership_id, db)

    total_received = _decimal(request.total_received) if request.total_received is not None else _decimal(partnership.total_received)

    partnership.status = "settled"
    partnership.total_received = total_received
    partnership.actual_end_date = request.actual_end_date
    if request.notes:
        existing_notes = partnership.notes or ""
        separator = "\n\n" if existing_notes else ""
        partnership.notes = f"{existing_notes}{separator}Settlement notes: {request.notes}"

    # Distribute total_received among members based on their advances + profit share
    members = db.query(PartnershipMember).filter(
        PartnershipMember.partnership_id == partnership_id,
    ).all()

    total_advance = sum(_decimal(m.advance_contributed) for m in members)
    profit = max(total_received - total_advance, Decimal("0"))

    for member in members:
        share_pct = _decimal(member.share_percentage)
        advance = _decimal(member.advance_contributed)
        profit_share = profit * (share_pct / Decimal("100"))
        member.total_received = advance + profit_share

    db.commit()
    db.refresh(partnership)

    transactions = db.query(PartnershipTransaction).filter(
        PartnershipTransaction.partnership_id == partnership_id,
    ).all()

    return {
        "message": "Partnership settled successfully",
        "partnership": PartnershipOut.model_validate(partnership),
        "summary": _calculate_summary(partnership, members, transactions),
    }
