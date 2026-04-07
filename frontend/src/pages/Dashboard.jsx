import React from "react";
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
import { useAuth } from "../hooks/useAuth";
import api from "../lib/api";
import { formatCurrency, formatDate } from "../lib/utils";

const fc = (v) => formatCurrency(v ?? 0);

function MetricCard({ label, value, subtitle, color = "blue", icon }) {
  const gradients = {
    green: "from-emerald-500 to-green-600",
    blue: "from-blue-500 to-indigo-600",
    red: "from-red-500 to-rose-600",
    orange: "from-orange-500 to-amber-600",
    purple: "from-purple-500 to-violet-600",
    emerald: "from-emerald-500 to-teal-600",
    violet: "from-violet-500 to-purple-600",
    cyan: "from-cyan-500 to-blue-600",
    pink: "from-pink-500 to-rose-600",
  };
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 sm:p-5 hover:shadow-md transition-all">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide truncate">{label}</p>
          <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-1.5 truncate">{value}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
        </div>
        {icon && (
          <div className={`shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br ${gradients[color] || gradients.blue} flex items-center justify-center ml-3 shadow-sm`}>
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">{icon}</svg>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function ExportButton({ dataset, label }) {
  const handleExport = async () => {
    const response = await api.get(`/api/dashboard/export?dataset=${encodeURIComponent(dataset)}`, { responseType: "blob" });
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
    <button onClick={handleExport} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-50 hover:border-gray-300 transition-colors">
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      {label}
    </button>
  );
}

const PIE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6"];

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: async () => (await api.get("/api/dashboard/summary")).data,
  });
  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ["dashboard-alerts"],
    queryFn: async () => (await api.get("/api/dashboard/alerts")).data,
  });
  const { data: cashflowData, isLoading: cashflowLoading } = useQuery({
    queryKey: ["dashboard-cashflow"],
    queryFn: async () => (await api.get("/api/dashboard/cashflow", { params: { months: 6 } })).data,
  });
  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ["dashboard-activity"],
    queryFn: async () => (await api.get("/api/dashboard/recent-activity", { params: { limit: 10 } })).data,
  });
  const { data: thisMonth } = useQuery({
    queryKey: ["dashboard-this-month"],
    queryFn: async () => (await api.get("/api/dashboard/this-month")).data,
  });
  const { data: paymentBehavior } = useQuery({
    queryKey: ["dashboard-payment-behavior"],
    queryFn: async () => (await api.get("/api/dashboard/payment-behavior")).data,
  });

  const alertItems = [
    ...(alerts?.overdue || []).map((item) => ({
      level: "critical",
      title: `${item.contact_name} has overdue interest`,
      description: `Interest due ${fc(item.interest_outstanding)} \u00B7 Total ${fc(item.total_outstanding)}`,
    })),
    ...(alerts?.collateral || []).map((item) => ({
      level: "critical",
      title: `${item.contact_name} collateral threshold breached`,
      description: `Outstanding ${fc(item.total_outstanding)} vs value ${fc(item.estimated_value)}`,
    })),
    ...(alerts?.capitalization || []).map((item) => ({
      level: "warning",
      title: `${item.contact_name} is due for capitalization`,
      description: `Outstanding interest ${fc(item.outstanding_interest)} \u00B7 ${item.months_since_last_action} month(s) since last action`,
    })),
  ];

  const cashflow = cashflowData?.cashflow || [];
  const activityItems = activityData?.items || [];
  const loading = summaryLoading;

  const monthPaymentData = thisMonth
    ? [
        { name: "Principal", value: Number(thisMonth.principal_collected || 0) },
        { name: "Interest", value: Number(thisMonth.interest_collected || 0) },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              Welcome back, {user?.full_name || user?.username}
            </h1>
            <p className="text-sm text-gray-500 mt-1">Here&apos;s your financial overview</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ExportButton dataset="summary" label="Summary" />
            <ExportButton dataset="cashflow" label="Cashflow" />
            <ExportButton dataset="expenses" label="Expenses" />
          </div>
        </div>

        {/* Lending Overview */}
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Lending Overview
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <MetricCard
            label="Total Lent Out"
            value={loading ? "..." : fc(summary?.total_lent_out)}
            color="green"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />}
          />
          <MetricCard
            label="Outstanding Receivable"
            value={loading ? "..." : fc(summary?.total_outstanding_receivable)}
            color="blue"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />}
          />
          <MetricCard
            label="Interest Earned"
            value={loading ? "..." : fc(summary?.total_interest_earned)}
            color="emerald"
            subtitle="All-time from given loans"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />}
          />
          <MetricCard
            label="Principal Recovered"
            value={loading ? "..." : fc(summary?.total_principal_recovered)}
            color="cyan"
            subtitle="All-time from given loans"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />}
          />
        </div>

        {/* Borrowing & Net Position */}
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Borrowing & Net Position
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <MetricCard
            label="Total Borrowed"
            value={loading ? "..." : fc(summary?.total_borrowed)}
            color="red"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />}
          />
          <MetricCard
            label="Outstanding Payable"
            value={loading ? "..." : fc(summary?.total_outstanding_payable)}
            color="orange"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />}
          />
          <MetricCard
            label="Expected This Month"
            value={loading ? "..." : fc(summary?.expected_this_month)}
            color="purple"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />}
          />
          <MetricCard
            label="Net Position"
            value={loading ? "..." : fc(summary?.net_position)}
            color={Number(summary?.net_position || 0) >= 0 ? "emerald" : "red"}
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />}
          />
        </div>

        {/* This Month Collections */}
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          {thisMonth?.month || "This Month"} &mdash; Collections
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-6">
          <MetricCard
            label="Total Collected"
            value={thisMonth ? fc(thisMonth.emis_collected) : "..."}
            color="green"
            subtitle="All payments received"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />}
          />
          <MetricCard
            label="Principal Portion"
            value={thisMonth ? fc(thisMonth.principal_collected) : "..."}
            color="cyan"
            subtitle="From collections"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />}
          />
          <MetricCard
            label="Interest Portion"
            value={thisMonth ? fc(thisMonth.interest_collected) : "..."}
            color="emerald"
            subtitle="From collections"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />}
          />
          <MetricCard
            label="Pending"
            value={thisMonth ? fc(thisMonth.emis_pending) : "..."}
            color="orange"
            subtitle="EMIs not yet received"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />}
          />
          <MetricCard
            label="Overdue Interest"
            value={thisMonth ? fc(thisMonth.overdue_interest) : "..."}
            color="red"
            subtitle="Outstanding across all"
            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />}
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
          {/* Cash Flow */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 sm:p-6 xl:col-span-2">
            <SectionHeader
              title="Cash Flow"
              subtitle="Last 6 months inflow vs outflow"
              action={
                <span className="text-xs font-medium text-gray-500">
                  Overdue: <span className="text-red-600">{fc(summary?.total_overdue)}</span>
                </span>
              }
            />
            {cashflowLoading ? (
              <div className="h-72 flex items-center justify-center text-gray-400 animate-pulse">
                Loading chart...
              </div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cashflow} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) =>
                        v >= 100000
                          ? `${(v / 100000).toFixed(1)}L`
                          : v >= 1000
                          ? `${(v / 1000).toFixed(0)}k`
                          : v
                      }
                    />
                    <Tooltip
                      formatter={(value) => fc(value)}
                      contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }}
                    />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Bar dataKey="inflow" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="outflow" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Right sidebar: Collection Split + Alerts */}
          <div className="space-y-6">
            {monthPaymentData.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <SectionHeader title="Collection Split" subtitle={thisMonth?.month} />
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={monthPaymentData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={65}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {monthPaymentData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => fc(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-900">Alerts</h2>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    alertItems.length > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                  }`}
                >
                  {alertItems.length}
                </span>
              </div>
              {alertsLoading ? (
                <div className="text-sm text-gray-400 animate-pulse">Loading...</div>
              ) : alertItems.length === 0 ? (
                <div className="text-center py-6">
                  <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-2">
                    <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-sm text-gray-500">All clear!</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-52 overflow-auto pr-1">
                  {alertItems.map((alert, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border px-3 py-2.5 ${
                        alert.level === "critical"
                          ? "border-red-200 bg-red-50/50"
                          : "border-amber-200 bg-amber-50/50"
                      }`}
                    >
                      <div
                        className={`text-xs font-medium ${
                          alert.level === "critical" ? "text-red-800" : "text-amber-800"
                        }`}
                      >
                        {alert.title}
                      </div>
                      <div
                        className={`text-xs mt-0.5 ${
                          alert.level === "critical" ? "text-red-600" : "text-amber-600"
                        }`}
                      >
                        {alert.description}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Activity + Portfolio */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
          <div className="bg-white rounded-xl border border-gray-100 p-5 sm:p-6 xl:col-span-2">
            <SectionHeader title="Recent Activity" subtitle="Last 10 entries" />
            {activityLoading ? (
              <div className="text-sm text-gray-400 animate-pulse">Loading...</div>
            ) : activityItems.length === 0 ? (
              <div className="text-sm text-gray-400 py-8 text-center">No activity recorded yet.</div>
            ) : (
              <div className="space-y-1.5">
                {activityItems.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-3 rounded-lg border border-gray-50 px-3 py-2.5 hover:bg-gray-50/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 truncate">{item.title}</div>
                      <div className="text-xs text-gray-400 mt-0.5 truncate">{item.description}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-gray-900">{fc(item.amount)}</div>
                      <div className="text-xs text-gray-400">{formatDate(item.date)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="text-base font-semibold text-gray-900 mb-3">Beesi / Chit Fund</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Active Beesis</span>
                  <span className="font-semibold text-gray-700">{summary?.active_beesis || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Total Invested</span>
                  <span className="font-semibold text-gray-700">{fc(summary?.beesi_total_invested)}</span>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="text-base font-semibold text-gray-900 mb-3">Portfolio</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Properties</span>
                  <span className="font-semibold text-gray-700">{summary?.active_property_deals || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Partnerships</span>
                  <span className="font-semibold text-gray-700">{summary?.active_partnerships || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Invested</span>
                  <span className="font-semibold text-gray-700">{fc(summary?.total_partnership_invested)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Received</span>
                  <span className="font-semibold text-gray-700">{fc(summary?.total_partnership_received)}</span>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="text-base font-semibold text-gray-900 mb-3">Quick Links</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Loans", route: "/loans" },
                  { label: "Expenses", route: "/expenses" },
                  { label: "Properties", route: "/properties" },
                  { label: "Analytics", route: "/analytics" },
                  { label: "Expense Analytics", route: "/expense-analytics" },
                  { label: "Accounts", route: "/accounts" },
                ].map((link) => (
                  <button
                    key={link.route}
                    onClick={() => navigate(link.route)}
                    className="px-3 py-2 text-xs font-medium text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors text-left"
                  >
                    {link.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Payment Behavior */}
        {paymentBehavior && paymentBehavior.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-5 sm:p-6">
            <SectionHeader title="Payment Behavior" subtitle="Scoring based on repayment consistency" />
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
                      <td className="py-2.5 text-gray-800 font-semibold">{row.contact_name}</td>
                      <td className="py-2.5 text-right text-gray-500">{row.active_loans}</td>
                      <td className="py-2.5 text-right text-gray-800">{fc(row.total_principal)}</td>
                      <td className="py-2.5 text-right text-gray-500">{row.total_payments_made}</td>
                      <td className="py-2.5 pr-4 text-right text-gray-500">{row.avg_payment_rate_pct}%</td>
                      <td className="py-2.5 pl-4 text-gray-500">
                        {row.last_payment_date ? formatDate(row.last_payment_date) : "Never"}
                      </td>
                      <td className="py-2.5 text-center">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            row.score_color === "green"
                              ? "bg-green-100 text-green-700"
                              : row.score_color === "red"
                              ? "bg-red-100 text-red-700"
                              : "bg-yellow-100 text-yellow-700"
                          }`}
                        >
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
