from app.models.user import User
from app.models.contact import Contact
from app.models.loan import Loan, LoanPayment, LoanCapitalizationEvent
from app.models.collateral import Collateral
from app.models.property_deal import PropertyDeal, PropertyTransaction, PropertySimulation
from app.models.partnership import Partnership, PartnershipMember, PartnershipTransaction
from app.models.expense import Expense
from app.models.category_learning import CategoryLearning
from app.models.category_limit import CategoryLimit
from app.models.category import Category
from app.models.beesi import Beesi, BeesiInstallment, BeesiWithdrawal
from app.models.cash_account import CashAccount, AccountTransaction
from app.models.obligation import MoneyObligation, ObligationSettlement
from app.models.property_anomaly import PropertyAnomaly
from app.models.forecast_override import ForecastOverride
from app.models.recurring_transaction import RecurringTransaction
from app.models.unencumbered_asset import UnencumberedAsset
from app.models.refresh_token import RefreshTokenBlacklist
from app.models.activity_log import ActivityLog
# Package-by-feature modules (E4+): re-exported here so Base.metadata,
# the activity logger and create_all see them like any other model.
from app.modules_pkg.assets.models import Asset
from app.models.outbox_event import OutboxEvent
from app.models.platform_setting import PlatformSetting

__all__ = [
    "User",
    "Contact",
    "Loan",
    "LoanPayment",
    "LoanCapitalizationEvent",
    "Collateral",
    "PropertyDeal",
    "PropertyTransaction",
    "PropertySimulation",
    "Partnership",
    "PartnershipMember",
    "PartnershipTransaction",
    "Expense",
    "CategoryLearning",
    "CategoryLimit",
    "Category",
    "Beesi",
    "BeesiInstallment",
    "BeesiWithdrawal",
    "CashAccount",
    "AccountTransaction",
    "MoneyObligation",
    "ObligationSettlement",
    "PropertyAnomaly",
    "ForecastOverride",
    "RecurringTransaction",
    "UnencumberedAsset",
    "ActivityLog",
    "Asset",
    "OutboxEvent",
    "PlatformSetting",
]
