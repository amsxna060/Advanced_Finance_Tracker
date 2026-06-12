from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from jose import JWTError, jwt
import time
import logging
import secrets
import hmac
import hashlib

logger = logging.getLogger(__name__)

from app.config import settings
from app.database import get_db, engine, Base
from app.models.user import User

# Import ALL models so Base.metadata has every table before create_all
import app.models  # noqa: F401 — registers Contact, Loan, Collateral, Property, Partnership, Expense, Beesi, CashAccount

# Import routers
from app.routers import auth, contacts, loans, collateral, property_deals, partnerships, expenses, dashboard, reports
from app.routers import beesi, accounts, analytics, obligations, category_limits, categories, admin, chatbot, forecast
from app.routers import recurring_transactions as recurring_router
from app.routers import unencumbered_assets as unencumbered_router

# Scheduler
from app.services.scheduler import start_scheduler, stop_scheduler

# Rate limiter — keyed by remote IP
# M-SEC-4: use 60/minute (was 200/minute) to limit abuse potential
limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])

# #8 (FIX): Hide the interactive docs / OpenAPI schema in production so the
# full API surface isn't advertised publicly. Still available in dev/staging.
_DOCS_ENABLED = settings.APP_ENV != "production"

app = FastAPI(
    title="Advanced Finance Tracker",
    description="Personal finance management for money lending and property deals",
    version="0.1.0",
    docs_url="/docs" if _DOCS_ENABLED else None,
    redoc_url="/redoc" if _DOCS_ENABLED else None,
    openapi_url="/openapi.json" if _DOCS_ENABLED else None,
)

# Attach limiter to app state so slowapi can find it
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    # H-SEC-2: include X-CSRF-Token in allowed headers for the CSRF double-submit cookie pattern
    allow_headers=["Authorization", "Content-Type", "Accept", "X-CSRF-Token"],
)


# ── Security headers middleware (FIX #4) ──────────────────────────────────────
# Adds standard hardening headers to every response: block MIME sniffing,
# deny framing (clickjacking), constrain the Referer, and pin HTTPS in prod.
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if settings.APP_ENV == "production":
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return response

# ── CSRF double-submit cookie middleware ─────────────────────────────────────
# H-SEC-2 / M-SEC-5: Protect state-changing /api/admin/* endpoints with a CSRF
# token. The browser SPA reads the `csrf_token` cookie (not httpOnly) and sends
# it back as X-CSRF-Token header. CSRF attacks cannot read cookies cross-origin,
# so they cannot forge this header.
#
# Note: regular API endpoints require Bearer token auth (Authorization header),
# which CSRF cannot forge — so CSRF middleware is only critical for admin paths
# and the refresh path where cookies are the sole credential.

_CSRF_EXEMPT = {"/api/auth/login", "/api/auth/refresh", "/api/auth/logout", "/docs", "/openapi.json"}


def _verify_csrf(request: Request) -> bool:
    """Return True if CSRF check passes (or is not required)."""
    if request.method in _SAFE_METHODS:
        return True
    path = request.url.path
    if not path.startswith("/api/admin"):
        return True  # CSRF enforced only on admin endpoints; others use Bearer token
    cookie_token = request.cookies.get("csrf_token", "")
    header_token = request.headers.get("X-CSRF-Token", "")
    if not cookie_token or not header_token:
        return False
    # Constant-time comparison to prevent timing attacks
    return hmac.compare_digest(
        hashlib.sha256(cookie_token.encode()).digest(),
        hashlib.sha256(header_token.encode()).digest(),
    )


@app.middleware("http")
async def enforce_csrf(request: Request, call_next):
    if not _verify_csrf(request):
        return JSONResponse(
            status_code=403,
            content={"detail": "CSRF token missing or invalid. Fetch a new token from GET /api/auth/csrf-token."},
        )
    return await call_next(request)


# ── Read-only enforcement middleware ──────────────────────────────────────────
# Users with role="readonly" may only issue safe HTTP methods (GET, HEAD, OPTIONS).
# The role is embedded in the JWT access token to avoid a DB lookup per request.
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@app.middleware("http")
async def enforce_readonly(request: Request, call_next):
    if request.method not in _SAFE_METHODS:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            try:
                payload = jwt.decode(
                    token,
                    settings.SECRET_KEY,
                    algorithms=[settings.ALGORITHM],
                )
                if payload.get("role") == "readonly" and payload.get("type") == "access":
                    return JSONResponse(
                        status_code=403,
                        content={"detail": "Read-only credentials: write operations are not permitted."},
                    )
            except JWTError:
                pass  # invalid token — let the route handler return 401 as normal
    return await call_next(request)

# Include routers
app.include_router(auth.router)
app.include_router(contacts.router)
app.include_router(loans.router)
app.include_router(collateral.router)
app.include_router(property_deals.router)
app.include_router(partnerships.router)
app.include_router(expenses.router)
app.include_router(dashboard.router)
app.include_router(reports.router)
app.include_router(beesi.router)
app.include_router(accounts.router)
app.include_router(analytics.router)
app.include_router(obligations.router)
app.include_router(category_limits.router)
app.include_router(categories.router)
app.include_router(admin.router)
app.include_router(chatbot.router)
app.include_router(forecast.router)
app.include_router(recurring_router.router)
app.include_router(unencumbered_router.router)

# L-SEC-7: increase bcrypt rounds from default (12) to 13 for better brute-force resistance
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=13)


# C-DB-1: The _ensure_v026/v027/v028_schema inline DDL functions have been removed.
# Schema is managed exclusively via Alembic migrations (alembic/versions/).
# To apply pending migrations: alembic upgrade head


@app.on_event("shutdown")
def shutdown():
    stop_scheduler()


@app.on_event("startup")
def startup():
    """Wait for DB, run Alembic migrations, seed admin user, and start background scheduler."""
    # Retry loop — Postgres may not be fully ready even after healthcheck
    for attempt in range(10):
        try:
            # C-DB-2: Do NOT call Base.metadata.create_all here; it bypasses Alembic
            # and can silently diverge the schema. Verify connectivity instead.
            with engine.connect() as conn:
                conn.execute(__import__("sqlalchemy").text("SELECT 1"))
            logger.info("Database connection verified")
            break
        except Exception as e:
            logger.warning("DB not ready (attempt %d/10): %s", attempt + 1, e)
            time.sleep(2)
    else:
        logger.error("Could not connect to database after 10 attempts")
        return

    # Apply pending Alembic migrations.
    # #7 (FIX): On Postgres, guard the migration with a session-scoped advisory
    # lock so that with multiple workers/replicas only ONE process runs
    # `alembic upgrade head` at a time (the others skip and proceed once the
    # lock holder finishes). On non-Postgres engines (e.g. sqlite in CI) the
    # advisory-lock functions don't exist, so we run the migration directly —
    # preserving the previous behavior.
    from sqlalchemy import text as _sql_text
    _MIGRATION_LOCK_KEY = 202605291001

    def _run_migrations():
        import subprocess
        result = subprocess.run(
            ["alembic", "upgrade", "head"],
            capture_output=True, text=True, cwd="/app"
        )
        if result.returncode == 0:
            logger.info("Alembic migrations applied successfully")
        else:
            logger.error("Alembic migration failed: %s", result.stderr)

    try:
        if engine.dialect.name == "postgresql":
            with engine.connect() as lock_conn:
                got_lock = lock_conn.execute(
                    _sql_text("SELECT pg_try_advisory_lock(:k)"),
                    {"k": _MIGRATION_LOCK_KEY},
                ).scalar()
                if got_lock:
                    try:
                        _run_migrations()
                    finally:
                        lock_conn.execute(
                            _sql_text("SELECT pg_advisory_unlock(:k)"),
                            {"k": _MIGRATION_LOCK_KEY},
                        )
                else:
                    logger.info("Another worker holds the migration lock; skipping migrations on this worker")
        else:
            _run_migrations()
    except Exception as e:
        logger.error("Could not run Alembic migrations: %s", e)

    # Seed admin user if no users exist
    db = next(get_db())
    try:
        user_count = db.query(User).count()
        if user_count == 0:
            admin_user = User(
                username=settings.SEED_ADMIN_USERNAME,
                email=settings.SEED_ADMIN_EMAIL,
                password_hash=pwd_context.hash(settings.SEED_ADMIN_PASSWORD),
                full_name="System Administrator",
                role="admin",
                is_active=True
            )
            db.add(admin_user)
            db.commit()
            logger.info("Created admin user: %s", settings.SEED_ADMIN_USERNAME)
        else:
            logger.info("Admin user already exists, skipping seed")
    except Exception as e:
        logger.error("Failed to seed admin user: %s", e)
        db.rollback()
    finally:
        db.close()

    # Start background scheduler for recurring transactions
    try:
        start_scheduler()
        logger.info("Background scheduler started")
    except Exception as e:
        logger.error("Scheduler failed to start: %s", e)


@app.get("/")
def root():
    return {
        "message": "Advanced Finance Tracker API",
        "version": "0.1.0",
        "docs": "/docs",
        "status": "running"
    }


@app.get("/health")
def health_check():
    return {"status": "healthy", "version": "v2.2-dashboard-redesign"}
