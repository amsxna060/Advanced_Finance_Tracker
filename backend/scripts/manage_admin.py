"""Admin & role management — run on the server (no credentials in .env).

Usage (from backend/):
  python -m scripts.manage_admin list
  python -m scripts.manage_admin create-admin            # prompts username + password
  python -m scripts.manage_admin set-role <username> <admin|viewer|readonly>
  python -m scripts.manage_admin set-password <username> # prompts new password

Roles:
  admin    – platform/support account: sees the Admin Console, can view any
             user's account (read-only) and edit it only with Edit mode on.
  viewer   – a normal user: full control of their OWN data (this is what
             amolsaxena060 should be).
  readonly – a view-only guest inside someone else's account.

Typical one-time cut-over:
  python -m scripts.manage_admin create-admin           # make the new admin
  python -m scripts.manage_admin set-role amolsaxena060 viewer
"""

import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from passlib.context import CryptContext  # noqa: E402

from app.database import SessionLocal  # noqa: E402
import app.models  # noqa: F401, E402
from app.models.user import User  # noqa: E402

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=13)
VALID_ROLES = {"admin", "viewer", "readonly"}


def _prompt_password() -> str:
    while True:
        p1 = getpass.getpass("Password (12+ chars): ")
        if len(p1) < 12:
            print("  too short — need 12+ characters"); continue
        if p1 != getpass.getpass("Confirm password: "):
            print("  didn't match, try again"); continue
        return p1


def cmd_list(db) -> int:
    rows = db.query(User).order_by(User.id).all()
    print(f"{'id':>4}  {'role':<9} {'active':<7} {'username':<24} email")
    for u in rows:
        print(f"{u.id:>4}  {u.role:<9} {str(u.is_active):<7} {u.username:<24} {u.email}")
    return 0


def cmd_create_admin(db) -> int:
    username = input("New admin username: ").strip()
    if not username:
        print("username required"); return 1
    if db.query(User).filter(User.username == username).first():
        print(f"user '{username}' already exists — use set-role / set-password instead"); return 1
    email = input("Email: ").strip() or f"{username}@financerbuddy.com"
    password = _prompt_password()
    db.add(User(
        username=username, email=email,
        password_hash=_pwd.hash(password),
        full_name="Platform Admin", role="admin",
        is_active=True, email_verified=True,
    ))
    db.commit()
    print(f"✓ admin '{username}' created")
    return 0


def cmd_set_role(db, username: str, role: str) -> int:
    if role not in VALID_ROLES:
        print(f"role must be one of {sorted(VALID_ROLES)}"); return 1
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        print(f"user '{username}' not found"); return 1
    old = user.role
    user.role = role
    db.commit()
    print(f"✓ '{username}': {old} → {role}"
          + ("  (keeps all data + modules)" if role == "viewer" else ""))
    return 0


def cmd_set_password(db, username: str) -> int:
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        print(f"user '{username}' not found"); return 1
    user.password_hash = _pwd.hash(_prompt_password())
    db.commit()
    print(f"✓ password updated for '{username}'")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__); return 1
    cmd, rest = args[0], args[1:]
    db = SessionLocal()
    try:
        if cmd == "list":
            return cmd_list(db)
        if cmd == "create-admin":
            return cmd_create_admin(db)
        if cmd == "set-role" and len(rest) == 2:
            return cmd_set_role(db, rest[0], rest[1])
        if cmd == "set-password" and len(rest) == 1:
            return cmd_set_password(db, rest[0])
        print(__doc__)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
