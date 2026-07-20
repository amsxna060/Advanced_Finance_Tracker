"""Gold revaluation (assets + collateral) and DB-backed platform settings."""

from decimal import Decimal
from unittest.mock import patch

import pytest

from app.services.gold_price import calculate_gold_value


# ---------------------------------------------------------------------------
# Gold price math
# ---------------------------------------------------------------------------

def test_calculate_gold_value_applies_carat_purity():
    # 10g of 22k at ₹6000/g (24k) = (22/24)*10*6000
    got = calculate_gold_value(22, Decimal("10"), Decimal("6000"))
    assert got == (Decimal("22") / 24 * 10 * 6000).quantize(Decimal("0.01"))
    # 24k is full purity
    assert calculate_gold_value(24, Decimal("5"), Decimal("6000")) == Decimal("30000.00")


def test_fetch_converts_usd_oz_to_inr_gram():
    """XAU USD/oz + USD→INR → INR/gram (24k)."""
    import asyncio
    from app.services import gold_price

    class _Resp:
        def __init__(self, data): self._d = data
        def raise_for_status(self): pass
        def json(self): return self._d

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url):
            return _Resp({"price": 4000.0}) if "gold" in url or "XAU" in url \
                else _Resp({"rates": {"INR": 90.0}})

    gold_price._gold_rate_cache["rate"] = None
    with patch.object(gold_price.httpx, "AsyncClient", lambda *a, **k: _Client()):
        rate = asyncio.run(gold_price.fetch_live_gold_rate_per_gram_inr(cache_ttl_seconds=0))
    # (4000 * 90) / 31.1034768 ≈ 11574.6
    assert abs(float(rate) - (4000 * 90 / 31.1034768)) < 0.5


class TestTenantGoldRevaluation:
    def _make_gold_asset(self, client, headers, grams=20, carat=24):
        return client.post("/api/assets", headers=headers, json={
            "name": "Gold bar", "asset_type": "gold",
            "quantity": grams, "unit": "grams", "gold_carat": carat,
            "current_value": 1,  # deliberately wrong; revaluation fixes it
        })

    def test_refresh_my_gold_updates_asset_value(self, client, headers_a):
        aid = self._make_gold_asset(client, headers_a).json()["id"]

        async def fake_rate(cache_ttl_seconds=3600):
            return Decimal("7000")

        with patch("app.services.gold_price.fetch_live_gold_rate_per_gram_inr", fake_rate):
            resp = client.post("/api/assets/refresh-gold", headers=headers_a)
        assert resp.status_code == 200, resp.text
        assert resp.json()["updated"] >= 1

        asset = client.get(f"/api/assets/{aid}", headers=headers_a).json()
        assert float(asset["current_value"]) == 20 * 7000   # 24k, 20g
        assert asset["auto_valuation"] is True

    def test_gold_rate_endpoint(self, client, headers_a):
        async def fake_rate(cache_ttl_seconds=3600):
            return Decimal("6543.21")
        with patch("app.services.gold_price.fetch_live_gold_rate_per_gram_inr", fake_rate):
            resp = client.get("/api/assets/gold-rate", headers=headers_a)
        assert resp.status_code == 200
        assert resp.json()["rate_per_gram_24k"] == 6543.21

    def test_revaluation_is_tenant_scoped(self, client, headers_a, headers_b):
        self._make_gold_asset(client, headers_a)

        async def fake_rate(cache_ttl_seconds=3600):
            return Decimal("7000")
        with patch("app.services.gold_price.fetch_live_gold_rate_per_gram_inr", fake_rate):
            # tenant B refreshing touches none of A's holdings
            resp = client.post("/api/assets/refresh-gold", headers=headers_b)
        assert resp.status_code == 200
        assert resp.json()["updated"] == 0


# ---------------------------------------------------------------------------
# DB-backed platform settings
# ---------------------------------------------------------------------------

class TestPlatformSettings:
    def test_default_falls_back_to_config(self, db):
        from app.services.settings_store import get_setting
        from app.config import settings
        # no DB row yet → config default
        assert get_setting(db, "signup_enabled") == settings.SIGNUP_ENABLED

    def test_db_override_wins_and_is_cached_briefly(self, db):
        from app.services.settings_store import get_setting, set_setting
        set_setting(db, "signup_enabled", False)
        assert get_setting(db, "signup_enabled") is False
        set_setting(db, "signup_enabled", True)
        assert get_setting(db, "signup_enabled") is True

    def test_signup_toggle_controls_endpoint(self, client, db, admin_user, auth_headers):
        from app.services.settings_store import set_setting
        set_setting(db, "signup_enabled", False)
        resp = client.post("/api/auth/signup", json={
            "username": "blocked", "email": "b@x.com", "password": "Str0ngPass1"})
        assert resp.status_code == 403
        assert "disabled" in resp.json()["detail"].lower()

        set_setting(db, "signup_enabled", True)
        resp = client.post("/api/auth/signup", json={
            "username": "allowed", "email": "a@x.com", "password": "Str0ngPass1"})
        assert resp.status_code == 201, resp.text

    def _csrf(self, client):
        return {"X-CSRF-Token": client.get("/api/auth/csrf-token").json()["csrf_token"]}

    def test_admin_settings_api(self, client, admin_user, auth_headers):
        listing = client.get("/api/admin/settings", headers=auth_headers)
        assert listing.status_code == 200
        keys = {s["key"] for s in listing.json()}
        assert {"signup_enabled", "require_email_verification", "gold_auto_refresh_enabled"} <= keys

        upd = client.put("/api/admin/settings/signup_enabled",
                         headers={**auth_headers, **self._csrf(client)},
                         json={"value": False})
        assert upd.status_code == 200, upd.text
        assert upd.json()["value"] is False

    def test_settings_api_admin_only(self, client, headers_a):
        assert client.get("/api/admin/settings", headers=headers_a).status_code == 403

    def test_unknown_setting_rejected(self, client, admin_user, auth_headers):
        resp = client.put("/api/admin/settings/nonsense",
                          headers={**auth_headers, **self._csrf(client)},
                          json={"value": True})
        assert resp.status_code == 404
