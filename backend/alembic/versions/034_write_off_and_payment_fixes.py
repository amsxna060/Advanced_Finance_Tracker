"""Add write_off_amount to loans; fix past payment allocations

Revision ID: 034_write_off_and_payment_fixes
Revises: 033_property_simulations
Create Date: 2026-05-05

Data fixes applied:
  - Loan 34 pmt 79  (ST):  allocate ₹6,000 surplus to current_interest
  - Loan 17 pmts 121,124  (EMI, ratio=0.25): proper interest/principal split
  - Loan 32 pmt 125       (EMI, ratio=0.25): proper interest/principal split
  - Loan 51 pmts 42,43,44,52,109 (taken EMI, ratio=23600/123600): proper split
  - Loan 4  pmt 98  (IO):  allocate ₹26.67 residual to current_interest
  - Loan 5  (IO, closed):  set write_off_amount = 7040.80
"""
from alembic import op

revision = "034_write_off_and_payment_fixes"
down_revision = "033_property_simulations"
branch_labels = None
depends_on = None


def upgrade():
    # ── Schema ───────────────────────────────────────────────────────────────
    op.execute(
        "ALTER TABLE loans ADD COLUMN IF NOT EXISTS write_off_amount NUMERIC(15,2) DEFAULT 0"
    )

    # ── Issue 3: Loan 34 ST payment 79 ───────────────────────────────────────
    # amount_paid=156000, princ=150000, curr_int=0 → surplus 6000 = interest/profit
    op.execute(
        "UPDATE loan_payments SET allocated_to_current_interest = 6000.00 WHERE id = 79"
    )

    # ── Issue 4: Loan 17 EMI payments (principal=9000, emi=1200, tenure=10) ──
    # interest_ratio = (12000-9000)/12000 = 0.25, principal_ratio = 0.75

    # pmt 121: emi_portion = amount_paid(2100) - penalty_paid(900) = 1200
    #          interest = 1200 × 0.25 = 300, principal = 900
    op.execute("""
        UPDATE loan_payments
        SET allocated_to_overdue_interest = 0,
            allocated_to_current_interest = 300.00,
            allocated_to_principal        = 900.00
        WHERE id = 121
    """)

    # pmt 124: emi_portion = 4800 (no penalty)
    #          interest = 4800 × 0.25 = 1200, principal = 3600
    op.execute("""
        UPDATE loan_payments
        SET allocated_to_overdue_interest = 0,
            allocated_to_current_interest = 1200.00,
            allocated_to_principal        = 3600.00
        WHERE id = 124
    """)

    # ── Issue 4: Loan 32 EMI payment (principal=45000, emi=6000, tenure=10) ─
    # interest_ratio = (60000-45000)/60000 = 0.25

    # pmt 125: emi_portion = amount_paid(6250) - penalty_paid(250) = 6000
    #          interest = 6000 × 0.25 = 1500, principal = 4500
    op.execute("""
        UPDATE loan_payments
        SET allocated_to_overdue_interest = 0,
            allocated_to_current_interest = 1500.00,
            allocated_to_principal        = 4500.00
        WHERE id = 125
    """)

    # ── Loan 51 taken EMI (principal=100000, emi=5150, tenure=24) ────────────
    # interest_ratio = (123600-100000)/123600 = 23600/123600
    # For each payment: emi_portion = amount_paid - penalty_paid (all penalty=0 here)

    # pmts 42, 43, 44, 52: each amount_paid=5150
    #   interest = ROUND(5150 × 23600/123600, 2) = 983.33
    #   principal = 5150 - 983.33 = 4166.67
    op.execute("""
        UPDATE loan_payments
        SET allocated_to_overdue_interest = 0,
            allocated_to_current_interest = ROUND(CAST((amount_paid - COALESCE(penalty_paid, 0)) * 23600.0 / 123600.0 AS NUMERIC), 2),
            allocated_to_principal        = (amount_paid - COALESCE(penalty_paid, 0))
                                            - ROUND(CAST((amount_paid - COALESCE(penalty_paid, 0)) * 23600.0 / 123600.0 AS NUMERIC), 2)
        WHERE id IN (42, 43, 44, 52, 109)
    """)

    # ── Issue 5: Loan 4 IO payment 98 ────────────────────────────────────────
    # amount_paid=28400, curr_int=8373.33, princ=20000 → residual 26.67 → interest
    op.execute(
        "UPDATE loan_payments SET allocated_to_current_interest = 8400.00 WHERE id = 98"
    )

    # ── Issue 6: Loan 5 write-off ─────────────────────────────────────────────
    # IO loan, principal=15000, principal_recovered=7959.20, shortfall=7040.80
    op.execute(
        "UPDATE loans SET write_off_amount = 7040.80 WHERE id = 5"
    )


def downgrade():
    op.execute("ALTER TABLE loans DROP COLUMN IF EXISTS write_off_amount")
    # Note: payment allocation reversals are not applied on downgrade
    # as the original data had known issues and the corrections are the
    # ground truth.
