import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "../hooks/useAuth";
import api from "../lib/api";
import { formatCurrency, formatDate } from "../lib/utils";

function StatCard({ label, value, tone, icon, subtitle }) {
  const toneMap = {
    green: "from-emerald-500 to-green-600",
    blue: "from-blue-500 to-indigo-600",
    red: "from-red-500 to-rose-600",
    orange: "from-orange-500 to-amber-600",
    purple: "from-purple-500 to-violet-600",
    emerald: "from-emerald-500 to-teal-600",
    violet: "from-violet-500 to-purple-600",
  };
  const bgTone = toneMap[tone] || toneMap.blue;
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 sm:p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm font-medium text-gray-500 truncate">{label}</p>
          <p className="text-lg sm:text-2xl font-bold text-gray-900 mt-1 truncate">{value}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className={`shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br ${bgTone} flex items-center justify-center ml-3`}>
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {icon}
          </svg>
        </div>
      </div>
    </div>
  );
}

function ExportButton({ dataset, label }) {
  const handleExport = async () => {
    const response = await api.get(`/api/dashboard/export?dataset=${dataset}`, {
      responseType: "blob",
    });
    const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement("a");
    const contentDisposition = response.headers["content-disposition"] || "";
    const match = contentDisposition.match(/filename=([^;]+)/i);
    const filename = match ? match[1].replaceAll('"', "") : `${dataset}.csv`;

    link.href = blobUrl;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(blobUrl);
  };

  return (
    <button
      onClick={handleExport}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs sm:text-sm font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      {label}
    </button>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // All hooks must be called unconditionally (Rules of Hooks)
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: async () => {
      const response = await api.get("/api/dashboard/summary");
      return response.data;
    },
  });

  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ["dashboard-alerts"],
    queryFn: async () => {
      const response = await api.get("/api/dashboard/alerts");
      return response.data;
    },
  });

  const { data: cashflowData, isLoading: cashflowLoading } = useQuery({
    queryKey: ["dashboard-cashflow"],
    queryFn: async () => {
      const response = await api.get("/api/dashboard/cashflow", {
        params: { months: 6 },
      });
      return response.data;
    },
  });

  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ["dashboard-activity"],
    queryFn: async () => {
      const response = await api.get("/api/dashboard/recent-activity", {
        params: { limit: 10 },
      });
      return response.data;
    },
  });

  const { data: thisMonth } = useQuery({
    queryKey: ["dashboard-this-month"],
    queryFn: async () => {
      const response = await api.get("/api/dashboard/this-month");
      return response.data;
    },
  });

  const { data: paymentBehavior } = useQuery({
    queryKey: ["dashboard-payment-behavior"],
    queryFn: async () => {
      const response = await api.get("/api/dashboard/payment-behavior");
      return response.data;
    },
  });

  const alertItems = [
    ...(alerts?.overdue || []).map((item) => ({
      level: "critical",
      title: `${item.contact_name} has overdue interest`,
      description: `Interest due ${formatCurrency(item.interest_outstanding)} · Total ${formatCurrency(item.total_outstanding)}`,
    })),
    ...(alerts?.collateral || []).map((item) => ({
      level: "critical",
      title: `${item.contact_name} collateral threshold breached`,
      description: `Outstanding ${formatCurrency(item.total_outstanding)} vs value ${formatCurrency(item.estimated_value)}`,
    })),
    ...(alerts?.capitalization || []).map((item) => ({
      level: "warning",
      title: `${item.contact_name} is due for capitalization`,
      description: `Outstanding interest ${formatCurrency(item.outstanding_interest)} · ${item.months_since_last_action} month(s) since last action`,
    })),
  ];

  const cashflow = cashflowData?.cashflow || [];
  const activityItems = activityData?.items || [];

  return (
    <div className="min-h-screen bg-gray-50/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              Welcome back, {user?.full_name || user?.username}
            </h1>
            <p className="text-sm sm:text-base text-gray-500 mt-1">
              Here&apos;s your financial overview
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ExportButton dataset="summary" label="Summary" />
            <ExportButton dataset="cashflow" label="Cashflow" />
            <ExportButton dataset="expenses" label="Expenses" />
          </div>
        </div>

        {/* Key Metrics – top row */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">
          <StatCard
            label="Total Lent Out"
            value={summaryLoading ? "..." : formatCurrency(summary?.total_lent_out)}
            tone="green"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />}
          />
          <StatCard
            label="Outstanding Receivable"
            value={summaryLoading ? "..." : formatCurrency(summary?.total_outstanding_receivable)}
            tone="blue"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />}
          />
          <StatCard
            label="Total Borrowed"
            value={summaryLoading ? "..." : formatCurrency(summary?.total_borrowed)}
            tone="red"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />}
          />
          <StatCard
            label="Outstanding Payable"
            value={summaryLoading ? "..." : formatCurrency(summary?.total_outstanding_payable)}
            tone="orange"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />}
          />
          <StatCard
            label="Expected This Month"
            value={summaryLoading ? "..." : formatCurrency(summary?.expected_this_month)}
            tone="purple"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />}
          />
          <StatCard
            label="Net Position"
            value={summaryLoading ? "..." : formatCurrency(summary?.net_position)}
            tone={Number(summary?.net_position || 0) >= 0 ? "emerald" : "red"}
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />}
          />
        </div>

        {/* Monthly & EMI Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <StatCard
            label="EMIs Expected"
            value={thisMonth ? formatCurrency(thisMonth.emis_expected) : "..."}
            tone="blue"
            subtitle="This month"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />}
          />
          <StatCard
            label="EMIs Collected"
            value={thisMonth ? formatCurrency(thisMonth.emis_collected) : "..."}
            tone="green"
            subtitle="This month"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />}
          />
          <StatCard
            label="EMIs Pending"
            value={thisMonth ? formatCurrency(thisMonth.emis_pending) : "..."}
            tone="orange"
            subtitle="This month"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />}
          />
          <StatCard
            label="Overdue Interest"
            value={thisMonth ? formatCurrency(thisMonth.overdue_interest) : "..."}
            tone="red"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />}
          />
        </div>

        {/* Beesi & Interest Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
          <StatCard
            label="Interest Due"
            value={thisMonth ? formatCurrency(thisMonth.interest_expected) : "..."}
            tone="purple"
            subtitle="This month"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />}
          />
          <StatCard
            label="Active Beesis"
            value={summaryLoading ? "..." : (summary?.active_beesis || 0)}
            tone="violet"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />}
          />
          <StatCard
            label="Beesi Invested"
            value={summaryLoading ? "..." : formatCurrency(summary?.beesi_total_invested || 0)}
            tone="violet"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />}
          />
          <div className="bg-white rounded-xl border border-gray-100 p-4 sm:p-5 hover:shadow-md transition-shadow">
            <p className="text-xs sm:text-sm font-medium text-gray-500">Portfolio</p>
            <div className="mt-2 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Properties</span>
                <span className="font-semibold text-gray-700">{summary?.active_property_deals || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Partnerships</span>
                <span className="font-semibold text-gray-700">{summary?.active_partnerships || 0}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Alerts + Cashflow */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
          {/* Alerts */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 sm:p-6 xl:col-span-1">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Alerts</h2>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                alertItems.length > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
              }`}>
                {alertItems.length} open
              </span>
            </div>
            {alertsLoading ? (
              <div className="text-sm text-gray-400 animate-pulse">Loading alerts...</div>
            ) : alertItems.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mb-3">
                  <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-600">All clear!</p>
                <p className="text-xs text-gray-400 mt-0.5">No active alerts</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-80 overflow-auto pr-1">
                {alertItems.map((alert, index) => (
                  <div
                    key={`${alert.title}-${index}`}
                    className={`rounded-lg border px-3.5 py-3 ${
                      alert.level === "critical"
                        ? "border-red-200 bg-red-50/50"
                        : "border-amber-200 bg-amber-50/50"
                    }`}
                  >
                    <div className={`text-sm font-medium ${
                      alert.level === "critical" ? "text-red-800" : "text-amber-800"
                    }`}>
                      {alert.title}
                    </div>
                    <div className={`text-xs mt-1 ${
                      alert.level === "critical" ? "text-red-600" : "text-amber-600"
                    }`}>
                      {alert.description}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cashflow Chart */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 sm:p-6 xl:col-span-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Cash Flow</h2>
                <p className="text-xs text-gray-400">Last 6 months inflow vs outflow</p>
              </div>
              <span className="text-xs sm:text-sm font-medium text-gray-500">
                Overdue: <span className="text-red-600">{formatCurrency(summary?.total_overdue)}</span>
              </span>
            </div>
            {cashflowLoading ? (
              <div className="h-64 sm:h-80 flex items-center justify-center text-gray-400 animate-pulse">
                Loading chart...
              </div>
            ) : (
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cashflow} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                    <Tooltip
                      formatter={(value) => formatCurrency(value)}
                      contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }}
                    />
                    <Legend wrapperStyle={{ fontSize: "13px" }} />
                    <Bar dataKey="inflow" fill="#10b981" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="outflow" fill="#ef4444" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* Activity + Portfolio sidebar */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
          {/* Recent Activity */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 sm:p-6 xl:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
              <span className="text-xs text-gray-400">Last 10 entries</span>
            </div>
            {activityLoading ? (
              <div className="text-sm text-gray-400 animate-pulse">Loading activity...</div>
            ) : activityItems.length === 0 ? (
              <div className="text-sm text-gray-400 py-8 text-center">No activity recorded yet.</div>
            ) : (
              <div className="space-y-2">
                {activityItems.map((item, index) => (
                  <div
                    key={`${item.type}-${index}`}
                    className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 px-3.5 py-3 hover:bg-gray-50/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 truncate">{item.title}</div>
                      <div className="text-xs text-gray-400 mt-0.5 truncate">{item.description}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-gray-900">{formatCurrency(item.amount)}</div>
                      <div className="text-xs text-gray-400">{formatDate(item.date)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar cards */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-100 p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Portfolio Snapshot</h2>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Active Property Deals</span>
                  <span className="font-semibold text-gray-800">{summary?.active_property_deals || 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Active Partnerships</span>
                  <span className="font-semibold text-gray-800">{summary?.active_partnerships || 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Partnership Invested</span>
                  <span className="font-semibold text-gray-800">{formatCurrency(summary?.total_partnership_invested)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Partnership Received</span>
                  <span className="font-semibold text-gray-800">{formatCurrency(summary?.total_partnership_received)}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Account</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
                <dt className="text-gray-400">Username</dt>
                <dd className="text-gray-800 font-medium">{user?.username}</dd>
                <dt className="text-gray-400">Email</dt>
                <dd className="text-gray-800 font-medium break-all">{user?.email}</dd>
                <dt className="text-gray-400">Role</dt>
                <dd className="text-gray-800 font-medium capitalize">{user?.role}</dd>
                <dt className="text-gray-400">Status</dt>
                <dd>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    user?.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                  }`}>
                    {user?.is_active ? "Active" : "Inactive"}
                  </span>
                </dd>
              </dl>
            </div>
          </div>
        </div>

        {/* Payment Behavior Table */}
        {paymentBehavior && paymentBehavior.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Payment Behavior</h2>
            <div className="overflow-x-auto -mx-5 sm:-mx-6 px-5 sm:px-6">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Contact</th>
                    <th className="pb-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">Loans</th>
                    <th className="pb-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">Principal</th>
                    <th className="pb-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">Payments</th>
                    <th className="pb-3 pr-4 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">Rate</th>
                    <th className="pb-3 pl-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Last Payment</th>
                    <th className="pb-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentBehavior.map((row) => (
                    <tr
                      key={row.contact_id}
                      className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => navigate(`/contacts/${row.contact_id}`)}
                    >
                      <td className="py-3 text-gray-800 font-semibold">{row.contact_name}</td>
                      <td className="py-3 text-right text-gray-500">{row.active_loans}</td>
                      <td className="py-3 text-right text-gray-800">{formatCurrency(row.total_principal)}</td>
                      <td className="py-3 text-right text-gray-500">{row.total_payments_made}</td>
                      <td className="py-3 pr-4 text-right text-gray-500">{row.avg_payment_rate_pct}%</td>
                      <td className="py-3 pl-4 text-gray-500">{row.last_payment_date ? formatDate(row.last_payment_date) : "Never"}</td>
                      <td className="py-3 text-center">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          row.score_color === "green"
                            ? "bg-green-100 text-green-700"
                            : row.score_color === "red"
                              ? "bg-red-100 text-red-700"
                              : "bg-yellow-100 text-yellow-700"
                        }`}>
                          {row.score}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
