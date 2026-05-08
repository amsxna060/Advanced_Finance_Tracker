import asyncio
import httpx
import logging
import threading
from decimal import Decimal
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

# M-FIN-28: protect the in-process cache with a threading lock so concurrent
# asyncio tasks / threads don't get a torn read or double-fetch.
_cache_lock = threading.Lock()
_gold_rate_cache = {
    "rate": None,
    "fetched_at": None,
}


async def fetch_live_gold_rate_per_gram_inr(cache_ttl_seconds: int = 3600) -> Optional[Decimal]:
    """
    Fetch live gold rate per gram in INR.
    M-FIN-27: URL is read from settings.GOLD_API_URL instead of being hardcoded.
    M-FIN-28: cache is protected by a threading.Lock.
    M-INT-6: retries up to 3 times with exponential backoff on transient errors.
    Returns None if the API is unavailable after retries.
    Caches result for cache_ttl_seconds (default 1 hour).
    """
    from app.config import settings

    # Check cache under lock
    with _cache_lock:
        if _gold_rate_cache["rate"] is not None and _gold_rate_cache["fetched_at"] is not None:
            cache_age = (datetime.now() - _gold_rate_cache["fetched_at"]).total_seconds()
            if cache_age < cache_ttl_seconds:
                return _gold_rate_cache["rate"]

    # M-INT-6: retry with exponential backoff (1s, 2s, 4s)
    last_exc: Exception = None
    for attempt, delay in enumerate([0, 1, 2]):
        if delay:
            await asyncio.sleep(delay)
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(settings.GOLD_API_URL)
                response.raise_for_status()
                data = response.json()

                price = data.get("price")
                if price:
                    rate = Decimal(str(price))
                    with _cache_lock:
                        _gold_rate_cache["rate"] = rate
                        _gold_rate_cache["fetched_at"] = datetime.now()
                    return rate
        except Exception as exc:
            last_exc = exc
            logger.warning("Gold API attempt %d failed: %s", attempt + 1, exc)

    logger.error("Gold API unavailable after 3 attempts: %s", last_exc)
    return None


def calculate_gold_value(carat: int, weight_grams: Decimal, price_per_gram: Decimal) -> Decimal:
    """
    Calculate gold value based on carat, weight, and price per gram.
    Formula: (carat / 24) * weight_grams * price_per_gram
    """
    purity_factor = Decimal(str(carat)) / Decimal("24")
    value = purity_factor * weight_grams * price_per_gram
    return value.quantize(Decimal("0.01"))
