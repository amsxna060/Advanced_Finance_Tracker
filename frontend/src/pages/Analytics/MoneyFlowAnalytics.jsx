import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";
import { GreyedOut } from "../../components/ui";

const fc = (v) => formatCurrency(v ?? 0);

const PERIOD_PRESETS = [
  { key: "1_month", label: "This Month" },
  { key: "3_months", label: "3 Months" },
  { key: "6_months", label: "6 Months" },
  { key: "1_year", label: "1 Year" },
  { key: "all", label: "All Time" },
  { key: "custom", label: "Custom" },
];

const SOURCE_LABELS = {
  loan: "Loan",
  expense: "Expense",
  property: "Property",
  partnership: "Partnership",
  beesi: "Beesi",
  manual: "Manual",
  transfer: "Transfer",
  obligation: "Obligation",
};

const COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16",
];

export default function MoneyFlowAnalytics() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState("3_months");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const params = { period };
  if (period === "custom" && customFrom && customTo) {
    params.from_date = customFrom;
    params.to_date = customTo;
  }

  const { data, isLoading } = useQuery({
    queryKey: ["money-flow", period, customFrom, customTo],
    queryFn: async () => (await api.get("/api/analytics/money-flow", { params })).data,
    enabled: period !== "custom" || (!!customFrom && !!customTo),
  });

  const fmt = (src) => SOURCE_LABELS[src] || src;

  return (
    <GreyedOut label="Under Review">
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <button onClick={() => navigate("/analytics")} className="text-gray-600 hover:text-gray-900 mb-1 text-sm">
              &larr; Back to Analytics
            </button>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Money Flow</h1>
            <p className="text-sm text-gray-500 mt-1">Track every rupee coming in and going out across all accounts</p>
          </div>
        </div>

        {/* Period Picker */}
        <div className="bg-white rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-2">
            {PERIOD_PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                  period === p.key
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-3 mt-3">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm" />
              <span className="text-gray-400 text-sm">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm" />
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
          </div>
        ) : !data ? null : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border p-5">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Total Inflow</p>
                <p className="text-2xl font-bold text-green-600 mt-1">{fc(data.total_in)}</p>
              </div>
              <div className="bg-white rounded-xl border p-5">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Total Outflow</p>
                <p className="text-2xl font-bold text-red-600 mt-1">{fc(data.total_out)}</p>
              </div>
              <div className="bg-white rounded-xl border p-5">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Net Flow</p>
                <p className={`text-2xl font-bold mt-1 ${data.net_flow >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {data.net_flow >= 0 ? "+" : ""}{fc(data.net_flow)}
                </p>
              </div>
            </div>

            {/* Monthly Trend Chart */}
            {data.monthly?.length > 0 && (
              <div className="bg-white rounded-xl border p-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Monthly Trend</h2>
                <p className="text-xs text-gray-400 mb-4">Credits vs Debits across all accounts</p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.monthly} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                      <Tooltip formatter={(value) => fc(value)} contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }} />
                      <Legend wrapperStyle={{ fontSize: "12px" }} />
                      <Bar dataKey="credit" name="Money In" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="debit" name="Money Out" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Inflow/Outflow by Source — side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Inflow by Source */}
              <div className="bg-white rounded-xl border p-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Inflow by Source</h2>
                <p className="text-xs text-gray-400 mb-4">Where the money comes from</p>
                {data.inflow_by_source?.length > 0 ? (
                  <>
                    <div className="h-48 mb-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={data.inflow_by_source.map((s) => ({ name: fmt(s.source), value: s.amount }))} cx="50%" cy="50%" innerRadius={35} outerRadius={65} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                            {data.inflow_by_source.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v) => fc(v)} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2">
                      {data.inflow_by_source.map((s, i) => (
                        <div key={s.source} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                            <span className="text-sm text-gray-700">{fmt(s.source)}</span>
                          </div>
                          <span className="text-sm font-semibold text-gray-900">{fc(s.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-8">No inflows in this period</p>
                )}
              </div>

              {/* Outflow by Source */}
              <div className="bg-white rounded-xl border p-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Outflow by Source</h2>
                <p className="text-xs text-gray-400 mb-4">Where the money goes</p>
                {data.outflow_by_source?.length > 0 ? (
                  <>
                    <div className="h-48 mb-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={data.outflow_by_source.map((s) => ({ name: fmt(s.source), value: s.amount }))} cx="50%" cy="50%" innerRadius={35} outerRadius={65} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                            {data.outflow_by_source.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v) => fc(v)} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2">
                      {data.outflow_by_source.map((s, i) => (
                        <div key={s.source} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                            <span className="text-sm text-gray-700">{fmt(s.source)}</span>
                          </div>
                          <span className="text-sm font-semibold text-gray-900">{fc(s.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-8">No outflows in this period</p>
                )}
              </div>
            </div>

            {/* Account-Wise Breakdown */}
            {data.by_account?.length > 0 && (
              <div className="bg-white rounded-xl border p-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Account-Wise Breakdown</h2>
                <p className="text-xs text-gray-400 mb-4">Money movement through each account</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[500px]">
                    <thead>
                      <tr className="border-b border-gray-100 text-left">
                        <th className="pb-3 text-xs font-semibold text-gray-400 uppercase">Account</th>
                        <th className="pb-3 text-right text-xs font-semibold text-gray-400 uppercase">Credits</th>
                        <th className="pb-3 text-right text-xs font-semibold text-gray-400 uppercase">Debits</th>
                        <th className="pb-3 text-right text-xs font-semibold text-gray-400 uppercase">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_account.map((row) => (
                        <tr key={row.account} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2.5 font-medium text-gray-800">{row.account}</td>
                          <td className="py-2.5 text-right text-green-600 font-medium">{fc(row.credit)}</td>
                          <td className="py-2.5 text-right text-red-600 font-medium">{fc(row.debit)}</td>
                          <td className={`py-2.5 text-right font-semibold ${row.net >= 0 ? "text-green-700" : "text-red-700"}`}>{row.net >= 0 ? "+" : ""}{fc(row.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Expense by Category */}
            {data.expenses?.by_category?.length > 0 && (
              <div className="bg-white rounded-xl border p-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Expense Breakdown</h2>
                <p className="text-xs text-gray-400 mb-4">Spending by category &mdash; Total: {fc(data.expenses.total)}</p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.expenses.by_category.map((c) => ({ name: c.category, value: c.amount }))}
                          cx="50%" cy="50%" innerRadius={35} outerRadius={70} dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {data.expenses.by_category.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v) => fc(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2">
                    {data.expenses.by_category.map((c, i) => {
                      const pct = data.expenses.total > 0 ? (c.amount / data.expenses.total) * 100 : 0;
                      return (
                        <div key={c.category}>
                          <div className="flex items-center justify-between mb-0.5">
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                              <span className="text-sm text-gray-700 capitalize">{c.category}</span>
                            </div>
                            <span className="text-sm font-semibold text-gray-900">{fc(c.amount)}</span>
                          </div>
                          <div className="ml-5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Payment Mode Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {data.inflow_by_mode?.length > 0 && (
                <div className="bg-white rounded-xl border p-5">
                  <h2 className="text-base font-semibold text-gray-900 mb-3">Inflow by Payment Mode</h2>
                  <div className="space-y-2">
                    {data.inflow_by_mode.map((m) => (
                      <div key={m.mode} className="flex items-center justify-between">
                        <span className="text-sm text-gray-600 capitalize">{m.mode.replace("_", " ")}</span>
                        <span className="text-sm font-semibold text-green-700">{fc(m.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {data.outflow_by_mode?.length > 0 && (
                <div className="bg-white rounded-xl border p-5">
                  <h2 className="text-base font-semibold text-gray-900 mb-3">Outflow by Payment Mode</h2>
                  <div className="space-y-2">
                    {data.outflow_by_mode.map((m) => (
                      <div key={m.mode} className="flex items-center justify-between">
                        <span className="text-sm text-gray-600 capitalize">{m.mode.replace("_", " ")}</span>
                        <span className="text-sm font-semibold text-red-700">{fc(m.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Recent Transactions */}
            {data.recent_transactions?.length > 0 && (
              <div className="bg-white rounded-xl border p-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Recent Transactions</h2>
                <p className="text-xs text-gray-400 mb-4">Last 50 account movements</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead>
                      <tr className="border-b border-gray-100 text-left">
                        <th className="pb-2 text-xs font-semibold text-gray-400 uppercase">Date</th>
                        <th className="pb-2 text-xs font-semibold text-gray-400 uppercase">Account</th>
                        <th className="pb-2 text-xs font-semibold text-gray-400 uppercase">Source</th>
                        <th className="pb-2 text-xs font-semibold text-gray-400 uppercase">Description</th>
                        <th className="pb-2 text-xs font-semibold text-gray-400 uppercase">Mode</th>
                        <th className="pb-2 text-right text-xs font-semibold text-gray-400 uppercase">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_transactions.map((t, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2 text-gray-500 whitespace-nowrap">{t.date}</td>
                          <td className="py-2 text-gray-700">{t.account}</td>
                          <td className="py-2">
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 capitalize">{fmt(t.source)}</span>
                          </td>
                          <td className="py-2 text-gray-600 truncate max-w-[200px]">{t.description || "—"}</td>
                          <td className="py-2 text-gray-500 capitalize text-xs">{(t.payment_mode || "").replace("_", " ")}</td>
                          <td className={`py-2 text-right font-semibold ${t.type === "credit" ? "text-green-600" : "text-red-600"}`}>
                            {t.type === "credit" ? "+" : "-"}{fc(t.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
    </GreyedOut>
  );
}
