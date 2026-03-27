#!/usr/bin/env python3
"""
Pre-start script to run database migrations before starting the FastAPI server.
This is more portable than a bash script and works reliably across platforms.
"""
import subprocess
import sys
import os

def main():
    print("=" * 60)
    print("Running database migrations...")
    print("=" * 60)
    
    # Change to the directory containing alembic.ini
    os.chdir("/app")
    
    # Run alembic upgrade head
    result = subprocess.run(
        ["alembic", "upgrade", "head"],
        capture_output=True,
        text=True
    )
    
    print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    
    if result.returncode != 0:
        print("ERROR: Database migration failed!")
        print("=" * 60)
        sys.exit(result.returncode)
    
    print("=" * 60)
    print("Database migrations completed successfully!")
    print("=" * 60)
    return 0

if __name__ == "__main__":
    sys.exit(main())
