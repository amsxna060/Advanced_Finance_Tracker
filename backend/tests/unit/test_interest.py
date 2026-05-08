"""
Unit tests for app/services/interest.py pure functions.
No DB or HTTP calls required — pure math.
"""

import pytest
from datetime import date
from decimal import Decimal

from app.services.interest import (
    _days_in_year,
    _build_monthly_periods,
    _calc_period_interest,
    _solve_emi_monthly_rate,
)


# ---------------------------------------------------------------------------
# _days_in_year
# ---------------------------------------------------------------------------

class TestDaysInYear:
    def test_leap_year_2024(self):
        assert _days_in_year(2024) == 366

    def test_leap_year_2000(self):
        # Century year divisible by 400 → leap
        assert _days_in_year(2000) == 366

    def test_leap_year_1996(self):
        assert _days_in_year(1996) == 366

    def test_non_leap_year_2023(self):
        assert _days_in_year(2023) == 365

    def test_non_leap_year_1900(self):
        # Century year NOT divisible by 400 → not a leap year
        assert _days_in_year(1900) == 365

    def test_non_leap_year_2019(self):
        assert _days_in_year(2019) == 365

    def test_non_leap_year_2025(self):
        assert _days_in_year(2025) == 365


# ---------------------------------------------------------------------------
# _build_monthly_periods
# ---------------------------------------------------------------------------

class TestBuildMonthlyPeriods:
    def test_single_day_range(self):
        """start == end should produce exactly one period of 1 day."""
        d = date(2024, 1, 15)
        periods = _build_monthly_periods(d, d)
        assert len(periods) == 1
        p_start, p_end, full_days = periods[0]
        assert p_start == d
        assert (p_end - p_start).days == 1

    def test_one_full_month_jan(self):
        """Jan 1 → Jan 31 (inclusive) = 1 period, 31 days."""
        start = date(2024, 1, 1)
        end = date(2024, 1, 31)
        periods = _build_monthly_periods(start, end)
        assert len(periods) == 1
        p_start, p_end, full_days = periods[0]
        assert p_start == start
        assert (p_end - p_start).days == 31
        assert full_days == 31

    def test_partial_month(self):
        """Jan 15 → Jan 29 (15 days). Should be 1 partial period."""
        start = date(2024, 1, 15)
        end = date(2024, 1, 29)
        periods = _build_monthly_periods(start, end)
        assert len(periods) == 1
        _, p_end, full_days = periods[0]
        days = (p_end - start).days
        assert days == 15          # Jan 15 to Jan 30 exclusive
        assert full_days == 31     # full month = 31 days (Jan 15 → Feb 15)

    def test_multiple_months(self):
        """Jan 1 → Mar 31: should produce 3 periods."""
        start = date(2024, 1, 1)
        end = date(2024, 3, 31)
        periods = _build_monthly_periods(start, end)
        # Jan 1→Feb 1, Feb 1→Mar 1, Mar 1→Apr 1
        assert len(periods) == 3
        for p_start, p_end, full_days in periods:
            assert full_days > 0
            assert (p_end - p_start).days > 0

    def test_month_end_anchor_jan31(self):
        """Loan on Jan 31 → periods anchor to Jan 31 each month."""
        start = date(2024, 1, 31)
        end = date(2024, 3, 31)
        periods = _build_monthly_periods(start, end)
        # Period 1: Jan 31 → Feb 29 (2024 is leap), Period 2: Feb 29 → Mar 31
        assert len(periods) >= 2
        # First period starts on Jan 31
        assert periods[0][0] == date(2024, 1, 31)

    def test_returns_list_of_tuples(self):
        start = date(2024, 6, 1)
        end = date(2024, 7, 31)
        periods = _build_monthly_periods(start, end)
        assert isinstance(periods, list)
        for item in periods:
            assert len(item) == 3  # (p_start, p_end_excl, full_days)

    def test_no_periods_for_reversed_dates(self):
        """start > end should return an empty list."""
        periods = _build_monthly_periods(date(2024, 6, 1), date(2024, 5, 1))
        assert periods == []


# ---------------------------------------------------------------------------
# _calc_period_interest
# ---------------------------------------------------------------------------

class TestCalcPeriodInterest:
    def test_commercial_full_period_exact(self):
        """
        principal=100000, annual_rate=12% => monthly = 100000 * 12/1200 = 1000.
        Full 30-day period: days == full_period_days => no proration.
        """
        result = _calc_period_interest(
            principal=Decimal("100000"),
            annual_rate=Decimal("12"),
            period_start=date(2024, 1, 1),
            days=30,
            full_period_days=30,
            banking=False,
        )
        assert result == Decimal("1000.00")

    def test_commercial_partial_period(self):
        """
        100000 @ 12%pa, 15 days out of 30-day full period.
        Expected = 100000 * 12/1200 * 15/30 = 500.
        """
        result = _calc_period_interest(
            principal=Decimal("100000"),
            annual_rate=Decimal("12"),
            period_start=date(2024, 1, 1),
            days=15,
            full_period_days=30,
            banking=False,
        )
        assert result == Decimal("500")

    def test_banking_365_mode(self):
        """
        100000 @ 12% annual, 31 days, banking=True.
        The function uses _days_in_year(period_start.year) as denominator.
        2024 is a leap year → denominator = 366.
        Expected = 100000 * 12/100 * 31/366 ≈ 1016.39.
        """
        result = _calc_period_interest(
            principal=Decimal("100000"),
            annual_rate=Decimal("12"),
            period_start=date(2024, 1, 1),
            days=31,
            full_period_days=31,
            banking=True,
        )
        # 2024 is a leap year, so denominator is 366
        expected = (Decimal("100000") * Decimal("12") / Decimal("100") * Decimal("31") / Decimal("366")).quantize(Decimal("0.01"))
        assert result == expected

    def test_banking_uses_leap_year_days(self):
        """In a leap year, banking mode uses 366 as denominator."""
        result_leap = _calc_period_interest(
            principal=Decimal("100000"),
            annual_rate=Decimal("12"),
            period_start=date(2024, 1, 1),  # 2024 is leap
            days=31,
            full_period_days=31,
            banking=True,
        )
        result_normal = _calc_period_interest(
            principal=Decimal("100000"),
            annual_rate=Decimal("12"),
            period_start=date(2023, 1, 1),  # 2023 is not leap
            days=31,
            full_period_days=31,
            banking=True,
        )
        # Leap year should give less interest (bigger denominator)
        assert result_leap < result_normal

    def test_zero_rate_returns_zero(self):
        result = _calc_period_interest(
            principal=Decimal("100000"),
            annual_rate=Decimal("0"),
            period_start=date(2024, 1, 1),
            days=30,
            full_period_days=30,
            banking=False,
        )
        assert result == Decimal("0")

    def test_zero_principal_returns_zero(self):
        result = _calc_period_interest(
            principal=Decimal("0"),
            annual_rate=Decimal("12"),
            period_start=date(2024, 1, 1),
            days=30,
            full_period_days=30,
            banking=False,
        )
        assert result == Decimal("0")

    def test_commercial_no_proration_when_days_equals_full(self):
        """When days == full_period_days, commercial mode returns flat monthly interest."""
        result = _calc_period_interest(
            principal=Decimal("50000"),
            annual_rate=Decimal("24"),
            period_start=date(2024, 2, 1),
            days=29,
            full_period_days=29,
            banking=False,
        )
        expected = Decimal("50000") * Decimal("24") / Decimal("1200")
        assert result == expected


# ---------------------------------------------------------------------------
# _solve_emi_monthly_rate
# ---------------------------------------------------------------------------

class TestSolveEmiMonthlyRate:
    def test_zero_rate_when_payment_times_tenure_equals_principal(self):
        """If EMI * N == P, there is no interest — rate should be 0."""
        principal = Decimal("120000")
        emi = Decimal("10000")
        tenure = 12
        rate = _solve_emi_monthly_rate(principal, emi, tenure)
        assert rate == Decimal("0")

    def test_positive_rate_for_standard_emi(self):
        """A standard EMI with embedded interest implies a positive monthly rate."""
        # 1,00,000 @ ~2% per month for 12 months: EMI ≈ 9456
        principal = Decimal("100000")
        emi = Decimal("9456")
        tenure = 12
        rate = _solve_emi_monthly_rate(principal, emi, tenure)
        assert rate > Decimal("0")

    def test_higher_emi_implies_higher_rate(self):
        """Holding P and N fixed, a larger EMI implies a higher embedded rate."""
        principal = Decimal("100000")
        tenure = 12
        rate_low = _solve_emi_monthly_rate(principal, Decimal("9000"), tenure)
        rate_high = _solve_emi_monthly_rate(principal, Decimal("10000"), tenure)
        assert rate_high > rate_low

    def test_zero_principal_returns_zero(self):
        rate = _solve_emi_monthly_rate(Decimal("0"), Decimal("1000"), 12)
        assert rate == Decimal("0")

    def test_zero_emi_returns_zero(self):
        rate = _solve_emi_monthly_rate(Decimal("100000"), Decimal("0"), 12)
        assert rate == Decimal("0")

    def test_rate_precision(self):
        """Result should be quantized to 7 decimal places."""
        rate = _solve_emi_monthly_rate(Decimal("100000"), Decimal("9500"), 12)
        # Check precision — result should have at most 7 decimal places
        assert rate == rate.quantize(Decimal("0.0000001"))
