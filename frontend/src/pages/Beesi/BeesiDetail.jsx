import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { PageHero, HeroStat, PageBody, Button } from "../../components/ui";
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
    account_id: "",
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

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", "for-form"],
    queryFn: async () => {
      const res = await api.get("/api/accounts");
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
        account_id: "",
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

  if (isLoading) return <div className="p-8 text-slate-500">Loading…</div>;
  if (!beesi) return <div className="p-8 text-rose-500">Beesi not found</div>;

  const summary = beesi.summary || {};
  const hasPL = summary.has_withdrawn;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title={beesi.title}
        subtitle={`Started ${formatDate(beesi.start_date)} · ${beesi.tenure_months} months · ${beesi.member_count} members`}
        backTo="/beesi"
        actions={
          isAdmin && (
            <div className="flex items-center gap-2">
              <Button variant="white" size="sm" onClick={() => navigate(`/beesi/${id}/edit`)}>
                Edit
              </Button>
              <Button variant="danger" size="sm" onClick={() => { if (window.confirm("Delete this Beesi?")) deleteSelf.mutate(); }}>
                Delete
              </Button>
            </div>
          )
        }
      >
        {(beesi.contact_name || beesi.account_name) && (
          <p className="text-xs text-indigo-300/60 mt-1">
            {beesi.contact_name && <span>Organiser: {beesi.contact_name}</span>}
            {beesi.contact_name && beesi.account_name && " · "}
            {beesi.account_name && <span>Account: {beesi.account_name}</span>}
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <HeroStat label="Pot Size" value={formatCurrency(beesi.pot_size)} accent="indigo" />
          <HeroStat label="Base Installment" value={formatCurrency(beesi.base_installment)} accent="violet" />
          <HeroStat label="Total Invested" value={formatCurrency(summary.total_invested)} accent="amber" />
          <HeroStat label="Months Paid" value={`${summary.months_paid || 0} / ${beesi.tenure_months}`} accent="emerald" />
        </div>
      </PageHero>
      <PageBody>
        <div className="max-w-4xl mx-auto">

        {/* P&L card if withdrawn */}
        {hasPL && (
          <div
            className={`rounded-2xl p-4 mb-6 ${Number(summary.profit_loss) >= 0 ? "bg-emerald-50 border border-emerald-200" : "bg-rose-50 border border-rose-200"}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-slate-600">
                  Net P&L (Withdrawn − Invested)
                </div>
                <div
                  className={`text-2xl font-bold ${Number(summary.profit_loss) >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                >
                  {formatCurrency(summary.profit_loss)} (
                  {summary.profit_loss_pct?.toFixed(1)}%)
                </div>
              </div>
              <div className="text-sm text-slate-500">
                Withdrawn:{" "}
                <span className="font-medium text-slate-800">
                  {formatCurrency(summary.total_withdrawn)}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Installments */}
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-800">
                Monthly Installments
              </h2>
              <button
                onClick={() => setShowInstallmentForm(!showInstallmentForm)}
                className="px-3 py-1.5 bg-gradient-to-r from-violet-500 to-violet-600 text-white rounded-xl text-sm hover:from-violet-600 hover:to-violet-700 shadow-sm shadow-violet-500/20 active:scale-[0.98] font-medium transition-all"
              >
                + Log Payment
              </button>
            </div>

            {showInstallmentForm && (
              <div className="mb-4 p-4 bg-violet-50 rounded-2xl border border-violet-200">
                {instError && (
                  <div className="mb-2 text-rose-600 text-sm">{instError}</div>
                )}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Payment Date *
                    </label>
                    <input
                      name="payment_date"
                      type="date"
                      value={instForm.payment_date}
                      onChange={handleInstChange}
                      required
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
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
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    />
                  </div>
                </div>
                {/* Read-only derived info */}
                {instForm.payment_date && instForm.actual_paid !== "" && (
                  <div className="mt-2 p-2 bg-white rounded-xl border border-violet-100 grid grid-cols-3 gap-2 text-xs text-slate-500">
                    <div>
                      Month #:{" "}
                      <span className="font-semibold text-slate-700">
                        {calcMonthNumber(
                          beesi.start_date,
                          instForm.payment_date,
                        )}
                      </span>
                    </div>
                    <div>
                      Base:{" "}
                      <span className="font-semibold text-slate-700">
                        {formatCurrency(beesi.base_installment)}
                      </span>
                    </div>
                    <div>
                      Dividend:{" "}
                      <span className="font-semibold text-emerald-600">
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
                  <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
                  <input
                    name="notes"
                    value={instForm.notes}
                    onChange={handleInstChange}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  />
                </div>
                <div className="mt-2 text-sm">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Account</label>
                  <select
                    name="account_id"
                    value={instForm.account_id}
                    onChange={handleInstChange}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  >
                    <option value="">— Select Account —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => {
                      setInstError("");
                      addInstallment.mutate({
                        payment_date: instForm.payment_date,
                        actual_paid: Number(instForm.actual_paid),
                        notes: instForm.notes,
                        account_id: instForm.account_id
                          ? parseInt(instForm.account_id)
                          : null,
                      });
                    }}
                    disabled={addInstallment.isPending}
                    className="px-3 py-1.5 bg-gradient-to-r from-violet-500 to-violet-600 text-white rounded-xl text-sm hover:from-violet-600 hover:to-violet-700 shadow-sm shadow-violet-500/20 active:scale-[0.98] font-medium disabled:opacity-50 transition-all"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setShowInstallmentForm(false)}
                    className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-xl text-sm hover:bg-slate-200 font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {(beesi.installments || []).length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">
                  No installments logged yet
                </p>
              ) : (
                (beesi.installments || [])
                  .slice()
                  .reverse()
                  .map((inst) => (
                    <div
                      key={inst.id}
                      className="flex items-center justify-between py-2 border-b border-slate-100 text-sm hover:bg-slate-50/50 transition-colors"
                    >
                      <div>
                        <span className="font-medium">
                          Month {inst.month_number}
                        </span>
                        <span className="text-slate-400 ml-2">
                          {formatDate(inst.payment_date)}
                        </span>
                        {Number(inst.dividend_received) > 0 && (
                          <span className="ml-2 text-xs text-emerald-600">
                            Div: {formatCurrency(inst.dividend_received)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-slate-800">
                          {formatCurrency(inst.actual_paid)}
                        </span>
                        {isAdmin && (
                          <button
                            onClick={() => deleteInstallment.mutate(inst.id)}
                            className="text-rose-400 hover:text-rose-600 text-xs"
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
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-800">
                Pot Withdrawal
              </h2>
              {!(beesi.withdrawals || []).length && (
                <button
                  onClick={() => setShowWithdrawForm(!showWithdrawForm)}
                  className="px-3 py-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl text-sm hover:from-emerald-600 hover:to-emerald-700 shadow-sm shadow-emerald-500/20 active:scale-[0.98] font-medium transition-all"
                >
                  + Record Claim
                </button>
              )}
            </div>

            {showWithdrawForm && (
              <div className="mb-4 p-4 bg-emerald-50 rounded-2xl border border-emerald-200">
                {withdrawError && (
                  <div className="mb-2 text-rose-600 text-sm">
                    {withdrawError}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Withdrawal Date *
                    </label>
                    <input
                      name="withdrawal_date"
                      type="date"
                      value={withdrawForm.withdrawal_date}
                      onChange={handleWithdrawChange}
                      required
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
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
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    />
                  </div>
                </div>
                {/* Read-only derived info */}
                {withdrawForm.withdrawal_date &&
                  withdrawForm.net_received !== "" && (
                    <div className="mt-2 p-2 bg-white rounded-xl border border-emerald-100 grid grid-cols-3 gap-2 text-xs text-slate-500">
                      <div>
                        Month #:{" "}
                        <span className="font-semibold text-slate-700">
                          {calcMonthNumber(
                            beesi.start_date,
                            withdrawForm.withdrawal_date,
                          )}
                        </span>
                      </div>
                      <div>
                        Gross (Pot):{" "}
                        <span className="font-semibold text-slate-700">
                          {formatCurrency(beesi.pot_size)}
                        </span>
                      </div>
                      <div>
                        Discount:{" "}
                        <span className="font-semibold text-rose-600">
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
                  <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
                  <input
                    name="notes"
                    value={withdrawForm.notes}
                    onChange={handleWithdrawChange}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
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
                    className="px-3 py-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl text-sm hover:from-emerald-600 hover:to-emerald-700 shadow-sm shadow-emerald-500/20 active:scale-[0.98] font-medium disabled:opacity-50 transition-all"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setShowWithdrawForm(false)}
                    className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-xl text-sm hover:bg-slate-200 font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {(beesi.withdrawals || []).length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-400">
                <div className="text-3xl mb-2">🏦</div>
                You haven't claimed the pot yet
              </div>
            ) : (
              beesi.withdrawals.map((w) => (
                <div
                  key={w.id}
                  className="border border-emerald-200 rounded-2xl p-4 bg-emerald-50"
                >
                  <div className="text-sm text-slate-500">
                    Claimed in Month {w.month_number} on{" "}
                    {formatDate(w.withdrawal_date)}
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
                    <div>
                      <div className="text-slate-500">Gross (Pot)</div>
                      <div className="font-semibold">
                        {formatCurrency(w.gross_amount)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Discount Bid</div>
                      <div className="font-semibold text-rose-600">
                        - {formatCurrency(w.discount_offered)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Net Received</div>
                      <div className="font-semibold text-emerald-700">
                        {formatCurrency(w.net_received)}
                      </div>
                    </div>
                  </div>
                  {w.notes && (
                    <p className="text-xs text-slate-500 mt-2">{w.notes}</p>
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
              <div className="mt-6 bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5">
                <h2 className="text-base font-bold text-slate-800 mb-1">
                  Bid Simulator — When to Take the Pot
                </h2>

                {/* Key insight note */}
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 mb-4 text-xs text-indigo-800 leading-relaxed">
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
                  <span className="text-sm text-slate-600 font-medium">
                    Simulate taking pot in:
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => prevMonth && setSelectedMonth(prevMonth)}
                      disabled={!prevMonth}
                      className="w-8 h-8 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-30 text-lg leading-none transition-colors"
                    >
                      ‹
                    </button>
                    <div className="min-w-[6rem] text-center">
                      <span className="text-2xl font-bold text-violet-700">
                        Month {selRow?.month}
                      </span>
                    </div>
                    <button
                      onClick={() => nextMonth && setSelectedMonth(nextMonth)}
                      disabled={!nextMonth}
                      className="w-8 h-8 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-30 text-lg leading-none transition-colors"
                    >
                      ›
                    </button>
                  </div>
                  <span className="text-sm text-slate-400">{selRow?.date}</span>
                  {selRow?.is_recommended && (
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                      ★ best — no bidding needed
                    </span>
                  )}
                </div>

                {/* 4-tile breakdown for selected month */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                  <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                    <div className="text-xs text-indigo-700 mb-1 font-medium">
                      Paid by Month {selRow?.month}
                    </div>
                    <div className="text-lg font-bold text-indigo-800">
                      {formatCurrency(selRow?.paid_by_then ?? 0)}
                    </div>
                    <div className="text-xs text-indigo-500 mt-0.5">
                      actual + estimated
                    </div>
                  </div>
                  <div className="bg-orange-50 border border-orange-100 rounded-xl p-3">
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
                  <div className="bg-white border border-slate-200 rounded-xl p-3">
                    <div className="text-xs text-slate-600 mb-1 font-medium">
                      Your bid discount
                    </div>
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-xs text-slate-400">₹</span>
                      <input
                        type="number"
                        min="0"
                        value={bidDiscount}
                        onChange={(e) => setBidDiscount(e.target.value)}
                        placeholder="0"
                        className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                      />
                    </div>
                    <div className="text-xs text-slate-400">
                      You receive: {formatCurrency(youReceive)}
                    </div>
                  </div>
                  <div
                    className={`border rounded-xl p-3 ${
                      isProfitable
                        ? "bg-emerald-50 border-emerald-200"
                        : "bg-rose-50 border-rose-200"
                    }`}
                  >
                    <div
                      className={`text-xs font-medium mb-1 ${
                        isProfitable ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      Net P&amp;L (any month)
                    </div>
                    <div
                      className={`text-2xl font-bold ${
                        isProfitable ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {isProfitable ? "+" : ""}
                      {formatCurrency(netPL)}
                    </div>
                    <div
                      className={`text-xs mt-0.5 ${
                        isProfitable ? "text-emerald-600" : "text-rose-600"
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

                <div className="text-xs text-slate-400 mb-4 flex gap-1 items-start">
                  <span>ℹ</span>
                  <span>
                    Max discount to break even:{" "}
                    <span className="font-medium text-slate-600">
                      {formatCurrency(analysis.max_discount_to_breakeven)}
                    </span>
                    . Offer less → profit. Offer more → loss.
                  </span>
                </div>

                {/* Table — click row to select month */}
                <div className="text-xs text-slate-400 mb-1">
                  Click any row to simulate that month ↓
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
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
                                ? "bg-violet-50 border-violet-200 font-medium"
                                : row.is_recommended
                                  ? "bg-emerald-50 border-emerald-100 hover:bg-emerald-100"
                                  : "border-slate-100 hover:bg-slate-50/50"
                            }`}
                          >
                            <td className="px-3 py-2">{row.month}</td>
                            <td className="px-3 py-2 text-slate-500">
                              {row.date}
                            </td>
                            <td className="px-3 py-2 text-right text-violet-600">
                              ~{formatCurrency(row.est_installment)}
                            </td>
                            <td className="px-3 py-2 text-right text-indigo-700">
                              {formatCurrency(row.paid_by_then)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {row.installments_left === 0 ? (
                                <span className="text-emerald-600 font-medium">
                                  None ✓
                                </span>
                              ) : (
                                <span className="text-slate-600">
                                  {row.installments_left} months
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-500">
                              {row.installments_left === 0
                                ? "—"
                                : formatCurrency(row.cash_still_owed)}
                            </td>
                            <td
                              className={`px-3 py-2 text-right font-medium ${
                                isProfitable ? "text-emerald-700" : "text-rose-600"
                              }`}
                            >
                              {isProfitable ? "+" : ""}
                              {formatCurrency(netPL)}
                            </td>
                            <td className="px-2 py-2">
                              {isSelected && !row.is_recommended && (
                                <span className="text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">
                                  selected
                                </span>
                              )}
                              {row.is_recommended && (
                                <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">
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
          <div className="mt-6 bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5">
            {beesi.description && (
              <p className="text-slate-700 mb-2">{beesi.description}</p>
            )}
            {beesi.notes && (
              <p className="text-sm text-slate-500">{beesi.notes}</p>
            )}
          </div>
        )}
        </div>
      </PageBody>
    </div>
  );
}
