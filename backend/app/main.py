from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
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
from app.routers import beesi, accounts, analytics

app = FastAPI(
    title="Advanced Finance Tracker",
    description="Personal finance management for money lending and property deals",
    version="0.1.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


@app.on_event("startup")
def startup():
    """Wait for DB, create all tables, then seed admin user."""
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
    return {"status": "healthy"}
