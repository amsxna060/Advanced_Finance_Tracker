from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session
from passlib.context import CryptContext
import time

from app.config import settings
from app.database import get_db, engine, Base
from app.models.user import User

# Import ALL models so Base.metadata has every table before create_all
import app.models  # noqa: F401 — registers Contact, Loan, Collateral, Property, Partnership, Expense, Beesi, CashAccount

# Import routers
from app.routers import auth, contacts, loans, collateral, property_deals, partnerships, expenses, dashboard, reports
from app.routers import beesi, accounts, analytics, obligations, category_limits, categories, admin, chatbot, forecast
from app.routers import recurring_transactions as recurring_router

# Scheduler
from app.services.scheduler import start_scheduler, stop_scheduler

# Rate limiter — keyed by remote IP
limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])

app = FastAPI(
    title="Advanced Finance Tracker",
    description="Personal finance management for money lending and property deals",
    version="0.1.0"
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
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

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

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _ensure_v027_schema(conn):
    """
    Safety net: apply migration-027 DDL (is_voided on account_transactions).
    All statements are idempotent — safe to run even when already applied.
    """
    stmts = [
        "DO $$ BEGIN ALTER TABLE account_transactions ADD COLUMN is_voided BOOLEAN NOT NULL DEFAULT FALSE; EXCEPTION WHEN duplicate_column THEN null; END $$",
        "CREATE INDEX IF NOT EXISTS ix_account_txn_is_voided ON account_transactions (is_voided)",
    ]
    for stmt in stmts:
        try:
            conn.execute(text(stmt))
        except Exception as e:
            print(f"⚠️  _ensure_v027_schema: {e}")


def _ensure_v026_schema(conn):
    """
    Safety net: apply migration-026 DDL directly if Alembic missed it.
    All statements are idempotent — safe to run even when already applied.
    """
    stmts = [
        "DO $$ BEGIN CREATE TYPE recurring_type_enum AS ENUM ('inflow','outflow'); EXCEPTION WHEN duplicate_object THEN null; END $$",
        "DO $$ BEGIN CREATE TYPE recurring_frequency_enum AS ENUM ('weekly','monthly','yearly'); EXCEPTION WHEN duplicate_object THEN null; END $$",
        "DO $$ BEGIN CREATE TYPE loan_priority_enum AS ENUM ('high','medium','low'); EXCEPTION WHEN duplicate_object THEN null; END $$",
        """CREATE TABLE IF NOT EXISTS recurring_transactions (
            id SERIAL PRIMARY KEY,
            created_by INTEGER NOT NULL REFERENCES users(id),
            title VARCHAR(255) NOT NULL,
            type recurring_type_enum NOT NULL,
            amount NUMERIC(15,2) NOT NULL,
            frequency recurring_frequency_enum NOT NULL,
            next_due_date DATE NOT NULL,
            account_id INTEGER REFERENCES cash_accounts(id),
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_recurring_transactions_created_by ON recurring_transactions (created_by)",
        "CREATE INDEX IF NOT EXISTS ix_recurring_transactions_next_due_date ON recurring_transactions (next_due_date)",
        "DO $$ BEGIN ALTER TABLE loans ADD COLUMN priority loan_priority_enum DEFAULT 'medium'; EXCEPTION WHEN duplicate_column THEN null; END $$",
    ]
    for stmt in stmts:
        try:
            conn.execute(text(stmt))
        except Exception as e:
            print(f"⚠️  _ensure_v026_schema: {e}")


@app.on_event("shutdown")
def shutdown():
    stop_scheduler()


@app.on_event("startup")
def startup():
    """Wait for DB, create all tables, seed admin user, and start background scheduler."""
    # Retry loop — Postgres may not be fully ready even after healthcheck
    for attempt in range(10):
        try:
            Base.metadata.create_all(bind=engine)
            print("✅ Database tables created / verified")
            break
        except Exception as e:
            print(f"⏳ DB not ready (attempt {attempt + 1}/10): {e}")
            time.sleep(2)
    else:
        print("❌ Could not connect to database after 10 attempts")
        return

    # Apply migration-026 schema directly (idempotent safety net)
    try:
        with engine.connect() as conn:
            _ensure_v026_schema(conn)
            conn.commit()
        print("✅ v026 schema verified (recurring_transactions + loans.priority)")
    except Exception as e:
        print(f"⚠️  v026 schema safety-net failed: {e}")

    # Apply migration-027 schema directly (idempotent safety net)
    try:
        with engine.connect() as conn:
            _ensure_v027_schema(conn)
            conn.commit()
        print("✅ v027 schema verified (account_transactions.is_voided)")
    except Exception as e:
        print(f"⚠️  v027 schema safety-net failed: {e}")

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
            print(f"✅ Created admin user: {settings.SEED_ADMIN_USERNAME}")
        else:
            print(f"ℹ️  Admin user already exists, skipping seed")
    except Exception as e:
        print(f"❌ Failed to seed admin user: {e}")
        db.rollback()
    finally:
        db.close()

    # Start background scheduler for recurring transactions
    try:
        start_scheduler()
        print("✅ Background scheduler started")
    except Exception as e:
        print(f"⚠️  Scheduler failed to start: {e}")


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
