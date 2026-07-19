from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, Numeric, ForeignKey
from sqlalchemy.sql import func
from app.database import Base
from app.models.mixins import TenantMixin


class PropertyAnomaly(Base, TenantMixin):
    __tablename__ = "property_anomalies"

    id = Column(Integer, primary_key=True, index=True)
    # Which entity triggered this anomaly
    scope_kind = Column(String(30), nullable=False)   # "property" | "partnership"
    scope_id   = Column(Integer, nullable=False)
    scope_title = Column(String(255))

    # Anomaly classification
    anomaly_type = Column(String(80), nullable=False)
    # low_buyer_coverage | cash_flow_risk | collection_lag | overpaid_to_seller
    severity = Column(String(20), nullable=False, default="warning")
    # info | warning | critical

    # Human-readable description
    message = Column(Text, nullable=False)

    # Financial snapshot at time of scan
    metric_value   = Column(Numeric(15, 2))   # the metric that triggered the flag
    threshold_value = Column(Numeric(15, 2))  # the threshold it was compared against

    # Lifecycle
    is_resolved = Column(Boolean, default=False)
    resolved_at = Column(DateTime(timezone=True))
    first_seen  = Column(DateTime(timezone=True), server_default=func.now())
    last_scanned = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
