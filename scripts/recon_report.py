#!/usr/bin/env python3
"""
Production data reconciliation report — STRICTLY READ-ONLY.

Scans a running Finance Tracker instance through its public API (GET requests
only, plus the login POST) and reports historical data corrupted by bugs that
were fixed in the 2026-06-12 remediation but whose stored effects do not
self-heal:

  R1  Accounts with old `balance_adjustment` ledger entries
      (opening-balance edits used to apply the delta twice — the entry AND the
      field update both survive in old data; balance overstated by the entry)
  R2  Phantom force-close write-off debits
      (force-close used to post a cash debit although no cash moved)
  R3  Closed/active loans where live payment allocations don't add up
      (payments voided before the fix never re-allocated later payments)
  R4  Open partnership-settlement obligations created before the fix
      (amounts may ignore pot money the partner had already spent)
  R5  Members whose advance_contributed includes pot-funded transactions
  R6  Ledger rows whose module link is dangling (source record deleted/voided)

Usage:
    python3 scripts/recon_report.py --base-url https://api.financerbuddy.com \
        --username <admin> [--password <pw> | env RECON_PASSWORD]

    # or against local dev:
    python3 scripts/recon_report.py --base-url http://localhost:8000 \
        --username testadmin --password testpass123

Output: human-readable report on stdout; exit code 0 always (report-only).
Nothing is written to the server — only GET endpoints are called.
"""
import argparse
import getpass
import os
import sys
from collections import defaultdict
from decimal import Decimal

try:
    import httpx
except ImportError:
    print("pip install httpx  (read-only HTTP client)")
    sys.exit(1)

D = lambda v: Decimal(str(v if v is not None else 0))


class Api:
    def __init__(self, base_url: str, username: str, password: str):
        self.client = httpx.Client(base_url=base_url.rstrip("/"), timeout=60)
        resp = self.client.post("/api/auth/login",
                                data={"username": username, "password": password})
        resp.raise_for_status()
        token = resp.json()["access_token"]
        self.client.headers["Authorization"] = f"Bearer {token}"

    def get(self, path: str, **params):
        resp = self.client.get(path, params=params or None)
        resp.raise_for_status()
        return resp.json()


def _section(title):
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--username", required=True)
    ap.add_argument("--password", default=os.environ.get("RECON_PASSWORD"))
    args = ap.parse_args()
    password = args.password or getpass.getpass("Password: ")

    api = Api(args.base_url, args.username, password)
    findings = 0

    accounts = api.get("/api/accounts")
    acct_names = {a["id"]: a["name"] for a in accounts}

    # Pull full ledger per account (including voided, for context)
    txns_by_account = {}
    for a in accounts:
        txns_by_account[a["id"]] = api.get(
            f"/api/accounts/{a['id']}/transactions", limit=1000, include_voided=True)

    # ── R1: balance_adjustment double-count ────────────────────────────────
    # Only entries auto-created by the old opening-balance bug carry the
    # "Opening balance adjusted from X to Y" description. Manual entries the
    # user filed under the balance_adjustment type are legitimate — skip them.
    _section("R1 — Opening-balance double-count (old balance_adjustment entries)")
    for aid, txns in txns_by_account.items():
        rows = [t for t in txns
                if t.get("linked_type") == "balance_adjustment" and not t["is_voided"]
                and "Opening balance adjusted from" in (t.get("description") or "")]
        for t in rows:
            findings += 1
            sign = 1 if t["txn_type"] == "credit" else -1
            print(f"  ⚠ Account '{acct_names[aid]}' (#{aid}): live balance_adjustment "
                  f"{t['txn_type']} of ₹{D(t['amount']):,} dated {t['txn_date']} "
                  f"(txn #{t['id']}). If the opening balance was ALSO updated at the "
                  f"time, this account is overstated by ₹{sign * D(t['amount']):,} — "
                  f"voiding this entry corrects it.")
    if not findings:
        print("  ✓ none found")

    # ── R2: phantom force-close write-offs ────────────────────────────────
    _section("R2 — Phantom force-close write-off ledger entries")
    r2 = 0
    for aid, txns in txns_by_account.items():
        for t in txns:
            if not t["is_voided"] and "Force-close write-off" in (t.get("description") or ""):
                r2 += 1
                print(f"  ⚠ Account '{acct_names[aid]}' (#{aid}): write-off "
                      f"{t['txn_type']} ₹{D(t['amount']):,} on {t['txn_date']} "
                      f"(txn #{t['id']}). No cash moved at force-close — this row "
                      f"understates the account; voiding it corrects the balance.")
    findings += r2
    if r2 == 0:
        print("  ✓ none found")

    # ── R3: loan allocation identity check ─────────────────────────────────
    _section("R3 — Loans whose payment allocations don't reconcile")
    r3 = 0
    loans = api.get("/api/loans", limit=500)
    for loan in loans:
        if loan["loan_type"] == "emi":
            continue  # proportional model — identity does not apply
        detail = api.get(f"/api/loans/{loan['id']}")
        pays = detail["payments"]
        if not pays:
            continue
        alloc_total = sum(
            D(p["allocated_to_principal"]) + D(p["allocated_to_current_interest"])
            + D(p["allocated_to_overdue_interest"]) + D(p.get("penalty_paid") or 0)
            for p in pays)
        paid_total = sum(D(p["amount_paid"]) for p in pays)
        drift = paid_total - alloc_total
        if abs(drift) > Decimal("1"):
            r3 += 1
            print(f"  ⚠ Loan #{loan['id']} ({detail['contact']['name'] if detail.get('contact') else '?'}, "
                  f"{loan['loan_type']}, {loan['status']}): payments total ₹{paid_total:,} "
                  f"but allocations cover ₹{alloc_total:,} (drift ₹{drift:,}). "
                  f"Likely a pre-fix void without re-allocation — run POST /api/loans/{loan['id']}/reconcile "
                  f"or re-void/re-record the affected payment.")
    findings += r3
    if r3 == 0:
        print("  ✓ all loan allocations reconcile")

    # ── R4: pre-fix partnership settlement obligations ─────────────────────
    _section("R4 — Open partnership-settlement obligations (verify amounts)")
    r4 = 0
    obls = api.get("/api/obligations", limit=500)
    for row in obls:
        ob = row["obligation"]
        if ob.get("linked_type") == "partnership" and ob["status"] != "settled":
            r4 += 1
            who = row["contact"]["name"] if row.get("contact") else "?"
            print(f"  ⚠ Obligation #{ob['id']} ({ob['obligation_type']}) ₹{D(ob['amount']):,} "
                  f"to/from {who} — created by a partnership settlement. If the partner "
                  f"had spent pot money before settlement, the pre-fix amount over-charges "
                  f"them by that spend. Cross-check against "
                  f"GET /api/partnerships/{ob['linked_id']}/settlement-preview.")
    findings += r4
    if r4 == 0:
        print("  ✓ none open")

    # ── R5: pot-funded advances inside advance_contributed ────────────────
    _section("R5 — advance_contributed inflated by pot-funded transactions")
    r5 = 0
    partnerships = api.get("/api/partnerships", limit=500)
    for p in partnerships:
        detail = api.get(f"/api/partnerships/{p['id']}")
        pot_advances = defaultdict(Decimal)
        for t in detail["transactions"]:
            if (t["txn_type"] in ("advance_to_seller", "advance_given")
                    and t.get("from_partnership_pot") and t.get("member_id")):
                pot_advances[t["member_id"]] += D(t["amount"])
        for m in detail["members"]:
            mem = m["member"]
            pot = pot_advances.get(mem["id"], Decimal("0"))
            if pot > 0 and D(mem["advance_contributed"]) >= pot:
                r5 += 1
                name = m["contact"]["name"] if m.get("contact") else ("Self" if mem["is_self"] else "?")
                print(f"  ⚠ Partnership '{p['title']}' member {name}: advance_contributed "
                      f"₹{D(mem['advance_contributed']):,} includes ₹{pot:,} of pot-funded "
                      f"advances recorded pre-fix (recycled buyer money, not fresh capital). "
                      f"Edit+resave one transaction on the partnership to trigger a resync, "
                      f"or adjust the member record.")
    findings += r5
    if r5 == 0:
        print("  ✓ none found")

    # ── R6: dangling module links ───────────────────────────────────────────
    _section("R6 — Live ledger rows pointing at deleted/missing source records")
    r6 = 0
    live_loan_ids = {l["id"] for l in loans}
    live_partnership_ids = {p["id"] for p in partnerships}
    for aid, txns in txns_by_account.items():
        for t in txns:
            if t["is_voided"]:
                continue
            if t.get("linked_type") == "loan" and t.get("linked_id") and t["linked_id"] not in live_loan_ids:
                r6 += 1
                print(f"  ⚠ Account '{acct_names[aid]}': txn #{t['id']} ₹{D(t['amount']):,} "
                      f"links to loan #{t['linked_id']} which is deleted/not visible.")
            if t.get("linked_type") == "partnership" and t.get("linked_id") and t["linked_id"] not in live_partnership_ids:
                r6 += 1
                print(f"  ⚠ Account '{acct_names[aid]}': txn #{t['id']} ₹{D(t['amount']):,} "
                      f"links to partnership #{t['linked_id']} which is deleted/not visible.")
    findings += r6
    if r6 == 0:
        print("  ✓ none found")

    _section(f"SUMMARY — {findings} item(s) need review")
    print("This report is read-only; nothing was changed on the server.\n"
          "Review each item above, then apply corrections manually from the app\n"
          "(voiding the flagged ledger rows / re-running loan reconcile) — or ask\n"
          "for a guided fix list.")


if __name__ == "__main__":
    main()
