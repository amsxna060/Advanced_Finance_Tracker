"""FB-6.1 — Move every row of one tenant to another user (the cut-over tool).

Use case: at launch you (currently the seed admin, owner of all historical
data) become a normal user. Create your personal account via signup, then:

    # ALWAYS rehearse first:
    python scripts/migrate_tenant_owner.py --from-user admin --to-user amol --dry-run
    # then for real:
    python scripts/migrate_tenant_owner.py --from-user admin --to-user amol

What it does, in ONE transaction (all-or-nothing):
  1. UPDATE owner_id: from -> to on every TenantMixin table (the mixin's
     mapper inventory guarantees no table is forgotten).
  2. Re-points household guests (users.tenant_owner_id) to the new owner.
  3. Prints per-table counts; with --dry-run it rolls back instead of
     committing, so you can diff the counts against expectations safely.

Reversal: run it again with --from-user/--to-user swapped.

Notes
  - created_by (audit history) is intentionally NOT rewritten — history
    stays honest about who typed what.
  - Run while the backend is stopped (or immediately restart it): sessions
    opened before the move may hold stale identity maps.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.database import Base, SessionLocal  # noqa: E402
import app.models  # noqa: F401, E402 — populate Base.registry
from app.models.mixins import TenantMixin  # noqa: E402
from app.models.user import User  # noqa: E402


def tenant_tables() -> list[str]:
    tables = sorted(
        mapper.class_.__tablename__
        for mapper in Base.registry.mappers
        if issubclass(mapper.class_, TenantMixin)
    )
    assert tables, "no TenantMixin tables found — models not imported?"
    return tables


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--from-user", required=True, help="username currently owning the data")
    ap.add_argument("--to-user", required=True, help="username that should own it")
    ap.add_argument("--dry-run", action="store_true", help="report counts, roll back")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        src = db.query(User).filter(User.username == args.from_user).first()
        dst = db.query(User).filter(User.username == args.to_user).first()
        if src is None or dst is None:
            missing = args.from_user if src is None else args.to_user
            print(f"ERROR: user '{missing}' not found")
            return 1
        if src.id == dst.id:
            print("ERROR: --from-user and --to-user are the same account")
            return 1
        if dst.tenant_owner_id:
            print(f"ERROR: '{dst.username}' is a household guest of user "
                  f"#{dst.tenant_owner_id} — the target must be a tenant owner")
            return 1

        print(f"Moving tenant #{src.id} ({src.username}) -> "
              f"#{dst.id} ({dst.username}){' [DRY RUN]' if args.dry_run else ''}\n")

        total = 0
        for table in tenant_tables():
            result = db.execute(
                text(f"UPDATE {table} SET owner_id = :dst WHERE owner_id = :src"),
                {"src": src.id, "dst": dst.id},
            )
            if result.rowcount:
                print(f"  {table:32s} {result.rowcount:6d} rows")
            total += result.rowcount

        guests = db.execute(
            text("UPDATE users SET tenant_owner_id = :dst WHERE tenant_owner_id = :src"),
            {"src": src.id, "dst": dst.id},
        ).rowcount
        if guests:
            print(f"  {'users (household guests)':32s} {guests:6d} rows")

        print(f"\nTotal rows moved: {total} (+ {guests} guests re-pointed)")

        if args.dry_run:
            db.rollback()
            print("DRY RUN — rolled back, nothing changed.")
        else:
            db.commit()
            print("COMMITTED.")
        return 0
    except Exception as exc:
        db.rollback()
        print(f"ERROR — rolled back: {exc}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
