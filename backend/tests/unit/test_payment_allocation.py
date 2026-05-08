"""
Unit tests for app/services/payment_allocation.allocate_payment.

All DB interaction is mocked with MagicMock so these tests run without any DB.
"""

from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from app.services.payment_allocation import allocate_payment


# ---------------------------------------------------------------------------
# Helpers to build mock Loan objects
# ---------------------------------------------------------------------------

def _make_loan(loan_id, loan_type, **kwargs):
    loan = MagicMock()
    loan.id = loan_id
    loan.loan_type = loan_type
    loan.principal_amount = kwargs.get("principal_amount", Decimal("100000"))
    loan.interest_rate = kwargs.get("interest_rate", Decimal("12"))
    loan.emi_amount = kwargs.get("emi_amount", None)
    loan.tenure_months = kwargs.get("tenure_months", None)
    loan.interest_free_till = kwargs.get("interest_free_till", None)
    loan.post_due_interest_rate = kwargs.get("post_due_interest_rate", None)
    loan.status = kwargs.get("status", "active")
    return loan


def _make_db(loan):
    """Return a mock session that returns `loan` on query().filter().first()."""
    db = MagicMock()
    query_mock = MagicMock()
    filter_mock = MagicMock()
    filter_mock.first.return_value = loan
    query_mock.filter.return_value = filter_mock
    db.query.return_value = query_mock
    return db


def _make_outstanding(principal, interest):
    return {
        "principal_outstanding": Decimal(str(principal)),
        "interest_outstanding": Decimal(str(interest)),
        "total_outstanding": Decimal(str(principal)) + Decimal(str(interest)),
    }


# ---------------------------------------------------------------------------
# EMI loan allocation
# ---------------------------------------------------------------------------

class TestEmiAllocation:
    def test_proportional_split_basic(self):
        """
        EMI loan: P=100000, EMI=9000, tenure=12.
        total_repayment = 108000, total_interest = 8000.
        interest_ratio = 8000/108000 ≈ 0.074
        For payment=9000: current_interest ≈ 667, principal ≈ 8333, total == 9000.
        """
        loan = _make_loan(1, "emi",
                          principal_amount=Decimal("100000"),
                          emi_amount=Decimal("9000"),
                          tenure_months=12)
        db = _make_db(loan)

        result = allocate_payment(1, Decimal("9000"), date(2024, 2, 1), db)

        assert result["allocated_to_overdue_interest"] == Decimal("0")
        total = (result["allocated_to_current_interest"]
                 + result["allocated_to_principal"]
                 + result["unallocated"])
        assert total == Decimal("9000")

    def test_emi_allocation_sums_to_payment(self):
        """allocated_to_current_interest + allocated_to_principal == payment_amount."""
        loan = _make_loan(2, "emi",
                          principal_amount=Decimal("200000"),
                          emi_amount=Decimal("18500"),
                          tenure_months=12)
        db = _make_db(loan)

        payment = Decimal("18500")
        result = allocate_payment(2, payment, date(2024, 3, 1), db)

        total = result["allocated_to_current_interest"] + result["allocated_to_principal"]
        assert abs(total - payment) < Decimal("0.02")  # rounding tolerance

    def test_emi_no_overdue_interest(self):
        """EMI loans never allocate to overdue_interest."""
        loan = _make_loan(3, "emi",
                          principal_amount=Decimal("100000"),
                          emi_amount=Decimal("9000"),
                          tenure_months=12)
        db = _make_db(loan)

        result = allocate_payment(3, Decimal("5000"), date(2024, 4, 1), db)
        assert result["allocated_to_overdue_interest"] == Decimal("0")

    def test_emi_no_config_raises(self):
        """H-FIN-21: EMI loan with no emi_amount/tenure_months raises ValueError.
        Silent misallocation is worse than surfacing the config error."""
        loan = _make_loan(4, "emi",
                          principal_amount=Decimal("100000"),
                          emi_amount=None,
                          tenure_months=None)
        db = _make_db(loan)

        with pytest.raises(ValueError, match="Cannot allocate payment without a valid schedule"):
            allocate_payment(4, Decimal("5000"), date(2024, 5, 1), db)

    def test_emi_interest_ratio_correct(self):
        """
        With P=60000, EMI=5000, tenure=12 → total_repayment=60000 (no interest).
        rate=0, so all payment goes to principal.
        """
        loan = _make_loan(5, "emi",
                          principal_amount=Decimal("60000"),
                          emi_amount=Decimal("5000"),
                          tenure_months=12)
        db = _make_db(loan)

        result = allocate_payment(5, Decimal("5000"), date(2024, 6, 1), db)

        # total_interest = 60000 - 60000 = 0 → interest_ratio = 0
        assert result["allocated_to_current_interest"] == Decimal("0")
        assert result["allocated_to_principal"] == Decimal("5000")


# ---------------------------------------------------------------------------
# interest_only loan allocation (2x rule)
# ---------------------------------------------------------------------------

class TestInterestOnlyAllocation:
    def _make_interest_only_db(self, loan, principal_outstanding, interest_outstanding):
        db = _make_db(loan)
        outstanding = _make_outstanding(principal_outstanding, interest_outstanding)
        return db, outstanding

    def test_small_payment_all_to_interest(self):
        """
        principal=100000, rate=12%pa.
        monthly_estimate = 100000 * 12/1200 = 1000.
        threshold (2x) = 2000.
        Payment = 1500 < 2000 → all current_interest, zero principal.
        """
        loan = _make_loan(10, "interest_only",
                          principal_amount=Decimal("100000"),
                          interest_rate=Decimal("12"))
        db = _make_db(loan)
        outstanding = _make_outstanding("100000", "3000")

        with patch("app.services.payment_allocation.calculate_outstanding",
                   return_value=outstanding):
            result = allocate_payment(10, Decimal("1500"), date(2024, 2, 1), db)

        assert result["allocated_to_principal"] == Decimal("0")
        assert result["allocated_to_current_interest"] == Decimal("1500")
        assert result["unallocated"] == Decimal("0")

    def test_large_payment_clears_interest_then_principal(self):
        """
        monthly_estimate = 1000, threshold = 2000.
        Payment = 5000 >= 2000 → clears interest_outstanding=3000, rest to principal.
        """
        loan = _make_loan(11, "interest_only",
                          principal_amount=Decimal("100000"),
                          interest_rate=Decimal("12"))
        db = _make_db(loan)
        outstanding = _make_outstanding("100000", "3000")

        with patch("app.services.payment_allocation.calculate_outstanding",
                   return_value=outstanding):
            result = allocate_payment(11, Decimal("5000"), date(2024, 2, 1), db)

        assert result["allocated_to_current_interest"] == Decimal("3000")
        assert result["allocated_to_principal"] == Decimal("2000")
        assert result["unallocated"] == Decimal("0")

    def test_massive_payment_beyond_principal_has_unallocated(self):
        """
        Payment way more than principal+interest → unallocated = surplus.
        """
        loan = _make_loan(12, "interest_only",
                          principal_amount=Decimal("10000"),
                          interest_rate=Decimal("12"))
        db = _make_db(loan)
        outstanding = _make_outstanding("10000", "500")

        with patch("app.services.payment_allocation.calculate_outstanding",
                   return_value=outstanding):
            result = allocate_payment(12, Decimal("20000"), date(2024, 2, 1), db)

        # interest = 500, principal = 10000; unallocated = 20000 - 500 - 10000 = 9500
        assert result["allocated_to_current_interest"] == Decimal("500")
        assert result["allocated_to_principal"] == Decimal("10000")
        assert result["unallocated"] == Decimal("9500")

    def test_payment_exactly_at_threshold(self):
        """
        monthly_estimate=1000, threshold=2000. Payment exactly 2000 → large payment path.
        """
        loan = _make_loan(13, "interest_only",
                          principal_amount=Decimal("100000"),
                          interest_rate=Decimal("12"))
        db = _make_db(loan)
        outstanding = _make_outstanding("100000", "1000")

        with patch("app.services.payment_allocation.calculate_outstanding",
                   return_value=outstanding):
            result = allocate_payment(13, Decimal("2000"), date(2024, 2, 1), db)

        # Payment >= threshold → large path: clear interest first
        assert result["allocated_to_current_interest"] == Decimal("1000")
        assert result["allocated_to_principal"] == Decimal("1000")


# ---------------------------------------------------------------------------
# short_term loan allocation
# ---------------------------------------------------------------------------

class TestShortTermAllocation:
    def test_no_interest_outstanding_all_to_principal(self):
        """
        short_term with zero interest outstanding: all payment → principal.
        """
        loan = _make_loan(20, "short_term",
                          principal_amount=Decimal("50000"),
                          interest_rate=Decimal("0"))
        db = _make_db(loan)
        outstanding = _make_outstanding("50000", "0")

        with patch("app.services.payment_allocation.calculate_outstanding",
                   return_value=outstanding):
            result = allocate_payment(20, Decimal("10000"), date(2024, 3, 1), db)

        assert result["allocated_to_current_interest"] == Decimal("0")
        assert result["allocated_to_principal"] == Decimal("10000")
        assert result["unallocated"] == Decimal("0")

    def test_payment_lte_interest_all_to_interest(self):
        """
        short_term: payment=500, interest_outstanding=1000 → all to interest.
        """
        loan = _make_loan(21, "short_term",
                          principal_amount=Decimal("50000"))
        db = _make_db(loan)
        outstanding = _make_outstanding("50000", "1000")

        with patch("app.services.payment_allocation.calculate_outstanding",
                   return_value=outstanding):
            result = allocate_payment(21, Decimal("500"), date(2024, 3, 1), db)

        assert result["allocated_to_current_interest"] == Decimal("500")
        assert result["allocated_to_principal"] == Decimal("0")

    def test_payment_greater_than_interest_splits_correctly(self):
        """
        short_term: interest=1000, principal=50000, payment=5000.
        → interest=1000, principal=4000, unallocated=0.
        """
        loan = _make_loan(22, "short_term",
                          principal_amount=Decimal("50000"))
        db = _make_db(loan)
        outstanding = _make_outstanding("50000", "1000")

        with patch("app.services.payment_allocation.calculate_outstanding",
                   return_value=outstanding):
            result = allocate_payment(22, Decimal("5000"), date(2024, 3, 1), db)

        assert result["allocated_to_current_interest"] == Decimal("1000")
        assert result["allocated_to_principal"] == Decimal("4000")
        assert result["unallocated"] == Decimal("0")

    def test_surplus_beyond_full_outstanding(self):
        """
        short_term: interest=500, principal=10000, payment=20000.
        Surplus after full recovery goes to current_interest. unallocated stays 0.
        """
        loan = _make_loan(23, "short_term",
                          principal_amount=Decimal("10000"))
        db = _make_db(loan)
        outstanding = _make_outstanding("10000", "500")

        with patch("app.services.payment_allocation.calculate_outstanding",
                   return_value=outstanding):
            result = allocate_payment(23, Decimal("20000"), date(2024, 3, 1), db)

        # interest=500, principal=10000, surplus=9500 → current_interest += 9500
        assert result["allocated_to_current_interest"] == Decimal("500") + Decimal("9500")
        assert result["allocated_to_principal"] == Decimal("10000")
        assert result["unallocated"] == Decimal("0")


# ---------------------------------------------------------------------------
# Nonexistent loan
# ---------------------------------------------------------------------------

class TestNonExistentLoan:
    def test_nonexistent_loan_returns_all_unallocated(self):
        """
        When the loan_id is not found, the full payment is returned as unallocated
        with all other buckets at zero.
        """
        db = MagicMock()
        query_mock = MagicMock()
        filter_mock = MagicMock()
        filter_mock.first.return_value = None  # loan not found
        query_mock.filter.return_value = filter_mock
        db.query.return_value = query_mock

        payment = Decimal("5000")
        result = allocate_payment(9999, payment, date(2024, 1, 1), db)

        assert result["allocated_to_overdue_interest"] == Decimal("0")
        assert result["allocated_to_current_interest"] == Decimal("0")
        assert result["allocated_to_principal"] == Decimal("0")
        assert result["unallocated"] == payment
