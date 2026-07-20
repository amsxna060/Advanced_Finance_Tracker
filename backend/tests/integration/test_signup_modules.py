"""FB-3.1/3.2/3.3 — public signup, email verification, module entitlements."""

from app.modules import CORE_MODULE_KEYS, DEFAULT_SIGNUP_MODULES


def _signup(client, username="newuser", email="newuser@example.com",
            password="Str0ngPass1", **extra):
    return client.post("/api/auth/signup", json={
        "username": username,
        "email": email,
        "password": password,
        "full_name": "New User",
        **extra,
    })


def _login(client, username, password):
    return client.post("/api/auth/login",
                       data={"username": username, "password": password})


# ---------------------------------------------------------------------------
# Signup
# ---------------------------------------------------------------------------

class TestSignup:
    def test_signup_creates_normal_user_with_default_modules(self, client):
        resp = _signup(client)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["role"] == "viewer"
        assert body["email_verified"] is False
        assert body["enabled_modules"] == DEFAULT_SIGNUP_MODULES
        assert CORE_MODULE_KEYS <= set(body["enabled_modules"])

    def test_signup_then_login(self, client):
        _signup(client)
        resp = _login(client, "newuser", "Str0ngPass1")
        assert resp.status_code == 200, resp.text
        assert "access_token" in resp.json()

    def test_duplicate_email_rejected(self, client):
        assert _signup(client).status_code == 201
        resp = _signup(client, username="otheruser")
        assert resp.status_code == 400

    def test_weak_password_rejected(self, client):
        for bad in ["short1A", "alllettersonly", "12345678901"]:
            resp = _signup(client, password=bad, username="pwuser",
                           email="pw@example.com")
            assert resp.status_code == 422, f"{bad!r} accepted: {resp.text}"

    def test_role_cannot_be_injected(self, client):
        resp = _signup(client, role="admin")
        assert resp.status_code == 201
        assert resp.json()["role"] == "viewer"

    def test_signup_disabled_flag(self, client, monkeypatch):
        from app.config import settings
        monkeypatch.setattr(settings, "SIGNUP_ENABLED", False)
        assert _signup(client).status_code == 403


# ---------------------------------------------------------------------------
# Email verification
# ---------------------------------------------------------------------------

class TestEmailVerification:
    def test_verify_email_with_token(self, client, db):
        _signup(client)
        from app.models.user import User
        from app.routers.auth import _create_email_verify_token
        user = db.query(User).filter(User.username == "newuser").first()
        token = _create_email_verify_token(user.id)

        resp = client.post("/api/auth/verify-email", json={"token": token})
        assert resp.status_code == 200, resp.text
        db.refresh(user)
        assert user.email_verified is True

    def test_garbage_token_rejected(self, client):
        resp = client.post("/api/auth/verify-email", json={"token": "junk"})
        assert resp.status_code == 400

    def test_access_token_not_accepted_as_verify_token(self, client, db):
        """Token-type confusion guard: a stolen access token must not verify."""
        _signup(client)
        from app.models.user import User
        from app.routers.auth import create_access_token
        user = db.query(User).filter(User.username == "newuser").first()
        resp = client.post("/api/auth/verify-email",
                           json={"token": create_access_token(user.id)})
        assert resp.status_code == 400

    def test_unverified_login_blocked_when_required(self, client, monkeypatch):
        from app.config import settings
        _signup(client)
        monkeypatch.setattr(settings, "REQUIRE_EMAIL_VERIFICATION", True)
        resp = _login(client, "newuser", "Str0ngPass1")
        assert resp.status_code == 403
        assert resp.json()["detail"] == "email_not_verified"

    def test_resend_never_reveals_account_existence(self, client):
        r1 = client.post("/api/auth/resend-verification",
                         json={"email": "nobody@example.com"})
        _signup(client)
        r2 = client.post("/api/auth/resend-verification",
                         json={"email": "newuser@example.com"})
        assert r1.status_code == r2.status_code == 200
        assert r1.json() == r2.json()


# ---------------------------------------------------------------------------
# Module entitlements
# ---------------------------------------------------------------------------

def _auth_headers_for(client, username, password):
    token = _login(client, username, password).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestModuleEntitlements:
    def test_me_exposes_effective_modules(self, client, auth_headers):
        """Legacy accounts (enabled_modules NULL) see every module."""
        from app.modules import ALL_MODULE_KEYS
        me = client.get("/api/auth/me", headers=auth_headers).json()
        assert set(me["enabled_modules"]) == ALL_MODULE_KEYS

    def test_disabled_module_router_403(self, client):
        _signup(client)   # default modules exclude "loans"
        headers = _auth_headers_for(client, "newuser", "Str0ngPass1")
        resp = client.get("/api/loans", headers=headers)
        assert resp.status_code == 403
        assert resp.json()["detail"] == "module_disabled"

    def test_enabling_module_opens_router(self, client):
        _signup(client)
        headers = _auth_headers_for(client, "newuser", "Str0ngPass1")
        resp = client.put("/api/auth/me/modules", headers=headers,
                          json={"modules": DEFAULT_SIGNUP_MODULES + ["loans"]})
        assert resp.status_code == 200, resp.text
        assert "loans" in resp.json()["enabled_modules"]
        assert client.get("/api/loans", headers=headers).status_code == 200

    def test_core_modules_cannot_be_dropped(self, client):
        _signup(client)
        headers = _auth_headers_for(client, "newuser", "Str0ngPass1")
        resp = client.put("/api/auth/me/modules", headers=headers,
                          json={"modules": ["loans"]})  # tries to drop core
        assert resp.status_code == 200
        assert CORE_MODULE_KEYS <= set(resp.json()["enabled_modules"])

    def test_unknown_module_rejected(self, client):
        _signup(client)
        headers = _auth_headers_for(client, "newuser", "Str0ngPass1")
        resp = client.put("/api/auth/me/modules", headers=headers,
                          json={"modules": ["crypto_trading"]})
        assert resp.status_code == 422

    def test_core_module_router_always_open(self, client):
        _signup(client)
        headers = _auth_headers_for(client, "newuser", "Str0ngPass1")
        assert client.get("/api/contacts", headers=headers).status_code == 200

    def test_guest_cannot_change_household_modules(self, client, admin_user,
                                                   viewer_auth_headers):
        resp = client.put("/api/auth/me/modules", headers=viewer_auth_headers,
                          json={"modules": ["loans"]})
        assert resp.status_code == 403
