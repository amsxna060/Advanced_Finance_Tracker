#!/usr/bin/env python3
"""
Pre-start script to run database migrations before starting the FastAPI server.
Handles Supabase and other cloud database providers (SSL, postgres:// → postgresql://).
"""
import subprocess
import sys
import os

def main():
    print("=" * 60)
    print("Running database migrations...")
    print("=" * 60)

    # Normalize DATABASE_URL: Supabase and some providers give postgres:// 
    # but SQLAlchemy / Alembic need postgresql://
    db_url = os.environ.get("DATABASE_URL", "")
    if db_url.startswith("postgres://"):
        normalized = db_url.replace("postgres://", "postgresql://", 1)
        os.environ["DATABASE_URL"] = normalized
        print(f"Normalized DATABASE_URL scheme: postgres:// → postgresql://")

    # Change to the directory containing alembic.ini
    os.chdir("/app")

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
