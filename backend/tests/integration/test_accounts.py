"""
Integration tests for /api/accounts/* endpoints.
"""

import pytest


_BASE_ACCOUNT = {
    "name": "Test Savings Account",
    "account_type": "savings",
    "opening_balance": 10000,
}


class TestAccountCreate:
    def test_create_account_returns_200_with_id(self, client, admin_user, auth_headers):
        resp = client.post("/api/accounts", json=_BASE_ACCOUNT, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "id" in body
        assert body["name"] == "Test Savings Account"
        assert body["account_type"] == "savings"

    def test_unauthenticated_create_returns_401(self, client):
        resp = client.post("/api/accounts", json=_BASE_ACCOUNT)
        assert resp.status_code == 401

    def test_create_missing_name_returns_422(self, client, admin_user, auth_headers):
        resp = client.post(
            "/api/accounts",
            json={"account_type": "savings"},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    def test_create_missing_account_type_returns_422(self, client, admin_user, auth_headers):
        resp = client.post(
            "/api/accounts",
            json={"name": "My Account"},
            headers=auth_headers,
        )
        assert resp.status_code == 422


class TestAccountList:
    def test_list_accounts_returns_200(self, client, admin_user, auth_headers):
        resp = client.get("/api/accounts", headers=auth_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_list_includes_created_account(self, client, admin_user, auth_headers):
        client.post("/api/accounts", json=_BASE_ACCOUNT, headers=auth_headers)
        resp = client.get("/api/accounts", headers=auth_headers)
        names = [a["name"] for a in resp.json()]
        assert "Test Savings Account" in names

    def test_unauthenticated_list_returns_401(self, client):
        resp = client.get("/api/accounts")
        assert resp.status_code == 401


class TestAccountDetail:
    def test_get_account_balance(self, client, admin_user, auth_headers):
        create_resp = client.post(
            "/api/accounts",
            json={"name": "Balance Account", "account_type": "cash", "opening_balance": 5000},
            headers=auth_headers,
        )
        account_id = create_resp.json()["id"]

        resp = client.get(f"/api/accounts/{account_id}", headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        # current_balance should reflect opening_balance with no transactions
        assert float(body["current_balance"]) == 5000.0

    def test_get_transactions_empty(self, client, admin_user, auth_headers):
        create_resp = client.post(
            "/api/accounts",
            json={"name": "TXN Account", "account_type": "current", "opening_balance": 0},
            headers=auth_headers,
        )
        account_id = create_resp.json()["id"]

        resp = client.get(f"/api/accounts/{account_id}", headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "transactions" in body
        assert isinstance(body["transactions"], list)
        assert len(body["transactions"]) == 0

    def test_get_nonexistent_account_returns_404(self, client, admin_user, auth_headers):
        resp = client.get("/api/accounts/99999", headers=auth_headers)
        assert resp.status_code == 404
