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
  const [instForm, setInstForm] = useState({ month_number: "", payment_date: "", base_amount: "", dividend_received: "0", actual_paid: "", notes: "" });
  const [withdrawForm, setWithdrawForm] = useState({ month_number: "", withdrawal_date: "", gross_amount: "", discount_offered: "0", net_received: "", notes: "" });
  const [instError, setInstError] = useState("");
  const [withdrawError, setWithdrawError] = useState("");

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
      setInstForm({ month_number: "", payment_date: "", base_amount: "", dividend_received: "0", actual_paid: "", notes: "" });
    },
    onError: (e) => setInstError(e.response?.data?.detail || "Failed to save"),
  });

  const addWithdrawal = useMutation({
    mutationFn: (data) => api.post(`/api/beesi/${id}/withdraw`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["beesi", id] });
      qc.invalidateQueries({ queryKey: ["beesis"] });
      setShowWithdrawForm(false);
    },
    onError: (e) => setWithdrawError(e.response?.data?.detail || "Failed to save"),
  });

  const deleteInstallment = useMutation({
    mutationFn: (instId) => api.delete(`/api/beesi/${id}/installments/${instId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["beesi", id] }),
  });

  const deleteSelf = useMutation({
    mutationFn: () => api.delete(`/api/beesi/${id}`),
    onSuccess: () => navigate("/beesi"),
  });

  // Auto-calculate actual_paid from base - dividend
  const handleInstChange = (e) => {
    const updated = { ...instForm, [e.target.name]: e.target.value };
    if (e.target.name === "base_amount" || e.target.name === "dividend_received") {
      const base = parseFloat(updated.base_amount) || 0;
      const div = parseFloat(updated.dividend_received) || 0;
      updated.actual_paid = String(Math.max(base - div, 0));
    }
    setInstForm(updated);
  };

  const handleWithdrawChange = (e) => {
    const updated = { ...withdrawForm, [e.target.name]: e.target.value };
    if (e.target.name === "gross_amount" || e.target.name === "discount_offered") {
      const gross = parseFloat(updated.gross_amount) || 0;
      const disc = parseFloat(updated.discount_offered) || 0;
      updated.net_received = String(Math.max(gross - disc, 0));
    }
    setWithdrawForm(updated);
  };

  if (isLoading) return <div className="p-8 text-gray-500">Loading…</div>;
  if (!beesi) return <div className="p-8 text-red-500">Beesi not found</div>;

  const summary = beesi.summary || {};
  const hasPL = summary.has_withdrawn;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <button onClick={() => navigate("/beesi")} className="text-gray-500 hover:text-gray-900 text-sm mb-1">← Beesi List</button>
            <h1 className="text-2xl font-bold text-gray-900">{beesi.title}</h1>
            <p className="text-sm text-gray-500">Started {formatDate(beesi.start_date)} · {beesi.tenure_months} months · {beesi.member_count} members</p>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <button onClick={() => navigate(`/beesi/${id}/edit`)} className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm">Edit</button>
              <button onClick={() => { if (window.confirm("Delete this Beesi?")) deleteSelf.mutate(); }} className="px-3 py-1.5 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 text-sm">Delete</button>
            </div>
          )}
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Pot Size", value: formatCurrency(beesi.pot_size) },
            { label: "Base Installment", value: formatCurrency(beesi.base_installment) },
            { label: "Total Invested", value: formatCurrency(summary.total_invested), tone: "text-blue-700" },
            { label: "Months Paid", value: `${summary.months_paid || 0} / ${beesi.tenure_months}` },
          ].map((c) => (
            <div key={c.label} className="bg-white rounded-lg shadow-sm p-4">
              <div className="text-xs text-gray-500">{c.label}</div>
              <div className={`text-xl font-bold mt-1 ${c.tone || "text-gray-900"}`}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* P&L card if withdrawn */}
        {hasPL && (
          <div className={`rounded-lg p-4 mb-6 ${Number(summary.profit_loss) >= 0 ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-600">Net P&L (Withdrawn − Invested)</div>
                <div className={`text-2xl font-bold ${Number(summary.profit_loss) >= 0 ? "text-green-700" : "text-red-700"}`}>
                  {formatCurrency(summary.profit_loss)} ({summary.profit_loss_pct?.toFixed(1)}%)
                </div>
              </div>
              <div className="text-sm text-gray-500">
                Withdrawn: <span className="font-medium text-gray-800">{formatCurrency(summary.total_withdrawn)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Installments */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Monthly Installments</h2>
              <button onClick={() => setShowInstallmentForm(!showInstallmentForm)}
                className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700">
                + Log Payment
              </button>
            </div>

            {showInstallmentForm && (
              <div className="mb-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
                {instError && <div className="mb-2 text-red-600 text-sm">{instError}</div>}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="block text-gray-600 mb-1">Month #</label>
                    <input name="month_number" type="number" min="1" value={instForm.month_number} onChange={handleInstChange}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-purple-400" />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">Date</label>
                    <input name="payment_date" type="date" value={instForm.payment_date} onChange={handleInstChange}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-purple-400" />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">Base Amount</label>
                    <input name="base_amount" type="number" value={instForm.base_amount} onChange={handleInstChange}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-purple-400" />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">Dividend Received</label>
                    <input name="dividend_received" type="number" value={instForm.dividend_received} onChange={handleInstChange}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-purple-400" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-gray-600 mb-1">Actual Paid (auto-calculated)</label>
                    <input name="actual_paid" type="number" value={instForm.actual_paid} onChange={handleInstChange}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-purple-400 bg-gray-50" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-gray-600 mb-1">Notes</label>
                    <input name="notes" value={instForm.notes} onChange={handleInstChange}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-purple-400" />
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => {
                    setInstError("");
                    addInstallment.mutate({
                      ...instForm,
                      month_number: Number(instForm.month_number),
                      base_amount: Number(instForm.base_amount),
                      dividend_received: Number(instForm.dividend_received),
                      actual_paid: Number(instForm.actual_paid),
                    });
                  }} disabled={addInstallment.isPending}
                    className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm hover:bg-purple-700 disabled:opacity-50">
                    Save
                  </button>
                  <button onClick={() => setShowInstallmentForm(false)} className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-sm">Cancel</button>
                </div>
              </div>
            )}

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {(beesi.installments || []).length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No installments logged yet</p>
              ) : (
                (beesi.installments || []).slice().reverse().map((inst) => (
                  <div key={inst.id} className="flex items-center justify-between py-2 border-b border-gray-100 text-sm">
                    <div>
                      <span className="font-medium">Month {inst.month_number}</span>
                      <span className="text-gray-400 ml-2">{formatDate(inst.payment_date)}</span>
                      {Number(inst.dividend_received) > 0 && (
                        <span className="ml-2 text-xs text-green-600">Div: {formatCurrency(inst.dividend_received)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-gray-800">{formatCurrency(inst.actual_paid)}</span>
                      {isAdmin && (
                        <button onClick={() => deleteInstallment.mutate(inst.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
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
              <h2 className="text-lg font-semibold text-gray-900">Pot Withdrawal</h2>
              {!(beesi.withdrawals || []).length && (
                <button onClick={() => setShowWithdrawForm(!showWithdrawForm)}
                  className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
                  + Record Claim
                </button>
              )}
            </div>

            {showWithdrawForm && (
              <div className="mb-4 p-4 bg-green-50 rounded-lg border border-green-200">
                {withdrawError && <div className="mb-2 text-red-600 text-sm">{withdrawError}</div>}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="block text-gray-600 mb-1">Month # Claimed</label>
                    <input name="month_number" type="number" min="1" value={withdrawForm.month_number} onChange={handleWithdrawChange}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-green-400" />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">Withdrawal Date</label>
                    <input name="withdrawal_date" type="date" value={withdrawForm.withdrawal_date} onChange={handleWithdrawChange}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-green-400" />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">Gross Amount (Pot)</label>
                    <input name="gross_amount" type="number" value={withdrawForm.gross_amount} onChange={handleWithdrawChange}
                      placeholder={beesi.pot_size}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-green-400" />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">Discount Offered</label>
                    <input name="discount_offered" type="number" value={withdrawForm.discount_offered} onChange={handleWithdrawChange}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-green-400" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-gray-600 mb-1">Net Received (auto-calculated)</label>
                    <input name="net_received" type="number" value={withdrawForm.net_received} onChange={handleWithdrawChange}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded bg-gray-50 focus:ring-2 focus:ring-green-400" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-gray-600 mb-1">Notes</label>
                    <input name="notes" value={withdrawForm.notes} onChange={handleWithdrawChange}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded" />
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => {
                    setWithdrawError("");
                    addWithdrawal.mutate({
                      ...withdrawForm,
                      month_number: Number(withdrawForm.month_number),
                      gross_amount: Number(withdrawForm.gross_amount) || Number(beesi.pot_size),
                      discount_offered: Number(withdrawForm.discount_offered),
                      net_received: Number(withdrawForm.net_received),
                    });
                  }} disabled={addWithdrawal.isPending}
                    className="px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50">Save</button>
                  <button onClick={() => setShowWithdrawForm(false)} className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-sm">Cancel</button>
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
                <div key={w.id} className="border border-green-200 rounded-lg p-4 bg-green-50">
                  <div className="text-sm text-gray-500">Claimed in Month {w.month_number} on {formatDate(w.withdrawal_date)}</div>
                  <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
                    <div><div className="text-gray-500">Gross (Pot)</div><div className="font-semibold">{formatCurrency(w.gross_amount)}</div></div>
                    <div><div className="text-gray-500">Discount Bid</div><div className="font-semibold text-red-600">- {formatCurrency(w.discount_offered)}</div></div>
                    <div><div className="text-gray-500">Net Received</div><div className="font-semibold text-green-700">{formatCurrency(w.net_received)}</div></div>
                  </div>
                  {w.notes && <p className="text-xs text-gray-500 mt-2">{w.notes}</p>}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Description / Notes */}
        {(beesi.description || beesi.notes) && (
          <div className="mt-6 bg-white rounded-lg shadow-sm p-5">
            {beesi.description && <p className="text-gray-700 mb-2">{beesi.description}</p>}
            {beesi.notes && <p className="text-sm text-gray-500">{beesi.notes}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
