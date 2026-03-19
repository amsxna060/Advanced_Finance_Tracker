import httpx
from decimal import Decimal
from datetime import datetime, timedelta
from typing import Optional

# In-memory cache for gold rate
_gold_rate_cache = {
    "rate": None,
    "fetched_at": None
}


async def fetch_live_gold_rate_per_gram_inr(cache_ttl_seconds: int = 3600) -> Optional[Decimal]:
    """
    Fetch live gold rate per gram in INR from goldpricez.com API.
    Returns None if API fails.
    Caches result for cache_ttl_seconds (default 1 hour).
    """
    global _gold_rate_cache

    # Check if cache is valid
    if _gold_rate_cache["rate"] is not None and _gold_rate_cache["fetched_at"] is not None:
        cache_age = (datetime.now() - _gold_rate_cache["fetched_at"]).total_seconds()
        if cache_age < cache_ttl_seconds:
            return _gold_rate_cache["rate"]

    # Fetch from API
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get("https://goldpricez.com/api/rates/currency/inr/measure/gram")
            response.raise_for_status()
            data = response.json()

            # API returns: {"price": "6789.50", "currency": "INR", "measure": "gram", ...}
            price = data.get("price")
            if price:
                rate = Decimal(str(price))
                _gold_rate_cache["rate"] = rate
                _gold_rate_cache["fetched_at"] = datetime.now()
                return rate
    except Exception as e:
        # Log error in production
        print(f"Gold API error: {e}")

    return None


def calculate_gold_value(carat: int, weight_grams: Decimal, price_per_gram: Decimal) -> Decimal:
    """
    Calculate gold value based on carat, weight, and price per gram.
    Formula: (carat / 24) * weight_grams * price_per_gram
    """
    purity_factor = Decimal(str(carat)) / Decimal("24")
    value = purity_factor * weight_grams * price_per_gram
    return value.quantize(Decimal("0.01"))
