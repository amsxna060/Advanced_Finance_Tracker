from sqlalchemy import Column, ForeignKey, Integer, String, Boolean, DateTime, JSON
from sqlalchemy.sql import func
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255))
    role = Column(String(20), default="viewer")  # admin (platform) | viewer | readonly
    # Household membership: NULL = this user is their own tenant. Set = this
    # user (viewer/readonly guest) operates inside that owner's tenant.
    tenant_owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    # Feature entitlements (see app/modules.py). NULL = all modules
    # (grandfathered accounts); a list = exactly those modules.
    enabled_modules = Column(JSON, nullable=True)
    # Public-signup accounts must verify their address; pre-signup accounts
    # are backfilled to True by migration 047.
    email_verified = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
