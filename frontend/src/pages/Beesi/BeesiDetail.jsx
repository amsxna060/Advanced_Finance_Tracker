import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";

export default function BeesiDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [showInstallmentForm, setShowInstallmentForm] = useState(false);
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [instForm, setInstForm] = useState({
    payment_date: "",
    actual_paid: "",
    notes: "",
  });
  const [withdrawForm, setWithdrawForm] = useState({
    withdrawal_date: "",
    net_received: "",
    notes: "",
  });
  const [instError, setInstError] = useState("");
  const [withdrawError, setWithdrawError] = useState("");
  const [bidDiscount, setBidDiscount] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(null);

  const { data: beesi, isLoading } = useQuery({
    queryKey: ["beesi", id],
    queryFn: async () => {
      const res = await api.get(`/api/beesi/${id}`);
      return res.data;
    },
  });

  const addInstallment = useMutation({
    mutationFn: (data) => api.post(`/api/beesi/${id}/installments`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["beesi", id] });
      qc.invalidateQueries({ queryKey: ["beesis"] });
      setShowInstallmentForm(false);
      setInstForm({
        payment_date: "",
        actual_paid: "",
        notes: "",
      });
    },
    onError: (e) => setInstError(e.response?.data?.detail || "Failed to save"),
  });

  const addWithdrawal = useMutation({
    mutationFn: (data) => api.post(`/api/beesi/${id}/withdraw`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["beesi", id] });
      qc.invalidateQueries({ queryKey: ["beesis"] });
      setShowWithdrawForm(false);
      setWithdrawForm({ withdrawal_date: "", net_received: "", notes: "" });
    },
    onError: (e) =>
      setWithdrawError(e.response?.data?.detail || "Failed to save"),
  });

  const deleteInstallment = useMutation({
    mutationFn: (instId) =>
      api.delete(`/api/beesi/${id}/installments/${instId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["beesi", id] }),
  });

  const deleteSelf = useMutation({
    mutationFn: () => api.delete(`/api/beesi/${id}`),
    onSuccess: () => navigate("/beesi"),
  });

  // Simple change handlers
  const handleInstChange = (e) =>
    setInstForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const handleWithdrawChange = (e) =>
    setWithdrawForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  // Derive display-only month number from start_date + a given date string
  function calcMonthNumber(startDateStr, paymentDateStr) {
    if (!startDateStr || !paymentDateStr) return "?";
    const start = new Date(startDateStr);
    const payment = new Date(paymentDateStr);
    const months =
      (payment.getFullYear() - start.getFullYear()) * 12 +
      (payment.getMonth() - start.getMonth()) +
      1;
    return Math.max(1, months);
  }

  if (isLoading) return <div className="p-8 text-gray-500">Loading…</div>;
  if (!beesi) return <div className="p-8 text-red-500">Beesi not found</div>;

  const summary = beesi.summary || {};
  const hasPL = summary.has_withdrawn;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <button
              onClick={() => navigate("/beesi")}
              className="text-gray-500 hover:text-gray-900 text-sm mb-1"
            >
              ← Beesi List
            </button>
            <h1 className="text-2xl font-bold text-gray-900">{beesi.title}</h1>
            <p className="text-sm text-gray-500">
              Started {formatDate(beesi.start_date)} · {beesi.tenure_months}{" "}
              months · {beesi.member_count} members
            </p>
            {(beesi.contact_name || beesi.account_name) && (
              <p className="text-xs text-gray-400 mt-0.5">
                {beesi.contact_name && (
                  <span>Organiser: {beesi.contact_name}</span>
                )}
                {beesi.contact_name && beesi.account_name && " · "}
                {beesi.account_name && (
                  <span>Account: {beesi.account_name}</span>
                )}
              </p>
            )}
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <button
                onClick={() => navigate(`/beesi/${id}/edit`)}
                className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
              >
                Edit
              </button>
              <button
                onClick={() => {
                  if (window.confirm("Delete this Beesi?")) deleteSelf.mutate();
                }}
                className="px-3 py-1.5 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 text-sm"
              >
                Delete
              </button>
            </div>
          )}
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Pot Size", value: formatCurrency(beesi.pot_size) },
            {
              label: "Base Installment",
              value: formatCurrency(beesi.base_installment),
            },
            {
              label: "Total Invested",
              value: formatCurrency(summary.total_invested),
              tone: "text-blue-700",
            },
            {
              label: "Months Paid",
              value: `${summary.months_paid || 0} / ${beesi.tenure_months}`,
            },
          ].map((c) => (
            <div key={c.label} className="bg-white rounded-lg shadow-sm p-4">
              <div className="text-xs text-gray-500">{c.label}</div>
              <div
                className={`text-xl font-bold mt-1 ${c.tone || "text-gray-900"}`}
              >
                {c.value}
              </div>
            </div>
          ))}
        </div>

        {/* P&L card if withdrawn */}
        {hasPL && (
          <div
            className={`rounded-lg p-4 mb-6 ${Number(summary.profit_loss) >= 0 ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-600">
                  Net P&L (Withdrawn − Invested)
                </div>
                <div
                  className={`text-2xl font-bold ${Number(summary.profit_loss) >= 0 ? "text-green-700" : "text-red-700"}`}
                >
                  {formatCurrency(summary.profit_loss)} (
                  {summary.profit_loss_pct?.toFixed(1)}%)
                </div>
              </div>
              <div className="text-sm text-gray-500">
                Withdrawn:{" "}
                <span className="font-medium text-gray-800">
                  {formatCurrency(summary.total_withdrawn)}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Installments */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Monthly Installments
              </h2>
              <button
                onClick={() => setShowInstallmentForm(!showInstallmentForm)}
                className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700"
              >
                + Log Payment
              </button>
            </div>

            {showInstallmentForm && (
              <div className="mb-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
                {instError && (
                  <div className="mb-2 text-red-600 text-sm">{instError}</div>
                )}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="block text-gray-600 mb-1">
                      Payment Date *
                    </label>
                    <input
                      name="payment_date"
                      type="date"
                      value={instForm.payment_date}
                      onChange={handleInstChange}
                      required
                      className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-purple-400"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">
                      Amount Paid (₹) *
                    </label>
                    <input
                      name="actual_paid"
                      type="number"
                      min="0"
                      value={instForm.actual_paid}
                      onChange={handleInstChange}
                      placeholder={beesi.base_installment}
                      required
                      className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-purple-400"
                    />
                  </div>
                </div>
                {/* Read-only derived info */}
                {instForm.payment_date && instForm.actual_paid !== "" && (
                  <div className="mt-2 p-2 bg-white rounded border border-purple-100 grid grid-cols-3 gap-2 text-xs text-gray-500">
                    <div>
                      Month #:{" "}
                      <span className="font-semibold text-gray-700">
                        {calcMonthNumber(
                          beesi.start_date,
                          instForm.payment_date,
                        )}
                      </span>
                    </div>
                    <div>
                      Base:{" "}
                      <span className="font-semibold text-gray-700">
                        {formatCurrency(beesi.base_installment)}
                      </span>
                    </div>
                    <div>
                      Dividend:{" "}
                      <span className="font-semibold text-green-600">
                        {formatCurrency(
                          Math.max(
                            0,
                            Number(beesi.base_installment) -
                              Number(instForm.actual_paid),
                          ),
                        )}
                      </span>
                    </div>
                  </div>
                )}
                <div className="mt-2 text-sm">
                  <label className="block text-gray-600 mb-1">Notes</label>
                  <input
                    name="notes"
                    value={instForm.notes}
                    onChange={handleInstChange}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-purple-400"
                  />
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => {
                      setInstError("");
                      addInstallment.mutate({
                        payment_date: instForm.payment_date,
                        actual_paid: Number(instForm.actual_paid),
                        notes: instForm.notes,
                      });
                    }}
                    disabled={addInstallment.isPending}
                    className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm hover:bg-purple-700 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setShowInstallmentForm(false)}
                    className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {(beesi.installments || []).length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">
                  No installments logged yet
                </p>
              ) : (
                (beesi.installments || [])
                  .slice()
                  .reverse()
                  .map((inst) => (
                    <div
                      key={inst.id}
                      className="flex items-center justify-between py-2 border-b border-gray-100 text-sm"
                    >
                      <div>
                        <span className="font-medium">
                          Month {inst.month_number}
                        </span>
                        <span className="text-gray-400 ml-2">
                          {formatDate(inst.payment_date)}
                        </span>
                        {Number(inst.dividend_received) > 0 && (
                          <span className="ml-2 text-xs text-green-600">
                            Div: {formatCurrency(inst.dividend_received)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-gray-800">
                          {formatCurrency(inst.actual_paid)}
                        </span>
                        {isAdmin && (
                          <button
                            onClick={() => deleteInstallment.mutate(inst.id)}
                            className="text-red-400 hover:text-red-600 text-xs"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>

          {/* Withdrawal */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Pot Withdrawal
              </h2>
              {!(beesi.withdrawals || []).length && (
                <button
                  onClick={() => setShowWithdrawForm(!showWithdrawForm)}
                  className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
                >
                  + Record Claim
                </button>
              )}
            </div>

            {showWithdrawForm && (
              <div className="mb-4 p-4 bg-green-50 rounded-lg border border-green-200">
                {withdrawError && (
                  <div className="mb-2 text-red-600 text-sm">
                    {withdrawError}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="block text-gray-600 mb-1">
                      Withdrawal Date *
                    </label>
                    <input
                      name="withdrawal_date"
                      type="date"
                      value={withdrawForm.withdrawal_date}
                      onChange={handleWithdrawChange}
                      required
                      className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-green-400"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">
                      Net Received (₹) *
                    </label>
                    <input
                      name="net_received"
                      type="number"
                      min="0"
                      value={withdrawForm.net_received}
                      onChange={handleWithdrawChange}
                      placeholder={beesi.pot_size}
                      required
                      className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-green-400"
                    />
                  </div>
                </div>
                {/* Read-only derived info */}
                {withdrawForm.withdrawal_date &&
                  withdrawForm.net_received !== "" && (
                    <div className="mt-2 p-2 bg-white rounded border border-green-100 grid grid-cols-3 gap-2 text-xs text-gray-500">
                      <div>
                        Month #:{" "}
                        <span className="font-semibold text-gray-700">
                          {calcMonthNumber(
                            beesi.start_date,
                            withdrawForm.withdrawal_date,
                          )}
                        </span>
                      </div>
                      <div>
                        Gross (Pot):{" "}
                        <span className="font-semibold text-gray-700">
                          {formatCurrency(beesi.pot_size)}
                        </span>
                      </div>
                      <div>
                        Discount:{" "}
                        <span className="font-semibold text-red-600">
                          {formatCurrency(
                            Math.max(
                              0,
                              Number(beesi.pot_size) -
                                Number(withdrawForm.net_received),
                            ),
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                <div className="mt-2 text-sm">
                  <label className="block text-gray-600 mb-1">Notes</label>
                  <input
                    name="notes"
                    value={withdrawForm.notes}
                    onChange={handleWithdrawChange}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded"
                  />
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => {
                      setWithdrawError("");
                      addWithdrawal.mutate({
                        withdrawal_date: withdrawForm.withdrawal_date,
                        net_received: Number(withdrawForm.net_received),
                        notes: withdrawForm.notes,
                      });
                    }}
                    disabled={addWithdrawal.isPending}
                    className="px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setShowWithdrawForm(false)}
                    className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {(beesi.withdrawals || []).length === 0 ? (
              <div className="text-center py-8 text-sm text-gray-400">
                <div className="text-3xl mb-2">🏦</div>
                You haven't claimed the pot yet
              </div>
            ) : (
              beesi.withdrawals.map((w) => (
                <div
                  key={w.id}
                  className="border border-green-200 rounded-lg p-4 bg-green-50"
                >
                  <div className="text-sm text-gray-500">
                    Claimed in Month {w.month_number} on{" "}
                    {formatDate(w.withdrawal_date)}
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
                    <div>
                      <div className="text-gray-500">Gross (Pot)</div>
                      <div className="font-semibold">
                        {formatCurrency(w.gross_amount)}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500">Discount Bid</div>
                      <div className="font-semibold text-red-600">
                        - {formatCurrency(w.discount_offered)}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500">Net Received</div>
                      <div className="font-semibold text-green-700">
                        {formatCurrency(w.net_received)}
                      </div>
                    </div>
                  </div>
                  {w.notes && (
                    <p className="text-xs text-gray-500 mt-2">{w.notes}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Bid Simulator */}
        {!summary.has_withdrawn &&
          summary.best_month_analysis &&
          (() => {
            const analysis = summary.best_month_analysis;
            const projections = analysis.projections || [];
            const currentMonth = selectedMonth ?? analysis.recommended_month;
            const selRow =
              projections.find((r) => r.month === currentMonth) ??
              projections[0];
            const selIdx = projections.findIndex(
              (r) => r.month === selRow?.month,
            );
            const prevMonth =
              selIdx > 0 ? projections[selIdx - 1]?.month : null;
            const nextMonth =
              selIdx < projections.length - 1
                ? projections[selIdx + 1]?.month
                : null;
            const discountNum = Number(bidDiscount) || 0;
            const youReceive = Number(analysis.pot_size) - discountNum;
            const netPL =
              Number(analysis.max_discount_to_breakeven) - discountNum;
            const isProfitable = netPL >= 0;
            return (
              <div className="mt-6 bg-white rounded-lg shadow-sm p-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-1">
                  Bid Simulator — When to Take the Pot
                </h2>

                {/* Key insight note */}
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-4 text-xs text-blue-800 leading-relaxed">
                  <span className="font-semibold">Key insight:</span> Your
                  P&amp;L depends only on your bid discount — not on which month
                  you pick. What changes per month is{" "}
                  <em>how much cash you still owe after receiving the pot.</em>{" "}
                  Last paid installment:{" "}
                  <span className="font-semibold">
                    {formatCurrency(analysis.last_paid_installment)}
                  </span>{" "}
                  → each future month estimated{" "}
                  <span className="font-semibold">₹100 less</span> (next ≈{" "}
                  <span className="font-semibold">
                    {formatCurrency(
                      (analysis.last_paid_installment ?? 0) - 100,
                    )}
                  </span>
                  ).
                </div>

                {/* Month stepper */}
                <div className="flex items-center gap-3 mb-4 flex-wrap">
                  <span className="text-sm text-gray-600 font-medium">
                    Simulate taking pot in:
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => prevMonth && setSelectedMonth(prevMonth)}
                      disabled={!prevMonth}
                      className="w-8 h-8 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-30 text-lg leading-none"
                    >
                      ‹
                    </button>
                    <div className="min-w-[6rem] text-center">
                      <span className="text-2xl font-bold text-purple-700">
                        Month {selRow?.month}
                      </span>
                    </div>
                    <button
                      onClick={() => nextMonth && setSelectedMonth(nextMonth)}
                      disabled={!nextMonth}
                      className="w-8 h-8 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-30 text-lg leading-none"
                    >
                      ›
                    </button>
                  </div>
                  <span className="text-sm text-gray-400">{selRow?.date}</span>
                  {selRow?.is_recommended && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                      ★ best — no bidding needed
                    </span>
                  )}
                </div>

                {/* 4-tile breakdown for selected month */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                    <div className="text-xs text-blue-700 mb-1 font-medium">
                      Paid by Month {selRow?.month}
                    </div>
                    <div className="text-lg font-bold text-blue-800">
                      {formatCurrency(selRow?.paid_by_then ?? 0)}
                    </div>
                    <div className="text-xs text-blue-500 mt-0.5">
                      actual + estimated
                    </div>
                  </div>
                  <div className="bg-orange-50 border border-orange-100 rounded-lg p-3">
                    <div className="text-xs text-orange-700 mb-1 font-medium">
                      Still owe after
                    </div>
                    <div className="text-lg font-bold text-orange-800">
                      {selRow?.installments_left === 0
                        ? "—"
                        : formatCurrency(selRow?.cash_still_owed ?? 0)}
                    </div>
                    <div className="text-xs text-orange-500 mt-0.5">
                      {selRow?.installments_left === 0
                        ? "last month, nothing left"
                        : `${selRow?.installments_left} months × est. ₹${Math.round(selRow?.est_installment ?? 0).toLocaleString("en-IN")}`}
                    </div>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-lg p-3">
                    <div className="text-xs text-gray-600 mb-1 font-medium">
                      Your bid discount
                    </div>
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-xs text-gray-400">₹</span>
                      <input
                        type="number"
                        min="0"
                        value={bidDiscount}
                        onChange={(e) => setBidDiscount(e.target.value)}
                        placeholder="0"
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm font-medium focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                    <div className="text-xs text-gray-400">
                      You receive: {formatCurrency(youReceive)}
                    </div>
                  </div>
                  <div
                    className={`border rounded-lg p-3 ${
                      isProfitable
                        ? "bg-green-50 border-green-200"
                        : "bg-red-50 border-red-200"
                    }`}
                  >
                    <div
                      className={`text-xs font-medium mb-1 ${
                        isProfitable ? "text-green-700" : "text-red-700"
                      }`}
                    >
                      Net P&amp;L (any month)
                    </div>
                    <div
                      className={`text-2xl font-bold ${
                        isProfitable ? "text-green-700" : "text-red-700"
                      }`}
                    >
                      {isProfitable ? "+" : ""}
                      {formatCurrency(netPL)}
                    </div>
                    <div
                      className={`text-xs mt-0.5 ${
                        isProfitable ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {discountNum === 0
                        ? "at zero discount"
                        : isProfitable
                          ? "you profit at this bid"
                          : "reduce your discount!"}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-gray-400 mb-4 flex gap-1 items-start">
                  <span>ℹ</span>
                  <span>
                    Max discount to break even:{" "}
                    <span className="font-medium text-gray-600">
                      {formatCurrency(analysis.max_discount_to_breakeven)}
                    </span>
                    . Offer less → profit. Offer more → loss.
                  </span>
                </div>

                {/* Table — click row to select month */}
                <div className="text-xs text-gray-400 mb-1">
                  Click any row to simulate that month ↓
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                        <th className="text-left px-3 py-2">Month</th>
                        <th className="text-left px-3 py-2">Date</th>
                        <th className="text-right px-3 py-2">Est. inst.</th>
                        <th className="text-right px-3 py-2">Paid by then</th>
                        <th className="text-right px-3 py-2">Left after</th>
                        <th className="text-right px-3 py-2">
                          Cash still owed
                        </th>
                        <th className="text-right px-3 py-2">P&amp;L at bid</th>
                        <th className="px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(analysis.projections || []).map((row) => {
                        const isSelected = row.month === selRow?.month;
                        return (
                          <tr
                            key={row.month}
                            onClick={() => setSelectedMonth(row.month)}
                            className={`cursor-pointer border-t transition-colors ${
                              isSelected
                                ? "bg-purple-50 border-purple-200 font-medium"
                                : row.is_recommended
                                  ? "bg-green-50 border-green-100 hover:bg-green-100"
                                  : "border-gray-100 hover:bg-gray-50"
                            }`}
                          >
                            <td className="px-3 py-2">{row.month}</td>
                            <td className="px-3 py-2 text-gray-500">
                              {row.date}
                            </td>
                            <td className="px-3 py-2 text-right text-purple-600">
                              ~{formatCurrency(row.est_installment)}
                            </td>
                            <td className="px-3 py-2 text-right text-blue-700">
                              {formatCurrency(row.paid_by_then)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {row.installments_left === 0 ? (
                                <span className="text-green-600 font-medium">
                                  None ✓
                                </span>
                              ) : (
                                <span className="text-gray-600">
                                  {row.installments_left} months
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-gray-500">
                              {row.installments_left === 0
                                ? "—"
                                : formatCurrency(row.cash_still_owed)}
                            </td>
                            <td
                              className={`px-3 py-2 text-right font-medium ${
                                isProfitable ? "text-green-700" : "text-red-600"
                              }`}
                            >
                              {isProfitable ? "+" : ""}
                              {formatCurrency(netPL)}
                            </td>
                            <td className="px-2 py-2">
                              {isSelected && !row.is_recommended && (
                                <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">
                                  selected
                                </span>
                              )}
                              {row.is_recommended && (
                                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                  ★ best
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

        {/* Description / Notes */}
        {(beesi.description || beesi.notes) && (
          <div className="mt-6 bg-white rounded-lg shadow-sm p-5">
            {beesi.description && (
              <p className="text-gray-700 mb-2">{beesi.description}</p>
            )}
            {beesi.notes && (
              <p className="text-sm text-gray-500">{beesi.notes}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
