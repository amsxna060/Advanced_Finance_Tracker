import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

export default function Reconciliation() {
  const [range, setRange] = useState(() => {
    const to = new Date().toISOString().split("T")[0];
    const from = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
    return { from_date: from, to_date: to };
  });
  const [accountId, setAccountId] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["reconciliation", range, accountId],
    queryFn: async () => {
      const params = { from_date: range.from_date, to_date: range.to_date };
      if (accountId) params.account_id = accountId;
      return (await api.get("/api/analytics/reconciliation", { params })).data;
    },
  });

  const accounts = data?.accounts || [];
  const ledger = data?.ledger || [];
  const summary = data?.summary || {};
  const opening = data?.opening_balances || {};
  const closing = data?.closing_balances || {};

  const selectedAcctName = useMemo(() => {
    if (!accountId) return "All Accounts";
    return accounts.find((a) => a.id === Number(accountId))?.name || "Unknown";
  }, [accountId, accounts]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reconciliation & Ledger</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Transaction ledger with running balances and unlinked item flagging
          </p>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <input type="date" value={range.from_date}
              onChange={(e) => setRange((r) => ({ ...r, from_date: e.target.value }))}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
            <span className="text-slate-400 text-sm">to</span>
            <input type="date" value={range.to_date}
              onChange={(e) => setRange((r) => ({ ...r, to_date: e.target.value }))}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white">
            <option value="">All Accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
            ))}
          </select>
          <div className="ml-auto text-xs text-slate-400">
            {data?.period?.from} to {data?.period?.to}
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <SummaryCard label="Total Credits" value={formatCurrency(summary.total_credits)} color="text-emerald-700" bg="bg-emerald-50 border-emerald-200" />
              <SummaryCard label="Total Debits" value={formatCurrency(summary.total_debits)} color="text-red-700" bg="bg-red-50 border-red-200" />
              <SummaryCard label="Net" value={formatCurrency(summary.net)} color={summary.net >= 0 ? "text-emerald-700" : "text-red-700"} bg="bg-white border-slate-200" />
              <SummaryCard label="Transactions" value={summary.transaction_count || 0} color="text-slate-900" bg="bg-white border-slate-200" />
              <SummaryCard label="Unlinked" value={summary.unlinked_count || 0}
                color={summary.unlinked_count > 0 ? "text-amber-700" : "text-slate-900"}
                bg={summary.unlinked_count > 0 ? "bg-amber-50 border-amber-200" : "bg-white border-slate-200"} />
            </div>

            {/* Opening / Closing Balances */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <BalanceBlock title="Opening Balances" balances={opening} accounts={accounts} />
              <BalanceBlock title="Closing Balances" balances={closing} accounts={accounts} />
            </div>

            {/* Ledger Table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
                  Transaction Ledger — {selectedAcctName}
                </h2>
                <span className="text-xs text-slate-400">{ledger.length} entries</span>
              </div>
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Date</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Account</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Type</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Amount</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Description</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Source</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Running Bal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledger.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                          No transactions in this period
                        </td>
                      </tr>
                    ) : (
                      ledger.map((row) => (
                        <tr key={row.id} className={`hover:bg-slate-50 ${row.is_unlinked ? "bg-amber-50/40" : ""}`}>
                          <td className="px-4 py-2 text-xs text-slate-600 font-mono whitespace-nowrap">{row.date}</td>
                          <td className="px-4 py-2 text-xs text-slate-700">{row.account}</td>
                          <td className="px-4 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              row.type === "credit"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-red-100 text-red-700"
                            }`}>
                              {row.type}
                            </span>
                          </td>
                          <td className={`px-4 py-2 text-right text-xs font-semibold ${
                            row.type === "credit" ? "text-emerald-700" : "text-red-700"
                          }`}>
                            {row.type === "credit" ? "+" : "−"}{formatCurrency(row.amount)}
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-600 max-w-[200px] truncate">
                            {row.description || "—"}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium capitalize ${
                                row.is_unlinked
                                  ? "bg-amber-100 text-amber-700 border border-amber-200"
                                  : "bg-slate-100 text-slate-600"
                              }`}>
                                {row.source}
                              </span>
                              {row.is_unlinked && (
                                <span className="text-[10px] text-amber-600" title="Unlinked transaction">⚠</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right text-xs font-semibold text-slate-800">
                            {formatCurrency(row.running_balance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Sub Components ────────────────────────────────────────────────── */

function SummaryCard({ label, value, color, bg }) {
  return (
    <div className={`rounded-xl border p-4 ${bg}`}>
      <p className="text-xs text-slate-500 font-medium">{label}</p>
      <p className={`text-xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function BalanceBlock({ title, balances, accounts }) {
  const acctMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const entries = Object.entries(balances);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <span className="text-sm font-bold text-slate-900">{formatCurrency(total)}</span>
      </div>
      <div className="space-y-1.5">
        {entries.map(([id, bal]) => {
          const acct = acctMap[Number(id)];
          return (
            <div key={id} className="flex justify-between text-xs">
              <span className="text-slate-600">{acct?.name || `Account #${id}`}</span>
              <span className="font-medium text-slate-800">{formatCurrency(bal)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
