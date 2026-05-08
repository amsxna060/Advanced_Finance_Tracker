from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from app.database import Base


class CategoryLearning(Base):
    """
    Stores description → category/sub_category mappings learned from user saves.
    Each unique normalized description is stored once per user; match_count grows
    each time the user saves the same pattern.
    H-DI-13: user_id scopes learnings per-user to prevent cross-user data leakage.
    """
    __tablename__ = "category_learnings"

    id = Column(Integer, primary_key=True, index=True)
    # H-DI-13: user_id makes learnings per-user; NULL = legacy global rows
    user_id = Column(Integer, nullable=True, index=True)
    description_normalized = Column(String(500), nullable=False, index=True)
    category = Column(String(100), nullable=False)
    sub_category = Column(String(100), nullable=True)
    match_count = Column(Integer, default=1, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
