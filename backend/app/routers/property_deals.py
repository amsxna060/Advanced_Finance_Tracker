from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.contact import Contact
from app.models.partnership import Partnership
from app.models.property_deal import PropertyDeal, PropertyTransaction
from app.models.user import User
from app.schemas.property_deal import (
    PropertyDealCreate,
    PropertyDealOut,
    PropertyDealUpdate,
    PropertyTransactionCreate,
    PropertyTransactionOut,
    PropertySettleRequest,
)
from app.schemas.loan import ContactBrief
from app.schemas.partnership import PartnershipOut

router = APIRouter(prefix="/api/properties", tags=["properties"])

INFLOW_TXN_TYPES = {"received_from_buyer", "sale_proceeds", "refund"}
OUTFLOW_TXN_TYPES = {
    "advance_to_seller",
    "payment_to_seller",
    "commission_paid",
    "expense",
    "other",
}


def _get_property_or_404(property_id: int, db: Session) -> PropertyDeal:
    property_deal = db.query(PropertyDeal).filter(
        PropertyDeal.id == property_id,
        PropertyDeal.is_deleted == False,
    ).first()
    if not property_deal:
        raise HTTPException(status_code=404, detail="Property deal not found")
    return property_deal


def _ensure_contact_exists(contact_id: Optional[int], db: Session, field_name: str) -> None:
    if not contact_id:
        return
    contact = db.query(Contact).filter(
        Contact.id == contact_id,
        Contact.is_deleted == False,
    ).first()
    if not contact:
        raise HTTPException(status_code=404, detail=f"{field_name} contact not found")


def _decimal(value: Optional[Decimal]) -> Decimal:
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def _calculate_property_summary(
    property_deal: PropertyDeal,
    transactions: List[PropertyTransaction],
    linked_partnerships: Optional[List[Partnership]] = None,
) -> dict:
    linked_partnerships = linked_partnerships or []

    total_inflow = Decimal("0")
    total_outflow = Decimal("0")
    for transaction in transactions:
        amount = _decimal(transaction.amount)
        if transaction.txn_type in INFLOW_TXN_TYPES:
            total_inflow += amount
        elif transaction.txn_type in OUTFLOW_TXN_TYPES:
            total_outflow += amount

    if property_deal.deal_type == "middleman":
        gross_profit = _decimal(property_deal.gross_profit)
        if gross_profit == 0 and property_deal.total_buyer_value and property_deal.total_seller_value:
            gross_profit = _decimal(property_deal.total_buyer_value) - _decimal(property_deal.total_seller_value)

        expense_total = _decimal(property_deal.broker_commission)
        expense_total += sum(
            _decimal(transaction.amount)
            for transaction in transactions
            if transaction.txn_type in {"commission_paid", "expense", "other"}
        )
        net_profit = _decimal(property_deal.net_profit)
        if net_profit == 0:
            net_profit = gross_profit - expense_total
    else:
        gross_profit = Decimal("0")
        if property_deal.sale_price and property_deal.purchase_price:
            gross_profit = _decimal(property_deal.sale_price) - _decimal(property_deal.purchase_price)
        net_profit = _decimal(property_deal.net_profit)
        if net_profit == 0:
            net_profit = gross_profit - _decimal(property_deal.holding_cost)

    return {
        "total_inflow": total_inflow,
        "total_outflow": total_outflow,
        "gross_profit": gross_profit,
        "net_profit": net_profit,
        "linked_partnerships": len(linked_partnerships),
        "partnership_titles": [partnership.title for partnership in linked_partnerships],
    }


@router.get("", response_model=List[PropertyDealOut])
def get_properties(
    status: Optional[str] = None,
    property_type: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(PropertyDeal).filter(PropertyDeal.is_deleted == False)

    if status:
        query = query.filter(PropertyDeal.status == status)
    if property_type:
        query = query.filter(PropertyDeal.property_type == property_type)
    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            or_(
                PropertyDeal.title.ilike(search_filter),
                PropertyDeal.location.ilike(search_filter),
                PropertyDeal.notes.ilike(search_filter),
            )
        )

    return query.order_by(PropertyDeal.created_at.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=PropertyDealOut)
def create_property(
    property_data: PropertyDealCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _ensure_contact_exists(property_data.seller_contact_id, db, "Seller")
    _ensure_contact_exists(property_data.buyer_contact_id, db, "Buyer")

    property_deal = PropertyDeal(**property_data.model_dump(), created_by=current_user.id)
    db.add(property_deal)
    db.commit()
    db.refresh(property_deal)
    return property_deal


@router.get("/{property_id}", response_model=dict)
def get_property(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    property_deal = _get_property_or_404(property_id, db)
    transactions = db.query(PropertyTransaction).filter(
        PropertyTransaction.property_deal_id == property_id,
    ).order_by(PropertyTransaction.txn_date.desc(), PropertyTransaction.id.desc()).all()
    linked_partnerships = db.query(Partnership).filter(
        Partnership.linked_property_deal_id == property_id,
        Partnership.is_deleted == False,
    ).order_by(Partnership.created_at.desc()).all()

    return {
        "property": PropertyDealOut.model_validate(property_deal),
        "seller": ContactBrief.model_validate(property_deal.seller) if property_deal.seller else None,
        "buyer": ContactBrief.model_validate(property_deal.buyer) if property_deal.buyer else None,
        "transactions": [PropertyTransactionOut.model_validate(txn) for txn in transactions],
        "partnerships": [PartnershipOut.model_validate(p) for p in linked_partnerships],
        "summary": _calculate_property_summary(property_deal, transactions, linked_partnerships),
    }


@router.put("/{property_id}", response_model=PropertyDealOut)
def update_property(
    property_id: int,
    property_data: PropertyDealUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    property_deal = _get_property_or_404(property_id, db)
    update_data = property_data.model_dump(exclude_unset=True)

    if "seller_contact_id" in update_data:
        _ensure_contact_exists(update_data["seller_contact_id"], db, "Seller")
    if "buyer_contact_id" in update_data:
        _ensure_contact_exists(update_data["buyer_contact_id"], db, "Buyer")

    for field, value in update_data.items():
        setattr(property_deal, field, value)

    db.commit()
    db.refresh(property_deal)
    return property_deal


@router.delete("/{property_id}")
def delete_property(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    property_deal = _get_property_or_404(property_id, db)
    property_deal.is_deleted = True
    db.commit()
    return {"message": "Property deal deleted successfully"}


@router.post("/{property_id}/transactions", response_model=PropertyTransactionOut)
def create_property_transaction(
    property_id: int,
    transaction_data: PropertyTransactionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _get_property_or_404(property_id, db)
    transaction = PropertyTransaction(
        property_deal_id=property_id,
        created_by=current_user.id,
        **transaction_data.model_dump(),
    )
    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    return transaction


@router.get("/{property_id}/transactions", response_model=List[PropertyTransactionOut])
def get_property_transactions(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_property_or_404(property_id, db)
    return db.query(PropertyTransaction).filter(
        PropertyTransaction.property_deal_id == property_id,
    ).order_by(PropertyTransaction.txn_date.desc(), PropertyTransaction.id.desc()).all()


@router.get("/{property_id}/profit-summary", response_model=dict)
def get_property_profit_summary(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    property_deal = _get_property_or_404(property_id, db)
    transactions = db.query(PropertyTransaction).filter(
        PropertyTransaction.property_deal_id == property_id,
    ).order_by(PropertyTransaction.txn_date.desc(), PropertyTransaction.id.desc()).all()
    linked_partnerships = db.query(Partnership).filter(
        Partnership.linked_property_deal_id == property_id,
        Partnership.is_deleted == False,
    ).order_by(Partnership.created_at.desc()).all()

    summary = _calculate_property_summary(property_deal, transactions, linked_partnerships)
    per_partner_share = []
    if linked_partnerships and summary["net_profit"]:
        for partnership in linked_partnerships:
            percentage = _decimal(partnership.our_share_percentage)
            share_amount = (summary["net_profit"] * percentage) / Decimal("100") if percentage else Decimal("0")
            per_partner_share.append(
                {
                    "partnership_id": partnership.id,
                    "title": partnership.title,
                    "share_percentage": percentage,
                    "share_amount": share_amount,
                }
            )

    return {
        **summary,
        "per_partner_share": per_partner_share,
    }


@router.post("/{deal_id}/settle", response_model=dict)
def settle_property_deal(
    deal_id: int,
    settle_data: PropertySettleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Mark a property deal as settled and distribute profit to partners.
    Calculation:
      gross_profit = total_buyer_value - total_seller_value
      net_profit = gross_profit - broker_commission - other_expenses
    Distributes net_profit among linked partnership members.
    If no partnership exists, 100% profit goes to self (admin user).
    """
    property_deal = _get_property_or_404(deal_id, db)

    if property_deal.status == "settled":
        raise HTTPException(status_code=400, detail="This property deal is already settled")

    # Resolve values from request or fall back to deal fields
    total_buyer_value = settle_data.total_buyer_value or _decimal(property_deal.total_buyer_value)
    total_seller_value = settle_data.total_seller_value or _decimal(property_deal.total_seller_value)
    broker_commission = settle_data.broker_commission if settle_data.broker_commission is not None else _decimal(property_deal.broker_commission)
    other_expenses = _decimal(settle_data.other_expenses)

    gross_profit = total_buyer_value - total_seller_value
    total_expenses = broker_commission + other_expenses
    net_profit = gross_profit - total_expenses

    # Update property deal fields
    property_deal.status = "settled"
    property_deal.gross_profit = gross_profit
    property_deal.net_profit = net_profit
    property_deal.broker_commission = broker_commission
    if settle_data.total_buyer_value is not None:
        property_deal.total_buyer_value = total_buyer_value
    if settle_data.total_seller_value is not None:
        property_deal.total_seller_value = total_seller_value
    if settle_data.actual_registry_date:
        property_deal.actual_registry_date = settle_data.actual_registry_date

    # Find linked partnerships
    from app.models.partnership import PartnershipMember
    linked_partnerships = db.query(Partnership).filter(
        Partnership.linked_property_deal_id == deal_id,
        Partnership.is_deleted == False,
    ).all()

    partner_settlements = []

    if linked_partnerships:
        for partnership in linked_partnerships:
            from app.models.partnership import PartnershipMember as PM
            members = db.query(PM).filter(
                PM.partnership_id == partnership.id,
            ).all()

            for member in members:
                share_pct = _decimal(member.share_percentage)
                advance = _decimal(member.advance_contributed)
                profit_share = net_profit * (share_pct / Decimal("100"))
                total_to_receive = advance + profit_share

                member.total_received = advance + profit_share

                contact = None
                if member.contact_id:
                    from app.models.contact import Contact as C
                    contact = db.query(C).filter(C.id == member.contact_id).first()

                partner_settlements.append({
                    "member_id": member.id,
                    "contact_name": "Self" if member.is_self else (contact.name if contact else "Unknown"),
                    "is_self": member.is_self,
                    "share_percentage": float(share_pct),
                    "advance_returned": float(advance),
                    "profit_share": float(profit_share),
                    "total_to_receive": float(total_to_receive),
                })

            partnership.status = "settled"
            if settle_data.actual_registry_date:
                partnership.actual_end_date = settle_data.actual_registry_date
    else:
        # No partnership — 100% profit to self (the admin user)
        partner_settlements.append({
            "member_id": None,
            "contact_name": "Self",
            "is_self": True,
            "share_percentage": 100.0,
            "advance_returned": 0.0,
            "profit_share": float(net_profit),
            "total_to_receive": float(net_profit),
        })

    db.commit()
    db.refresh(property_deal)

    return {
        "deal": PropertyDealOut.model_validate(property_deal),
        "settlement_summary": {
            "gross_profit": float(gross_profit),
            "total_expenses": float(total_expenses),
            "net_profit": float(net_profit),
            "partner_settlements": partner_settlements,
        },
    }
