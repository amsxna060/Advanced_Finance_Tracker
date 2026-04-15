from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.contact import Contact

# Average number of days in a month (used for duration calculations)
_AVG_DAYS_PER_MONTH = 30.44
from app.models.partnership import Partnership, PartnershipMember, PartnershipTransaction
from app.models.property_deal import PropertyDeal, PropertyTransaction, SitePlot, PlotBuyer
from app.models.user import User
from app.schemas.property_deal import (
    PropertyDealCreate,
    PropertyDealOut,
    PropertyDealUpdate,
    PropertyTransactionCreate,
    PropertyTransactionUpdate,
    PropertyTransactionOut,
    PropertySettleRequest,
    SitePlotCreate,
    SitePlotOut,
    PlotBuyerCreate,
    PlotBuyerUpdate,
    PlotBuyerOut,
)
from app.schemas.loan import ContactBrief
from app.schemas.partnership import PartnershipOut, PartnershipMemberOut
from app.services.auto_ledger import auto_ledger, reverse_all_ledger
from app.models.cash_account import AccountTransaction

router = APIRouter(prefix="/api/properties", tags=["properties"])

INFLOW_TXN_TYPES = {"received_from_buyer", "sale_proceeds", "refund"}
OUTFLOW_TXN_TYPES = {
    "advance_to_seller",
    "payment_to_seller",
    "commission_paid",
    "expense",
    "other",
    "other_expense",
}


def _resync_plot_buyer(property_id: int, plot_buyer_id: int, db: Session) -> None:
    """Re-calculate PlotBuyer.total_paid and status from all received_from_buyer txns."""
    buyer = db.query(PlotBuyer).filter(PlotBuyer.id == plot_buyer_id).first()
    if not buyer:
        return
    total_from_buyer = db.query(func.coalesce(func.sum(PropertyTransaction.amount), 0)).filter(
        PropertyTransaction.property_deal_id == property_id,
        PropertyTransaction.txn_type == "received_from_buyer",
        PropertyTransaction.plot_buyer_id == plot_buyer_id,
    ).scalar()
    buyer.total_paid = total_from_buyer
    buyer.advance_received = total_from_buyer
    if _decimal(total_from_buyer) > 0:
        if buyer.status in ("pending", "negotiating", "available"):
            buyer.status = "advance_received"
    else:
        buyer.status = "pending"


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


# Partnership transaction type sets (mirror partnerships.py)
_P_OUTFLOW_TYPES = {
    "advance_to_seller", "remaining_to_seller", "broker_commission", "expense",
    "advance_given", "broker_paid", "invested", "other_expense",
}
_P_INFLOW_TYPES = {
    "buyer_advance", "buyer_payment", "profit_received",
    "buyer_payment_received", "received", "profit_distributed",
}
_P_BUYER_INFLOW_TYPES = {"buyer_advance", "buyer_payment", "buyer_payment_received"}


def _calculate_property_summary(
    property_deal: PropertyDeal,
    transactions: List[PropertyTransaction],
    linked_partnerships: Optional[List[Partnership]] = None,
    partnership_transactions: Optional[list] = None,
) -> dict:
    linked_partnerships = linked_partnerships or []
    partnership_transactions = partnership_transactions or []

    # Prefer partnership transactions if any exist; fall back to legacy PropertyTransaction
    if partnership_transactions:
        total_outflow = sum(
            _decimal(t.amount) for t in partnership_transactions if t.txn_type in _P_OUTFLOW_TYPES
        )
        total_inflow = sum(
            _decimal(t.amount) for t in partnership_transactions if t.txn_type in _P_INFLOW_TYPES
        )
        buyer_inflow = sum(
            _decimal(t.amount) for t in partnership_transactions if t.txn_type in _P_BUYER_INFLOW_TYPES
        )
        broker_commission = sum(
            _decimal(t.amount) for t in partnership_transactions if t.txn_type in ("broker_commission", "broker_paid")
        )
        expense_total = sum(
            _decimal(t.amount) for t in partnership_transactions if t.txn_type in ("expense", "other_expense")
        )
        seller_total = sum(
            _decimal(t.amount) for t in partnership_transactions if t.txn_type in ("advance_to_seller", "remaining_to_seller", "advance_given")
        )
        gross_profit = buyer_inflow - seller_total if buyer_inflow > 0 else (
            _decimal(property_deal.total_buyer_value) - _decimal(property_deal.total_seller_value)
            if property_deal.total_buyer_value and property_deal.total_seller_value else Decimal("0")
        )
        net_profit = total_inflow - total_outflow
    else:
        total_inflow = Decimal("0")
        total_outflow = Decimal("0")
        for transaction in transactions:
            amount = _decimal(transaction.amount)
            if transaction.txn_type in INFLOW_TXN_TYPES:
                total_inflow += amount
            elif transaction.txn_type in OUTFLOW_TXN_TYPES:
                total_outflow += amount

        gross_profit = _decimal(property_deal.total_buyer_value) - _decimal(property_deal.total_seller_value) \
            if property_deal.total_buyer_value and property_deal.total_seller_value else Decimal("0")
        net_profit = total_inflow - total_outflow

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
    legacy_transactions = db.query(PropertyTransaction).filter(
        PropertyTransaction.property_deal_id == property_id,
    ).order_by(PropertyTransaction.txn_date.desc(), PropertyTransaction.id.desc()).all()
    linked_partnerships = db.query(Partnership).filter(
        Partnership.linked_property_deal_id == property_id,
        Partnership.is_deleted == False,
    ).order_by(Partnership.created_at.desc()).all()

    linked_partnership_data = _get_linked_partnership_data(property_id, db)

    site_plots = db.query(SitePlot).filter(
        SitePlot.property_deal_id == property_id,
    ).order_by(SitePlot.id).all()

    plot_buyers = db.query(PlotBuyer).filter(
        PlotBuyer.property_deal_id == property_id,
    ).order_by(PlotBuyer.id).all()

    # Collect ALL partnership transactions (for summary + display) and expense subset
    all_partnership_txns = []
    partnership_expenses = []
    for lp in linked_partnerships:
        lp_members = db.query(PartnershipMember).filter(
            PartnershipMember.partnership_id == lp.id,
        ).all()
        member_map = {m.id: m for m in lp_members}

        lp_all_txns = db.query(PartnershipTransaction).filter(
            PartnershipTransaction.partnership_id == lp.id,
        ).order_by(PartnershipTransaction.txn_date.desc(), PartnershipTransaction.id.desc()).all()
        all_partnership_txns.extend(lp_all_txns)

        for txn in lp_all_txns:
            if txn.txn_type in ("other_expense", "expense", "broker_commission", "broker_paid"):
                payer_member = member_map.get(txn.member_id) if txn.member_id else None
                payer_contact = None
                if payer_member and payer_member.contact_id:
                    payer_contact = db.query(Contact).filter(Contact.id == payer_member.contact_id).first()
                partnership_expenses.append({
                    "id": txn.id,
                    "source": "partnership",
                    "partnership_id": lp.id,
                    "txn_date": str(txn.txn_date),
                    "amount": float(txn.amount),
                    "description": txn.description,
                    "payer_name": "Self" if (payer_member and payer_member.is_self) else (payer_contact.name if payer_contact else "Partner"),
                    "is_self": payer_member.is_self if payer_member else False,
                    "member_id": txn.member_id,
                })

    # Build displayable transaction list: prefer partnership txns, fallback to legacy
    display_transactions = []
    if all_partnership_txns:
        for lp in linked_partnerships:
            lp_members = db.query(PartnershipMember).filter(
                PartnershipMember.partnership_id == lp.id,
            ).all()
            member_map = {m.id: m for m in lp_members}
            for txn in all_partnership_txns:
                if txn.partnership_id != lp.id:
                    continue
                payer = member_map.get(txn.member_id) if txn.member_id else None
                receiver = member_map.get(txn.received_by_member_id) if txn.received_by_member_id else None
                payer_contact = None
                if payer and payer.contact_id:
                    payer_contact = db.query(Contact).filter(Contact.id == payer.contact_id).first()
                receiver_contact = None
                if receiver and receiver.contact_id:
                    receiver_contact = db.query(Contact).filter(Contact.id == receiver.contact_id).first()
                display_transactions.append({
                    "id": txn.id,
                    "source": "partnership",
                    "partnership_id": lp.id,
                    "txn_type": txn.txn_type,
                    "amount": float(txn.amount),
                    "txn_date": str(txn.txn_date),
                    "description": txn.description,
                    "payment_mode": txn.payment_mode,
                    "payer_name": "Self" if (payer and payer.is_self) else (payer_contact.name if payer_contact else None),
                    "receiver_name": "Self" if (receiver and receiver.is_self) else (receiver_contact.name if receiver_contact else None),
                    "broker_name": txn.broker_name,
                    "plot_buyer_id": txn.plot_buyer_id,
                    "site_plot_id": txn.site_plot_id,
                })
    else:
        for txn in legacy_transactions:
            display_transactions.append({
                "id": txn.id,
                "source": "legacy",
                "txn_type": txn.txn_type,
                "amount": float(txn.amount),
                "txn_date": str(txn.txn_date),
                "description": txn.description,
                "payment_mode": txn.payment_mode,
                "payer_name": None,
                "receiver_name": None,
                "broker_name": None,
                "plot_buyer_id": getattr(txn, "plot_buyer_id", None),
                "site_plot_id": None,
            })

    return {
        "property": PropertyDealOut.model_validate(property_deal),
        "seller": ContactBrief.model_validate(property_deal.seller) if property_deal.seller else None,
        "buyer": ContactBrief.model_validate(property_deal.buyer) if property_deal.buyer else None,
        "transactions": display_transactions,
        "partnerships": [PartnershipOut.model_validate(p) for p in linked_partnerships],
        "linked_partnership": linked_partnership_data,
        "summary": _calculate_property_summary(
            property_deal, legacy_transactions, linked_partnerships,
            partnership_transactions=all_partnership_txns,
        ),
        "site_plots": [SitePlotOut.model_validate(p) for p in site_plots],
        "plot_buyers": [PlotBuyerOut.model_validate(b) for b in plot_buyers],
        "partnership_expenses": partnership_expenses,
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
    # Clean up all linked AccountTransaction entries
    reverse_all_ledger(db, "property", property_id)
    # Delete child PropertyTransaction records
    db.query(PropertyTransaction).filter(
        PropertyTransaction.property_deal_id == property_id,
    ).delete(synchronize_session=False)
    property_deal.is_deleted = True
    db.commit()
    return {"message": "Property deal deleted successfully"}


@router.post("/{property_id}/transactions", response_model=PropertyTransactionOut, deprecated=True)
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

    # Auto-sync advance_paid from all advance_to_seller transactions
    if transaction.txn_type == "advance_to_seller":
        deal = db.query(PropertyDeal).filter(PropertyDeal.id == property_id).first()
        total_advance = db.query(func.coalesce(func.sum(PropertyTransaction.amount), 0)).filter(
            PropertyTransaction.property_deal_id == property_id,
            PropertyTransaction.txn_type == "advance_to_seller",
        ).scalar()
        deal.advance_paid = total_advance
        if not deal.advance_date:
            deal.advance_date = transaction.txn_date
        # Update status to advance_given if still negotiating
        if deal.status == "negotiating" and _decimal(total_advance) > 0:
            deal.status = "advance_given"
        # For site type, sync my_investment to total advance
        if (deal.property_type or "").lower() == "site":
            deal.my_investment = total_advance

    # Auto-sync PlotBuyer advance/total when received_from_buyer with plot_buyer_id
    if transaction.txn_type == "received_from_buyer" and transaction.plot_buyer_id:
        _resync_plot_buyer(property_id, transaction.plot_buyer_id, db)

    db.commit()
    db.refresh(transaction)
    return transaction


@router.put("/{property_id}/transactions/{txn_id}", response_model=PropertyTransactionOut, deprecated=True)
def update_property_transaction(
    property_id: int,
    txn_id: int,
    update_data: PropertyTransactionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Update a property transaction and re-sync its linked ledger entry."""
    _get_property_or_404(property_id, db)
    txn = db.query(PropertyTransaction).filter(
        PropertyTransaction.id == txn_id,
        PropertyTransaction.property_deal_id == property_id,
    ).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Capture old values before mutation
    old_account_id = txn.account_id
    old_amount = _decimal(txn.amount)
    old_txn_date = txn.txn_date
    old_txn_type = txn.txn_type

    # Apply updates
    for field, value in update_data.model_dump(exclude_unset=True).items():
        setattr(txn, field, value)

    # Re-sync ledger: delete old entry, create new one
    is_inflow = old_txn_type in INFLOW_TXN_TYPES
    if old_account_id:
        old_entries = db.query(AccountTransaction).filter(
            AccountTransaction.linked_type == "property",
            AccountTransaction.linked_id == property_id,
            AccountTransaction.txn_type == ("credit" if is_inflow else "debit"),
            AccountTransaction.amount == old_amount,
            AccountTransaction.txn_date == old_txn_date,
        ).all()
        for e in old_entries:
            db.delete(e)

    if txn.account_id:
        auto_ledger(
            db=db,
            account_id=txn.account_id,
            txn_type="credit" if is_inflow else "debit",
            amount=_decimal(txn.amount),
            txn_date=txn.txn_date,
            linked_type="property",
            linked_id=property_id,
            description=f"Property: {txn.txn_type} — {txn.description or ''}".strip(),
            payment_mode=txn.payment_mode,
            created_by=current_user.id,
        )

    # Re-sync advance_paid + my_investment + status if it's an advance
    db.flush()  # ensure setattr changes are visible to subsequent queries
    if txn.txn_type == "advance_to_seller":
        deal = db.query(PropertyDeal).filter(PropertyDeal.id == property_id).first()
        total_advance = db.query(func.coalesce(func.sum(PropertyTransaction.amount), 0)).filter(
            PropertyTransaction.property_deal_id == property_id,
            PropertyTransaction.txn_type == "advance_to_seller",
        ).scalar()
        deal.advance_paid = total_advance
        if deal.status == "negotiating" and _decimal(total_advance) > 0:
            deal.status = "advance_given"
        if (deal.property_type or "").lower() == "site":
            deal.my_investment = total_advance

    # Re-sync PlotBuyer totals if received_from_buyer with plot_buyer_id
    if txn.txn_type == "received_from_buyer" and txn.plot_buyer_id:
        _resync_plot_buyer(property_id, txn.plot_buyer_id, db)

    db.commit()
    db.refresh(txn)
    return txn


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


@router.delete("/{property_id}/transactions/{txn_id}", deprecated=True)
def delete_property_transaction(
    property_id: int,
    txn_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Delete a property transaction and its linked ledger entry."""
    _get_property_or_404(property_id, db)
    txn = db.query(PropertyTransaction).filter(
        PropertyTransaction.id == txn_id,
        PropertyTransaction.property_deal_id == property_id,
    ).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Capture type and buyer_id before deletion for post-sync
    txn_type = txn.txn_type
    plot_buyer_id = txn.plot_buyer_id

    # Reverse linked ledger entry
    if txn.account_id:
        is_inflow = txn.txn_type in INFLOW_TXN_TYPES
        matching = db.query(AccountTransaction).filter(
            AccountTransaction.linked_type == "property",
            AccountTransaction.linked_id == property_id,
            AccountTransaction.txn_type == ("credit" if is_inflow else "debit"),
            AccountTransaction.amount == txn.amount,
            AccountTransaction.txn_date == txn.txn_date,
        ).all()
        for m in matching:
            db.delete(m)

    db.delete(txn)
    db.flush()

    # Re-sync advance_paid
    if txn_type == "advance_to_seller":
        deal = db.query(PropertyDeal).filter(PropertyDeal.id == property_id).first()
        total_advance = db.query(func.coalesce(func.sum(PropertyTransaction.amount), 0)).filter(
            PropertyTransaction.property_deal_id == property_id,
            PropertyTransaction.txn_type == "advance_to_seller",
        ).scalar()
        deal.advance_paid = total_advance
        # For site type, sync my_investment to total advance
        if (deal.property_type or "").lower() == "site":
            deal.my_investment = total_advance

    # Re-sync PlotBuyer totals
    if txn_type == "received_from_buyer" and plot_buyer_id:
        _resync_plot_buyer(property_id, plot_buyer_id, db)

    db.commit()
    return {"message": "Transaction deleted"}


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


@router.post("/{deal_id}/settle", response_model=dict, deprecated=True)
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
    # Gather all other_expense transactions (property-level + partnership-level)
    # and attribute each to the paying member
    prop_expense_txns = db.query(PropertyTransaction).filter(
        PropertyTransaction.property_deal_id == deal_id,
        PropertyTransaction.txn_type == "other_expense",
    ).all()

    # For property-level expenses, payer is always treated as self (no member_id on property txns)
    # For partnership-level expenses, payer is whoever has member_id on the txn
    linked_partnerships_for_settle = db.query(Partnership).filter(
        Partnership.linked_property_deal_id == deal_id,
        Partnership.is_deleted == False,
    ).all()

    # Build member_id -> total_expense_paid mapping from partnership transactions
    # member_id=None means Self (property-level expense with no member)
    member_expense_map: dict = {}  # {member_id_or_None: Decimal}

    # Property-level other_expenses → attributed to self (None key)
    prop_exp_total = sum((_decimal(t.amount) for t in prop_expense_txns), Decimal("0"))
    member_expense_map[None] = member_expense_map.get(None, Decimal("0")) + prop_exp_total

    for lp in linked_partnerships_for_settle:
        lp_exp_txns = db.query(PartnershipTransaction).filter(
            PartnershipTransaction.partnership_id == lp.id,
            PartnershipTransaction.txn_type == "other_expense",
        ).all()
        for t in lp_exp_txns:
            key = t.member_id  # member_id on partnership transaction
            member_expense_map[key] = member_expense_map.get(key, Decimal("0")) + _decimal(t.amount)

    total_other_expenses = sum(member_expense_map.values(), Decimal("0"))
    # If form explicitly provides a value use it (legacy / manual override), else use tracked total
    other_expenses = _decimal(settle_data.other_expenses) if _decimal(settle_data.other_expenses) > 0 else total_other_expenses

    gross_profit = total_buyer_value - total_seller_value
    total_expenses = broker_commission + other_expenses
    net_profit = gross_profit - total_expenses

    total_advance_pool = Decimal("0")
    partner_settlements = []

    if linked_partnerships_for_settle:
        for partnership in linked_partnerships_for_settle:
            members = db.query(PartnershipMember).filter(
                PartnershipMember.partnership_id == partnership.id,
            ).all()

            # Build id -> member map for this partnership
            pm_map = {m.id: m for m in members}

            for member in members:
                share_pct = _decimal(member.share_percentage)
                advance = _decimal(member.advance_contributed)
                total_advance_pool += advance
                profit_share = net_profit * (share_pct / Decimal("100"))

                # Other expenses paid by this member:
                # Check partnership transaction member_id == member.id
                # Also include property-level expenses if member is self (None key)
                other_exp_returned = member_expense_map.get(member.id, Decimal("0"))
                if member.is_self:
                    other_exp_returned += member_expense_map.get(None, Decimal("0"))

                total_to_receive = advance + other_exp_returned + profit_share
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
                    "other_expense_returned": float(other_exp_returned),
                    "profit_share": float(profit_share),
                    "total_to_receive": float(total_to_receive),
                })

            partnership.status = "settled"
            registry_date = settle_data.registry_date or settle_data.actual_registry_date
            if registry_date:
                partnership.actual_end_date = registry_date
    else:
        # No partnership — 100% to self, self gets back all other_expenses
        partner_settlements.append({
            "member_id": None,
            "contact_name": "Self",
            "is_self": True,
            "share_percentage": 100.0,
            "advance_contributed": 0.0,
            "advance_returned": 0.0,
            "other_expense_returned": float(other_expenses),
            "profit_share": float(net_profit),
            "total_to_receive": float(net_profit + other_expenses),
        })

    # Persist deal fields
    property_deal.status = "settled"
    property_deal.gross_profit = gross_profit
    property_deal.net_profit = net_profit
    property_deal.broker_commission = broker_commission
    property_deal.other_expenses = other_expenses
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
            "advance_paid": float(_decimal(property_deal.advance_paid)),
            "seller_remaining": float(total_seller_value - _decimal(property_deal.advance_paid)),
            "broker_name": property_deal.broker_name,
            "broker_commission": float(broker_commission),
            "other_expenses": float(other_expenses),
            "gross_profit": float(gross_profit),
            "net_profit": float(net_profit),
            "total_advance_pool": float(total_advance_pool),
            "partner_settlements": partner_settlements,
        },
    }


# ─── Site Plots CRUD ─────────────────────────────────────────────────────────

@router.get("/{property_id}/plots", response_model=List[SitePlotOut])
def list_site_plots(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_property_or_404(property_id, db)
    return db.query(SitePlot).filter(
        SitePlot.property_deal_id == property_id,
    ).order_by(SitePlot.id).all()


@router.post("/{property_id}/plots", response_model=SitePlotOut)
def create_site_plot(
    property_id: int,
    plot_data: SitePlotCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _get_property_or_404(property_id, db)
    data = plot_data.model_dump()
    # Auto-calculate price if not supplied
    if data.get("calculated_price") is None and data.get("area_sqft") and data.get("sold_price_per_sqft"):
        data["calculated_price"] = Decimal(str(data["area_sqft"])) * Decimal(str(data["sold_price_per_sqft"]))
    plot = SitePlot(property_deal_id=property_id, created_by=current_user.id, **data)
    db.add(plot)
    db.commit()
    db.refresh(plot)
    return plot


@router.put("/{property_id}/plots/{plot_id}", response_model=SitePlotOut)
def update_site_plot(
    property_id: int,
    plot_id: int,
    plot_data: SitePlotCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _get_property_or_404(property_id, db)
    plot = db.query(SitePlot).filter(
        SitePlot.id == plot_id,
        SitePlot.property_deal_id == property_id,
    ).first()
    if not plot:
        raise HTTPException(status_code=404, detail="Plot not found")
    data = plot_data.model_dump(exclude_unset=True)
    if data.get("calculated_price") is None and data.get("area_sqft") and data.get("sold_price_per_sqft"):
        data["calculated_price"] = Decimal(str(data["area_sqft"])) * Decimal(str(data["sold_price_per_sqft"]))
    for field, value in data.items():
        setattr(plot, field, value)
    db.commit()
    db.refresh(plot)
    return plot


@router.delete("/{property_id}/plots/{plot_id}")
def delete_site_plot(
    property_id: int,
    plot_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _get_property_or_404(property_id, db)
    plot = db.query(SitePlot).filter(
        SitePlot.id == plot_id,
        SitePlot.property_deal_id == property_id,
    ).first()
    if not plot:
        raise HTTPException(status_code=404, detail="Plot not found")
    db.delete(plot)
    db.commit()
    return {"message": "Plot deleted"}


# ─── Plot Buyers CRUD (for plot-type deals with multiple buyers) ──────────────

@router.get("/{property_id}/buyers", response_model=List[PlotBuyerOut])
def list_plot_buyers(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_property_or_404(property_id, db)
    return db.query(PlotBuyer).filter(
        PlotBuyer.property_deal_id == property_id,
    ).order_by(PlotBuyer.id).all()


@router.post("/{property_id}/buyers", response_model=PlotBuyerOut)
def create_plot_buyer(
    property_id: int,
    buyer_data: PlotBuyerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _get_property_or_404(property_id, db)
    data = buyer_data.model_dump()
    # Auto-calculate total_value if not supplied
    if data.get("total_value") is None and data.get("area_sqft") and data.get("rate_per_sqft"):
        data["total_value"] = Decimal(str(data["area_sqft"])) * Decimal(str(data["rate_per_sqft"]))
    buyer = PlotBuyer(property_deal_id=property_id, created_by=current_user.id, **data)
    db.add(buyer)
    db.commit()
    db.refresh(buyer)
    return buyer


@router.put("/{property_id}/buyers/{buyer_id}", response_model=PlotBuyerOut)
def update_plot_buyer(
    property_id: int,
    buyer_id: int,
    buyer_data: PlotBuyerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _get_property_or_404(property_id, db)
    buyer = db.query(PlotBuyer).filter(
        PlotBuyer.id == buyer_id,
        PlotBuyer.property_deal_id == property_id,
    ).first()
    if not buyer:
        raise HTTPException(status_code=404, detail="Buyer not found")
    data = buyer_data.model_dump(exclude_unset=True)
    if data.get("total_value") is None and data.get("area_sqft") and data.get("rate_per_sqft"):
        data["total_value"] = Decimal(str(data["area_sqft"])) * Decimal(str(data["rate_per_sqft"]))
    for field, value in data.items():
        setattr(buyer, field, value)
    db.commit()
    db.refresh(buyer)
    return buyer


@router.delete("/{property_id}/buyers/{buyer_id}")
def delete_plot_buyer(
    property_id: int,
    buyer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _get_property_or_404(property_id, db)
    buyer = db.query(PlotBuyer).filter(
        PlotBuyer.id == buyer_id,
        PlotBuyer.property_deal_id == property_id,
    ).first()
    if not buyer:
        raise HTTPException(status_code=404, detail="Buyer not found")
    # Also clean up any transactions linked to this buyer
    db.query(PropertyTransaction).filter(
        PropertyTransaction.plot_buyer_id == buyer_id,
    ).update({"plot_buyer_id": None}, synchronize_session=False)
    db.delete(buyer)
    db.commit()
    return {"message": "Buyer deleted"}
