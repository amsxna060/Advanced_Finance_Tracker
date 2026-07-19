"""Fixtures for tenant isolation tests (FB-1.4).

Two independent tenants, each a normal self-owned user, both exercised
through the real API so the full request → tenancy filter → DB stack is
what's under test.
"""

import pytest
from passlib.context import CryptContext

from app.models.user import User

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _make_user(db, username):
    # role="viewer" — a NORMAL user, not a platform admin. Since FB-2.1,
    # ownership (tenancy), not role, is what grants full CRUD on your own
    # data; running the whole isolation suite as plain users proves it.
    user = User(
        username=username,
        email=f"{username}@test.local",
        password_hash=_pwd.hash("tenantpass123"),
        full_name=username,
        role="viewer",
        is_active=True,
    )
    db.add(user)
    db.flush()
    return user


def _login(client, username):
    resp = client.post(
        "/api/auth/login",
        data={"username": username, "password": "tenantpass123"},
    )
    assert resp.status_code == 200, f"login failed for {username}: {resp.text}"
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.fixture()
def tenant_a(db):
    return _make_user(db, "tenant_alice")


@pytest.fixture()
def tenant_b(db):
    return _make_user(db, "tenant_bob")


@pytest.fixture()
def headers_a(client, tenant_a):
    return _login(client, tenant_a.username)


@pytest.fixture()
def headers_b(client, tenant_b):
    return _login(client, tenant_b.username)


@pytest.fixture()
def seeded_a(client, headers_a):
    """Tenant A's dataset, created through the real API: a contact, an
    account, an expense, an obligation, a loan and a property deal."""
    contact = client.post("/api/contacts", headers=headers_a, json={
        "name": "Alice Borrower",
        "contact_type": "individual",
        "relationship_type": "borrower",
    }).json()

    account = client.post("/api/accounts", headers=headers_a, json={
        "name": "Alice Savings",
        "account_type": "savings",
        "opening_balance": 500000,
    }).json()

    expense = client.post("/api/expenses", headers=headers_a, json={
        "category": "food",
        "amount": 250,
        "expense_date": "2026-07-01",
        "description": "alice lunch",
    }).json()

    obligation = client.post("/api/obligations", headers=headers_a, json={
        "obligation_type": "receivable",
        "contact_id": contact["id"],
        "amount": 12000,
        "reason": "alice obligation",
    }).json()

    loan = client.post("/api/loans", headers=headers_a, json={
        "contact_id": contact["id"],
        "loan_direction": "given",
        "loan_type": "interest_only",
        "principal_amount": 100000,
        "disbursed_date": "2026-04-01",
        "interest_rate": 24,
        "account_id": account["id"],
    }).json()

    prop = client.post("/api/properties", headers=headers_a, json={
        "title": "Alice Plot",
        "property_type": "plot",
        "total_area_sqft": 1000,
        "seller_rate_per_sqft": 500,
    }).json()

    for name, obj in [("contact", contact), ("account", account),
                      ("expense", expense), ("obligation", obligation),
                      ("loan", loan), ("property", prop)]:
        assert "id" in obj, f"seeding {name} failed: {obj}"

    return {
        "contact": contact,
        "account": account,
        "expense": expense,
        "obligation": obligation,
        "loan": loan,
        "property": prop,
    }
