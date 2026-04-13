from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime
from sqlalchemy.sql import func
from app.database import Base


class Contact(Base):
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    phone = Column(String(20))
    alternate_phone = Column(String(20))
    address = Column(Text)
    city = Column(String(100))
    contact_type = Column(String(20), default="individual")  # individual | institution
    relationship_type = Column(String(30), default="borrower")
    # borrower | lender | bank | partner | seller | buyer | family | friend
    is_handshake = Column(Boolean, default=False)
    notes = Column(Text)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
