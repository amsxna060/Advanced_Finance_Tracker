import os
import sys
from logging.config import fileConfig

from sqlalchemy import create_engine
from sqlalchemy import pool

from alembic import context

# Add app to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# this is the Alembic Config object
config = context.config

# Prefer DIRECT_URL (Supabase direct connection, port 5432) for migrations
# because PgBouncer transaction mode (port 6543) can't run DDL migrations.
# DIRECT_URL is set by prestart.py before alembic is invoked, but we also
# check here in case alembic is run directly.
database_url = (
    os.environ.get("DATABASE_URL")  # prestart.py already sets this to DIRECT_URL
    or os.environ.get("DIRECT_URL")
)
if database_url:
    # Normalize postgres:// → postgresql:// (Supabase and many cloud providers use postgres://)
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    config.set_main_option("sqlalchemy.url", database_url)

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Import all models so Alembic can detect them
from app.database import Base
from app.models import *  # noqa: F401, F403

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = config.get_main_option("sqlalchemy.url")

    # For non-localhost databases (Supabase, Render, etc.), require SSL
    is_remote = url and ("localhost" not in url) and ("127.0.0.1" not in url)
    connect_args = {"sslmode": "require"} if is_remote else {}

    connectable = create_engine(url, connect_args=connect_args, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
