from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
from decimal import Decimal

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.user import User
from app.models.loan import Loan
from app.models.collateral import Collateral
from app.schemas.collateral import CollateralCreate, CollateralUpdate, CollateralOut, GoldRateResponse
from app.services.gold_price import fetch_live_gold_rate_per_gram_inr, calculate_gold_value
from app.config import settings

router = APIRouter(prefix="/api", tags=["collaterals"])


@router.get("/loans/{loan_id}/collaterals", response_model=List[CollateralOut])
def get_loan_collaterals(
    loan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all collaterals for a loan"""
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    
    collaterals = db.query(Collateral).filter(Collateral.loan_id == loan_id).all()
    return collaterals


@router.post("/loans/{loan_id}/collaterals", response_model=CollateralOut)
async def create_collateral(
    loan_id: int,
    collateral_data: CollateralCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Create a new collateral for a loan"""
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.is_deleted == False).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    
    # If gold collateral, calculate value
    if collateral_data.collateral_type == "gold":
        if not all([collateral_data.gold_carat, collateral_data.gold_weight_grams]):
            raise HTTPException(
                status_code=400,
                detail="Gold collateral requires gold_carat and gold_weight_grams"
            )
        
        # Fetch live rate if not using manual
        if not collateral_data.gold_use_manual_rate:
            live_rate = await fetch_live_gold_rate_per_gram_inr(settings.GOLD_CACHE_TTL_SECONDS)
            if live_rate:
                calculated_value = calculate_gold_value(
                    collateral_data.gold_carat,
                    Decimal(str(collateral_data.gold_weight_grams)),
                    live_rate
                )
                collateral_data.gold_calculated_rate = calculated_value
                collateral_data.estimated_value = calculated_value
            else:
                # API failed, require manual rate
                if not collateral_data.gold_manual_rate:
                    raise HTTPException(
                        status_code=400,
                        detail="Gold rate API unavailable. Please provide gold_manual_rate."
                    )
                collateral_data.estimated_value = collateral_data.gold_manual_rate
        else:
            # Using manual rate
            if not collateral_data.gold_manual_rate:
                raise HTTPException(status_code=400, detail="gold_manual_rate required when gold_use_manual_rate is true")
            collateral_data.estimated_value = collateral_data.gold_manual_rate
    
    new_collateral = Collateral(**collateral_data.model_dump())
    db.add(new_collateral)
    db.commit()
    db.refresh(new_collateral)
    return new_collateral


@router.put("/collaterals/{collateral_id}", response_model=CollateralOut)
async def update_collateral(
    collateral_id: int,
    collateral_data: CollateralUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Update a collateral"""
    collateral = db.query(Collateral).filter(Collateral.id == collateral_id).first()
    if not collateral:
        raise HTTPException(status_code=404, detail="Collateral not found")
    
    # Update fields
    update_data = collateral_data.model_dump(exclude_unset=True)
    
    # If gold-related fields updated, recalculate value
    if collateral.collateral_type == "gold" and any(k in update_data for k in ['gold_carat', 'gold_weight_grams', 'gold_use_manual_rate', 'gold_manual_rate']):
        carat = update_data.get('gold_carat', collateral.gold_carat)
        weight = update_data.get('gold_weight_grams', collateral.gold_weight_grams)
        use_manual = update_data.get('gold_use_manual_rate', collateral.gold_use_manual_rate)
        manual_rate = update_data.get('gold_manual_rate', collateral.gold_manual_rate)
        
        if not use_manual:
            live_rate = await fetch_live_gold_rate_per_gram_inr(settings.GOLD_CACHE_TTL_SECONDS)
            if live_rate and carat and weight:
                calculated_value = calculate_gold_value(carat, Decimal(str(weight)), live_rate)
                update_data['gold_calculated_rate'] = calculated_value
                update_data['estimated_value'] = calculated_value
                update_data['gold_rate_fetched_at'] = datetime.now()
        else:
            if manual_rate:
                update_data['estimated_value'] = manual_rate
    
    for field, value in update_data.items():
        setattr(collateral, field, value)
    
    db.commit()
    db.refresh(collateral)
    return collateral


@router.delete("/collaterals/{collateral_id}")
def delete_collateral(
    collateral_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Delete a collateral"""
    collateral = db.query(Collateral).filter(Collateral.id == collateral_id).first()
    if not collateral:
        raise HTTPException(status_code=404, detail="Collateral not found")
    
    db.delete(collateral)
    db.commit()
    return {"message": "Collateral deleted successfully"}


@router.get("/collaterals/{collateral_id}/gold-rate", response_model=GoldRateResponse)
async def get_gold_rate(
    collateral_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Fetch current gold rate and calculate value for gold collateral"""
    collateral = db.query(Collateral).filter(Collateral.id == collateral_id).first()
    if not collateral:
        raise HTTPException(status_code=404, detail="Collateral not found")
    
    if collateral.collateral_type != "gold":
        raise HTTPException(status_code=400, detail="This endpoint is only for gold collateral")
    
    if not all([collateral.gold_carat, collateral.gold_weight_grams]):
        raise HTTPException(status_code=400, detail="Gold collateral missing carat or weight information")
    
    # Fetch live rate
    live_rate = await fetch_live_gold_rate_per_gram_inr(settings.GOLD_CACHE_TTL_SECONDS)
    
    calculated_value = None
    if live_rate:
        calculated_value = calculate_gold_value(
            collateral.gold_carat,
            Decimal(str(collateral.gold_weight_grams)),
            live_rate
        )
    
    return GoldRateResponse(
        price_per_gram=live_rate,
        calculated_value=calculated_value,
        manual_value=collateral.gold_manual_rate,
        use_manual=collateral.gold_use_manual_rate,
        fetched_at=datetime.now() if live_rate else None
    )
