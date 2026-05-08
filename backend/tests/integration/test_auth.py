"""
Integration tests for /api/auth/* endpoints.
"""

import pytest
from passlib.context import CryptContext

from app.models.user import User

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


class TestLogin:
    def test_login_success(self, client, admin_user):
        resp = client.post(
            "/api/auth/login",
            data={"username": admin_user.username, "password": "testpass123"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "access_token" in body
        assert "refresh_token" in body
        assert body["token_type"] == "bearer"

    def test_login_wrong_password(self, client, admin_user):
        resp = client.post(
            "/api/auth/login",
            data={"username": admin_user.username, "password": "wrongpassword"},
        )
        assert resp.status_code == 401

    def test_login_wrong_username(self, client):
        resp = client.post(
            "/api/auth/login",
            data={"username": "nouser", "password": "testpass123"},
        )
        assert resp.status_code == 401

    def test_login_inactive_user(self, client, db):
        """Disabled user gets generic 401 (H-AUTH-5: no username enumeration)."""
        inactive = User(
            username="inactiveuser",
            email="inactive@test.local",
            password_hash=_pwd.hash("somepass123"),
            full_name="Inactive",
            role="viewer",
            is_active=False,
        )
        db.add(inactive)
        db.flush()

        resp = client.post(
            "/api/auth/login",
            data={"username": "inactiveuser", "password": "somepass123"},
        )
        assert resp.status_code == 401

    def test_login_sets_httponly_cookie(self, client, admin_user):
        """C-AUTH-4: Login must set a httpOnly refresh_token cookie."""
        resp = client.post(
            "/api/auth/login",
            data={"username": admin_user.username, "password": "testpass123"},
        )
        assert resp.status_code == 200
        assert "refresh_token" in resp.cookies


class TestRefreshToken:
    def test_refresh_via_cookie_returns_new_access_token(self, client, admin_user):
        """C-AUTH-4: TestClient carries the httpOnly cookie set on login automatically."""
        client.post(
            "/api/auth/login",
            data={"username": admin_user.username, "password": "testpass123"},
        )
        # No body — cookie is forwarded automatically by TestClient
        resp = client.post("/api/auth/refresh")
        assert resp.status_code == 200
        assert "access_token" in resp.json()
        assert resp.json()["token_type"] == "bearer"

    def test_refresh_rotates_cookie(self, client, admin_user):
        """C-AUTH-4: Each refresh issues a new cookie, so consecutive refreshes work."""
        client.post(
            "/api/auth/login",
            data={"username": admin_user.username, "password": "testpass123"},
        )
        first = client.post("/api/auth/refresh")
        assert first.status_code == 200
        # Cookie was rotated — second call should also succeed using the new cookie
        second = client.post("/api/auth/refresh")
        assert second.status_code == 200

    def test_refresh_blacklisted_token_rejected(self, client, admin_user):
        """C-AUTH-2: After logout the refresh token is blacklisted and must be rejected."""
        login = client.post(
            "/api/auth/login",
            data={"username": admin_user.username, "password": "testpass123"},
        )
        access_token = login.json()["access_token"]
        old_token = login.json()["refresh_token"]
        # Logout blacklists the cookie token (= old_token) and clears the cookie
        client.post("/api/auth/logout", headers={"Authorization": f"Bearer {access_token}"})
        # Body-only request with the now-blacklisted token must fail
        resp = client.post("/api/auth/refresh", json={"refresh_token": old_token})
        assert resp.status_code == 401

    def test_refresh_invalid_token(self, client):
        resp = client.post("/api/auth/refresh", json={"refresh_token": "garbage.token.here"})
        assert resp.status_code == 401

    def test_refresh_no_token_rejected(self, client):
        """Calling /refresh with no cookie and no body must return 401."""
        resp = client.post("/api/auth/refresh")
        assert resp.status_code == 401



class TestGetMe:
    def test_get_me_authenticated(self, client, admin_user, auth_headers):
        resp = client.get("/api/auth/me", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["username"] == admin_user.username

    def test_get_me_unauthenticated(self, client):
        resp = client.get("/api/auth/me")
        assert resp.status_code == 401


class TestRegister:
    def test_register_as_admin_creates_user(self, client, auth_headers):
        payload = {
            "username": "newuser",
            "email": "newuser@example.com",
            "password": "newpass123",
            "full_name": "New User",
            "role": "viewer",
        }
        resp = client.post("/api/auth/register", json=payload, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["username"] == "newuser"

    def test_register_as_non_admin_forbidden(self, client, viewer_user, viewer_auth_headers):
        payload = {
            "username": "anotheruser",
            "email": "anotheruser@example.com",
            "password": "pass123456",
            "full_name": "Another",
            "role": "viewer",
        }
        resp = client.post("/api/auth/register", json=payload, headers=viewer_auth_headers)
        assert resp.status_code == 403

    def test_create_readonly_user_as_admin(self, client, auth_headers):
        resp = client.post(
            "/api/auth/create-readonly",
            json={"username": "myreadonly", "password": "readonly123", "full_name": "Readonly Person"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["role"] == "readonly"


class TestLogout:
    def test_logout_succeeds_with_valid_token(self, client, admin_user):
        """C-AUTH-2: Logout blacklists the refresh token and clears the cookie."""
        login = client.post(
            "/api/auth/login",
            data={"username": admin_user.username, "password": "testpass123"},
        )
        access_token = login.json()["access_token"]
        resp = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {access_token}"})
        assert resp.status_code == 200
        assert resp.json()["message"] == "Logged out successfully"

    def test_logout_blacklists_refresh_token(self, client, admin_user):
        """After logout the refresh token stored in cookie must be rejected."""
        login = client.post(
            "/api/auth/login",
            data={"username": admin_user.username, "password": "testpass123"},
        )
        access_token = login.json()["access_token"]
        refresh_token = login.json()["refresh_token"]
        client.post("/api/auth/logout", headers={"Authorization": f"Bearer {access_token}"})
        # Cookie is now cleared; use the old token via body — must be rejected
        resp = client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
        assert resp.status_code == 401

    def test_logout_requires_authentication(self, client):
        """Calling /logout without a valid access token should return 401."""
        resp = client.post("/api/auth/logout")
        assert resp.status_code == 401


class TestCsrfToken:
    def test_csrf_token_endpoint_returns_token(self, client):
        """H-SEC-2: GET /csrf-token returns a token and sets a readable cookie."""
        resp = client.get("/api/auth/csrf-token")
        assert resp.status_code == 200
        body = resp.json()
        assert "csrf_token" in body
        assert len(body["csrf_token"]) == 64  # secrets.token_hex(32) → 64 hex chars

    def test_csrf_token_cookie_is_set(self, client):
        """The csrf_token cookie must be present in the response."""
        resp = client.get("/api/auth/csrf-token")
        assert "csrf_token" in resp.cookies


class TestReadonlyEnforcement:
    def test_readonly_user_blocked_on_write(self, client, readonly_user, readonly_auth_headers):
        """readonly token on POST /api/contacts → 403."""
        payload = {
            "name": "SomeContact",
            "contact_type": "individual",
            "relationship_type": "borrower",
        }
        resp = client.post("/api/contacts", json=payload, headers=readonly_auth_headers)
        assert resp.status_code == 403

    def test_readonly_user_allowed_on_read(self, client, readonly_user, readonly_auth_headers):
        """readonly token on GET /api/contacts → 200."""
        resp = client.get("/api/contacts", headers=readonly_auth_headers)
        assert resp.status_code == 200
