"""
conftest.py — shared fixtures for all tests.

IMPORTANT: env vars MUST be set before any app imports so that
app.config.Settings() picks them up at module load time.
"""

import os

# Set test environment variables before importing any app module
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_finance_tracker.db")
os.environ.setdefault("SECRET_KEY", "test-secret-key-min-32-chars-for-jwt!!")
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("GEMINI_API_KEY", "")
os.environ.setdefault("SEED_ADMIN_USERNAME", "admin")
os.environ.setdefault("SEED_ADMIN_PASSWORD", "admin123")
os.environ.setdefault("SEED_ADMIN_EMAIL", "admin@test.local")
os.environ.setdefault("SIGNUP_ENABLED", "true")  # default flipped to False for prod safety

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from passlib.context import CryptContext
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Now safe to import app modules
from app.database import Base, get_db
from app.main import app as fastapi_app
from app.models.user import User

# Alias for convenience — all fixtures reference fastapi_app
app = fastapi_app

# ---------------------------------------------------------------------------
# Test database — SQLite in-memory-style (file so FK pragma applies)
# ---------------------------------------------------------------------------

TEST_DATABASE_URL = os.environ["DATABASE_URL"]

test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
)

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

# Import all models so Base.metadata is fully populated before create_all
import app.models as _app_models  # noqa: F401, E402

# Create all tables once for the entire test session
Base.metadata.create_all(bind=test_engine)


# ---------------------------------------------------------------------------
# Rate-limiter patch — auth /login is limited to 10/min; disable for tests
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True, scope="session")
def disable_rate_limiter():
    """
    Completely neutralise slowapi for tests.

    slowapi's sync_wrapper (used by @limiter.limit("10/minute")) calls
    _check_request_limit (which sets request.state.view_rate_limit) and then
    reads that attribute to inject response headers.

    Patching only _check_request_limit with a noop leaves view_rate_limit
    unset → AttributeError.  We therefore also patch _inject_headers to be
    a noop AND ensure _check_request_limit sets the required state attribute
    before returning.
    """
    def _noop_check(self, request, *args, **kwargs):
        # slowapi sets this inside the real _check_request_limit; we must
        # replicate it so sync_wrapper can read it without AttributeError.
        request.state.view_rate_limit = None

    def _noop_inject(*args, **kwargs):
        return None

    with patch("slowapi.Limiter._check_request_limit", _noop_check), \
         patch("slowapi.Limiter._inject_headers", _noop_inject):
        yield


# ---------------------------------------------------------------------------
# DB fixture — each test gets a transaction that is rolled back on teardown
# ---------------------------------------------------------------------------

@pytest.fixture(scope="function")
def db():
    """
    Provide a clean DB session per test, rolled back after the test so
    tests remain isolated without dropping/recreating tables each time.
    """
    connection = test_engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


# ---------------------------------------------------------------------------
# TestClient — do NOT use the context manager so startup events are skipped
# ---------------------------------------------------------------------------

@pytest.fixture(scope="function")
def client(db):
    """
    Return a TestClient with the real DB dependency overridden to use the
    test session. startup/shutdown events are skipped (no context-manager).
    """

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    # Patch scheduler to prevent background threads in tests
    with patch("app.services.scheduler.start_scheduler"), \
         patch("app.services.scheduler.stop_scheduler"):
        yield TestClient(app)

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Admin user fixture — created within the test-scoped db session
# ---------------------------------------------------------------------------

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


@pytest.fixture(scope="function")
def admin_user(db):
    """Create and return an admin User within the test transaction."""
    user = User(
        username="testadmin",
        email="testadmin@test.local",
        password_hash=_pwd_context.hash("testpass123"),
        full_name="Test Admin",
        role="admin",
        is_active=True,
    )
    db.add(user)
    db.flush()
    return user


@pytest.fixture(scope="function")
def viewer_user(db, admin_user):
    """Viewer User — a household guest inside the admin's tenant."""
    user = User(
        username="testviewer",
        email="testviewer@test.local",
        password_hash=_pwd_context.hash("viewerpass123"),
        full_name="Test Viewer",
        role="viewer",
        is_active=True,
        tenant_owner_id=admin_user.id,
    )
    db.add(user)
    db.flush()
    return user


@pytest.fixture(scope="function")
def readonly_user(db, admin_user):
    """Readonly User — a household guest inside the admin's tenant."""
    user = User(
        username="testreadonly",
        email="testreadonly@test.local",
        password_hash=_pwd_context.hash("readonlypass123"),
        full_name="Test Readonly",
        role="readonly",
        is_active=True,
        tenant_owner_id=admin_user.id,
    )
    db.add(user)
    db.flush()
    return user


# ---------------------------------------------------------------------------
# Auth token helpers
# ---------------------------------------------------------------------------

@pytest.fixture(scope="function")
def auth_headers(client, admin_user):
    """Log in as admin and return Authorization headers."""
    resp = client.post(
        "/api/auth/login",
        data={"username": admin_user.username, "password": "testpass123"},
    )
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="function")
def viewer_auth_headers(client, viewer_user):
    """Log in as viewer and return Authorization headers."""
    resp = client.post(
        "/api/auth/login",
        data={"username": viewer_user.username, "password": "viewerpass123"},
    )
    assert resp.status_code == 200, f"Viewer login failed: {resp.text}"
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="function")
def readonly_auth_headers(client, readonly_user):
    """Log in as readonly and return Authorization headers."""
    resp = client.post(
        "/api/auth/login",
        data={"username": readonly_user.username, "password": "readonlypass123"},
    )
    assert resp.status_code == 200, f"Readonly login failed: {resp.text}"
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Convenience fixtures for common resource creation
# ---------------------------------------------------------------------------

@pytest.fixture(scope="function")
def sample_contact(db, admin_user):
    """Create a sample contact within the test transaction."""
    from app.models.contact import Contact

    contact = Contact(
        name="Test Borrower",
        phone="9876543210",
        city="Mumbai",
        contact_type="individual",
        relationship_type="borrower",
        owner_id=admin_user.id,
    )
    db.add(contact)
    db.flush()
    return contact
