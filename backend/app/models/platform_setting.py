"""Runtime-editable platform settings — key/value, changed from the admin
portal WITHOUT a redeploy or .env edit.

Only operational switches live here (signup open?, email verification?, gold
auto-refresh?). Secrets and infra (DATABASE_URL, SECRET_KEY, API keys) stay
in .env — they must not sit in the application database.

A missing row means "use the .env / config default", so the DB only ever
holds explicit overrides.
"""
from sqlalchemy import Column, DateTime, String, Text
from sqlalchemy.sql import func

from app.database import Base


class PlatformSetting(Base):
    __tablename__ = "platform_settings"

    key = Column(String(64), primary_key=True)
    value = Column(Text, nullable=False)          # stored as text; typed on read
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
