"""
Integration tests for /api/expenses/* endpoints.
"""

import pytest


_BASE_EXPENSE = {
    "amount": 500,
    "expense_date": "2024-03-15",
    "category": "Food",
    "description": "Lunch at restaurant",
    "payment_mode": "cash",
}


class TestExpenseCreate:
    def test_create_expense_returns_200(self, client, admin_user, auth_headers):
        resp = client.post("/api/expenses", json=_BASE_EXPENSE, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "id" in body
        assert float(body["amount"]) == 500.0

    def test_unauthenticated_create_returns_401(self, client):
        resp = client.post("/api/expenses", json=_BASE_EXPENSE)
        assert resp.status_code == 401


class TestExpenseList:
    def test_list_expenses_returns_200(self, client, admin_user, auth_headers):
        resp = client.get("/api/expenses", headers=auth_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_list_includes_created_expense(self, client, admin_user, auth_headers):
        client.post(
            "/api/expenses",
            json={**_BASE_EXPENSE, "description": "Unique lunch description"},
            headers=auth_headers,
        )
        resp = client.get("/api/expenses", headers=auth_headers)
        assert resp.status_code == 200
        descriptions = [e.get("description") for e in resp.json()]
        assert "Unique lunch description" in descriptions

    def test_filter_by_category(self, client, admin_user, auth_headers):
        client.post(
            "/api/expenses",
            json={**_BASE_EXPENSE, "category": "Transport", "description": "Cab fare"},
            headers=auth_headers,
        )
        client.post(
            "/api/expenses",
            json={**_BASE_EXPENSE, "category": "Food", "description": "Dinner"},
            headers=auth_headers,
        )

        resp = client.get("/api/expenses?category=Transport", headers=auth_headers)
        assert resp.status_code == 200
        for expense in resp.json():
            assert expense["category"] == "Transport"

    def test_unauthenticated_list_returns_401(self, client):
        resp = client.get("/api/expenses")
        assert resp.status_code == 401


class TestExpenseUpdate:
    def test_update_expense_amount(self, client, admin_user, auth_headers):
        create_resp = client.post("/api/expenses", json=_BASE_EXPENSE, headers=auth_headers)
        expense_id = create_resp.json()["id"]

        update_resp = client.put(
            f"/api/expenses/{expense_id}",
            json={"amount": 750},
            headers=auth_headers,
        )
        assert update_resp.status_code == 200
        assert float(update_resp.json()["amount"]) == 750.0


class TestExpenseDelete:
    def test_delete_expense(self, client, admin_user, auth_headers):
        create_resp = client.post("/api/expenses", json=_BASE_EXPENSE, headers=auth_headers)
        expense_id = create_resp.json()["id"]

        del_resp = client.delete(f"/api/expenses/{expense_id}", headers=auth_headers)
        assert del_resp.status_code in (200, 204)
