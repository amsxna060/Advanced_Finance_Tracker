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


class TestExpenseSearch:
    """F2: search must be server-side so it covers all pages, not just the loaded one."""

    def test_search_matches_description_across_pagination(self, client, admin_user, auth_headers):
        # Create a uniquely searchable expense plus filler rows that would push
        # it off page 1 of a paginated listing.
        client.post(
            "/api/expenses",
            json={**_BASE_EXPENSE, "description": "petrol pump zx9"},
            headers=auth_headers,
        )
        for i in range(5):
            client.post(
                "/api/expenses",
                json={**_BASE_EXPENSE, "description": f"filler row {i}"},
                headers=auth_headers,
            )

        resp = client.get(
            "/api/expenses",
            params={"paginated": True, "limit": 2, "skip": 0, "search": "petrol pump zx9"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["description"] == "petrol pump zx9"

    def test_search_matches_amount(self, client, admin_user, auth_headers):
        client.post(
            "/api/expenses",
            json={**_BASE_EXPENSE, "amount": 4321.55, "description": "odd amount row"},
            headers=auth_headers,
        )
        resp = client.get(
            "/api/expenses",
            params={"search": "4321.55"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        descriptions = [e["description"] for e in resp.json()]
        assert "odd amount row" in descriptions

    def test_search_excludes_deleted(self, client, admin_user, auth_headers):
        create = client.post(
            "/api/expenses",
            json={**_BASE_EXPENSE, "description": "ghost row qq7"},
            headers=auth_headers,
        )
        client.delete(f"/api/expenses/{create.json()['id']}", headers=auth_headers)
        resp = client.get("/api/expenses", params={"search": "ghost row qq7"}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []


class TestBudgetVsActualDeletedExpenses:
    """F3: category budgets must not count soft-deleted expenses."""

    def test_deleted_expense_not_counted_in_budget(self, client, admin_user, auth_headers):
        month = "2031-01"
        client.post(
            "/api/category-limits",
            json={"category": "BudgetCatF3", "monthly_limit": 1000},
            headers=auth_headers,
        )
        keep = client.post(
            "/api/expenses",
            json={**_BASE_EXPENSE, "category": "BudgetCatF3", "amount": 200,
                  "expense_date": "2031-01-10"},
            headers=auth_headers,
        )
        doomed = client.post(
            "/api/expenses",
            json={**_BASE_EXPENSE, "category": "BudgetCatF3", "amount": 900,
                  "expense_date": "2031-01-11"},
            headers=auth_headers,
        )
        client.delete(f"/api/expenses/{doomed.json()['id']}", headers=auth_headers)

        resp = client.get(
            "/api/category-limits/budget-vs-actual",
            params={"month": month},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        row = next(c for c in resp.json()["categories"] if c["category"] == "BudgetCatF3")
        # Only the surviving 200 should count — not the deleted 900 (which
        # would falsely show the category as over budget).
        assert float(row["actual"]) == 200.0

    def test_deleted_expense_not_counted_in_rollover(self, client, admin_user, auth_headers):
        client.post(
            "/api/category-limits",
            json={"category": "RollCatF3", "monthly_limit": 1000, "rollover_enabled": True},
            headers=auth_headers,
        )
        doomed = client.post(
            "/api/expenses",
            json={**_BASE_EXPENSE, "category": "RollCatF3", "amount": 800,
                  "expense_date": "2031-03-05"},
            headers=auth_headers,
        )
        client.delete(f"/api/expenses/{doomed.json()['id']}", headers=auth_headers)

        resp = client.get(
            "/api/category-limits/rollover-preview",
            params={"month": "2031-04"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        row = next(i for i in resp.json()["rollover_items"] if i["category"] == "RollCatF3")
        # The deleted 800 must not shrink the carried surplus.
        assert row["prev_month_spent"] == 0.0
        assert row["surplus_carried"] == 1000.0


class TestCategoryTreeInactiveParent:
    """F8: a sub-category must not vanish from the tree when its parent is deactivated."""

    def test_child_of_inactive_parent_still_in_tree(self, client, admin_user, auth_headers, db):
        parent = client.post(
            "/api/categories",
            json={"name": "ParentF8"},
            headers=auth_headers,
        ).json()
        child = client.post(
            "/api/categories",
            json={"name": "ChildF8", "parent_id": parent["id"]},
            headers=auth_headers,
        ).json()

        # Deactivate the parent directly (simulates a deactivated category)
        from app.models.category import Category
        db.query(Category).filter(Category.id == parent["id"]).update({"is_active": False})
        db.commit()

        resp = client.get("/api/categories", params={"tree": True}, headers=auth_headers)
        assert resp.status_code == 200

        def collect_ids(nodes):
            out = []
            for n in nodes:
                out.append(n["id"])
                out.extend(collect_ids(n.get("children", [])))
            return out

        ids = collect_ids(resp.json())
        assert child["id"] in ids, "active sub-category disappeared from the tree"
        assert parent["id"] not in ids
