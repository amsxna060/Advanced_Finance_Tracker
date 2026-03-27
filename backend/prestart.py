#!/usr/bin/env python3
"""
Pre-start script to run database migrations before starting the FastAPI server.
Handles Supabase and other cloud database providers (SSL, postgres:// → postgresql://).
"""
import subprocess
import sys
import os

def _normalize(url: str) -> str:
    return url.replace("postgres://", "postgresql://", 1) if url.startswith("postgres://") else url


def main():
    print("=" * 60)
    print("Running database migrations...")
    print("=" * 60)

    # DIRECT_URL: Supabase direct connection (port 5432) bypasses PgBouncer,
    # which is required for DDL migrations.  Fall back to DATABASE_URL.
    direct_url = os.environ.get("DIRECT_URL") or os.environ.get("DATABASE_URL", "")
    if not direct_url:
        print("WARNING: No DATABASE_URL or DIRECT_URL set — skipping migrations.")
        return 0

    normalized = _normalize(direct_url)
    if normalized != direct_url:
        print("Normalized URL scheme: postgres:// → postgresql://")

    # Override DATABASE_URL so Alembic's env.py picks it up
    os.environ["DATABASE_URL"] = normalized

    # Change to the directory containing alembic.ini (same dir as this script)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)

    # Run alembic upgrade head
    result = subprocess.run(
        ["alembic", "upgrade", "head"],
        capture_output=False,   # print directly to stdout/stderr so Render logs show it
    )

    if result.returncode != 0:
        print("=" * 60)
        print("ERROR: Database migration FAILED — server will still start.")
        print("Check the logs above for details.")
        print("=" * 60)
        # Don't exit — let the server start so we can see the real error in the API
    else:
        print("=" * 60)
        print("Database migrations completed successfully!")
        print("=" * 60)

    return 0

if __name__ == "__main__":
    sys.exit(main())
