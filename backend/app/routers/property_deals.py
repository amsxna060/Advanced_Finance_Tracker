from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.contact import Contact

# Average number of days in a month (used for duration calculations)
_AVG_DAYS_PER_MONTH = 30.44
from app.models.partnership import Partnership, PartnershipMember
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
from app.schemas.partnership import PartnershipOut, PartnershipMemberOut
from app.services.auto_ledger import auto_ledger

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


def _get_linked_partnership_data(property_id: int, db: Session) -> Optional[dict]:
    """Return the first linked partnership with its members for the property detail endpoint."""
    partnership = db.query(Partnership).filter(
        Partnership.linked_property_deal_id == property_id,
        Partnership.is_deleted == False,
    ).first()
    if not partnership:
        return None

    members = db.query(PartnershipMember).filter(
        PartnershipMember.partnership_id == partnership.id,
    ).all()

    member_list = []
    for member in members:
        contact = None
        if member.contact_id:
            contact = db.query(Contact).filter(Contact.id == member.contact_id).first()
        member_list.append({
            "member": PartnershipMemberOut.model_validate(member),
            "contact": ContactBrief.model_validate(contact) if contact else None,
        })

    return {
        "partnership": PartnershipOut.model_validate(partnership),
        "members": member_list,
    }


@router.get("", response_model=List[PropertyDealOut])
def get_properties(
    status: Optional[str] = None,
    property_type: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=500),
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

    data = property_data.model_dump()

    # Auto-calculate total_seller_value for plot type when rate and area are provided
    if (
        data.get("property_type") == "plot"
        and data.get("seller_rate_per_sqft") is not None
        and data.get("total_area_sqft") is not None
        and not data.get("total_seller_value")
    ):
        data["total_seller_value"] = (
            Decimal(str(data["seller_rate_per_sqft"])) * Decimal(str(data["total_area_sqft"]))
        )

    property_deal = PropertyDeal(**data, created_by=current_user.id)
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

    linked_partnership_data = _get_linked_partnership_data(property_id, db)

    return {
        "property": PropertyDealOut.model_validate(property_deal),
        "seller": ContactBrief.model_validate(property_deal.seller) if property_deal.seller else None,
        "buyer": ContactBrief.model_validate(property_deal.buyer) if property_deal.buyer else None,
        "transactions": [PropertyTransactionOut.model_validate(txn) for txn in transactions],
        "partnerships": [PartnershipOut.model_validate(p) for p in linked_partnerships],
        "linked_partnership": linked_partnership_data,
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
    db.flush()

    # Auto-ledger
    if transaction.account_id:
        is_inflow = transaction.txn_type in INFLOW_TXN_TYPES
        auto_ledger(
            db=db,
            account_id=transaction.account_id,
            txn_type="credit" if is_inflow else "debit",
            amount=_decimal(transaction.amount),
            txn_date=transaction.txn_date,
            linked_type="property",
            linked_id=property_id,
            description=f"Property: {transaction.txn_type} — {transaction.description or ''}".strip(),
            payment_mode=transaction.payment_mode,
            created_by=current_user.id,
        )

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
    Settle a property deal. Handles two deal sub-types differently:

    PLOT (middleman): buyer_rate_per_sqft, registry_date, other_expenses
      - gross_profit = buyer_rate * area - total_seller_value
      - net_profit = gross_profit - broker_commission - other_expenses
      - Each partner gets: advance_returned + (net_profit * share%)

    SITE: total_profit_received, site_deal_end_date
      - my_profit = total_profit_received * (my_share_percentage / 100)
      - ROI per annum computed from deal start/end dates
    """
    property_deal = _get_property_or_404(deal_id, db)

    if property_deal.status == "settled":
        raise HTTPException(status_code=400, detail="This property deal is already settled")

    property_type = (property_deal.property_type or "").lower()

    # ── SITE settlement ────────────────────────────────────────────────────────
    if property_type == "site":
        total_profit_received = _decimal(
            settle_data.total_profit_received or property_deal.total_profit_received
        )
        my_share_pct = _decimal(property_deal.my_share_percentage)
        my_investment = _decimal(property_deal.my_investment)

        my_profit = total_profit_received * (my_share_pct / Decimal("100")) if my_share_pct else Decimal("0")
        total_returned = my_investment + my_profit

        # Duration and ROI
        start_date = property_deal.site_deal_start_date
        end_date = settle_data.site_deal_end_date or property_deal.site_deal_end_date
        duration_days = None
        duration_months = None
        roi_per_annum = None
        if start_date and end_date:
            duration_days = (end_date - start_date).days
            duration_months = round(duration_days / _AVG_DAYS_PER_MONTH, 1)
            if my_investment > 0 and duration_days > 0:
                roi_per_annum = float(
                    (my_profit / my_investment) / Decimal(str(duration_days / 365)) * Decimal("100")
                )

        # Persist
        property_deal.status = "settled"
        property_deal.total_profit_received = total_profit_received
        if settle_data.site_deal_end_date:
            property_deal.site_deal_end_date = settle_data.site_deal_end_date

        db.commit()
        db.refresh(property_deal)

        return {
            "deal": PropertyDealOut.model_validate(property_deal),
            "settlement_summary": {
                "deal_type": "site",
                "my_investment": float(my_investment),
                "total_profit_received": float(total_profit_received),
                "my_share_percentage": float(my_share_pct),
                "my_profit": float(my_profit),
                "total_returned_to_me": float(total_returned),
                "roi_per_annum_percent": roi_per_annum,
                "duration_months": duration_months,
            },
        }

    # ── PLOT / default settlement ───────────────────────────────────────────────
    # Determine total_buyer_value
    if settle_data.buyer_rate_per_sqft is not None and property_deal.total_area_sqft:
        total_buyer_value = (
            _decimal(settle_data.buyer_rate_per_sqft) * _decimal(property_deal.total_area_sqft)
        )
    else:
        total_buyer_value = (
            _decimal(settle_data.total_buyer_value) or _decimal(property_deal.total_buyer_value)
        )

    total_seller_value = (
        _decimal(settle_data.total_seller_value) or _decimal(property_deal.total_seller_value)
    )
    broker_commission = (
        settle_data.broker_commission
        if settle_data.broker_commission is not None
        else _decimal(property_deal.broker_commission)
    )
    other_expenses = _decimal(settle_data.other_expenses)

    gross_profit = total_buyer_value - total_seller_value
    total_expenses = broker_commission + other_expenses
    net_profit = gross_profit - total_expenses

    # Sum of all partner advances (for summary display)
    linked_partnerships = db.query(Partnership).filter(
        Partnership.linked_property_deal_id == deal_id,
        Partnership.is_deleted == False,
    ).all()

    total_advance_pool = Decimal("0")
    partner_settlements = []

    if linked_partnerships:
        for partnership in linked_partnerships:
            members = db.query(PartnershipMember).filter(
                PartnershipMember.partnership_id == partnership.id,
            ).all()

            for member in members:
                share_pct = _decimal(member.share_percentage)
                advance = _decimal(member.advance_contributed)
                total_advance_pool += advance
                profit_share = net_profit * (share_pct / Decimal("100"))
                total_to_receive = advance + profit_share

                member.total_received = total_to_receive

                contact = None
                if member.contact_id:
                    contact = db.query(Contact).filter(Contact.id == member.contact_id).first()

                partner_settlements.append({
                    "member_id": member.id,
                    "contact_name": "Self" if member.is_self else (contact.name if contact else "Unknown"),
                    "is_self": member.is_self,
                    "share_percentage": float(share_pct),
                    "advance_contributed": float(advance),
                    "advance_returned": float(advance),
                    "profit_share": float(profit_share),
                    "total_to_receive": float(total_to_receive),
                })

            partnership.status = "settled"
            registry_date = settle_data.registry_date or settle_data.actual_registry_date
            if registry_date:
                partnership.actual_end_date = registry_date
    else:
        # No partnership — 100% to self
        partner_settlements.append({
            "member_id": None,
            "contact_name": "Self",
            "is_self": True,
            "share_percentage": 100.0,
            "advance_contributed": 0.0,
            "advance_returned": 0.0,
            "profit_share": float(net_profit),
            "total_to_receive": float(net_profit),
        })

    # Persist deal fields
    property_deal.status = "settled"
    property_deal.gross_profit = gross_profit
    property_deal.net_profit = net_profit
    property_deal.broker_commission = broker_commission
    property_deal.total_buyer_value = total_buyer_value
    if settle_data.total_seller_value is not None:
        property_deal.total_seller_value = total_seller_value
    if settle_data.buyer_rate_per_sqft is not None:
        property_deal.buyer_rate_per_sqft = settle_data.buyer_rate_per_sqft
    registry_date = settle_data.registry_date or settle_data.actual_registry_date
    if registry_date:
        property_deal.actual_registry_date = registry_date

    db.commit()
    db.refresh(property_deal)

    return {
        "deal": PropertyDealOut.model_validate(property_deal),
        "settlement_summary": {
            "deal_type": "plot",
            "total_buyer_value": float(total_buyer_value),
            "total_seller_value": float(total_seller_value),
            "gross_profit": float(gross_profit),
            "broker_commission": float(broker_commission),
            "other_expenses": float(other_expenses),
            "net_profit": float(net_profit),
            "total_advance_pool": float(total_advance_pool),
            "partner_settlements": partner_settlements,
        },
    }
