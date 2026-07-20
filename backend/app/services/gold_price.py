"""Live gold rate (INR per gram, 24k) from free, no-API-key sources.

The old goldpricez.com endpoint needs a paid key. We instead combine two
free, keyless public APIs:
  - gold-api.com  → gold spot price in USD per troy ounce (XAU)
  - open.er-api.com → USD→INR exchange rate

  INR_per_gram_24k = (USD_per_ounce * USD_INR) / 31.1035

Both source URLs are overridable via settings (GOLD_PRICE_URL / FX_RATE_URL)
if you later switch to a paid provider. Result is cached in-process for
GOLD_CACHE_TTL_SECONDS. calculate_gold_value() applies the carat purity.
"""
import asyncio
import logging
import threading
from datetime import datetime
from decimal import Decimal
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_GRAMS_PER_TROY_OUNCE = Decimal("31.1034768")

_cache_lock = threading.Lock()
_gold_rate_cache = {"rate": None, "fetched_at": None}


async def _get_json(client: httpx.AsyncClient, url: str) -> dict:
    resp = await client.get(url)
    resp.raise_for_status()
    return resp.json()


async def fetch_live_gold_rate_per_gram_inr(cache_ttl_seconds: int = 3600) -> Optional[Decimal]:
    """Return live 24k gold rate in INR/gram, or None if sources are down.
    Cached for cache_ttl_seconds. Retries transient failures 3x with backoff."""
    from app.config import settings

    with _cache_lock:
        if _gold_rate_cache["rate"] is not None and _gold_rate_cache["fetched_at"] is not None:
            if (datetime.now() - _gold_rate_cache["fetched_at"]).total_seconds() < cache_ttl_seconds:
                return _gold_rate_cache["rate"]

    last_exc: Optional[Exception] = None
    for delay in (0, 1, 2):
        if delay:
            await asyncio.sleep(delay)
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                gold = await _get_json(client, settings.GOLD_PRICE_URL)
                usd_per_oz = Decimal(str(gold["price"]))          # gold-api.com: {"price": <usd/oz>}

                fx = await _get_json(client, settings.FX_RATE_URL)
                usd_inr = Decimal(str(fx["rates"]["INR"]))         # open.er-api.com: {"rates": {"INR": ...}}

            rate = (usd_per_oz * usd_inr / _GRAMS_PER_TROY_OUNCE).quantize(Decimal("0.01"))
            with _cache_lock:
                _gold_rate_cache["rate"] = rate
                _gold_rate_cache["fetched_at"] = datetime.now()
            logger.info("Gold rate refreshed: ₹%s/gram (24k)", rate)
            return rate
        except Exception as exc:
            last_exc = exc
            logger.warning("Gold rate fetch failed: %s", exc)

    logger.error("Gold rate unavailable after retries: %s", last_exc)
    return None


def calculate_gold_value(carat: int, weight_grams: Decimal, price_per_gram_24k: Decimal) -> Decimal:
    """Value of a gold holding: (carat/24) * grams * 24k-rate."""
    purity = Decimal(str(carat)) / Decimal("24")
    return (purity * Decimal(str(weight_grams)) * Decimal(str(price_per_gram_24k))).quantize(Decimal("0.01"))
