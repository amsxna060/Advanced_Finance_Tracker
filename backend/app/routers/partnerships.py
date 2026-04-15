from decimal import Decimal
from datetime import date as date_type
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.contact import Contact
from app.models.obligation import MoneyObligation
from app.models.property_deal import PropertyDeal
from app.models.partnership import Partnership, PartnershipMember, PartnershipTransaction
from app.models.user import User
from app.schemas.partnership import (
    PartnershipCreate,
    PartnershipMemberCreate,
    PartnershipMemberOut,
    PartnershipMemberUpdate,
    PartnershipOut,
    PartnershipSettleRequest,
    PartnershipTransactionCreate,
    PartnershipTransactionOut,
    PartnershipUpdate,
    CreateBuyerRequest,
    AddPlotRequest,
    AssignBuyerRequest,
)
from app.schemas.property_deal import PropertyDealOut, PlotBuyerOut, SitePlotOut
from app.schemas.loan import ContactBrief
from app.services.auto_ledger import auto_ledger, reverse_all_ledger, reverse_ledger_match
from app.models.cash_account import AccountTransaction, CashAccount
from app.models.property_deal import PropertyDeal, PropertyTransaction, SitePlot, PlotBuyer

router = APIRouter(prefix="/api/partnerships", tags=["partnerships"])

# New transaction types
OUTFLOW_TYPES = {
    "advance_to_seller", "remaining_to_seller", "broker_commission", "expense",
    # Legacy types (still recognized)
    "advance_given", "broker_paid", "invested", "other_expense",
}
INFLOW_TYPES = {
    "buyer_advance", "buyer_payment", "profit_received",
    # Legacy types
    "buyer_payment_received", "received", "profit_distributed",
}
# Types that affect our_investment (outflows that represent money put in)
INVESTMENT_TYPES = {"advance_to_seller", "remaining_to_seller", "expense", "broker_commission", "advance_given", "invested", "other_expense", "broker_paid"}
# Types that affect total_received (inflows we actually get)
RECEIVED_TYPES = {"buyer_advance", "buyer_payment", "buyer_payment_received", "received", "profit_distributed"}
# Buyer-related inflow types
BUYER_INFLOW_TYPES = {"buyer_advance", "buyer_payment", "buyer_payment_received"}


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


def _sync_property_from_partnership(partnership_id: int, db: Session) -> None:
    """
    Sync property fields FROM partnership transactions.
    Partnership is the source of truth; property reflects aggregated data.
    """
    partnership = db.query(Partnership).filter(Partnership.id == partnership_id).first()
    if not partnership or not partnership.linked_property_deal_id:
        return

    prop = db.query(PropertyDeal).filter(
        PropertyDeal.id == partnership.linked_property_deal_id,
    ).first()
    if not prop:
        return

    txns = db.query(PartnershipTransaction).filter(
        PartnershipTransaction.partnership_id == partnership_id,
    ).all()

    # Aggregate by type
    advance_to_seller = sum(_decimal(t.amount) for t in txns if t.txn_type in ("advance_to_seller", "advance_given"))
    remaining_to_seller = sum(_decimal(t.amount) for t in txns if t.txn_type == "remaining_to_seller")
    broker_commission = sum(_decimal(t.amount) for t in txns if t.txn_type in ("broker_commission", "broker_paid"))
    expenses = sum(_decimal(t.amount) for t in txns if t.txn_type in ("expense", "other_expense"))
    buyer_inflow = sum(_decimal(t.amount) for t in txns if t.txn_type in BUYER_INFLOW_TYPES)
    profit_received_total = sum(_decimal(t.amount) for t in txns if t.txn_type == "profit_received")

    # Sync property fields
    prop.advance_paid = advance_to_seller
    prop.broker_commission = broker_commission
    prop.other_expenses = expenses

    # Get broker name from the most recent broker_commission transaction
    broker_txn = next((t for t in reversed(txns) if t.txn_type in ("broker_commission", "broker_paid") and t.broker_name), None)
    if broker_txn:
        prop.broker_name = broker_txn.broker_name

    # Total buyer value from plot buyers AND site plots
    total_buyer_value = Decimal("0")
    plot_buyers = db.query(PlotBuyer).filter(PlotBuyer.property_deal_id == prop.id).all()
    for pb in plot_buyers:
        total_buyer_value += _decimal(pb.total_value)

    site_plots = db.query(SitePlot).filter(SitePlot.property_deal_id == prop.id).all()
    for sp in site_plots:
        total_buyer_value += _decimal(sp.calculated_price)

    if total_buyer_value > 0:
        prop.total_buyer_value = total_buyer_value

    # Status derivation
    if prop.status not in ("settled", "cancelled"):
        if any(pb.status == "registry_done" for pb in plot_buyers) or any(sp.status == "sold" for sp in site_plots):
            prop.status = "registry_done"
        elif len(plot_buyers) > 0 or len(site_plots) > 0:
            prop.status = "buyer_found"
        elif advance_to_seller > 0:
            prop.status = "advance_given"
        else:
            prop.status = "negotiating"

    # Sync partnership aggregates (include legacy 'invested' type)
    invested_total = sum(_decimal(t.amount) for t in txns if t.txn_type == "invested")
    total_outflow = advance_to_seller + remaining_to_seller + broker_commission + expenses + invested_total
    partnership.our_investment = total_outflow
    partnership.total_received = buyer_inflow + profit_received_total


def _resync_plot_buyer_from_partnership(partnership_id: int, plot_buyer_id: int, db: Session) -> None:
    """Re-calculate PlotBuyer.total_paid/advance from partnership buyer txns."""
    buyer = db.query(PlotBuyer).filter(PlotBuyer.id == plot_buyer_id).first()
    if not buyer:
        return

    txns = db.query(PartnershipTransaction).filter(
        PartnershipTransaction.partnership_id == partnership_id,
        PartnershipTransaction.plot_buyer_id == plot_buyer_id,
        PartnershipTransaction.txn_type.in_(BUYER_INFLOW_TYPES),
    ).all()

    total_from_buyer = sum(_decimal(t.amount) for t in txns)
    buyer.total_paid = total_from_buyer
    buyer.advance_received = total_from_buyer

    buyer_total_value = _decimal(buyer.total_value)
    if total_from_buyer == 0:
        if buyer.buyer_contact_id:
            buyer.status = "negotiating"
        else:
            buyer.status = "available"
    elif buyer_total_value > 0 and total_from_buyer >= buyer_total_value:
        buyer.status = "payment_done"
    elif buyer.status in ("negotiating", "available", "pending"):
        buyer.status = "advance_received"


def _resync_site_plot_from_partnership(partnership_id: int, site_plot_id: int, db: Session) -> None:
    """Re-calculate SitePlot.total_paid/advance from partnership buyer txns."""
    plot = db.query(SitePlot).filter(SitePlot.id == site_plot_id).first()
    if not plot:
        return

    txns = db.query(PartnershipTransaction).filter(
        PartnershipTransaction.partnership_id == partnership_id,
        PartnershipTransaction.site_plot_id == site_plot_id,
        PartnershipTransaction.txn_type.in_(BUYER_INFLOW_TYPES),
    ).all()

    total_from_buyer = sum(_decimal(t.amount) for t in txns)
    plot.total_paid = total_from_buyer
    plot.advance_received = total_from_buyer

    plot_total_value = _decimal(plot.calculated_price)
    if total_from_buyer == 0:
        if plot.buyer_contact_id:
            plot.status = "negotiating"
        else:
            plot.status = "available"
    elif plot_total_value > 0 and total_from_buyer >= plot_total_value:
        plot.status = "payment_done"
    elif plot.status in ("available", "negotiating"):
        plot.status = "advance_received"


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
    advance_to_seller = sum(
        _decimal(txn.amount) for txn in transactions if txn.txn_type in ("advance_to_seller", "advance_given")
    )
    remaining_to_seller = sum(
        _decimal(txn.amount) for txn in transactions if txn.txn_type == "remaining_to_seller"
    )
    broker_commission = sum(
        _decimal(txn.amount) for txn in transactions if txn.txn_type in ("broker_commission", "broker_paid")
    )
    expense_total = sum(
        _decimal(txn.amount) for txn in transactions if txn.txn_type in ("expense", "other_expense")
    )
    buyer_inflow = sum(
        _decimal(txn.amount) for txn in transactions if txn.txn_type in BUYER_INFLOW_TYPES
    )
    profit_received = sum(
        _decimal(txn.amount) for txn in transactions if txn.txn_type == "profit_received"
    )
    invested_total = sum(
        _decimal(txn.amount) for txn in transactions if txn.txn_type == "invested"
    )
    received_total = sum(
        _decimal(txn.amount) for txn in transactions if txn.txn_type in ("received", "profit_distributed")
    )

    total_outflow = advance_to_seller + remaining_to_seller + broker_commission + expense_total + invested_total
    total_inflow = buyer_inflow + profit_received + received_total
    net_pnl = total_inflow - total_outflow

    return {
        "our_investment": _decimal(partnership.our_investment),
        "total_received": _decimal(partnership.total_received),
        "our_pnl": net_pnl,
        "advance_to_seller": advance_to_seller,
        "remaining_to_seller": remaining_to_seller,
        "broker_commission": broker_commission,
        "expense_total": expense_total,
        "buyer_inflow": buyer_inflow,
        "profit_received": profit_received,
        "total_outflow": total_outflow,
        "total_inflow": total_inflow,
        "invested_total": invested_total,
        "received_total": received_total,
        "other_expense_total": expense_total,
        "member_count": len(members),
    }


@router.get("", response_model=List[PartnershipOut])
def get_partnerships(
    status: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
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

    # Get linked property data including buyers and plots
    linked_property = None
    plot_buyers = []
    site_plots = []
    if partnership.linked_deal:
        linked_property = PropertyDealOut.model_validate(partnership.linked_deal)
        prop_id = partnership.linked_property_deal_id

        plot_buyers_db = db.query(PlotBuyer).filter(
            PlotBuyer.property_deal_id == prop_id,
        ).order_by(PlotBuyer.id).all()
        plot_buyers = [PlotBuyerOut.model_validate(b) for b in plot_buyers_db]

        site_plots_db = db.query(SitePlot).filter(
            SitePlot.property_deal_id == prop_id,
        ).order_by(SitePlot.id).all()
        site_plots = [SitePlotOut.model_validate(p) for p in site_plots_db]

    return {
        "partnership": PartnershipOut.model_validate(partnership),
        "linked_property": linked_property,
        "members": members_payload,
        "transactions": [PartnershipTransactionOut.model_validate(txn) for txn in transactions],
        "summary": _calculate_summary(partnership, members, transactions),
        "plot_buyers": plot_buyers,
        "site_plots": site_plots,
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
    # Clean up all linked AccountTransaction entries
    reverse_all_ledger(db, "partnership", partnership_id)
    # Delete child transactions
    db.query(PartnershipTransaction).filter(
        PartnershipTransaction.partnership_id == partnership_id,
    ).delete(synchronize_session=False)
    # Delete child members
    db.query(PartnershipMember).filter(
        PartnershipMember.partnership_id == partnership_id,
    ).delete(synchronize_session=False)
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
    partnership = _get_partnership_or_404(partnership_id, db)

    if partnership.status == "settled":
        raise HTTPException(status_code=400, detail="Cannot add members to a settled partnership")

    if not member_data.is_self and not member_data.contact_id:
        raise HTTPException(status_code=400, detail="contact_id is required for non-self members")
    if member_data.is_self and member_data.contact_id:
        raise HTTPException(status_code=400, detail="Self member should not have a contact_id")

    _ensure_contact_exists(member_data.contact_id, db)

    # Validate total share_percentage <= 100%
    existing_members = db.query(PartnershipMember).filter(
        PartnershipMember.partnership_id == partnership_id,
    ).all()
    existing_total = sum(_decimal(m.share_percentage) for m in existing_members)
    new_share = _decimal(member_data.share_percentage)
    if existing_total + new_share > Decimal("100"):
        raise HTTPException(
            status_code=400,
            detail=f"Total share would be {existing_total + new_share}%. Cannot exceed 100%.",
        )

    member = PartnershipMember(partnership_id=partnership_id, **member_data.model_dump())
    db.add(member)
    db.flush()  # get member.id

    db.commit()
    db.refresh(member)
    return member


@router.put("/{partnership_id}/members/{member_id}", response_model=PartnershipMemberOut)
def update_partnership_member(
    partnership_id: int,
    member_id: int,
    member_data: PartnershipMemberUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    partnership = _get_partnership_or_404(partnership_id, db)

    if partnership.status == "settled":
        raise HTTPException(status_code=400, detail="Cannot modify members on a settled partnership")

    member = db.query(PartnershipMember).filter(
        PartnershipMember.id == member_id,
        PartnershipMember.partnership_id == partnership_id,
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Partnership member not found")

    update_data = member_data.model_dump(exclude_unset=True)

    # Validate total share_percentage <= 100% if share is being updated
    if "share_percentage" in update_data:
        other_members = db.query(PartnershipMember).filter(
            PartnershipMember.partnership_id == partnership_id,
            PartnershipMember.id != member_id,
        ).all()
        other_total = sum(_decimal(m.share_percentage) for m in other_members)
        new_share = _decimal(update_data["share_percentage"])
        if other_total + new_share > Decimal("100"):
            raise HTTPException(
                status_code=400,
                detail=f"Total share would be {other_total + new_share}%. Cannot exceed 100%.",
            )

    for field, value in update_data.items():
        setattr(member, field, value)

    db.commit()
    db.refresh(member)
    return member


@router.delete("/{partnership_id}/members/{member_id}")
def delete_partnership_member(
    partnership_id: int,
    member_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    partnership = _get_partnership_or_404(partnership_id, db)
    member = db.query(PartnershipMember).filter(
        PartnershipMember.id == member_id,
        PartnershipMember.partnership_id == partnership_id,
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Partnership member not found")

    if partnership.status == "settled":
        raise HTTPException(status_code=400, detail="Cannot remove members from a settled partnership")

    # If self-member with advance, reverse associated transactions + ledger
    if member.is_self and _decimal(member.advance_contributed) > 0:
        # Delete advance transaction(s) for this member
        adv_txns = db.query(PartnershipTransaction).filter(
            PartnershipTransaction.partnership_id == partnership_id,
            PartnershipTransaction.member_id == member_id,
            PartnershipTransaction.txn_type == "advance_given",
        ).all()
        total_advance_reversed = Decimal("0")
        for t in adv_txns:
            # Reverse ledger for each advance transaction
            if t.account_id:
                match = db.query(AccountTransaction).filter(
                    AccountTransaction.linked_type == "partnership",
                    AccountTransaction.linked_id == partnership_id,
                    AccountTransaction.txn_type == "debit",
                    AccountTransaction.amount == t.amount,
                    AccountTransaction.txn_date == t.txn_date,
                    AccountTransaction.account_id == t.account_id,
                ).order_by(AccountTransaction.id.desc()).first()
                if match:
                    db.delete(match)
            total_advance_reversed += _decimal(t.amount)
            db.delete(t)
        # Adjust partnership investment total
        partnership.our_investment = max(
            _decimal(partnership.our_investment) - total_advance_reversed,
            Decimal("0"),
        )

    db.delete(member)
    db.commit()
    return {"message": "Partner removed successfully"}


@router.post("/{partnership_id}/transactions", response_model=PartnershipTransactionOut)
def create_partnership_transaction(
    partnership_id: int,
    transaction_data: PartnershipTransactionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    partnership = _get_partnership_or_404(partnership_id, db)

    if partnership.status == "settled":
        raise HTTPException(status_code=400, detail="Cannot add transactions to a settled partnership")

    receiving_member = None
    if transaction_data.received_by_member_id:
        receiving_member = db.query(PartnershipMember).filter(
            PartnershipMember.id == transaction_data.received_by_member_id,
            PartnershipMember.partnership_id == partnership_id,
        ).first()
        if not receiving_member:
            raise HTTPException(status_code=404, detail="Receiving member not found")

    if transaction_data.member_id:
        member = db.query(PartnershipMember).filter(
            PartnershipMember.id == transaction_data.member_id,
            PartnershipMember.partnership_id == partnership_id,
        ).first()
        if not member:
            raise HTTPException(status_code=404, detail="Partnership member not found")

    txn_data = transaction_data.model_dump()

    # Validate buyer-related transactions require a linked buyer
    if transaction_data.txn_type in BUYER_INFLOW_TYPES:
        if not transaction_data.plot_buyer_id and not transaction_data.site_plot_id:
            # Check if any buyer exists at all
            has_buyer = False
            if partnership.linked_property_deal_id:
                buyer_count = db.query(PlotBuyer).filter(
                    PlotBuyer.property_deal_id == partnership.linked_property_deal_id,
                ).count()
                plot_count = db.query(SitePlot).filter(
                    SitePlot.property_deal_id == partnership.linked_property_deal_id,
                ).count()
                has_buyer = buyer_count > 0 or plot_count > 0
            if not has_buyer:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot record buyer payment: no buyer is linked to this property. Add a buyer first.",
                )
            raise HTTPException(
                status_code=400,
                detail="Please select which buyer/plot this payment is from.",
            )
        # Validate that the referenced buyer/plot actually exists
        if transaction_data.plot_buyer_id:
            pb = db.query(PlotBuyer).filter(
                PlotBuyer.id == transaction_data.plot_buyer_id,
                PlotBuyer.property_deal_id == partnership.linked_property_deal_id,
            ).first()
            if not pb:
                raise HTTPException(status_code=400, detail="Plot buyer not found for this property")
        if transaction_data.site_plot_id:
            sp = db.query(SitePlot).filter(
                SitePlot.id == transaction_data.site_plot_id,
                SitePlot.property_deal_id == partnership.linked_property_deal_id,
            ).first()
            if not sp:
                raise HTTPException(status_code=400, detail="Site plot not found for this property")

    # BUG-013: Null out account_id if payer/receiver is not Self
    if transaction_data.txn_type in OUTFLOW_TYPES and transaction_data.member_id:
        paying_member = db.query(PartnershipMember).filter(
            PartnershipMember.id == transaction_data.member_id,
        ).first()
        if paying_member and not paying_member.is_self:
            txn_data["account_id"] = None
    if transaction_data.txn_type in INFLOW_TYPES and receiving_member and not receiving_member.is_self:
        txn_data["account_id"] = None

    transaction = PartnershipTransaction(
        partnership_id=partnership_id,
        created_by=current_user.id,
        **txn_data,
    )
    db.add(transaction)
    db.flush()

    txn_type = transaction_data.txn_type
    amount = _decimal(transaction_data.amount)

    # Determine if ledger should be skipped (partner received buyer money, not in my account)
    buyer_received_by_partner = (
        txn_type in BUYER_INFLOW_TYPES
        and receiving_member is not None
        and not receiving_member.is_self
    )

    # Also skip ledger if paid from partnership pot (not from any individual's account)
    from_pot = transaction_data.from_partnership_pot

    if transaction.account_id and not buyer_received_by_partner and not from_pot:
        if txn_type in OUTFLOW_TYPES:
            auto_ledger(
                db=db,
                account_id=transaction.account_id,
                txn_type="debit",
                amount=amount,
                txn_date=transaction_data.txn_date,
                linked_type="partnership",
                linked_id=partnership_id,
                description=f"Partnership ({partnership.title}): {txn_type.replace('_', ' ')}",
                payment_mode=transaction_data.payment_mode,
                created_by=current_user.id,
            )
        elif txn_type in INFLOW_TYPES:
            auto_ledger(
                db=db,
                account_id=transaction.account_id,
                txn_type="credit",
                amount=amount,
                txn_date=transaction_data.txn_date,
                linked_type="partnership",
                linked_id=partnership_id,
                description=f"Partnership ({partnership.title}): {txn_type.replace('_', ' ')}",
                payment_mode=transaction_data.payment_mode,
                created_by=current_user.id,
            )

    # Update partnership totals
    if txn_type in INVESTMENT_TYPES:
        partnership.our_investment = _decimal(partnership.our_investment) + amount
    if txn_type in RECEIVED_TYPES:
        if not buyer_received_by_partner:
            partnership.total_received = _decimal(partnership.total_received) + amount
    if txn_type == "profit_received":
        if not buyer_received_by_partner:
            partnership.total_received = _decimal(partnership.total_received) + amount

    # Auto-sync advance_contributed on member for advance types
    if txn_type in ("advance_to_seller", "advance_given") and transaction_data.member_id:
        member = db.query(PartnershipMember).filter(
            PartnershipMember.id == transaction_data.member_id,
        ).first()
        if member:
            member.advance_contributed = _decimal(member.advance_contributed) + amount

    # Auto-sync PlotBuyer/SitePlot if this is a buyer payment
    if txn_type in BUYER_INFLOW_TYPES:
        if transaction_data.plot_buyer_id:
            _resync_plot_buyer_from_partnership(partnership_id, transaction_data.plot_buyer_id, db)
        if transaction_data.site_plot_id:
            _resync_site_plot_from_partnership(partnership_id, transaction_data.site_plot_id, db)

    # Obligations are created only at settlement time, not per-transaction.

    # Sync property from partnership transactions
    _sync_property_from_partnership(partnership_id, db)

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


@router.delete("/{partnership_id}/transactions/{txn_id}")
def delete_partnership_transaction(
    partnership_id: int,
    txn_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Delete a partnership transaction and reverse all linked effects."""
    partnership = _get_partnership_or_404(partnership_id, db)

    if partnership.status == "settled":
        raise HTTPException(status_code=400, detail="Cannot delete transactions from a settled partnership")

    txn = db.query(PartnershipTransaction).filter(
        PartnershipTransaction.id == txn_id,
        PartnershipTransaction.partnership_id == partnership_id,
    ).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    txn_type = txn.txn_type
    amount = _decimal(txn.amount)
    plot_buyer_id = txn.plot_buyer_id
    site_plot_id = txn.site_plot_id

    # Reverse ledger entry
    if txn.account_id:
        ledger_type = "debit" if txn_type in OUTFLOW_TYPES else "credit"
        match = db.query(AccountTransaction).filter(
            AccountTransaction.linked_type == "partnership",
            AccountTransaction.linked_id == partnership_id,
            AccountTransaction.txn_type == ledger_type,
            AccountTransaction.amount == txn.amount,
            AccountTransaction.txn_date == txn.txn_date,
            AccountTransaction.account_id == txn.account_id,
        ).order_by(AccountTransaction.id.desc()).first()
        if match:
            db.delete(match)

    # Reverse partnership totals
    if txn_type in INVESTMENT_TYPES:
        partnership.our_investment = max(
            _decimal(partnership.our_investment) - amount, Decimal("0")
        )
    if txn_type in RECEIVED_TYPES or txn_type == "profit_received":
        partnership.total_received = max(
            _decimal(partnership.total_received) - amount, Decimal("0")
        )

    # Reverse advance_contributed on member
    if txn_type in ("advance_to_seller", "advance_given") and txn.member_id:
        member = db.query(PartnershipMember).filter(
            PartnershipMember.id == txn.member_id,
        ).first()
        if member:
            member.advance_contributed = max(
                _decimal(member.advance_contributed) - amount, Decimal("0")
            )

    db.delete(txn)
    db.flush()

    # Reverse obligations created by this transaction
    if txn_type in ("buyer_advance", "buyer_payment", "profit_received"):
        obligations = db.query(MoneyObligation).filter(
            MoneyObligation.linked_type == "partnership",
            MoneyObligation.linked_id == partnership_id,
            MoneyObligation.is_deleted == False,
        ).all()
        for obl in obligations:
            if _decimal(obl.amount) == amount:
                db.delete(obl)

    # Re-sync PlotBuyer / SitePlot
    if plot_buyer_id:
        _resync_plot_buyer_from_partnership(partnership_id, plot_buyer_id, db)
    if site_plot_id:
        _resync_site_plot_from_partnership(partnership_id, site_plot_id, db)

    # Sync property
    _sync_property_from_partnership(partnership_id, db)

    db.commit()
    return {"message": "Transaction deleted"}


@router.put("/{partnership_id}/transactions/{txn_id}", response_model=PartnershipTransactionOut)
def update_partnership_transaction(
    partnership_id: int,
    txn_id: int,
    transaction_data: PartnershipTransactionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Update a partnership transaction with full ledger + member sync."""
    partnership = _get_partnership_or_404(partnership_id, db)

    if partnership.status == "settled":
        raise HTTPException(status_code=400, detail="Cannot edit transactions on a settled partnership")

    txn = db.query(PartnershipTransaction).filter(
        PartnershipTransaction.id == txn_id,
        PartnershipTransaction.partnership_id == partnership_id,
    ).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    old_type = txn.txn_type
    old_amount = _decimal(txn.amount)
    old_account_id = txn.account_id
    old_date = txn.txn_date
    old_member_id = txn.member_id
    old_plot_buyer_id = txn.plot_buyer_id
    old_site_plot_id = txn.site_plot_id

    new_type = transaction_data.txn_type
    new_amount = _decimal(transaction_data.amount)
    new_account_id = transaction_data.account_id
    new_date = transaction_data.txn_date
    new_member_id = transaction_data.member_id

    # ── Reverse old ledger entry ────────────────────────────────────────────
    if old_account_id:
        old_ledger_type = "debit" if old_type in OUTFLOW_TYPES else "credit"
        match = db.query(AccountTransaction).filter(
            AccountTransaction.linked_type == "partnership",
            AccountTransaction.linked_id == partnership_id,
            AccountTransaction.txn_type == old_ledger_type,
            AccountTransaction.amount == old_amount,
            AccountTransaction.txn_date == old_date,
            AccountTransaction.account_id == old_account_id,
        ).order_by(AccountTransaction.id.desc()).first()
        if match:
            db.delete(match)

    # ── Reverse old partnership totals ──────────────────────────────────────
    if old_type in INVESTMENT_TYPES:
        partnership.our_investment = max(
            _decimal(partnership.our_investment) - old_amount, Decimal("0")
        )
    if old_type in RECEIVED_TYPES or old_type == "profit_received":
        partnership.total_received = max(
            _decimal(partnership.total_received) - old_amount, Decimal("0")
        )

    # ── Reverse old advance_contributed ─────────────────────────────────────
    if old_type in ("advance_to_seller", "advance_given") and old_member_id:
        old_member = db.query(PartnershipMember).filter(
            PartnershipMember.id == old_member_id,
        ).first()
        if old_member:
            old_member.advance_contributed = max(
                _decimal(old_member.advance_contributed) - old_amount, Decimal("0")
            )

    # ── Update the transaction fields ───────────────────────────────────────
    txn.txn_type = new_type
    txn.amount = new_amount
    txn.txn_date = new_date
    txn.account_id = new_account_id
    txn.member_id = new_member_id
    txn.description = transaction_data.description
    txn.payment_mode = transaction_data.payment_mode
    txn.received_by_member_id = transaction_data.received_by_member_id
    txn.plot_buyer_id = transaction_data.plot_buyer_id
    txn.site_plot_id = transaction_data.site_plot_id
    txn.broker_name = transaction_data.broker_name
    txn.from_partnership_pot = transaction_data.from_partnership_pot
    db.flush()

    # ── Apply new ledger entry ──────────────────────────────────────────────
    buyer_received_by_partner = False
    if new_type in BUYER_INFLOW_TYPES and transaction_data.received_by_member_id:
        recv_member = db.query(PartnershipMember).filter(
            PartnershipMember.id == transaction_data.received_by_member_id,
        ).first()
        if recv_member and not recv_member.is_self:
            buyer_received_by_partner = True

    from_pot = transaction_data.from_partnership_pot

    if new_account_id and not buyer_received_by_partner and not from_pot:
        if new_type in OUTFLOW_TYPES:
            auto_ledger(
                db=db,
                account_id=new_account_id,
                txn_type="debit",
                amount=new_amount,
                txn_date=new_date,
                linked_type="partnership",
                linked_id=partnership_id,
                description=f"Partnership ({partnership.title}): {new_type.replace('_', ' ')}",
                payment_mode=transaction_data.payment_mode,
                created_by=current_user.id,
            )
        elif new_type in INFLOW_TYPES:
            auto_ledger(
                db=db,
                account_id=new_account_id,
                txn_type="credit",
                amount=new_amount,
                txn_date=new_date,
                linked_type="partnership",
                linked_id=partnership_id,
                description=f"Partnership ({partnership.title}): {new_type.replace('_', ' ')}",
                payment_mode=transaction_data.payment_mode,
                created_by=current_user.id,
            )

    # ── Apply new partnership totals ────────────────────────────────────────
    if new_type in INVESTMENT_TYPES:
        partnership.our_investment = _decimal(partnership.our_investment) + new_amount
    if new_type in RECEIVED_TYPES:
        if not buyer_received_by_partner:
            partnership.total_received = _decimal(partnership.total_received) + new_amount
    if new_type == "profit_received":
        if not buyer_received_by_partner:
            partnership.total_received = _decimal(partnership.total_received) + new_amount

    # ── Apply new advance_contributed ───────────────────────────────────────
    if new_type in ("advance_to_seller", "advance_given") and new_member_id:
        new_member = db.query(PartnershipMember).filter(
            PartnershipMember.id == new_member_id,
        ).first()
        if new_member:
            new_member.advance_contributed = _decimal(new_member.advance_contributed) + new_amount

    # Re-sync PlotBuyer / SitePlot for both old and new
    for pbid in {old_plot_buyer_id, transaction_data.plot_buyer_id}:
        if pbid:
            _resync_plot_buyer_from_partnership(partnership_id, pbid, db)
    for spid in {old_site_plot_id, transaction_data.site_plot_id}:
        if spid:
            _resync_site_plot_from_partnership(partnership_id, spid, db)

    # Sync property
    _sync_property_from_partnership(partnership_id, db)

    db.commit()
    db.refresh(txn)
    return txn


@router.put("/{partnership_id}/settle", response_model=dict)
def settle_partnership(
    partnership_id: int,
    request: PartnershipSettleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    partnership = _get_partnership_or_404(partnership_id, db)

    members = db.query(PartnershipMember).filter(
        PartnershipMember.partnership_id == partnership_id,
    ).all()

    # Validate total shares equal 100%
    total_share = sum(_decimal(m.share_percentage) for m in members)
    if abs(total_share - Decimal("100")) > Decimal("0.01"):
        raise HTTPException(
            status_code=400,
            detail=f"Total share percentage is {total_share}%. It must equal 100% before settlement.",
        )

    partnership.status = "settled"
    partnership.actual_end_date = request.actual_end_date
    if request.notes:
        existing_notes = partnership.notes or ""
        separator = "\n\n" if existing_notes else ""
        partnership.notes = f"{existing_notes}{separator}Settlement notes: {request.notes}"

    transactions = db.query(PartnershipTransaction).filter(
        PartnershipTransaction.partnership_id == partnership_id,
    ).all()

    # Compute P&L from actual transactions
    total_to_seller = sum(
        _decimal(t.amount) for t in transactions
        if t.txn_type in ("advance_to_seller", "remaining_to_seller", "advance_given")
    )
    broker_total = sum(
        _decimal(t.amount) for t in transactions
        if t.txn_type in ("broker_commission", "broker_paid")
    )
    expense_total = sum(
        _decimal(t.amount) for t in transactions
        if t.txn_type in ("expense", "other_expense")
    )
    invested_total = sum(
        _decimal(t.amount) for t in transactions
        if t.txn_type == "invested"
    )
    total_outflow = total_to_seller + broker_total + expense_total + invested_total
    total_buyer_inflow = sum(
        _decimal(t.amount) for t in transactions
        if t.txn_type in BUYER_INFLOW_TYPES
    )
    profit_received_total = sum(
        _decimal(t.amount) for t in transactions
        if t.txn_type == "profit_received"
    )
    total_inflow = total_buyer_inflow + profit_received_total

    # If user overrides total_received, use that; otherwise use computed inflow
    final_received = _decimal(request.total_received) if request.total_received is not None else total_inflow
    partnership.total_received = final_received

    net_profit = final_received - total_outflow

    # Per-member expense tracking: each member who paid expenses should be reimbursed
    member_expenses = {}
    for t in transactions:
        if t.txn_type in ("expense", "other_expense") and t.member_id:
            member_expenses[t.member_id] = member_expenses.get(t.member_id, Decimal("0")) + _decimal(t.amount)

    # Distribute: each member gets back advance + expenses_paid + share of net profit - profit already taken
    for member in members:
        share_pct = _decimal(member.share_percentage)
        advance_back = _decimal(member.advance_contributed)
        profit_share = net_profit * (share_pct / Decimal("100"))
        expense_back = member_expenses.get(member.id, Decimal("0"))

        # Subtract profit already received by this member (BUG-006: use received_by_member_id)
        already_received = sum(
            _decimal(t.amount) for t in transactions
            if t.txn_type == "profit_received" and t.received_by_member_id == member.id
        )
        member.total_received = advance_back + expense_back + profit_share - already_received

    # ── Create settlement obligations for non-self members ──────────────────
    # Clear any old partnership obligations first (from previous incorrect per-txn logic)
    db.query(MoneyObligation).filter(
        MoneyObligation.linked_type == "partnership",
        MoneyObligation.linked_id == partnership.id,
        MoneyObligation.is_deleted == False,
    ).update({"is_deleted": True})
    db.flush()

    for member in members:
        if member.is_self or not member.contact_id:
            continue
        entitlement = _decimal(member.total_received)
        if entitlement > Decimal("0"):
            # We owe this partner money
            db.add(MoneyObligation(
                obligation_type="payable",
                contact_id=member.contact_id,
                amount=entitlement,
                reason=f"Partnership '{partnership.title}' settlement: partner entitlement",
                linked_type="partnership",
                linked_id=partnership.id,
                created_by=current_user.id,
            ))
        elif entitlement < Decimal("0"):
            # Partner owes us money
            db.add(MoneyObligation(
                obligation_type="receivable",
                contact_id=member.contact_id,
                amount=abs(entitlement),
                reason=f"Partnership '{partnership.title}' settlement: partner owes back",
                linked_type="partnership",
                linked_id=partnership.id,
                created_by=current_user.id,
            ))

    # Sync property status if linked
    if partnership.linked_property_deal_id:
        prop = db.query(PropertyDeal).filter(
            PropertyDeal.id == partnership.linked_property_deal_id,
        ).first()
        if prop:
            prop.status = "settled"

    db.commit()
    db.refresh(partnership)

    return {
        "message": "Partnership settled successfully",
        "partnership": PartnershipOut.model_validate(partnership),
        "summary": _calculate_summary(partnership, members, transactions),
    }


@router.post("/{partnership_id}/create-buyer", response_model=dict)
def create_buyer_for_partnership(
    partnership_id: int,
    buyer_data: CreateBuyerRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create a Contact + PlotBuyer (or SitePlot buyer) linked to the partnership's property."""
    partnership = _get_partnership_or_404(partnership_id, db)

    if partnership.status == "settled":
        raise HTTPException(status_code=400, detail="Cannot add buyers to a settled partnership")

    if not partnership.linked_property_deal_id:
        raise HTTPException(status_code=400, detail="Partnership has no linked property")

    prop = db.query(PropertyDeal).filter(
        PropertyDeal.id == partnership.linked_property_deal_id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Linked property not found")

    # For plot type, only allow 1 buyer
    if prop.property_type == "plot":
        existing_buyers = db.query(PlotBuyer).filter(
            PlotBuyer.property_deal_id == prop.id,
        ).count()
        if existing_buyers > 0:
            raise HTTPException(status_code=400, detail="This plot already has a buyer. A plot can only have one buyer.")

    # Dedup check: name + phone, or name + city, skip if neither
    dedup_q = db.query(Contact).filter(
        Contact.is_deleted == False,
        func.lower(Contact.name) == buyer_data.name.strip().lower(),
    )
    if buyer_data.phone and buyer_data.phone.strip():
        dedup_q = dedup_q.filter(Contact.phone == buyer_data.phone.strip())
    elif buyer_data.city and buyer_data.city.strip():
        dedup_q = dedup_q.filter(func.lower(Contact.city) == buyer_data.city.strip().lower())
    else:
        dedup_q = None

    existing_contact = dedup_q.first() if dedup_q is not None else None
    if existing_contact:
        raise HTTPException(
            status_code=409,
            detail=f"Contact '{existing_contact.name}' (Phone: {existing_contact.phone or 'N/A'}) already exists (ID {existing_contact.id}). Use 'Assign Buyer' with the existing contact instead.",
        )

    # Create contact for buyer
    contact = Contact(
        name=buyer_data.name,
        phone=buyer_data.phone,
        city=buyer_data.city,
        contact_type="individual",
        relationship_type="buyer",
        notes=buyer_data.notes,
    )
    db.add(contact)
    db.flush()

    if prop.property_type == "plot":
        buyer = PlotBuyer(
            property_deal_id=prop.id,
            buyer_contact_id=contact.id,
            buyer_name=buyer_data.name,
            area_sqft=buyer_data.area_sqft,
            rate_per_sqft=buyer_data.rate_per_sqft,
            total_value=(_decimal(buyer_data.area_sqft) * _decimal(buyer_data.rate_per_sqft)) if buyer_data.area_sqft and buyer_data.rate_per_sqft else Decimal("0"),
            status="negotiating",
            notes=buyer_data.notes,
            side_north_ft=buyer_data.side_north_ft,
            side_south_ft=buyer_data.side_south_ft,
            side_east_ft=buyer_data.side_east_ft,
            side_west_ft=buyer_data.side_west_ft,
            created_by=current_user.id,
        )
        db.add(buyer)
        db.flush()

        # Sync property
        _sync_property_from_partnership(partnership_id, db)
        db.commit()

        return {
            "message": "Buyer created successfully",
            "contact_id": contact.id,
            "plot_buyer": PlotBuyerOut.model_validate(buyer),
        }
    else:
        # Site: create a SitePlot entry for buyer
        calc_price = (_decimal(buyer_data.area_sqft) * _decimal(buyer_data.rate_per_sqft)) if buyer_data.area_sqft and buyer_data.rate_per_sqft else Decimal("0")
        site_plot = SitePlot(
            property_deal_id=prop.id,
            buyer_contact_id=contact.id,
            buyer_name=buyer_data.name,
            area_sqft=buyer_data.area_sqft,
            sold_price_per_sqft=buyer_data.rate_per_sqft,
            calculated_price=calc_price,
            side_north_ft=buyer_data.side_north_ft,
            side_south_ft=buyer_data.side_south_ft,
            side_east_ft=buyer_data.side_east_ft,
            side_west_ft=buyer_data.side_west_ft,
            status="negotiating",
            notes=buyer_data.notes,
            created_by=current_user.id,
        )
        db.add(site_plot)
        db.flush()

        _sync_property_from_partnership(partnership_id, db)
        db.commit()

        return {
            "message": "Buyer created successfully",
            "contact_id": contact.id,
            "site_plot": SitePlotOut.model_validate(site_plot),
        }


# ─── New Plot / Buyer Workflow ───────────────────────────────────────────────


@router.post("/{partnership_id}/add-plot", response_model=dict)
def add_plot_to_partnership(
    partnership_id: int,
    plot_data: AddPlotRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create a PlotBuyer or SitePlot subdivision WITHOUT a buyer assigned."""
    partnership = _get_partnership_or_404(partnership_id, db)

    if partnership.status == "settled":
        raise HTTPException(status_code=400, detail="Cannot add plots to a settled partnership")

    if not partnership.linked_property_deal_id:
        raise HTTPException(status_code=400, detail="Partnership has no linked property")

    prop = db.query(PropertyDeal).filter(
        PropertyDeal.id == partnership.linked_property_deal_id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Linked property not found")

    if prop.property_type == "plot":
        total_val = (
            _decimal(plot_data.area_sqft) * _decimal(plot_data.rate_per_sqft)
            if plot_data.area_sqft and plot_data.rate_per_sqft else Decimal("0")
        )
        buyer = PlotBuyer(
            property_deal_id=prop.id,
            area_sqft=plot_data.area_sqft,
            rate_per_sqft=plot_data.rate_per_sqft,
            total_value=total_val,
            side_north_ft=plot_data.side_north_ft,
            side_south_ft=plot_data.side_south_ft,
            side_east_ft=plot_data.side_east_ft,
            side_west_ft=plot_data.side_west_ft,
            status="available",
            notes=plot_data.notes,
            created_by=current_user.id,
        )
        db.add(buyer)
        db.flush()
        _sync_property_from_partnership(partnership_id, db)
        db.commit()
        return {"message": "Plot added", "plot_buyer": PlotBuyerOut.model_validate(buyer)}
    else:
        calc_price = (
            _decimal(plot_data.area_sqft) * _decimal(plot_data.rate_per_sqft)
            if plot_data.area_sqft and plot_data.rate_per_sqft else Decimal("0")
        )
        site_plot = SitePlot(
            property_deal_id=prop.id,
            plot_number=plot_data.plot_number,
            area_sqft=plot_data.area_sqft,
            sold_price_per_sqft=plot_data.rate_per_sqft,
            calculated_price=calc_price,
            side_north_ft=plot_data.side_north_ft,
            side_south_ft=plot_data.side_south_ft,
            side_east_ft=plot_data.side_east_ft,
            side_west_ft=plot_data.side_west_ft,
            status="available",
            notes=plot_data.notes,
            created_by=current_user.id,
        )
        db.add(site_plot)
        db.flush()
        _sync_property_from_partnership(partnership_id, db)
        db.commit()
        return {"message": "Site plot added", "site_plot": SitePlotOut.model_validate(site_plot)}


@router.put("/{partnership_id}/assign-buyer", response_model=dict)
def assign_buyer_to_plot(
    partnership_id: int,
    data: AssignBuyerRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Assign a buyer contact to an existing PlotBuyer or SitePlot.
    Either provide an existing contact_id or name+phone for quick-create with dedup check.
    """
    partnership = _get_partnership_or_404(partnership_id, db)

    if partnership.status == "settled":
        raise HTTPException(status_code=400, detail="Cannot assign buyers to a settled partnership")

    if not partnership.linked_property_deal_id:
        raise HTTPException(status_code=400, detail="Partnership has no linked property")

    # Resolve or create the buyer contact
    if data.contact_id:
        contact = db.query(Contact).filter(
            Contact.id == data.contact_id, Contact.is_deleted == False,
        ).first()
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")
    else:
        if not data.name or not data.name.strip():
            raise HTTPException(status_code=400, detail="Buyer name is required")
        # Dedup check: name + phone
        dedup_q = db.query(Contact).filter(
            Contact.is_deleted == False,
            func.lower(Contact.name) == data.name.strip().lower(),
        )
        if data.phone and data.phone.strip():
            dedup_q = dedup_q.filter(Contact.phone == data.phone.strip())
        existing = dedup_q.first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Contact '{existing.name}' (Phone: {existing.phone or 'N/A'}) already exists (ID {existing.id}). Use the existing contact instead.",
            )
        contact = Contact(
            name=data.name.strip(),
            phone=data.phone.strip() if data.phone else None,
            city=data.city.strip() if data.city else None,
            contact_type="individual",
            relationship_type="buyer",
        )
        db.add(contact)
        db.flush()

    # Assign to the correct record
    if data.plot_type == "plot_buyer":
        buyer = db.query(PlotBuyer).filter(
            PlotBuyer.id == data.plot_id,
            PlotBuyer.property_deal_id == partnership.linked_property_deal_id,
        ).first()
        if not buyer:
            raise HTTPException(status_code=404, detail="Plot not found")
        buyer.buyer_contact_id = contact.id
        buyer.buyer_name = contact.name
        if buyer.status == "available":
            buyer.status = "negotiating"
    elif data.plot_type == "site_plot":
        sp = db.query(SitePlot).filter(
            SitePlot.id == data.plot_id,
            SitePlot.property_deal_id == partnership.linked_property_deal_id,
        ).first()
        if not sp:
            raise HTTPException(status_code=404, detail="Site plot not found")
        sp.buyer_contact_id = contact.id
        sp.buyer_name = contact.name
        if sp.status == "available":
            sp.status = "negotiating"
    else:
        raise HTTPException(status_code=400, detail="plot_type must be 'plot_buyer' or 'site_plot'")

    _sync_property_from_partnership(partnership_id, db)
    db.commit()
    return {"message": "Buyer assigned", "contact_id": contact.id, "contact_name": contact.name}
