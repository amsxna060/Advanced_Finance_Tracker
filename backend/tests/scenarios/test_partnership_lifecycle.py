"""Full partnership + property lifecycle: members, buyers, transactions,
pot money, partner transfers, settlement preview vs actual obligations."""
from datetime import date

import pytest

from tests.scenarios.helpers import (
    make_account, make_contact, make_property, make_partnership,
    add_member, add_partnership_txn, account_balance, account_txns,
)


def _setup_deal(client, db, headers):
    """Plot 1000 sqft @500 seller (=500k), partnership self 50% + partner 50%,
    buyer at 800k."""
    prop = make_property(client, headers)
    assert float(prop["total_seller_value"]) == 500000

    partnership = make_partnership(client, headers, property_id=prop["id"])
    self_member = add_member(client, headers, partnership["id"], 50, is_self=True)
    partner_contact = make_contact(db, name="Partner R", relationship_type="partner")
    partner_member = add_member(client, headers, partnership["id"], 50,
                                contact_id=partner_contact.id)

    resp = client.post(f"/api/partnerships/{partnership['id']}/create-buyer",
                       headers=headers, json={
                           "name": "Buyer B", "area_sqft": 1000, "rate_per_sqft": 800,
                       })
    assert resp.status_code == 200, resp.text
    buyer = resp.json()["plot_buyer"]
    return prop, partnership, self_member, partner_member, partner_contact, buyer


class TestSettlementParity:
    def test_preview_equals_created_obligations_with_pot_spend(
            self, client, db, admin_user, auth_headers):
        """P1: partner held 800k buyer cash, spent 50k broker from pot →
        preview and settle must both charge them entitlement − 750k."""
        prop, p, self_m, partner_m, partner_contact, buyer = _setup_deal(client, db, auth_headers)
        acct = make_account(client, auth_headers, opening_balance=1000000)

        add_partnership_txn(client, auth_headers, p["id"], "advance_to_seller", 200000,
                            member_id=self_m["id"], account_id=acct["id"])
        add_partnership_txn(client, auth_headers, p["id"], "remaining_to_seller", 300000,
                            member_id=partner_m["id"])
        add_partnership_txn(client, auth_headers, p["id"], "buyer_payment", 800000,
                            received_by_member_id=partner_m["id"],
                            plot_buyer_id=buyer["id"])
        add_partnership_txn(client, auth_headers, p["id"], "broker_commission", 50000,
                            member_id=partner_m["id"], from_partnership_pot=True,
                            broker_name="Broker X")

        preview = client.get(f"/api/partnerships/{p['id']}/settlement-preview",
                             headers=auth_headers).json()
        assert preview["net_profit"] == pytest.approx(250000)

        partner_row = next(m for m in preview["members"] if not m["is_self"])
        assert partner_row["final_entitlement"] == pytest.approx(425000)   # 300k + 125k profit
        assert partner_row["buyer_cash_held"] == pytest.approx(750000)     # 800k − 50k pot broker
        assert partner_row["net_obligation"] == pytest.approx(-325000)

        resp = client.put(f"/api/partnerships/{p['id']}/settle", headers=auth_headers,
                          json={"actual_end_date": date.today().isoformat()})
        assert resp.status_code == 200, resp.text

        obls = client.get("/api/obligations", headers=auth_headers,
                          params={"contact_id": partner_contact.id}).json()
        assert len(obls) == 1
        ob = obls[0]["obligation"]
        assert ob["obligation_type"] == "receivable"
        assert float(ob["amount"]) == pytest.approx(abs(partner_row["net_obligation"]), abs=0.02), (
            "settle created a different obligation than the preview showed")

    def test_partner_transfer_affects_settlement_and_ledger(
            self, client, db, admin_user, auth_headers):
        """P3: a partner transferring held cash to self must credit the account
        and shrink their settlement debt."""
        prop, p, self_m, partner_m, partner_contact, buyer = _setup_deal(client, db, auth_headers)
        acct = make_account(client, auth_headers, opening_balance=0)

        add_partnership_txn(client, auth_headers, p["id"], "advance_to_seller", 200000,
                            member_id=self_m["id"])
        add_partnership_txn(client, auth_headers, p["id"], "remaining_to_seller", 300000,
                            member_id=partner_m["id"])
        add_partnership_txn(client, auth_headers, p["id"], "buyer_payment", 800000,
                            received_by_member_id=partner_m["id"], plot_buyer_id=buyer["id"])
        # Partner hands 200k of held buyer cash to self (into my account)
        add_partnership_txn(client, auth_headers, p["id"], "partner_transfer", 200000,
                            member_id=partner_m["id"],
                            received_by_member_id=self_m["id"],
                            account_id=acct["id"])

        # Ledger: credit posted
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(200000), (
            "partner_transfer to self must credit the chosen account")

        preview = client.get(f"/api/partnerships/{p['id']}/settlement-preview",
                             headers=auth_headers).json()
        partner_row = next(m for m in preview["members"] if not m["is_self"])
        self_row = next(m for m in preview["members"] if m["is_self"])
        # profit = 800k − 500k = 300k → 150k each
        assert partner_row["buyer_cash_held"] == pytest.approx(600000)
        assert partner_row["net_obligation"] == pytest.approx((300000 + 150000) - 600000)
        assert self_row["buyer_cash_held"] == pytest.approx(200000)

    def test_transfer_void_reverses_ledger(self, client, db, admin_user, auth_headers):
        prop, p, self_m, partner_m, partner_contact, buyer = _setup_deal(client, db, auth_headers)
        acct = make_account(client, auth_headers, opening_balance=0)
        add_partnership_txn(client, auth_headers, p["id"], "buyer_payment", 100000,
                            received_by_member_id=partner_m["id"], plot_buyer_id=buyer["id"])
        t = add_partnership_txn(client, auth_headers, p["id"], "partner_transfer", 50000,
                                member_id=partner_m["id"],
                                received_by_member_id=self_m["id"],
                                account_id=acct["id"])
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(50000)
        resp = client.delete(f"/api/partnerships/{p['id']}/transactions/{t['id']}",
                             headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(0)


class TestTotalsIntegrity:
    def test_edit_partner_held_inflow_does_not_corrupt_total_received(
            self, client, db, admin_user, auth_headers):
        """P2: editing a buyer payment held by a partner must not subtract from
        total_received an amount that was never added."""
        prop, p, self_m, partner_m, partner_contact, buyer = _setup_deal(client, db, auth_headers)
        t = add_partnership_txn(client, auth_headers, p["id"], "buyer_payment", 100000,
                                received_by_member_id=partner_m["id"],
                                plot_buyer_id=buyer["id"])

        before = client.get(f"/api/partnerships/{p['id']}", headers=auth_headers).json()
        tr_before = float(before["partnership"]["total_received"])

        # Edit: same everything, just the amount
        resp = client.put(f"/api/partnerships/{p['id']}/transactions/{t['id']}",
                          headers=auth_headers, json={
                              "txn_type": "buyer_payment", "amount": 100000,
                              "txn_date": date.today().isoformat(),
                              "received_by_member_id": partner_m["id"],
                              "plot_buyer_id": buyer["id"],
                          })
        assert resp.status_code == 200, resp.text

        after = client.get(f"/api/partnerships/{p['id']}", headers=auth_headers).json()
        tr_after = float(after["partnership"]["total_received"])
        assert tr_after == pytest.approx(tr_before, abs=0.02), (
            f"total_received drifted {tr_before} → {tr_after} on a no-op edit")

    def test_pot_funded_outflow_not_counted_as_investment(
            self, client, db, admin_user, auth_headers):
        """P5: recycling buyer money to the seller is not fresh capital."""
        prop, p, self_m, partner_m, partner_contact, buyer = _setup_deal(client, db, auth_headers)
        add_partnership_txn(client, auth_headers, p["id"], "buyer_payment", 400000,
                            received_by_member_id=partner_m["id"], plot_buyer_id=buyer["id"])
        add_partnership_txn(client, auth_headers, p["id"], "remaining_to_seller", 400000,
                            member_id=partner_m["id"], from_partnership_pot=True)

        detail = client.get(f"/api/partnerships/{p['id']}", headers=auth_headers).json()
        assert float(detail["partnership"]["our_investment"]) == pytest.approx(0), (
            "pot-funded seller payment inflated our_investment")

    def test_member_with_transactions_cannot_be_deleted_with_500(
            self, client, db, admin_user, auth_headers):
        """P4: must be a clean 400, not an FK-violation 500."""
        prop, p, self_m, partner_m, partner_contact, buyer = _setup_deal(client, db, auth_headers)
        add_partnership_txn(client, auth_headers, p["id"], "expense", 5000,
                            member_id=partner_m["id"])
        resp = client.delete(f"/api/partnerships/{p['id']}/members/{partner_m['id']}",
                             headers=auth_headers)
        assert resp.status_code == 400, f"expected 400, got {resp.status_code}: {resp.text}"

    def test_buyer_fully_paid_status(self, client, db, admin_user, auth_headers):
        """P7: full payment should mark the buyer fully_paid (a documented status)."""
        prop, p, self_m, partner_m, partner_contact, buyer = _setup_deal(client, db, auth_headers)
        add_partnership_txn(client, auth_headers, p["id"], "buyer_payment", 800000,
                            received_by_member_id=self_m["id"], plot_buyer_id=buyer["id"])
        detail = client.get(f"/api/partnerships/{p['id']}", headers=auth_headers).json()
        b = next(x for x in detail["plot_buyers"] if x["id"] == buyer["id"])
        assert b["status"] == "fully_paid"


class TestPlotEndpoints:
    def test_plot_update_not_blocked_by_creator(self, client, db, admin_user, auth_headers):
        """P6: plots belong to the partnership, not to whoever created it.
        (Here the same admin edits, but the created_by filter was removed —
        the endpoint must resolve the partnership by id alone.)"""
        prop, p, self_m, partner_m, partner_contact, buyer = _setup_deal(client, db, auth_headers)
        resp = client.put(f"/api/partnerships/{p['id']}/plot-buyers/{buyer['id']}",
                          headers=auth_headers, json={"area_sqft": 900})
        assert resp.status_code == 200, resp.text
        # PR5 analogue: total_value recalculated from merged values
        assert float(resp.json()["total_value"]) == pytest.approx(900 * 800)
