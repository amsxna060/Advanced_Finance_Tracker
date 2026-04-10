from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from app.database import Base


class CategoryLearning(Base):
    """
    Stores description → category/sub_category mappings learned from user saves.
    Each unique normalized description is stored once; match_count grows each
    time the user saves the same pattern.
    """
    __tablename__ = "category_learnings"

    id = Column(Integer, primary_key=True, index=True)
    description_normalized = Column(String(500), unique=True, index=True, nullable=False)
    category = Column(String(100), nullable=False)
    sub_category = Column(String(100), nullable=True)
    match_count = Column(Integer, default=1, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
