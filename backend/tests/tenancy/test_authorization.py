"""FB-2.1/FB-2.3 — Owner-based authorization semantics.

After E2, roles mean:
  admin    -> PLATFORM operator (admin console, user provisioning)
  viewer   -> a normal user: full CRUD on their own tenant's data
  readonly -> household guest credentials: read-only, still tenant-scoped

Domain write access comes from ownership (tenancy), not from role.
"""


def test_normal_user_full_crud_own_data(client, headers_a):
    """A plain (non-admin) user can create, update and delete their own data."""
    created = client.post("/api/contacts", headers=headers_a, json={
        "name": "My Contact",
        "contact_type": "individual",
        "relationship_type": "borrower",
    })
    assert created.status_code == 200, created.text
    cid = created.json()["id"]

    updated = client.put(f"/api/contacts/{cid}", headers=headers_a,
                         json={"name": "Renamed"})
    assert updated.status_code == 200, updated.text

    deleted = client.delete(f"/api/contacts/{cid}", headers=headers_a)
    assert deleted.status_code == 200, deleted.text


def test_platform_admin_endpoints_denied_to_normal_user(client, headers_a):
    """Normal users must NOT reach platform surfaces."""
    for method, url, payload in [
        ("post", "/api/admin/mark-legacy", None),
        ("post", "/api/auth/register", {
            "username": "sneaky", "email": "s@x.com", "password": "Passw0rd!123",
        }),
    ]:
        resp = getattr(client, method)(url, headers=headers_a,
                                       **({"json": payload} if payload else {}))
        assert resp.status_code == 403, f"{url} → {resp.status_code}: {resp.text}"


def test_readonly_guest_blocked_from_writes(client, readonly_auth_headers):
    resp = client.post("/api/contacts", headers=readonly_auth_headers, json={
        "name": "Nope",
        "contact_type": "individual",
        "relationship_type": "borrower",
    })
    assert resp.status_code == 403


def test_readonly_guest_reads_household_data(client, auth_headers,
                                             readonly_auth_headers):
    """Guests read the household's (owner's) tenant, not an empty one."""
    created = client.post("/api/contacts", headers=auth_headers, json={
        "name": "Household Contact",
        "contact_type": "individual",
        "relationship_type": "borrower",
    })
    assert created.status_code == 200, created.text

    resp = client.get("/api/contacts", headers=readonly_auth_headers)
    assert resp.status_code == 200
    assert [c["name"] for c in resp.json()] == ["Household Contact"]


def test_guest_write_attributed_to_actor_and_household(client, db, admin_user,
                                                       viewer_user,
                                                       viewer_auth_headers):
    """FB-2.3: when someone acts inside a tenant that is not their own, the
    activity log must record BOTH who acted (user_id) and whose books were
    touched (owner_id). Viewer-in-household is today's case; admin
    support-view (E5) will reuse the exact same mechanism."""
    resp = client.post("/api/contacts", headers=viewer_auth_headers, json={
        "name": "Guest Created",
        "contact_type": "individual",
        "relationship_type": "borrower",
    })
    assert resp.status_code == 200, resp.text

    from app.models.activity_log import ActivityLog
    row = (
        db.query(ActivityLog)
        .filter(ActivityLog.entity_type == "contacts",
                ActivityLog.action == "create")
        .order_by(ActivityLog.id.desc())
        .first()
    )
    assert row is not None
    assert row.user_id == viewer_user.id          # who acted
    assert row.owner_id == admin_user.id          # whose tenant was touched
    # and the row itself lives in the household's tenant, so the owner can
    # see it in their activity log while other tenants cannot
