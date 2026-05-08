"""C-AUTH-2: Refresh token blacklist for logout revocation."""
from sqlalchemy import Column, Integer, String, DateTime, Index
from sqlalchemy.sql import func
from app.database import Base


class RefreshTokenBlacklist(Base):
    """Stores SHA-256 hashes of revoked refresh tokens.

    On logout the token is hashed and inserted here.
    On /refresh the token is hashed and checked against this table.
    Rows can be pruned when their expires_at is in the past.
    """
    __tablename__ = "refresh_token_blacklist"

    id = Column(Integer, primary_key=True, autoincrement=True)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_rtb_expires_at", "expires_at"),
    )
