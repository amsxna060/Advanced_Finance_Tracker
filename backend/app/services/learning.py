"""
Category learning service.

Learns description → category/sub_category mappings from user saves,
and uses them to suggest categories before falling back to keyword rules.
"""
import re
from typing import Optional
from sqlalchemy.orm import Session

# Words to ignore when matching descriptions
_STOP_WORDS = {
    "the", "a", "an", "and", "or", "for", "in", "on", "at", "to",
    "from", "of", "with", "by", "is", "it", "this", "i", "my", "our",
    "some", "few", "one", "two", "three", "got", "bought", "paid",
    "order", "ordered", "bought", "purchase", "bill",
}


def normalize(text: str) -> str:
    """Lowercase, remove punctuation, collapse whitespace."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def keywords(text: str) -> set:
    """Extract significant keywords from normalized text."""
    return {w for w in normalize(text).split() if w not in _STOP_WORDS and len(w) > 1}


def save_learning(
    db: Session,
    description: str,
    category: str,
    sub_category: Optional[str],
) -> None:
    """
    Upsert a description → category mapping.
    If the same normalized description already exists, update the category
    and increment match_count. Does NOT commit — caller must commit.
    """
    from app.models.category_learning import CategoryLearning

    if not description or not category:
        return

    norm = normalize(description)
    if not norm:
        return

    existing = (
        db.query(CategoryLearning)
        .filter(CategoryLearning.description_normalized == norm)
        .first()
    )
    if existing:
        existing.category = category
        existing.sub_category = sub_category
        existing.match_count = (existing.match_count or 1) + 1
    else:
        db.add(CategoryLearning(
            description_normalized=norm,
            category=category,
            sub_category=sub_category,
            match_count=1,
        ))


def suggest_from_learnings(
    db: Session,
    description: str,
) -> Optional[tuple]:
    """
    Look up the best-matching learned mapping for a description.
    Returns (category, sub_category) or None if no confident match found.

    Matching strategy:
    1. Exact normalized description → instant match.
    2. Subset match: all significant keywords of a stored entry are present
       in the input. The most specific stored entry (most keywords, highest
       match_count) wins. Requires at least 1 keyword from stored entry.
    """
    from app.models.category_learning import CategoryLearning

    if not description:
        return None

    norm = normalize(description)
    if not norm:
        return None

    # Fast path: exact match
    exact = (
        db.query(CategoryLearning)
        .filter(CategoryLearning.description_normalized == norm)
        .first()
    )
    if exact:
        return (exact.category, exact.sub_category)

    # Subset match: stored keywords must all appear in input
    input_kw = keywords(norm)
    if not input_kw:
        return None

    learnings = db.query(CategoryLearning).all()
    best = None
    best_score = 0

    for entry in learnings:
        stored_kw = keywords(entry.description_normalized)
        if not stored_kw:
            continue
        # Every keyword in the stored entry must be present in the input
        if not stored_kw.issubset(input_kw):
            continue
        # Score: prefer more-specific entries (more keywords) and frequently
        # confirmed ones (higher match_count).
        score = len(stored_kw) * (entry.match_count or 1)
        if score > best_score:
            best_score = score
            best = entry

    return (best.category, best.sub_category) if best else None
