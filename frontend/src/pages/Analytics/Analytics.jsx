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
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
];

export default function Analytics() {
  const navigate = useNavigate();
  const [forecastPeriod, setForecastPeriod] = useState("30_days");
  const [expandedSection, setExpandedSection] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["analytics-overview"],
    queryFn: async () => {
      const response = await api.get("/api/analytics/overview");
      return response.data;
    },
  });

  const { data: forecast, isLoading: forecastLoading } = useQuery({
    queryKey: ["analytics-forecast"],
    queryFn: async () => {
      const response = await api.get("/api/analytics/forecast");
      return response.data;
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!data) return null;

  const {
    investments,
    liabilities,
    pnl,
    net_worth,
    accounts,
    total_cash,
    counts,
    monthly_cashflow,
    top_contacts,
  } = data;

  const investmentPie = [
    { name: "Loans Given", value: investments.loans_given_outstanding },
    { name: "Property Advances", value: investments.property_advances },
    { name: "Property Sites", value: investments.property_site_investments },
    { name: "Partnership", value: investments.partnership_invested },
    { name: "Beesi", value: investments.beesi_invested },
  ].filter((d) => d.value > 0);

  const liabilityPie = [
    { name: "Loans Taken", value: liabilities.loans_taken_outstanding },
    { name: "Partner Payables", value: liabilities.partner_payables },
  ].filter((d) => d.value > 0);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={() => navigate("/dashboard")}
              className="text-gray-600 hover:text-gray-900 mb-2 text-sm"
            >
              ← Back to Dashboard
            </button>
            <h1 className="text-3xl font-bold text-gray-900">
              Financial Analytics
            </h1>
            <p className="text-gray-600 mt-1">
              Consolidated view of investments, liabilities &amp; cash flow
            </p>
          </div>
          <div className="text-sm text-gray-500">As of {data.as_of_date}</div>
        </div>

        {/* Net Worth Banner */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-6 text-white">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div>
              <p className="text-indigo-200 text-sm">Net Worth</p>
              <p className="text-3xl font-bold mt-1">
                {formatCurrency(net_worth)}
              </p>
            </div>
            <div>
              <p className="text-indigo-200 text-sm">Total Cash</p>
              <p className="text-2xl font-bold mt-1">
                {formatCurrency(total_cash)}
              </p>
            </div>
            <div>
              <p className="text-indigo-200 text-sm">Investments</p>
              <p className="text-2xl font-bold mt-1">
                {formatCurrency(investments.total)}
              </p>
            </div>
            <div>
              <p className="text-indigo-200 text-sm">Liabilities</p>
              <p className="text-2xl font-bold mt-1">
                {formatCurrency(liabilities.total)}
              </p>
            </div>
          </div>
        </div>

        {/* ── FORECAST SECTION ───────────────────────────── */}
        <ForecastSection
          forecast={forecast}
          forecastLoading={forecastLoading}
          forecastPeriod={forecastPeriod}
          setForecastPeriod={setForecastPeriod}
          expandedSection={expandedSection}
          setExpandedSection={setExpandedSection}
          navigate={navigate}
        />

        {/* Counts */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <CountCard
            label="Active Loans Given"
            value={counts.active_loans_given}
            color="green"
          />
          <CountCard
            label="Active Loans Taken"
            value={counts.active_loans_taken}
            color="red"
          />
          <CountCard
            label="Active Properties"
            value={counts.active_properties}
            color="purple"
          />
          <CountCard
            label="Active Partnerships"
            value={counts.active_partnerships}
            color="orange"
          />
          <CountCard
            label="Active Beesi"
            value={counts.active_beesis}
            color="blue"
          />
        </div>

        {/* Investments & Liabilities detail */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Investments */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Investments Breakdown
            </h3>
            <div className="space-y-3 mb-6">
              <DetailRow
                label="Loans Given (Outstanding)"
                value={investments.loans_given_outstanding}
              />
              <DetailRow
                label="Interest Pending (Receivable)"
                value={investments.loans_given_interest_pending}
                sub
              />
              <DetailRow
                label="Property Advances"
                value={investments.property_advances}
              />
              <DetailRow
                label="Property Site Investments"
                value={investments.property_site_investments}
              />
              <DetailRow
                label="Partnership Invested"
                value={investments.partnership_invested}
              />
              <DetailRow
                label="Beesi Invested"
                value={investments.beesi_invested}
              />
              <div className="border-t pt-3">
                <DetailRow
                  label="Total Investments"
                  value={investments.total}
                  bold
                />
              </div>
            </div>
            {investmentPie.length > 0 && (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={investmentPie}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                  >
                    {investmentPie.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Liabilities */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Liabilities Breakdown
            </h3>
            <div className="space-y-3 mb-6">
              <DetailRow
                label="Loans Taken (Outstanding)"
                value={liabilities.loans_taken_outstanding}
              />
              <DetailRow
                label="Interest Pending (Payable)"
                value={liabilities.loans_taken_interest_pending}
                sub
              />
              <DetailRow
                label="Partner Payables"
                value={liabilities.partner_payables}
              />
              <div className="border-t pt-3">
                <DetailRow
                  label="Total Liabilities"
                  value={liabilities.total}
                  bold
                />
              </div>
            </div>
            {liabilityPie.length > 0 && (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={liabilityPie}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                  >
                    {liabilityPie.map((_, i) => (
                      <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* P&L */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Profit &amp; Loss
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <PnlCard label="Property Profit" value={pnl.property_profit} />
            <PnlCard label="Partnership P&L" value={pnl.partnership_pnl} />
            <PnlCard label="Beesi P&L" value={pnl.beesi_pnl} />
            <PnlCard
              label="Total Expenses"
              value={-pnl.total_expenses}
              negative
            />
            <PnlCard
              label="Expenses This Month"
              value={-pnl.expenses_this_month}
              negative
            />
          </div>
        </div>

        {/* Monthly Cash Flow */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Monthly Cash Flow (Last 12 Months)
          </h3>
          {monthly_cashflow.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthly_cashflow}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Legend />
                <Bar dataKey="inflow" name="Inflow" fill="#10b981" />
                <Bar dataKey="outflow" name="Outflow" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-500 text-sm">
              No cash flow data available yet. Link accounts to transactions to
              start tracking.
            </p>
          )}
        </div>

        {/* Accounts & Top Contacts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Account Balances */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Account Balances
            </h3>
            {accounts.length > 0 ? (
              <div className="space-y-3">
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => navigate(`/accounts/${a.id}`)}
                    className="w-full flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 text-left"
                  >
                    <div>
                      <span className="text-sm font-medium text-gray-900">
                        {a.name}
                      </span>
                      <span className="text-xs text-gray-500 ml-2 capitalize">
                        {a.account_type}
                      </span>
                    </div>
                    <span
                      className={`text-sm font-semibold ${a.balance >= 0 ? "text-green-700" : "text-red-700"}`}
                    >
                      {formatCurrency(a.balance)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">
                No accounts created yet.{" "}
                <button
                  onClick={() => navigate("/accounts/new")}
                  className="text-blue-600 hover:underline"
                >
                  Create one
                </button>
              </p>
            )}
          </div>

          {/* Top Contacts */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Top Contacts by Outstanding
            </h3>
            {top_contacts.length > 0 ? (
              <div className="space-y-3">
                {top_contacts.map((c, idx) => (
                  <button
                    key={c.id}
                    onClick={() => navigate(`/contacts/${c.id}`)}
                    className="w-full flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-gray-400 w-5">
                        #{idx + 1}
                      </span>
                      <span className="text-sm font-medium text-gray-900">
                        {c.name}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-blue-700">
                      {formatCurrency(c.outstanding)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No outstanding loans.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CountCard({ label, value, color }) {
  const bg = {
    green: "bg-green-50 text-green-800",
    red: "bg-red-50 text-red-800",
    purple: "bg-purple-50 text-purple-800",
    orange: "bg-orange-50 text-orange-800",
    blue: "bg-blue-50 text-blue-800",
  };
  return (
    <div className={`rounded-lg p-4 ${bg[color] || bg.blue}`}>
      <p className="text-xs opacity-80">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function DetailRow({ label, value, bold, sub }) {
  return (
    <div className={`flex justify-between ${sub ? "pl-4" : ""}`}>
      <span
        className={`text-sm ${bold ? "font-semibold text-gray-900" : sub ? "text-gray-500" : "text-gray-700"}`}
      >
        {label}
      </span>
      <span
        className={`text-sm ${bold ? "font-bold text-gray-900" : "font-medium text-gray-800"}`}
      >
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function PnlCard({ label, value, negative }) {
  const isNeg = value < 0;
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <p className="text-xs text-gray-600">{label}</p>
      <p
        className={`text-xl font-bold mt-1 ${negative || isNeg ? "text-red-700" : "text-green-700"}`}
      >
        {formatCurrency(Math.abs(value))}
        {isNeg && !negative ? " (Loss)" : ""}
      </p>
    </div>
  );
}

/* ── FORECAST ────────────────────────────────────────────────── */

const PERIOD_LABELS = {
  "15_days": "15 Days",
  "30_days": "30 Days",
  "90_days": "90 Days",
  "1_year": "1 Year",
};

const SOURCE_LABELS = {
  emi_receipt: "EMI Receipt",
  interest_receipt: "Interest Income",
  principal_return: "Principal Return",
  property: "Property Deal",
  beesi: "Beesi / BC",
  obligation_receivable: "Receivable",
  emi_payment: "EMI Payment",
  interest_payment: "Interest Due",
  principal_payment: "Principal Due",
  beesi_installment: "Beesi Installment",
  obligation_payable: "Payable",
};

const SOURCE_COLORS = {
  emi_receipt: "text-green-700 bg-green-50",
  interest_receipt: "text-emerald-700 bg-emerald-50",
  principal_return: "text-teal-700 bg-teal-50",
  property: "text-purple-700 bg-purple-50",
  beesi: "text-blue-700 bg-blue-50",
  obligation_receivable: "text-indigo-700 bg-indigo-50",
  emi_payment: "text-red-700 bg-red-50",
  interest_payment: "text-orange-700 bg-orange-50",
  principal_payment: "text-rose-700 bg-rose-50",
  beesi_installment: "text-amber-700 bg-amber-50",
  obligation_payable: "text-pink-700 bg-pink-50",
};

function ForecastSection({
  forecast,
  forecastLoading,
  forecastPeriod,
  setForecastPeriod,
  expandedSection,
  setExpandedSection,
  navigate,
}) {
  if (forecastLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse h-48 bg-gray-100 rounded" />
      </div>
    );
  }
  if (!forecast?.periods) return null;

  const pd = forecast.periods[forecastPeriod];
  if (!pd) return null;

  const toggleSection = (key) =>
    setExpandedSection((prev) => (prev === key ? null : key));

  // Group items by contact
  const groupByContact = (items) => {
    const groups = {};
    for (const it of items) {
      const key = it.contact || "Unknown";
      if (!groups[key]) groups[key] = { contact: key, items: [], total: 0 };
      groups[key].items.push(it);
      groups[key].total += it.amount;
    }
    return Object.values(groups).sort((a, b) => b.total - a.total);
  };

  const inflowContacts = groupByContact(pd.inflow.items);
  const outflowContacts = groupByContact(pd.outflow.items);

  const inflowCategories = [
    { key: "emi_receipts", label: "EMI Receipts", amount: pd.inflow.emi_receipts, color: "bg-green-500" },
    { key: "interest_receipts", label: "Interest Income", amount: pd.inflow.interest_receipts, color: "bg-emerald-500" },
    { key: "principal_returns", label: "Principal Returns", amount: pd.inflow.principal_returns, color: "bg-teal-500" },
    { key: "property", label: "Property Deals", amount: pd.inflow.property, color: "bg-purple-500" },
    { key: "beesi", label: "Beesi / BC", amount: pd.inflow.beesi, color: "bg-blue-500" },
    { key: "receivables", label: "Receivables", amount: pd.inflow.receivables, color: "bg-indigo-500" },
  ].filter((c) => c.amount > 0);

  const outflowCategories = [
    { key: "emi_payments", label: "EMI Payments", amount: pd.outflow.emi_payments, color: "bg-red-500" },
    { key: "interest_payments", label: "Interest Due", amount: pd.outflow.interest_payments, color: "bg-orange-500" },
    { key: "principal_payments", label: "Principal Due", amount: pd.outflow.principal_payments, color: "bg-rose-500" },
    { key: "beesi_installments", label: "Beesi Installments", amount: pd.outflow.beesi_installments, color: "bg-amber-500" },
    { key: "payables", label: "Payables", amount: pd.outflow.payables, color: "bg-pink-500" },
  ].filter((c) => c.amount > 0);

  return (
    <div className="space-y-4">
      {/* Period Tabs + Summary */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">
            Cash Flow Forecast
          </h2>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {Object.entries(PERIOD_LABELS).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setForecastPeriod(key)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                  forecastPeriod === key
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Big summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-5">
            <p className="text-sm text-green-700 font-medium">Expected Inflow</p>
            <p className="text-2xl font-bold text-green-800 mt-1">
              {formatCurrency(pd.inflow.total)}
            </p>
            <p className="text-xs text-green-600 mt-1">
              Money coming back to you
            </p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-5">
            <p className="text-sm text-red-700 font-medium">Expected Outflow</p>
            <p className="text-2xl font-bold text-red-800 mt-1">
              {formatCurrency(pd.outflow.total)}
            </p>
            <p className="text-xs text-red-600 mt-1">
              Money you need to pay
            </p>
          </div>
          <div
            className={`border rounded-xl p-5 ${
              pd.net >= 0
                ? "bg-emerald-50 border-emerald-200"
                : "bg-orange-50 border-orange-200"
            }`}
          >
            <p
              className={`text-sm font-medium ${pd.net >= 0 ? "text-emerald-700" : "text-orange-700"}`}
            >
              Net Position
            </p>
            <p
              className={`text-2xl font-bold mt-1 ${
                pd.net >= 0 ? "text-emerald-800" : "text-orange-800"
              }`}
            >
              {pd.net >= 0 ? "+" : ""}
              {formatCurrency(pd.net)}
            </p>
            <p
              className={`text-xs mt-1 ${pd.net >= 0 ? "text-emerald-600" : "text-orange-600"}`}
            >
              within {PERIOD_LABELS[forecastPeriod]}
            </p>
          </div>
        </div>
      </div>

      {/* Inflows & Outflows Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* INFLOWS */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-green-800 mb-4 flex items-center gap-2">
            <span className="w-3 h-3 bg-green-500 rounded-full" />
            Inflows — Money Coming In
          </h3>

          {/* Category bars */}
          <div className="space-y-2 mb-4">
            {inflowCategories.map((cat) => (
              <div key={cat.key} className="flex items-center gap-3">
                <div className="w-28 text-xs text-gray-600 shrink-0 truncate">
                  {cat.label}
                </div>
                <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
                  <div
                    className={`${cat.color} h-full rounded-full`}
                    style={{
                      width: `${Math.min((cat.amount / pd.inflow.total) * 100, 100)}%`,
                    }}
                  />
                </div>
                <div className="w-24 text-right text-xs font-semibold text-gray-800">
                  {formatCurrency(cat.amount)}
                </div>
              </div>
            ))}
          </div>

          {/* Contact-wise drill-down */}
          <div className="border-t pt-3">
            <button
              onClick={() => toggleSection("inflow")}
              className="flex items-center gap-2 text-sm font-medium text-green-700 hover:text-green-900 mb-2"
            >
              <span className={`transition-transform ${expandedSection === "inflow" ? "rotate-90" : ""}`}>
                ▶
              </span>
              From whom? ({inflowContacts.length} contacts/sources)
            </button>
            {expandedSection === "inflow" && (
              <div className="space-y-2 mt-2 max-h-96 overflow-y-auto">
                {inflowContacts.map((group) => (
                  <div
                    key={group.contact}
                    className="border rounded-lg p-3 bg-gray-50"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-gray-900">
                        {group.contact}
                      </span>
                      <span className="text-sm font-bold text-green-700">
                        {formatCurrency(group.total)}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {group.items.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                SOURCE_COLORS[item.source] || "text-gray-700 bg-gray-100"
                              }`}
                            >
                              {SOURCE_LABELS[item.source] || item.source}
                            </span>
                            <span className="text-gray-600">{item.label}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {item.due_date && (
                              <span className="text-gray-400">
                                {item.due_date}
                              </span>
                            )}
                            <span className="font-semibold text-gray-800">
                              {formatCurrency(item.amount)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {group.items[0]?.loan_id && (
                      <button
                        onClick={() => navigate(`/loans/${group.items[0].loan_id}`)}
                        className="text-[10px] text-blue-600 hover:underline mt-1"
                      >
                        View loan →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* OUTFLOWS */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-red-800 mb-4 flex items-center gap-2">
            <span className="w-3 h-3 bg-red-500 rounded-full" />
            Outflows — Money Going Out
          </h3>

          {/* Category bars */}
          <div className="space-y-2 mb-4">
            {outflowCategories.map((cat) => (
              <div key={cat.key} className="flex items-center gap-3">
                <div className="w-28 text-xs text-gray-600 shrink-0 truncate">
                  {cat.label}
                </div>
                <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
                  <div
                    className={`${cat.color} h-full rounded-full`}
                    style={{
                      width: `${Math.min((cat.amount / pd.outflow.total) * 100, 100)}%`,
                    }}
                  />
                </div>
                <div className="w-24 text-right text-xs font-semibold text-gray-800">
                  {formatCurrency(cat.amount)}
                </div>
              </div>
            ))}
            {outflowCategories.length === 0 && (
              <p className="text-sm text-gray-500">No outflows expected in this period.</p>
            )}
          </div>

          {/* Contact-wise drill-down */}
          <div className="border-t pt-3">
            <button
              onClick={() => toggleSection("outflow")}
              className="flex items-center gap-2 text-sm font-medium text-red-700 hover:text-red-900 mb-2"
            >
              <span className={`transition-transform ${expandedSection === "outflow" ? "rotate-90" : ""}`}>
                ▶
              </span>
              To whom? ({outflowContacts.length} contacts/sources)
            </button>
            {expandedSection === "outflow" && (
              <div className="space-y-2 mt-2 max-h-96 overflow-y-auto">
                {outflowContacts.map((group) => (
                  <div
                    key={group.contact}
                    className="border rounded-lg p-3 bg-gray-50"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-gray-900">
                        {group.contact}
                      </span>
                      <span className="text-sm font-bold text-red-700">
                        {formatCurrency(group.total)}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {group.items.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                SOURCE_COLORS[item.source] || "text-gray-700 bg-gray-100"
                              }`}
                            >
                              {SOURCE_LABELS[item.source] || item.source}
                            </span>
                            <span className="text-gray-600">{item.label}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {item.due_date && (
                              <span className="text-gray-400">
                                {item.due_date}
                              </span>
                            )}
                            <span className="font-semibold text-gray-800">
                              {formatCurrency(item.amount)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {group.items[0]?.loan_id && (
                      <button
                        onClick={() => navigate(`/loans/${group.items[0].loan_id}`)}
                        className="text-[10px] text-blue-600 hover:underline mt-1"
                      >
                        View loan →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
