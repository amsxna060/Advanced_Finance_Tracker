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

const quickLinks = [
  {
    title: "Contacts",
    description: "Manage your contacts",
    route: "/contacts",
    color: "blue",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
      />
    ),
  },
  {
    title: "Loans",
    description: "Track lending activities",
    route: "/loans",
    color: "green",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    ),
  },
  {
    title: "Properties",
    description: "Track deal flow and profit",
    route: "/properties",
    color: "purple",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
      />
    ),
  },
  {
    title: "Partnerships",
    description: "Monitor invested vs received",
    route: "/partnerships",
    color: "orange",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
      />
    ),
  },
  {
    title: "Expenses",
    description: "Log and review expenses",
    route: "/expenses",
    color: "rose",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8c-1.657 0-3 .895-3 2m0 0c0 1.105 1.343 2 3 2s3 .895 3 2m-6-4h6m-6 0V6m6 4a2 2 0 012 2c0 1.105-1.343 2-3 2m1 0H9m6 0v2m-6-2a2 2 0 01-2-2m2 2a2 2 0 00-2 2m10-6a2 2 0 00-2-2m2 2a2 2 0 012 2m-8 6h8"
      />
    ),
  },
  {
    title: "Reports",
    description: "Generate PDF/Excel reports",
    route: "/reports",
    color: "indigo",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    ),
  },
  {
    title: "Beesi",
    description: "Chit fund / BC tracking",
    route: "/beesi",
    color: "violet",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
      />
    ),
  },
  {
    title: "Accounts",
    description: "Cash & bank balance ledger",
    route: "/accounts",
    color: "teal",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
      />
    ),
  },
  {
    title: "Analytics",
    description: "Investments, liabilities & cash flow",
    route: "/analytics",
    color: "cyan",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
      />
    ),
  },
  {
    title: "Money Flow",
    description: "Receivables & payables tracker",
    route: "/obligations",
    color: "amber",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
      />
    ),
  },
];

const colorClasses = {
  blue: "bg-blue-100 text-blue-600",
  green: "bg-green-100 text-green-600",
  purple: "bg-purple-100 text-purple-600",
  orange: "bg-orange-100 text-orange-600",
  rose: "bg-rose-100 text-rose-600",
  indigo: "bg-indigo-100 text-indigo-600",
  violet: "bg-violet-100 text-violet-600",
  teal: "bg-teal-100 text-teal-600",
  cyan: "bg-cyan-100 text-cyan-600",
};

function MetricCard({ label, value, tone = "text-gray-900" }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${tone}`}>{value}</div>
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
      className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      {label}
    </button>
  );
}

export default function Dashboard() {
  const { user, logout } = useAuth();
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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Advanced Finance Tracker
            </h1>
            <p className="text-sm text-gray-600">
              Welcome back, {user.full_name || user.username}!
            </p>
          </div>
          <button
            onClick={logout}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-wrap gap-3 mb-8">
          <ExportButton dataset="summary" label="Export Summary" />
          <ExportButton dataset="cashflow" label="Export Cashflow" />
          <ExportButton dataset="expenses" label="Export Expenses" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6 mb-8">
          {quickLinks.map((item) => (
            <button
              key={item.title}
              onClick={() => navigate(item.route)}
              className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow text-left"
            >
              <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-lg ${colorClasses[item.color]}`}>
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    {item.icon}
                  </svg>
                </div>
                <svg
                  className="w-5 h-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">
                {item.title}
              </h3>
              <p className="text-sm text-gray-600 mt-1">{item.description}</p>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
          <MetricCard
            label="Total Lent Out"
            value={
              summaryLoading ? "..." : formatCurrency(summary?.total_lent_out)
            }
            tone="text-green-700"
          />
          <MetricCard
            label="Outstanding Receivable"
            value={
              summaryLoading
                ? "..."
                : formatCurrency(summary?.total_outstanding_receivable)
            }
            tone="text-blue-700"
          />
          <MetricCard
            label="Total Borrowed"
            value={
              summaryLoading ? "..." : formatCurrency(summary?.total_borrowed)
            }
            tone="text-red-700"
          />
          <MetricCard
            label="Outstanding Payable"
            value={
              summaryLoading
                ? "..."
                : formatCurrency(summary?.total_outstanding_payable)
            }
            tone="text-orange-700"
          />
          <MetricCard
            label="Expected This Month"
            value={
              summaryLoading
                ? "..."
                : formatCurrency(summary?.expected_this_month)
            }
            tone="text-purple-700"
          />
          <MetricCard
            label="Net Position"
            value={
              summaryLoading ? "..." : formatCurrency(summary?.net_position)
            }
            tone={
              Number(summary?.net_position || 0) >= 0
                ? "text-emerald-700"
                : "text-red-700"
            }
          />
          <MetricCard
            label="EMIs Expected This Month"
            value={thisMonth ? formatCurrency(thisMonth.emis_expected) : "..."}
            tone="text-blue-700"
          />
          <MetricCard
            label="EMIs Collected This Month"
            value={thisMonth ? formatCurrency(thisMonth.emis_collected) : "..."}
            tone="text-green-700"
          />
          <MetricCard
            label="EMIs Pending This Month"
            value={thisMonth ? formatCurrency(thisMonth.emis_pending) : "..."}
            tone="text-orange-700"
          />
          <MetricCard
            label="Interest Due This Month"
            value={
              thisMonth ? formatCurrency(thisMonth.interest_expected) : "..."
            }
            tone="text-purple-700"
          />
          <MetricCard
            label="Overdue Interest"
            value={
              thisMonth ? formatCurrency(thisMonth.overdue_interest) : "..."
            }
            tone="text-red-700"
          />
          <MetricCard
            label="Active Beesis"
            value={summaryLoading ? "..." : summary?.active_beesis || 0}
            tone="text-violet-700"
          />
          <MetricCard
            label="Total Invested in Beesi"
            value={
              summaryLoading
                ? "..."
                : formatCurrency(summary?.beesi_total_invested || 0)
            }
            tone="text-violet-700"
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-sm p-6 xl:col-span-1">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Alerts</h2>
              <span className="text-sm text-gray-500">
                {alertItems.length} open
              </span>
            </div>
            {alertsLoading ? (
              <div className="text-sm text-gray-500">Loading alerts...</div>
            ) : alertItems.length === 0 ? (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                No active alerts. Everything looks stable.
              </div>
            ) : (
              <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
                {alertItems.map((alert, index) => (
                  <div
                    key={`${alert.title}-${index}`}
                    className={`rounded-lg border px-4 py-3 ${alert.level === "critical" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}
                  >
                    <div
                      className={`font-medium ${alert.level === "critical" ? "text-red-800" : "text-amber-800"}`}
                    >
                      {alert.title}
                    </div>
                    <div
                      className={`text-sm mt-1 ${alert.level === "critical" ? "text-red-700" : "text-amber-700"}`}
                    >
                      {alert.description}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 xl:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  Cashflow
                </h2>
                <p className="text-sm text-gray-500">
                  Last 6 months inflow vs outflow
                </p>
              </div>
              <div className="text-sm text-gray-500">
                Overdue: {formatCurrency(summary?.total_overdue)}
              </div>
            </div>
            {cashflowLoading ? (
              <div className="h-80 flex items-center justify-center text-gray-500">
                Loading chart...
              </div>
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cashflow}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Legend />
                    <Bar
                      dataKey="inflow"
                      fill="#16a34a"
                      radius={[6, 6, 0, 0]}
                    />
                    <Bar
                      dataKey="outflow"
                      fill="#ef4444"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow-sm p-6 xl:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">
                Recent Activity
              </h2>
              <span className="text-sm text-gray-500">Last 10 entries</span>
            </div>
            {activityLoading ? (
              <div className="text-sm text-gray-500">Loading activity...</div>
            ) : activityItems.length === 0 ? (
              <div className="text-sm text-gray-500">
                No activity recorded yet.
              </div>
            ) : (
              <div className="space-y-3">
                {activityItems.map((item, index) => (
                  <div
                    key={`${item.type}-${index}`}
                    className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3"
                  >
                    <div>
                      <div className="font-medium text-gray-900">
                        {item.title}
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        {item.description}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold text-gray-900">
                        {formatCurrency(item.amount)}
                      </div>
                      <div className="text-sm text-gray-500">
                        {formatDate(item.date)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Portfolio Snapshot
              </h2>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Active Property Deals</span>
                  <span className="font-medium text-gray-900">
                    {summary?.active_property_deals || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Active Partnerships</span>
                  <span className="font-medium text-gray-900">
                    {summary?.active_partnerships || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Partnership Invested</span>
                  <span className="font-medium text-gray-900">
                    {formatCurrency(summary?.total_partnership_invested)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Partnership Received</span>
                  <span className="font-medium text-gray-900">
                    {formatCurrency(summary?.total_partnership_received)}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                User Info
              </h2>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-gray-600">Username:</dt>
                <dd className="text-gray-900 font-medium">{user.username}</dd>
                <dt className="text-gray-600">Email:</dt>
                <dd className="text-gray-900 font-medium break-all">
                  {user.email}
                </dd>
                <dt className="text-gray-600">Role:</dt>
                <dd className="text-gray-900 font-medium capitalize">
                  {user.role}
                </dd>
                <dt className="text-gray-600">Status:</dt>
                <dd className="text-gray-900 font-medium">
                  {user.is_active ? "Active" : "Inactive"}
                </dd>
              </dl>
            </div>
          </div>
        </div>

        {/* Payment Behavior Table */}
        {paymentBehavior && paymentBehavior.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm p-6 mt-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Payment Behavior
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left">
                    <th className="pb-2 text-gray-500 font-medium">Contact</th>
                    <th className="pb-2 text-right text-gray-500 font-medium">
                      Active Loans
                    </th>
                    <th className="pb-2 text-right text-gray-500 font-medium">
                      Total Principal
                    </th>
                    <th className="pb-2 text-right text-gray-500 font-medium">
                      Payments Made
                    </th>
                    <th className="pb-2 pr-4 text-right text-gray-500 font-medium">
                      Avg Repayment Rate
                    </th>
                    <th className="pb-2 pl-4 text-gray-500 font-medium">
                      Last Payment
                    </th>
                    <th className="pb-2 text-center text-gray-500 font-medium">
                      Score
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paymentBehavior.map((row) => (
                    <tr
                      key={row.contact_id}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                      onClick={() =>
                        (window.location.href = `/contacts/${row.contact_id}`)
                      }
                    >
                      <td className="py-2 text-gray-800 font-semibold">
                        {row.contact_name}
                      </td>
                      <td className="py-2 text-right text-gray-600">
                        {row.active_loans}
                      </td>
                      <td className="py-2 text-right text-gray-800">
                        {formatCurrency(row.total_principal)}
                      </td>
                      <td className="py-2 text-right text-gray-600">
                        {row.total_payments_made}
                      </td>
                      <td className="py-2 pr-4 text-right text-gray-600">
                        {row.avg_payment_rate_pct}%
                      </td>
                      <td className="py-2 pl-4 text-gray-600">
                        {row.last_payment_date
                          ? formatDate(row.last_payment_date)
                          : "Never"}
                      </td>
                      <td className="py-2 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
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
      </main>
    </div>
  );
}
