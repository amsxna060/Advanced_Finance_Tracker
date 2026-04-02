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
)
from app.schemas.property_deal import PropertyDealOut
from app.schemas.loan import ContactBrief
from app.services.auto_ledger import auto_ledger, reverse_all_ledger, reverse_ledger_match
from app.models.cash_account import AccountTransaction, CashAccount

router = APIRouter(prefix="/api/partnerships", tags=["partnerships"])

OUTFLOW_TYPES = {"advance_given", "broker_paid", "invested", "expense", "other_expense"}
INFLOW_TYPES = {"buyer_payment_received", "received", "profit_distributed"}


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


def _create_buyer_payment_obligations(
    db: Session,
    partnership,
    amount: Decimal,
    receiving_member,
    current_user_id: int,
) -> None:
    """
    Auto-create MoneyObligation records when a buyer payment is recorded.

    - If received by self (receiving_member is None or is_self):
        Create PAYABLE obligations to each non-self partner (advance + profit share).
        Also create PAYABLE to seller for remaining balance (if linked property exists).
    - If received by a partner:
        Create RECEIVABLE obligation from that partner for my (self) share.
    """
    members = db.query(PartnershipMember).filter(
        PartnershipMember.partnership_id == partnership.id,
    ).all()

    total_advance = sum(_decimal(m.advance_contributed) for m in members)

    # Derive profit to distribute among partners.
    # If linked to a settled property: use stored net_profit (= buyer - seller - broker - other, already correct).
    # If linked but not yet settled: calculate from raw values.
    # Standalone: subtract broker_paid transactions from amount, then subtract advances.
    profit = Decimal("0")
    if partnership.linked_property_deal_id:
        prop_for_calc = db.query(PropertyDeal).filter(
            PropertyDeal.id == partnership.linked_property_deal_id,
        ).first()
        if prop_for_calc and prop_for_calc.net_profit is not None:
            # Property already settled — use stored net_profit directly
            profit = max(_decimal(prop_for_calc.net_profit), Decimal("0"))
        elif prop_for_calc:
            # Property not yet settled — derive from raw fields
            total_seller = _decimal(prop_for_calc.total_seller_value)
            broker_comm = _decimal(prop_for_calc.broker_commission)
            other_exp = _decimal(getattr(prop_for_calc, "other_expenses", None))
            profit = max(amount - total_seller - broker_comm - other_exp, Decimal("0"))
        else:
            profit = max(amount - total_advance, Decimal("0"))
    else:
        # Standalone partnership: deduct broker_paid transactions from amount
        from sqlalchemy import func as sql_func
        broker_paid_total = _decimal(
            db.query(sql_func.sum(PartnershipTransaction.amount)).filter(
                PartnershipTransaction.partnership_id == partnership.id,
                PartnershipTransaction.txn_type == "broker_paid",
            ).scalar() or Decimal("0")
        )
        profit = max(amount - broker_paid_total - total_advance, Decimal("0"))

    self_received = receiving_member is None or receiving_member.is_self

    if self_received:
        # 1. PAYABLE → Broker commission + Other expenses (from linked property)
        if partnership.linked_property_deal_id:
            prop = db.query(PropertyDeal).filter(
                PropertyDeal.id == partnership.linked_property_deal_id,
            ).first()
            if prop:
                broker_comm = _decimal(prop.broker_commission)
                if broker_comm > Decimal("0"):
                    broker_label = prop.broker_name or "Broker"
                    # Try to find broker as a contact by name
                    broker_contact = None
                    if prop.broker_name:
                        from app.models.contact import Contact as _Contact
                        broker_contact = db.query(_Contact).filter(
                            _Contact.name.ilike(prop.broker_name),
                            _Contact.is_deleted == False,
                        ).first()
                    db.add(MoneyObligation(
                        obligation_type="payable",
                        contact_id=broker_contact.id if broker_contact else None,
                        amount=broker_comm,
                        reason=f"Broker: {broker_label}",
                        linked_type="partnership",
                        linked_id=partnership.id,
                        created_by=current_user_id,
                    ))

                # Other expenses (stamp duty, registry, legal, etc.)
                other_exp = _decimal(getattr(prop, "other_expenses", None))
                if other_exp > Decimal("0"):
                    db.add(MoneyObligation(
                        obligation_type="payable",
                        contact_id=None,
                        amount=other_exp,
                        reason=f"Other expenses — {prop.title}",
                        linked_type="partnership",
                        linked_id=partnership.id,
                        created_by=current_user_id,
                    ))

                # 2. PAYABLE → Seller remaining (total_seller_value - advance_already_paid)
                if prop.seller_contact_id:
                    seller_remaining = _decimal(prop.total_seller_value) - _decimal(prop.advance_paid)
                    if seller_remaining > Decimal("0"):
                        db.add(MoneyObligation(
                            obligation_type="payable",
                            contact_id=prop.seller_contact_id,
                            amount=seller_remaining,
                            reason=f"Property '{prop.title}': remaining seller payment",
                            linked_type="partnership",
                            linked_id=partnership.id,
                            created_by=current_user_id,
                        ))

        # 3. PAYABLE → each non-self partner (advance + profit share)
        for member in members:
            if member.is_self or not member.contact_id:
                continue
            member_advance = _decimal(member.advance_contributed)
            member_share = _decimal(member.share_percentage)
            member_profit = profit * (member_share / Decimal("100"))
            owed = member_advance + member_profit
            if owed > Decimal("0"):
                db.add(MoneyObligation(
                    obligation_type="payable",
                    contact_id=member.contact_id,
                    amount=owed,
                    reason=f"Partnership '{partnership.title}': partner settlement",
                    linked_type="partnership",
                    linked_id=partnership.id,
                    created_by=current_user_id,
                ))
    else:
        # A partner received the money — create RECEIVABLE from them for my share
        self_member = next((m for m in members if m.is_self), None)
        if self_member and receiving_member.contact_id:
            self_advance = _decimal(self_member.advance_contributed)
            self_share = _decimal(self_member.share_percentage)
            self_profit = profit * (self_share / Decimal("100"))
            my_owed = self_advance + self_profit
            if my_owed > Decimal("0"):
                partner_name = receiving_member.contact.name if receiving_member.contact else "partner"
                db.add(MoneyObligation(
                    obligation_type="receivable",
                    contact_id=receiving_member.contact_id,
                    amount=my_owed,
                    reason=f"Partnership '{partnership.title}': my share (received by {partner_name})",
                    linked_type="partnership",
                    linked_id=partnership.id,
                    created_by=current_user_id,
                ))


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
    other_expense_total = sum(
        _decimal(txn.amount) for txn in transactions if txn.txn_type == "other_expense"
    )
    our_pnl = _decimal(partnership.total_received) - _decimal(partnership.our_investment)

    return {
        "our_investment": _decimal(partnership.our_investment),
        "total_received": _decimal(partnership.total_received),
        "our_pnl": our_pnl,
        "invested_total": invested_total,
        "received_total": received_total,
        "expense_total": expense_total,
        "other_expense_total": other_expense_total,
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

    member = PartnershipMember(partnership_id=partnership_id, **{k: v for k, v in member_data.model_dump().items() if k != 'advance_account_id'})
    db.add(member)
    db.flush()  # get member.id

    # Auto-create advance debit when self-member with advance
    if member.is_self and _decimal(member.advance_contributed) > 0:
        # Default to "Cash in Hand" account
        cash_account = db.query(CashAccount).filter(
            CashAccount.name.ilike("%cash in hand%"),
            CashAccount.is_deleted == False,
        ).first()
        advance_account_id = member_data.advance_account_id or (cash_account.id if cash_account else 1)
        adv_amount = _decimal(member.advance_contributed)
        today = date_type.today()

        # PartnershipTransaction for advance
        adv_txn = PartnershipTransaction(
            partnership_id=partnership_id,
            member_id=member.id,
            txn_type="advance_given",
            amount=adv_amount,
            txn_date=today,
            account_id=advance_account_id,
            description="Advance given (auto-recorded on member add)",
            created_by=current_user.id,
        )
        db.add(adv_txn)

        # Auto-ledger debit from account
        auto_ledger(
            db=db,
            account_id=advance_account_id,
            txn_type="debit",
            amount=adv_amount,
            txn_date=today,
            linked_type="partnership",
            linked_id=partnership_id,
            description=f"Partnership ({partnership.title}): advance given by self",
            created_by=current_user.id,
        )

        # Update partnership investment total
        partnership.our_investment = _decimal(partnership.our_investment) + adv_amount

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
    _get_partnership_or_404(partnership_id, db)
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
                matching = db.query(AccountTransaction).filter(
                    AccountTransaction.linked_type == "partnership",
                    AccountTransaction.linked_id == partnership_id,
                    AccountTransaction.txn_type == "debit",
                    AccountTransaction.amount == t.amount,
                    AccountTransaction.txn_date == t.txn_date,
                ).all()
                for m in matching:
                    db.delete(m)
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
    # Allow transactions regardless of partnership status

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

    transaction = PartnershipTransaction(
        partnership_id=partnership_id,
        created_by=current_user.id,
        **transaction_data.model_dump(),
    )
    db.add(transaction)
    db.flush()

    txn_type = transaction_data.txn_type
    amount = _decimal(transaction_data.amount)

    # ── Validation ──────────────────────────────────────────────────────────
    if txn_type == "advance_given" and partnership.linked_property_deal_id:
        prop = db.query(PropertyDeal).filter(
            PropertyDeal.id == partnership.linked_property_deal_id,
        ).first()
        if prop:
            property_advance = _decimal(prop.advance_paid)
            existing_advance = _decimal(
                db.query(func.coalesce(func.sum(PartnershipTransaction.amount), 0)).filter(
                    PartnershipTransaction.partnership_id == partnership_id,
                    PartnershipTransaction.txn_type == "advance_given",
                ).scalar()
            )
            if existing_advance > property_advance:
                raise HTTPException(
                    status_code=400,
                    detail=f"Total partnership advance ({existing_advance}) cannot exceed property advance ({property_advance})",
                )

    if txn_type == "buyer_payment_received" and partnership.linked_property_deal_id:
        prop = db.query(PropertyDeal).filter(
            PropertyDeal.id == partnership.linked_property_deal_id,
        ).first()
        if prop and prop.total_buyer_value:
            deal_value = _decimal(prop.total_buyer_value)
            existing_buyer = _decimal(
                db.query(func.coalesce(func.sum(PartnershipTransaction.amount), 0)).filter(
                    PartnershipTransaction.partnership_id == partnership_id,
                    PartnershipTransaction.txn_type == "buyer_payment_received",
                ).scalar()
            )
            if existing_buyer > deal_value:
                raise HTTPException(
                    status_code=400,
                    detail=f"Total buyer payments ({existing_buyer}) cannot exceed deal value ({deal_value})",
                )

    # Determine account impact
    # buyer_payment_received by a non-self partner → skip my account ledger
    buyer_received_by_partner = (
        txn_type == "buyer_payment_received"
        and receiving_member is not None
        and not receiving_member.is_self
    )

    if transaction.account_id and not buyer_received_by_partner:
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
    if txn_type in {"advance_given", "invested", "other_expense"}:
        partnership.our_investment = _decimal(partnership.our_investment) + amount
    elif txn_type in {"buyer_payment_received", "received", "profit_distributed"}:
        if not buyer_received_by_partner:
            partnership.total_received = _decimal(partnership.total_received) + amount

    # ── Auto-sync advance_contributed on member ─────────────────────────────
    if txn_type == "advance_given" and transaction_data.member_id:
        member = db.query(PartnershipMember).filter(
            PartnershipMember.id == transaction_data.member_id,
        ).first()
        if member:
            member.advance_contributed = _decimal(member.advance_contributed) + amount

    # Auto-create money flow obligations for buyer payment
    if txn_type == "buyer_payment_received":
        _create_buyer_payment_obligations(
            db=db,
            partnership=partnership,
            amount=amount,
            receiving_member=receiving_member,
            current_user_id=current_user.id,
        )

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
    txn = db.query(PartnershipTransaction).filter(
        PartnershipTransaction.id == txn_id,
        PartnershipTransaction.partnership_id == partnership_id,
    ).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    txn_type = txn.txn_type
    amount = _decimal(txn.amount)

    # Reverse ledger entry
    if txn.account_id:
        ledger_type = "debit" if txn_type in OUTFLOW_TYPES else "credit"
        matching = db.query(AccountTransaction).filter(
            AccountTransaction.linked_type == "partnership",
            AccountTransaction.linked_id == partnership_id,
            AccountTransaction.txn_type == ledger_type,
            AccountTransaction.amount == txn.amount,
            AccountTransaction.txn_date == txn.txn_date,
        ).all()
        for m in matching:
            db.delete(m)
            break  # delete only one matching entry

    # Reverse partnership totals
    if txn_type in {"advance_given", "invested", "other_expense"}:
        partnership.our_investment = max(
            _decimal(partnership.our_investment) - amount, Decimal("0")
        )
    elif txn_type in {"buyer_payment_received", "received", "profit_distributed"}:
        partnership.total_received = max(
            _decimal(partnership.total_received) - amount, Decimal("0")
        )

    # Reverse advance_contributed on member
    if txn_type == "advance_given" and txn.member_id:
        member = db.query(PartnershipMember).filter(
            PartnershipMember.id == txn.member_id,
        ).first()
        if member:
            member.advance_contributed = max(
                _decimal(member.advance_contributed) - amount, Decimal("0")
            )

    db.delete(txn)
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

    new_type = transaction_data.txn_type
    new_amount = _decimal(transaction_data.amount)
    new_account_id = transaction_data.account_id
    new_date = transaction_data.txn_date
    new_member_id = transaction_data.member_id

    # ── Reverse old ledger entry ────────────────────────────────────────────
    if old_account_id:
        old_ledger_type = "debit" if old_type in OUTFLOW_TYPES else "credit"
        matching = db.query(AccountTransaction).filter(
            AccountTransaction.linked_type == "partnership",
            AccountTransaction.linked_id == partnership_id,
            AccountTransaction.txn_type == old_ledger_type,
            AccountTransaction.amount == old_amount,
            AccountTransaction.txn_date == old_date,
        ).all()
        for m in matching:
            db.delete(m)
            break

    # ── Reverse old partnership totals ──────────────────────────────────────
    if old_type in {"advance_given", "invested", "other_expense"}:
        partnership.our_investment = max(
            _decimal(partnership.our_investment) - old_amount, Decimal("0")
        )
    elif old_type in {"buyer_payment_received", "received", "profit_distributed"}:
        partnership.total_received = max(
            _decimal(partnership.total_received) - old_amount, Decimal("0")
        )

    # ── Reverse old advance_contributed ─────────────────────────────────────
    if old_type == "advance_given" and old_member_id:
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
    db.flush()

    # ── Apply new ledger entry ──────────────────────────────────────────────
    buyer_received_by_partner = False
    if new_type == "buyer_payment_received" and transaction_data.received_by_member_id:
        recv_member = db.query(PartnershipMember).filter(
            PartnershipMember.id == transaction_data.received_by_member_id,
        ).first()
        if recv_member and not recv_member.is_self:
            buyer_received_by_partner = True

    if new_account_id and not buyer_received_by_partner:
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
    if new_type in {"advance_given", "invested", "other_expense"}:
        partnership.our_investment = _decimal(partnership.our_investment) + new_amount
    elif new_type in {"buyer_payment_received", "received", "profit_distributed"}:
        if not buyer_received_by_partner:
            partnership.total_received = _decimal(partnership.total_received) + new_amount

    # ── Apply new advance_contributed ───────────────────────────────────────
    if new_type == "advance_given" and new_member_id:
        new_member = db.query(PartnershipMember).filter(
            PartnershipMember.id == new_member_id,
        ).first()
        if new_member:
            new_member.advance_contributed = _decimal(new_member.advance_contributed) + new_amount

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
