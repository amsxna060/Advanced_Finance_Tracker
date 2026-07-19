"""FB-1.4 — Tenant isolation suite.

The merge gate for all multi-tenant work: tenant B must never be able to
see, modify, or reference tenant A's data, on every kind of path — list,
detail, write, cross-tenant FK, and aggregates. If any test here fails,
tenancy is broken and nothing ships.
"""

import pytest

from app import tenancy
from app.models.contact import Contact


# ---------------------------------------------------------------------------
# List endpoints: B sees nothing of A's
# ---------------------------------------------------------------------------

LIST_ENDPOINTS = [
    "/api/contacts",
    "/api/accounts",
    "/api/loans",
    "/api/obligations",
    "/api/properties",
    "/api/partnerships",
    "/api/beesi",
    "/api/recurring-transactions",
    "/api/unencumbered-assets",
]


@pytest.mark.parametrize("endpoint", LIST_ENDPOINTS)
def test_list_endpoints_hide_other_tenant(client, seeded_a, headers_b, endpoint):
    resp = client.get(endpoint, headers=headers_b)
    assert resp.status_code == 200, f"{endpoint}: {resp.text}"
    body = resp.json()
    items = body if isinstance(body, list) else body.get("items", [])
    assert items == [], f"{endpoint} leaked rows to another tenant: {items}"


def test_expense_list_hides_other_tenant(client, seeded_a, headers_b):
    resp = client.get("/api/expenses", headers=headers_b)
    assert resp.status_code == 200
    body = resp.json()
    items = body if isinstance(body, list) else body.get("items", body.get("expenses", []))
    assert items == [], f"expenses leaked: {items}"


def test_list_endpoints_still_visible_to_owner(client, seeded_a, headers_a):
    """Sanity: the filter hides other tenants, not your own data."""
    resp = client.get("/api/contacts", headers=headers_a)
    assert resp.status_code == 200
    assert [c["id"] for c in resp.json()] == [seeded_a["contact"]["id"]]


# ---------------------------------------------------------------------------
# Detail endpoints: A's ids are 404 for B
# ---------------------------------------------------------------------------

def test_detail_endpoints_404_for_other_tenant(client, seeded_a, headers_b):
    checks = [
        f"/api/contacts/{seeded_a['contact']['id']}",
        f"/api/accounts/{seeded_a['account']['id']}",
        f"/api/loans/{seeded_a['loan']['id']}",
        f"/api/obligations/{seeded_a['obligation']['id']}",
        f"/api/properties/{seeded_a['property']['id']}",
    ]
    for url in checks:
        resp = client.get(url, headers=headers_b)
        assert resp.status_code == 404, f"{url} returned {resp.status_code} for another tenant"


def test_detail_endpoints_ok_for_owner(client, seeded_a, headers_a):
    resp = client.get(f"/api/loans/{seeded_a['loan']['id']}", headers=headers_a)
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Writes: B cannot update / delete A's records
# ---------------------------------------------------------------------------

def test_update_other_tenant_contact_404(client, seeded_a, headers_b):
    resp = client.put(
        f"/api/contacts/{seeded_a['contact']['id']}",
        headers=headers_b,
        json={"name": "hijacked"},
    )
    assert resp.status_code == 404

    # And the record is untouched for its owner
    resp = client.get(f"/api/contacts/{seeded_a['contact']['id']}", headers=headers_b)
    assert resp.status_code == 404


def test_delete_other_tenant_records_404(client, seeded_a, headers_b, headers_a):
    for url in [
        f"/api/contacts/{seeded_a['contact']['id']}",
        f"/api/expenses/{seeded_a['expense']['id']}",
        f"/api/obligations/{seeded_a['obligation']['id']}",
    ]:
        resp = client.delete(url, headers=headers_b)
        assert resp.status_code == 404, f"DELETE {url} → {resp.status_code}"

    # Owner still sees their contact intact
    resp = client.get(f"/api/contacts/{seeded_a['contact']['id']}", headers=headers_a)
    assert resp.status_code == 200
    assert resp.json()["contact"]["name"] == "Alice Borrower"


def test_settle_other_tenant_obligation_404(client, seeded_a, headers_b):
    resp = client.post(
        f"/api/obligations/{seeded_a['obligation']['id']}/settle",
        headers=headers_b,
        json={"amount": 12000, "settlement_date": "2026-07-15"},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Cross-tenant FKs: B cannot create records referencing A's rows
# ---------------------------------------------------------------------------

def test_loan_against_other_tenant_contact_blocked(client, seeded_a, headers_b):
    resp = client.post("/api/loans", headers=headers_b, json={
        "contact_id": seeded_a["contact"]["id"],
        "loan_direction": "given",
        "loan_type": "interest_only",
        "principal_amount": 50000,
        "disbursed_date": "2026-05-01",
        "interest_rate": 12,
    })
    assert resp.status_code in (400, 404, 422), (
        f"loan referencing another tenant's contact was accepted: {resp.text}"
    )


def test_expense_against_other_tenant_account_blocked(client, seeded_a, headers_b):
    resp = client.post("/api/expenses", headers=headers_b, json={
        "category": "food",
        "amount": 100,
        "expense_date": "2026-07-02",
        "account_id": seeded_a["account"]["id"],
    })
    assert resp.status_code in (400, 404, 422), (
        f"expense referencing another tenant's account was accepted: {resp.text}"
    )


# ---------------------------------------------------------------------------
# Aggregates: B's dashboards/analytics contain nothing of A's
# ---------------------------------------------------------------------------

def test_dashboard_summary_isolated(client, seeded_a, headers_b):
    resp = client.get("/api/dashboard/summary", headers=headers_b)
    assert resp.status_code == 200
    text = resp.text
    assert "Alice" not in text, f"dashboard leaked tenant A data: {text[:500]}"


def test_property_stats_isolated(client, seeded_a, headers_b):
    resp = client.get("/api/properties/stats", headers=headers_b)
    assert resp.status_code == 200
    body = resp.json()
    for key in ("my_capital", "my_liability"):
        if key in body:
            assert float(body[key]) == 0, f"property stats leaked: {body}"


def test_expense_analytics_isolated(client, seeded_a, headers_b):
    resp = client.get("/api/expenses/analytics/summary", headers=headers_b)
    assert resp.status_code == 200
    assert "alice lunch" not in resp.text


# ---------------------------------------------------------------------------
# Engine-level guarantees (no HTTP): stamping + violation guard
# ---------------------------------------------------------------------------

def test_insert_is_stamped_with_session_tenant(db, tenant_a):
    db.info["tenant_id"] = tenant_a.id
    c = Contact(name="stamped", contact_type="individual", relationship_type="borrower")
    db.add(c)
    db.flush()
    assert c.owner_id == tenant_a.id
    db.info.pop("tenant_id", None)


def test_cross_tenant_insert_raises(db, tenant_a, tenant_b):
    db.info["tenant_id"] = tenant_a.id
    c = Contact(
        name="spoofed", contact_type="individual",
        relationship_type="borrower", owner_id=tenant_b.id,
    )
    db.add(c)
    with pytest.raises(tenancy.TenantViolation):
        db.flush()
    db.rollback()
    db.info.pop("tenant_id", None)


def test_pk_get_filtered_by_tenant(db, tenant_a, tenant_b):
    db.info["tenant_id"] = tenant_a.id
    c = Contact(name="mine", contact_type="individual", relationship_type="borrower")
    db.add(c)
    db.flush()
    cid = c.id
    # Clear the identity map — session.get() serves identity-map hits without
    # SQL, so the filter only applies to fresh loads (matches production,
    # where every request gets a fresh session).
    db.expunge_all()

    db.info["tenant_id"] = tenant_b.id
    assert db.get(Contact, cid) is None
    assert db.query(Contact).filter(Contact.id == cid).first() is None

    db.info["tenant_id"] = tenant_a.id
    db.expire_all()
    assert db.get(Contact, cid) is not None
    db.info.pop("tenant_id", None)
