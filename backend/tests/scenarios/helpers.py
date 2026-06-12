"""Shared builders for scenario tests. Everything goes through the real API
so the full request → router → service → DB stack is exercised."""

from datetime import date
from dateutil.relativedelta import relativedelta


def months_ago(n: int, day: int | None = None) -> str:
    d = date.today() - relativedelta(months=n)
    if day:
        d = d.replace(day=day)
    return d.isoformat()


def days_from_today(n: int) -> str:
    from datetime import timedelta
    return (date.today() + timedelta(days=n)).isoformat()


def make_account(client, headers, name="Scenario Account", account_type="savings",
                 opening_balance=0, **extra) -> dict:
    resp = client.post("/api/accounts", headers=headers, json={
        "name": name, "account_type": account_type,
        "opening_balance": opening_balance, **extra,
    })
    assert resp.status_code == 200, resp.text
    return resp.json()


def account_balance(client, headers, account_id) -> float:
    resp = client.get(f"/api/accounts/{account_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    return float(resp.json()["current_balance"])


def account_txns(client, headers, account_id, include_voided=False) -> list:
    resp = client.get(
        f"/api/accounts/{account_id}/transactions",
        headers=headers, params={"include_voided": include_voided},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def make_contact(db, name="Scenario Contact", relationship_type="borrower"):
    from app.models.contact import Contact
    c = Contact(name=name, phone=None, contact_type="individual",
                relationship_type=relationship_type)
    db.add(c)
    db.flush()
    return c


def make_loan(client, headers, contact_id, **overrides) -> dict:
    payload = {
        "contact_id": contact_id,
        "loan_direction": "given",
        "loan_type": "interest_only",
        "principal_amount": 100000,
        "disbursed_date": months_ago(3),
        "interest_rate": 24,
    }
    payload.update(overrides)
    resp = client.post("/api/loans", headers=headers, json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()


def pay_loan(client, headers, loan_id, amount, payment_date=None, **extra) -> dict:
    resp = client.post(f"/api/loans/{loan_id}/payments", headers=headers, json={
        "amount_paid": amount,
        "payment_date": payment_date or date.today().isoformat(),
        **extra,
    })
    assert resp.status_code == 200, resp.text
    return resp.json()


def loan_detail(client, headers, loan_id) -> dict:
    resp = client.get(f"/api/loans/{loan_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def make_property(client, headers, **overrides) -> dict:
    payload = {
        "title": "Scenario Plot",
        "property_type": "plot",
        "total_area_sqft": 1000,
        "seller_rate_per_sqft": 500,
    }
    payload.update(overrides)
    resp = client.post("/api/properties", headers=headers, json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()


def make_partnership(client, headers, property_id=None, **overrides) -> dict:
    payload = {"title": "Scenario Partnership"}
    if property_id:
        payload["linked_property_deal_id"] = property_id
    payload.update(overrides)
    resp = client.post("/api/partnerships", headers=headers, json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()


def add_member(client, headers, partnership_id, share, is_self=False, contact_id=None) -> dict:
    resp = client.post(f"/api/partnerships/{partnership_id}/members", headers=headers, json={
        "is_self": is_self, "contact_id": contact_id, "share_percentage": share,
    })
    assert resp.status_code == 200, resp.text
    return resp.json()


def add_partnership_txn(client, headers, partnership_id, txn_type, amount, **extra) -> dict:
    payload = {
        "txn_type": txn_type,
        "amount": amount,
        "txn_date": extra.pop("txn_date", date.today().isoformat()),
        **extra,
    }
    resp = client.post(f"/api/partnerships/{partnership_id}/transactions",
                       headers=headers, json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()
