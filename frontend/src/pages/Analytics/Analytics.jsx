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

  const { data, isLoading } = useQuery({
    queryKey: ["analytics-overview"],
    queryFn: async () => {
      const response = await api.get("/api/analytics/overview");
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
