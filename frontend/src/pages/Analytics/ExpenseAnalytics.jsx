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

const COLORS = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#84cc16",
  "#14b8a6", "#e11d48", "#0ea5e9", "#a855f7", "#d946ef",
  "#64748b", "#22c55e", "#dc2626", "#2563eb", "#ca8a04",
];

function getMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function getToday() {
  return new Date().toISOString().split("T")[0];
}

function get6MonthsAgo() {
  const d = new Date();
  d.setMonth(d.getMonth() - 5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function ExpenseAnalytics() {
  const navigate = useNavigate();
  const [range, setRange] = useState({
    from_date: get6MonthsAgo(),
    to_date: getToday(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["expense-analytics", range],
    queryFn: async () => {
      const params = {};
      if (range.from_date) params.from_date = range.from_date;
      if (range.to_date) params.to_date = range.to_date;
      return (await api.get("/api/expenses/analytics/summary", { params })).data;
    },
  });

  const presets = [
    { label: "This Month", from: getMonthStart(), to: getToday() },
    { label: "Last 3 Months", from: (() => { const d = new Date(); d.setMonth(d.getMonth() - 2); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; })(), to: getToday() },
    { label: "Last 6 Months", from: get6MonthsAgo(), to: getToday() },
    { label: "This Year", from: `${new Date().getFullYear()}-01-01`, to: getToday() },
    { label: "All Time", from: "", to: "" },
  ];

  const categories = data?.categories || [];
  const monthly = data?.monthly || [];
  const modes = data?.payment_modes || [];
  const linkedTypes = data?.linked_types || [];
  const accountBreakdown = data?.accounts || [];

  const monthlyChart = monthly.map((m) => ({
    month: new Date(m.month + "-01").toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
    amount: Number(m.total),
    count: m.count,
  }));

  const categoryChart = categories.map((c, i) => ({
    name: c.category,
    value: Number(c.total),
    color: COLORS[i % COLORS.length],
  }));

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <button onClick={() => navigate("/analytics")} className="text-gray-600 hover:text-gray-900 mb-3">
            ← Back to Analytics
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Expense Analytics</h1>
          <p className="text-gray-600 mt-1">Analyze spending patterns across categories, time periods, and accounts.</p>
        </div>

        {/* Date Range + Presets */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-500">From</label>
              <input
                type="date"
                value={range.from_date}
                onChange={(e) => setRange((r) => ({ ...r, from_date: e.target.value }))}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-500">To</label>
              <input
                type="date"
                value={range.to_date}
                onChange={(e) => setRange((r) => ({ ...r, to_date: e.target.value }))}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div className="h-6 border-l border-gray-200" />
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => setRange({ from_date: p.from, to_date: p.to })}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  range.from_date === p.from && range.to_date === p.to
                    ? "bg-blue-600 text-white border-blue-600"
                    : "border-gray-300 hover:bg-gray-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg shadow-sm p-5">
                <div className="text-sm text-gray-500">Total Spent</div>
                <div className="text-2xl font-bold text-red-600 mt-1">{formatCurrency(data?.grand_total)}</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm p-5">
                <div className="text-sm text-gray-500">Transactions</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">{data?.expense_count || 0}</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm p-5">
                <div className="text-sm text-gray-500">Categories Used</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">{categories.length}</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm p-5">
                <div className="text-sm text-gray-500">Avg per Entry</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">
                  {formatCurrency(data?.expense_count ? Number(data.grand_total) / data.expense_count : 0)}
                </div>
              </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Category Pie */}
              <div className="bg-white rounded-lg shadow-sm p-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Spending by Category</h2>
                {categoryChart.length === 0 ? (
                  <div className="text-center text-gray-400 py-12">No data</div>
                ) : (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categoryChart}
                          cx="50%"
                          cy="50%"
                          outerRadius={110}
                          dataKey="value"
                          nameKey="name"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {categoryChart.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => formatCurrency(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Monthly Trend */}
              <div className="bg-white rounded-lg shadow-sm p-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Monthly Spending Trend</h2>
                {monthlyChart.length === 0 ? (
                  <div className="text-center text-gray-400 py-12">No data</div>
                ) : (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monthlyChart}>
                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                        <Tooltip formatter={(value) => formatCurrency(value)} />
                        <Bar dataKey="amount" fill="#ef4444" radius={[6, 6, 0, 0]} name="Amount" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            {/* Category Breakdown Table */}
            <div className="bg-white rounded-lg shadow-sm p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Category Breakdown</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="py-2 text-left text-xs font-semibold text-gray-400 uppercase">Category</th>
                      <th className="py-2 text-right text-xs font-semibold text-gray-400 uppercase">Amount</th>
                      <th className="py-2 text-right text-xs font-semibold text-gray-400 uppercase">Count</th>
                      <th className="py-2 text-right text-xs font-semibold text-gray-400 uppercase">% of Total</th>
                      <th className="py-2 text-left text-xs font-semibold text-gray-400 uppercase pl-4">Distribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((cat, i) => {
                      const pct = data?.grand_total > 0 ? (Number(cat.total) / Number(data.grand_total)) * 100 : 0;
                      return (
                        <tr key={cat.category} className="border-b border-gray-50">
                          <td className="py-2.5 font-medium text-gray-800 flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                            {cat.category}
                          </td>
                          <td className="py-2.5 text-right font-semibold text-gray-900">{formatCurrency(cat.total)}</td>
                          <td className="py-2.5 text-right text-gray-500">{cat.count}</td>
                          <td className="py-2.5 text-right text-gray-500">{pct.toFixed(1)}%</td>
                          <td className="py-2.5 pl-4">
                            <div className="w-full bg-gray-100 rounded-full h-2">
                              <div className="h-2 rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Payment Mode & Account Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-lg shadow-sm p-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">By Payment Mode</h2>
                <div className="space-y-2">
                  {modes.map((m) => (
                    <div key={m.mode} className="flex items-center justify-between py-1.5 border-b border-gray-50">
                      <span className="capitalize text-gray-700">{m.mode.replaceAll("_", " ")}</span>
                      <div className="text-right">
                        <span className="font-semibold text-gray-900">{formatCurrency(m.total)}</span>
                        <span className="text-xs text-gray-400 ml-2">({m.count})</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">By Linked Type</h2>
                <div className="space-y-2">
                  {linkedTypes.map((lt) => (
                    <div key={lt.type} className="flex items-center justify-between py-1.5 border-b border-gray-50">
                      <span className="capitalize text-gray-700">{lt.type}</span>
                      <div className="text-right">
                        <span className="font-semibold text-gray-900">{formatCurrency(lt.total)}</span>
                        <span className="text-xs text-gray-400 ml-2">({lt.count})</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Account Breakdown */}
            {accountBreakdown.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm p-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">By Account</h2>
                <div className="space-y-2">
                  {accountBreakdown.map((a) => (
                    <div key={a.account_id} className="flex items-center justify-between py-1.5 border-b border-gray-50">
                      <span className="text-gray-700">{a.name}</span>
                      <div className="text-right">
                        <span className="font-semibold text-gray-900">{formatCurrency(a.total)}</span>
                        <span className="text-xs text-gray-400 ml-2">({a.count} entries)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
