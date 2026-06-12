from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_, func, text
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
    PropertyTransactionOut,
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
from app.config import settings

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
        PropertyTransaction.is_voided == False,
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


def _ensure_contact_exists(contact_id: Optional[int], db: Session, field_name: str, user_id: Optional[int] = None) -> None:
    if not contact_id:
        return
    q = db.query(Contact).filter(
        Contact.id == contact_id,
        Contact.is_deleted == False,
    )
    # H-AUTHZ-4: optionally scope contact lookup to the requesting user
    if user_id is not None:
        q = q.filter(Contact.created_by == user_id)
    contact = q.first()
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
        # BUG-1/2 guard: only process non-voided transactions
        live_txns = [t for t in partnership_transactions if not getattr(t, "is_voided", False)]
        total_outflow = sum(
            _decimal(t.amount) for t in live_txns if t.txn_type in _P_OUTFLOW_TYPES
        )
        total_inflow = sum(
            _decimal(t.amount) for t in live_txns if t.txn_type in _P_INFLOW_TYPES
        )
        buyer_inflow = sum(
            _decimal(t.amount) for t in live_txns if t.txn_type in _P_BUYER_INFLOW_TYPES
        )
        broker_commission = sum(
            _decimal(t.amount) for t in live_txns if t.txn_type in ("broker_commission", "broker_paid")
        )
        expense_total = sum(
            _decimal(t.amount) for t in live_txns if t.txn_type in ("expense", "other_expense")
        )
        # BUG-3: include paid_to_seller (buyer-direct-to-seller) as part of seller cost
        paid_to_seller_sum = sum(
            _decimal(t.amount) for t in live_txns if getattr(t, "paid_to_seller", False)
        )
        seller_total = sum(
            _decimal(t.amount) for t in live_txns
            if t.txn_type in ("advance_to_seller", "remaining_to_seller", "advance_given")
        ) + paid_to_seller_sum
        gross_profit = buyer_inflow - seller_total if buyer_inflow > 0 else (
            _decimal(property_deal.total_buyer_value) - _decimal(property_deal.total_seller_value)
            if property_deal.total_buyer_value and property_deal.total_seller_value else Decimal("0")
        )
        # paid_to_seller txns increase both inflow AND outflow (pass-through); add to outflow so net is correct
        net_profit = total_inflow - total_outflow - paid_to_seller_sum

        # PR3: two explicit profit views.
        # realized = cash so far; projected = full committed buyer/seller values.
        committed_seller = (
            _decimal(property_deal.total_seller_value)
            if property_deal.total_seller_value and _decimal(property_deal.total_seller_value) > 0
            else seller_total
        )
        committed_buyer = (
            _decimal(property_deal.total_buyer_value)
            if property_deal.total_buyer_value and _decimal(property_deal.total_buyer_value) > 0
            else buyer_inflow
        )
        realized_pnl = net_profit
        projected_pnl = committed_buyer - committed_seller - broker_commission - expense_total
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
        realized_pnl = net_profit
        projected_pnl = gross_profit if gross_profit != Decimal("0") else net_profit

    return {
        "total_inflow": total_inflow,
        "total_outflow": total_outflow,
        "gross_profit": gross_profit,
        "net_profit": net_profit,  # back-compat alias for realized_pnl
        "realized_pnl": realized_pnl,
        "projected_pnl": projected_pnl,
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

    contact_ids = [m.contact_id for m in members if m.contact_id]
    contact_map = {c.id: c for c in db.query(Contact).filter(Contact.id.in_(contact_ids)).all()} if contact_ids else {}
    member_list = []
    for member in members:
        contact = contact_map.get(member.contact_id)
        member_list.append({
            "member": PartnershipMemberOut.model_validate(member),
            "contact": ContactBrief.model_validate(contact) if contact else None,
        })

    return {
        "partnership": PartnershipOut.model_validate(partnership),
        "members": member_list,
    }


_ACTIVE_STATUSES = {"negotiating", "advance_given", "registry_done", "buyer_found"}


@router.get("/stats")
def portfolio_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Portfolio stats using PartnershipMember as source of truth.

    Capital  = sum of self_member.advance_contributed (actual cash personally paid).
    Liability = sum of (remaining_seller_amount × self_member.share_percentage).
    Properties without a linked partnership or self member are excluded.
    """
    rows = db.execute(text("""
        SELECT
            pd.status,
            pd.total_seller_value,
            pd.advance_paid,
            pd.net_profit,
            pm.id            AS member_id,
            pm.share_percentage,
            pm.advance_contributed,
            COALESCE(
                SUM(pt.amount) FILTER (
                    WHERE pt.txn_type IN ('expense', 'other_expense', 'kharcha')
                    AND   pt.member_id = pm.id
                    AND   COALESCE(pt.is_voided, FALSE) = FALSE
                    AND   COALESCE(pt.from_partnership_pot, FALSE) = FALSE
                ), 0
            ) AS personal_expenses,
            COALESCE(
                SUM(pt.amount) FILTER (
                    WHERE COALESCE(pt.is_voided, FALSE) = FALSE
                    AND (
                        pt.txn_type IN ('advance_to_seller', 'advance_given', 'remaining_to_seller')
                        OR COALESCE(pt.paid_to_seller, FALSE) = TRUE
                    )
                ), 0
            ) AS seller_paid_total
        FROM property_deals pd
        LEFT JOIN partnerships p
            ON  p.linked_property_deal_id = pd.id
            AND p.is_deleted = FALSE
        LEFT JOIN partnership_members pm
            ON  pm.partnership_id = p.id
            AND pm.is_self = TRUE
        LEFT JOIN partnership_transactions pt
            ON  pt.partnership_id = p.id
        WHERE pd.is_deleted = FALSE
          AND pd.is_legacy  = FALSE
        GROUP BY pd.id, pm.id
    """)).fetchall()

    my_capital = Decimal("0")
    my_liability = Decimal("0")
    settled_profit = Decimal("0")
    active_count = 0
    included_count = 0

    for row in rows:
        if row.member_id is None:   # no self-member → skip
            continue
        included_count += 1
        share_pct       = Decimal(str(row.share_percentage or 0))
        adv_contributed = Decimal(str(row.advance_contributed or 0))
        expenses        = Decimal(str(row.personal_expenses or 0))
        total_seller    = Decimal(str(row.total_seller_value or 0))
        # Liability = what's still unpaid to the seller. Count ALL seller-side
        # payments (advance + remaining + buyer-direct), not just advance_paid —
        # otherwise a fully paid seller still shows as a liability.
        seller_paid     = max(
            Decimal(str(row.seller_paid_total or 0)),
            Decimal(str(row.advance_paid or 0)),
        )
        remaining       = max(Decimal("0"), total_seller - seller_paid)

        if row.status in _ACTIVE_STATUSES:
            active_count += 1
            my_capital   += adv_contributed + expenses
            my_liability += remaining * share_pct / Decimal("100")
        elif row.status == "settled":
            settled_profit += Decimal(str(row.net_profit or 0)) * share_pct / Decimal("100")

    return {
        "my_capital": float(my_capital),
        "my_liability": float(my_liability),
        "settled_profit": float(settled_profit),
        "active_count": active_count,
        "total_count": included_count,
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
    query = db.query(PropertyDeal).filter(PropertyDeal.is_deleted == False, PropertyDeal.is_legacy == False)

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
        PropertyTransaction.is_voided == False,
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
            PartnershipTransaction.is_voided == False,
        ).order_by(PartnershipTransaction.txn_date.desc(), PartnershipTransaction.id.desc()).all()
        all_partnership_txns.extend(lp_all_txns)

        # H-PERF-3: batch-load contacts for all members at once to avoid N+1
        lp_member_contact_ids = [m.contact_id for m in lp_members if m.contact_id]
        lp_contact_map = {}
        if lp_member_contact_ids:
            lp_contacts = db.query(Contact).filter(Contact.id.in_(lp_member_contact_ids)).all()
            lp_contact_map = {c.id: c for c in lp_contacts}

        for txn in lp_all_txns:
            if txn.txn_type in ("other_expense", "expense", "broker_commission", "broker_paid"):
                payer_member = member_map.get(txn.member_id) if txn.member_id else None
                payer_contact = lp_contact_map.get(payer_member.contact_id) if (payer_member and payer_member.contact_id) else None
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
    # N+1 fix: one members query + one contacts query for ALL partnerships/txns
    # (was a members query per partnership and a Contact query per txn side).
    display_transactions = []
    if all_partnership_txns:
        _all_members = db.query(PartnershipMember).filter(
            PartnershipMember.partnership_id.in_([lp.id for lp in linked_partnerships] or [0]),
        ).all()
        _members_by_partnership = {}
        for m in _all_members:
            _members_by_partnership.setdefault(m.partnership_id, {})[m.id] = m
        _contact_name_map = {
            c.id: c for c in db.query(Contact).filter(
                Contact.id.in_({m.contact_id for m in _all_members if m.contact_id} or {0})
            ).all()
        }
        for lp in linked_partnerships:
            member_map = _members_by_partnership.get(lp.id, {})
            for txn in all_partnership_txns:
                if txn.partnership_id != lp.id:
                    continue
                payer = member_map.get(txn.member_id) if txn.member_id else None
                receiver = member_map.get(txn.received_by_member_id) if txn.received_by_member_id else None
                payer_contact = _contact_name_map.get(payer.contact_id) if (payer and payer.contact_id) else None
                receiver_contact = _contact_name_map.get(receiver.contact_id) if (receiver and receiver.contact_id) else None
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
                    "paid_to_seller": getattr(txn, "paid_to_seller", False) or False,
                    "is_voided": getattr(txn, "is_voided", False) or False,
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

    # When total_seller_value changes, propagate to linked partnerships so P&L
    # stays correct without needing a transaction write to trigger the sync.
    if "total_seller_value" in update_data and update_data["total_seller_value"]:
        linked_partnerships = db.query(Partnership).filter(
            Partnership.linked_property_deal_id == property_id,
            Partnership.is_deleted == False,
        ).all()
        for p in linked_partnerships:
            p.total_deal_value = update_data["total_seller_value"]

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


# NOTE: the deprecated property-transaction write endpoints and the
# deprecated /settle endpoint were removed (2026-06-12). All property
# money flows are managed through the linked partnership; the read-only
# GET /transactions endpoint below is kept for legacy data display.

@router.get("/{property_id}/transactions", response_model=List[PropertyTransactionOut])
def get_property_transactions(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_property_or_404(property_id, db)
    return db.query(PropertyTransaction).filter(
        PropertyTransaction.property_deal_id == property_id,
        PropertyTransaction.is_voided == False,
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
        PropertyTransaction.is_voided == False,
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
    for field, value in data.items():
        setattr(plot, field, value)
    # Recalculate from the MERGED values so editing only area (or only rate)
    # doesn't leave calculated_price stale.
    if "calculated_price" not in data and ("area_sqft" in data or "sold_price_per_sqft" in data):
        if plot.area_sqft and plot.sold_price_per_sqft:
            plot.calculated_price = Decimal(str(plot.area_sqft)) * Decimal(str(plot.sold_price_per_sqft))
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
    for field, value in data.items():
        setattr(buyer, field, value)
    # Recalculate from the MERGED values so editing only area (or only rate)
    # doesn't leave total_value stale.
    if "total_value" not in data and ("area_sqft" in data or "rate_per_sqft" in data):
        if buyer.area_sqft and buyer.rate_per_sqft:
            buyer.total_value = Decimal(str(buyer.area_sqft)) * Decimal(str(buyer.rate_per_sqft))
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


# ── Deal Simulator Endpoints ──────────────────────────────────────────────────
# These are fully sandboxed: they only read/write the property_simulations table.
# No mutations are made to property_deals, property_transactions, or any other
# production table.

from app.models.property_deal import PropertySimulation  # noqa: E402 (local import for clarity)
from app.schemas.property_deal import SimulationCreate, SimulationOut  # noqa: E402
import json  # noqa: E402


@router.post("/{property_id}/simulations", response_model=SimulationOut)
def save_simulation(
    property_id: int,
    body: SimulationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save a named simulation scenario for a property. Sandboxed — no live data is changed."""
    _get_property_or_404(property_id, db)
    sim = PropertySimulation(
        property_deal_id=property_id,
        name=body.name,
        payload=json.dumps(body.payload.model_dump()),
        created_by=current_user.id,
    )
    db.add(sim)
    db.commit()
    db.refresh(sim)
    # Deserialize payload for the response
    sim.payload = body.payload  # type: ignore[assignment]
    return _sim_to_out(sim, body.payload)


@router.get("/{property_id}/simulations", response_model=list[SimulationOut])
def list_simulations(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all saved simulation scenarios for a property."""
    _get_property_or_404(property_id, db)
    rows = (
        db.query(PropertySimulation)
        .filter(PropertySimulation.property_deal_id == property_id)
        .order_by(PropertySimulation.created_at.desc())
        .all()
    )
    return [_sim_to_out(r) for r in rows]


@router.delete("/{property_id}/simulations/{sim_id}", status_code=204)
def delete_simulation(
    property_id: int,
    sim_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a saved simulation scenario."""
    _get_property_or_404(property_id, db)
    sim = db.query(PropertySimulation).filter(
        PropertySimulation.id == sim_id,
        PropertySimulation.property_deal_id == property_id,
    ).first()
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found")
    db.delete(sim)
    db.commit()


# ── AI Insight endpoint ───────────────────────────────────────────────────────

class AIInsightRequest(BaseModel):
    holding_months: float
    target_price_per_sqft: float
    purchase_and_hold: bool = False
    annual_appreciation_pct: float = 12
    brokerage_amount: float = 0
    absolute_profit: float = 0
    absolute_roi_pct: float = 0
    annualized_roi_pct: float = 0
    breakeven_price_per_sqft: float = 0
    my_capital: float = 0
    my_profit: float = 0
    my_ann_roi_pct: float = 0
    effective_invest: float = 0
    lending_rate_pct: float = 18


class AIInsightResponse(BaseModel):
    verdict: str
    reasoning: str


@router.post("/{property_id}/simulations/ai-insight", response_model=AIInsightResponse)
def ai_insight(
    property_id: int,
    req: AIInsightRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Call Gemini to generate HOLD/SELL/REGISTRY verdict + reasoning for a simulation scenario."""
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")

    prop = _get_property_or_404(property_id, db)
    total_area = float(prop.total_area_sqft or 0)
    total_invest = (
        float(prop.total_seller_value or 0)
        + float(prop.broker_commission or 0)
        + float(prop.other_expenses or 0)
        + req.brokerage_amount
    )

    mode = "Purchase & Hold (register and own)" if req.purchase_and_hold else "Flip / sell to buyer"
    lending_return = req.my_capital * (req.lending_rate_pct / 100) * (req.holding_months / 12)

    prompt = f"""You are a personal capital advisor for a small Indian property investor. You must give blunt, specific, numbers-first advice.

=== INVESTOR PROFILE ===
- Runs a parallel money-lending business at ~{req.lending_rate_pct:.0f}% p.a. as primary income
- Capital is SCARCE — tying up money in property directly reduces lending capacity and other deal opportunities
- Also actively flips plots (typical 25–40% annualised returns in 4–5 months)
- Cannot afford prolonged capital blockage; every idle rupee is a missed lending EMI or deal

=== DEAL DETAILS ===
Property: {prop.title}
Total area: {total_area:,.0f} sqft
All-in investment: ₹{total_invest:,.0f}
Mode: {mode}
Holding period: {req.holding_months:.0f} months
Target sale price: ₹{req.target_price_per_sqft:,.0f}/sqft
Break-even price: ₹{req.breakeven_price_per_sqft:,.0f}/sqft
{"Annual appreciation: " + str(req.annual_appreciation_pct) + "% p.a." if req.purchase_and_hold else ""}

=== MY POSITION ===
My capital at stake: ₹{req.my_capital:,.0f}
My projected profit: ₹{req.my_profit:,.0f}
My annualised ROI: {req.my_ann_roi_pct:.1f}%
If I lent this ₹{req.my_capital:,.0f} at {req.lending_rate_pct:.0f}% for {req.holding_months:.0f} months instead: ₹{lending_return:,.0f} return
Deal profit vs lending alternative: ₹{req.my_profit - lending_return:,.0f} {"better" if req.my_profit >= lending_return else "WORSE"}

=== ANALYSIS REQUIRED ===
1. Does the {req.my_ann_roi_pct:.1f}% ROI justify locking capital vs {req.lending_rate_pct:.0f}% lending? Be specific with rupee numbers.
2. What is the opportunity cost of capital blockage on this investor's lending business and other deals?
3. Is the {req.holding_months:.0f}-month hold period reasonable, or should they accept a lower price faster to redeploy?
{"4. Does " + str(req.annual_appreciation_pct) + "% appreciation justify the registry cost and full capital lock-in for " + str(req.holding_months) + " months?" if req.purchase_and_hold else "4. Would shaving ₹" + str(round((req.target_price_per_sqft - req.breakeven_price_per_sqft) * 0.3)) + "/sqft off the ask close the deal faster and still beat lending?"}

Respond with EXACTLY this format (nothing else):
VERDICT: [SELL or HOLD or REGISTRY]
REASONING: [3-5 sentences. Use rupee numbers. Be blunt. Reference the lending business impact explicitly.]"""

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0.3),
        )
        text = (response.text or "").strip()

        verdict = "HOLD"
        reasoning = text
        for line in text.split("\n"):
            stripped = line.strip()
            if stripped.upper().startswith("VERDICT:"):
                v = stripped.split(":", 1)[-1].strip().upper()
                if v in ("SELL", "HOLD", "REGISTRY"):
                    verdict = v
            elif stripped.upper().startswith("REASONING:"):
                reasoning = stripped.split(":", 1)[-1].strip()

        return AIInsightResponse(verdict=verdict, reasoning=reasoning)

    except HTTPException:
        raise
    except ImportError:
        raise HTTPException(status_code=503, detail="google-genai package not installed")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI service error: {str(e)}")


def _sim_to_out(sim: "PropertySimulation", parsed_payload=None) -> SimulationOut:
    from app.schemas.property_deal import SimulationPayload  # noqa: PLC0415

    if parsed_payload is None:
        raw = sim.payload if isinstance(sim.payload, str) else json.dumps(sim.payload)
        parsed_payload = SimulationPayload(**json.loads(raw))

    return SimulationOut(
        id=sim.id,
        property_deal_id=sim.property_deal_id,
        name=sim.name,
        payload=parsed_payload,
        created_by=sim.created_by,
        created_at=sim.created_at,
    )

