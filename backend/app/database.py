from urllib.parse import urlparse

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool
from app.config import settings

# Normalize URL: Supabase and some providers use postgres:// but SQLAlchemy needs postgresql://
db_url = settings.DATABASE_URL
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

# Detect local / Docker-Compose databases:
#   - explicit localhost / 127.0.0.1
#   - bare hostnames with no dots (Docker service names like "postgres", "db", etc.)
# Cloud hosts (Supabase, Render, …) always contain dots in the hostname.
_hostname = urlparse(db_url).hostname or ""
_is_local = _hostname in ("localhost", "127.0.0.1") or "." not in _hostname

if _is_local:
    engine = create_engine(
        db_url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )
elif ":6543" in db_url:
    # Supabase PgBouncer transaction mode pooler — NullPool prevents
    # SQLAlchemy from managing its own pool on top of PgBouncer's
    engine = create_engine(
        db_url,
        connect_args={"sslmode": "require"},
        poolclass=NullPool,
    )
else:
    engine = create_engine(
        db_url,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
