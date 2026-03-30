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

const PERIOD_PRESETS = [
  { key: "30_days", label: "Last 30 Days" },
  { key: "90_days", label: "Last 90 Days" },
  { key: "1_year", label: "Last 1 Year" },
  { key: "custom", label: "Custom" },
];

export default function Analytics() {
  const navigate = useNavigate();
  const [activityPeriod, setActivityPeriod] = useState("30_days");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [expandedSection, setExpandedSection] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["analytics-overview"],
    queryFn: async () => (await api.get("/api/analytics/overview")).data,
  });

  const { data: forecast, isLoading: forecastLoading } = useQuery({
    queryKey: ["analytics-forecast"],
    queryFn: async () => (await api.get("/api/analytics/forecast")).data,
  });

  const activityParams =
    activityPeriod === "custom" && customFrom && customTo
      ? `?period=custom&from_date=${customFrom}&to_date=${customTo}`
      : `?period=${activityPeriod}`;

  const { data: activity, isLoading: activityLoading } = useQuery({
    queryKey: ["analytics-activity", activityPeriod, customFrom, customTo],
    queryFn: async () =>
      (await api.get(`/api/analytics/activity${activityParams}`)).data,
    enabled: activityPeriod !== "custom" || (!!customFrom && !!customTo),
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
    { name: "Plot Advances (My Share)", value: investments.property_advances },
    { name: "Site Investments", value: investments.property_site_investments },
    { name: "My Partnership", value: investments.partnership_invested },
    { name: "Beesi", value: investments.beesi_invested },
  ].filter((d) => d.value > 0);

  const liabilityPie = [
    { name: "Loans Taken", value: liabilities.loans_taken_outstanding },
    { name: "Partner Payables", value: liabilities.partner_payables },
  ].filter((d) => d.value > 0);

  const toggle = (key) => setExpandedSection((p) => (p === key ? null : key));

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
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
              Past activity, future projections &amp; portfolio overview
            </p>
          </div>
          <div className="text-sm text-gray-500">As of {data.as_of_date}</div>
        </div>

        {/* Net Worth Banner */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-6 text-white">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
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

        {/* ── FORECAST SUMMARY (link to full page) ──────── */}
        <ForecastSummary
          forecast={forecast}
          forecastLoading={forecastLoading}
          navigate={navigate}
        />

        {/* ══════════════════════════════════════════════════
            HISTORICAL ACTIVITY — What actually happened
           ══════════════════════════════════════════════════ */}
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-5 border-b">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  Money Movement
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  What actually happened — collections, disbursements,
                  investments
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {PERIOD_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setActivityPeriod(p.key)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                      activityPeriod === p.key
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {activityPeriod === "custom" && (
              <div className="flex items-center gap-3 mt-3">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="border rounded px-2 py-1 text-sm"
                />
                <span className="text-gray-400 text-sm">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="border rounded px-2 py-1 text-sm"
                />
              </div>
            )}
          </div>

          {activityLoading ? (
            <div className="p-6">
              <div className="animate-pulse space-y-3">
                <div className="h-6 bg-gray-100 rounded w-1/3" />
                <div className="h-20 bg-gray-100 rounded" />
              </div>
            </div>
          ) : activity ? (
            <div className="p-5 space-y-5">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <ActivityCard
                  label="EMIs Collected"
                  value={activity.summary.emis_collected}
                  color="green"
                  icon="📥"
                />
                <ActivityCard
                  label="Interest Collected"
                  value={activity.summary.interest_collected}
                  color="emerald"
                  icon="💰"
                />
                <ActivityCard
                  label="Money Lent Out"
                  value={activity.summary.loans_given}
                  color="blue"
                  icon="📤"
                />
                <ActivityCard
                  label="Money Borrowed"
                  value={activity.summary.loans_taken}
                  color="orange"
                  icon="🏦"
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <ActivityCard
                  label="Payments Made (Outflow)"
                  value={activity.summary.payments_made}
                  color="red"
                  icon="💸"
                />
                <ActivityCard
                  label="Total Collected"
                  value={activity.summary.total_collected}
                  color="teal"
                  icon="✅"
                />
                <ActivityCard
                  label="Property Invested"
                  value={activity.summary.property_invested}
                  color="purple"
                  icon="🏠"
                />
                <ActivityCard
                  label="Beesi Paid"
                  value={activity.summary.beesi_paid}
                  color="amber"
                  icon="🔄"
                />
              </div>

              {/* ── Expandable sections ─────────────────────── */}

              {/* EMIs Collected */}
              <ActivitySection
                title="EMIs Collected"
                subtitle="From whom you received EMI payments"
                section={activity.sections.emis_collected}
                sectionKey="emis"
                expanded={expandedSection === "emis"}
                toggle={() => toggle("emis")}
                navigate={navigate}
                color="green"
              />

              {/* Interest Collected */}
              <ActivitySection
                title="Interest Collected"
                subtitle="Monthly interest payments received"
                section={activity.sections.interest_collected}
                sectionKey="interest"
                expanded={expandedSection === "interest"}
                toggle={() => toggle("interest")}
                navigate={navigate}
                color="emerald"
              />

              {/* Loans Given */}
              <ActivitySection
                title="New Loans Given"
                subtitle="Money you lent out during this period"
                section={activity.sections.loans_given}
                sectionKey="given"
                expanded={expandedSection === "given"}
                toggle={() => toggle("given")}
                navigate={navigate}
                color="blue"
              />

              {/* Loans Taken */}
              <ActivitySection
                title="Money Borrowed"
                subtitle="Loans you took during this period"
                section={activity.sections.loans_taken}
                sectionKey="taken"
                expanded={expandedSection === "taken"}
                toggle={() => toggle("taken")}
                navigate={navigate}
                color="orange"
              />

              {/* Payments Made on loans taken */}
              <ActivitySection
                title="Payments Made (Loans Taken)"
                subtitle="EMIs / interest you paid to lenders"
                section={activity.sections.payments_made}
                sectionKey="paid"
                expanded={expandedSection === "paid"}
                toggle={() => toggle("paid")}
                navigate={navigate}
                color="red"
              />

              {/* Property Investments */}
              {activity.sections.property?.total > 0 && (
                <div className="border rounded-lg">
                  <button
                    onClick={() => toggle("property")}
                    className="w-full flex items-center justify-between p-3 hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-purple-500" />
                      <span className="text-sm font-semibold text-gray-800">
                        Property Investments
                      </span>
                      <span className="text-xs text-gray-500">
                        {activity.sections.property.count} transaction
                        {activity.sections.property.count !== 1 ? "s" : ""}
                      </span>
                      <span className="text-[10px] text-gray-400 hidden md:inline">
                        — Advances &amp; investments in plots/sites
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-purple-700">
                        {formatCurrency(activity.sections.property.total)}
                      </span>
                      <span className={`text-gray-400 text-xs transition-transform ${expandedSection === "property" ? "rotate-90" : ""}`}>
                        ▶
                      </span>
                    </div>
                  </button>
                  {expandedSection === "property" && (
                    <div className="border-t divide-y">
                      {activity.sections.property.items.map((it, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between px-4 py-2 text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-gray-400 font-mono w-20">
                              {it.date}
                            </span>
                            <span className="text-sm font-medium text-gray-800">
                              {it.property}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-600 text-[10px] uppercase">
                              {it.txn_type?.replace(/_/g, " ")}
                            </span>
                          </div>
                          <span className="font-semibold text-gray-800">
                            {formatCurrency(it.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Beesi */}
              {activity.sections.beesi?.total > 0 && (
                <div className="border rounded-lg">
                  <button
                    onClick={() => toggle("beesi")}
                    className="w-full flex items-center justify-between p-3 hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span className="text-sm font-semibold text-gray-800">
                        Beesi Installments Paid
                      </span>
                      <span className="text-xs text-gray-500">
                        {activity.sections.beesi.items.length} payment
                        {activity.sections.beesi.items.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <span className="text-sm font-bold text-amber-700">
                      {formatCurrency(activity.sections.beesi.total)}
                    </span>
                  </button>
                  {expandedSection === "beesi" && (
                    <div className="border-t divide-y">
                      {activity.sections.beesi.items.map((it, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between px-4 py-2 text-xs"
                        >
                          <span className="text-gray-700">
                            {it.beesi} — Month #{it.month_number}
                          </span>
                          <div className="flex items-center gap-3">
                            <span className="text-gray-400 font-mono">
                              {it.date}
                            </span>
                            <span className="font-semibold text-gray-800">
                              {formatCurrency(it.amount)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* ── Portfolio Overview (existing sections) ────── */}
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
                label="Plot Advances (My Share)"
                value={investments.property_advances}
              />
              <DetailRow
                label="Site Investments"
                value={investments.property_site_investments}
              />
              {investments.partnership_invested > 0 && (
                <DetailRow
                  label="My Partnership Investment"
                  value={investments.partnership_invested}
                />
              )}
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
              No cash flow data available yet.
            </p>
          )}
        </div>

        {/* Accounts & Top Contacts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                No accounts.{" "}
                <button
                  onClick={() => navigate("/accounts/new")}
                  className="text-blue-600 hover:underline"
                >
                  Create one
                </button>
              </p>
            )}
          </div>

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

/* ── Sub-components ──────────────────────────────────────────── */

function ActivityCard({ label, value, color, icon }) {
  const styles = {
    green: "bg-green-50 border-green-200",
    emerald: "bg-emerald-50 border-emerald-200",
    blue: "bg-blue-50 border-blue-200",
    orange: "bg-orange-50 border-orange-200",
    red: "bg-red-50 border-red-200",
    teal: "bg-teal-50 border-teal-200",
    purple: "bg-purple-50 border-purple-200",
    amber: "bg-amber-50 border-amber-200",
  };
  const textStyles = {
    green: "text-green-800",
    emerald: "text-emerald-800",
    blue: "text-blue-800",
    orange: "text-orange-800",
    red: "text-red-800",
    teal: "text-teal-800",
    purple: "text-purple-800",
    amber: "text-amber-800",
  };
  return (
    <div className={`rounded-lg border p-3 ${styles[color] || styles.green}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{icon}</span>
        <p className="text-[11px] text-gray-600 font-medium">{label}</p>
      </div>
      <p
        className={`text-lg font-bold mt-1 ${textStyles[color] || "text-gray-800"}`}
      >
        {formatCurrency(value)}
      </p>
    </div>
  );
}

function ActivitySection({
  title,
  subtitle,
  section,
  sectionKey,
  expanded,
  toggle,
  navigate,
  color,
}) {
  if (!section || section.total === 0) return null;
  const dotColors = {
    green: "bg-green-500",
    emerald: "bg-emerald-500",
    blue: "bg-blue-500",
    orange: "bg-orange-500",
    red: "bg-red-500",
  };
  const textColors = {
    green: "text-green-700",
    emerald: "text-emerald-700",
    blue: "text-blue-700",
    orange: "text-orange-700",
    red: "text-red-700",
  };

  return (
    <div className="border rounded-lg">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between p-3 hover:bg-gray-50"
      >
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${dotColors[color] || "bg-gray-500"}`}
          />
          <span className="text-sm font-semibold text-gray-800">{title}</span>
          <span className="text-xs text-gray-500">
            {section.count} transaction{section.count !== 1 ? "s" : ""}
          </span>
          <span className="text-[10px] text-gray-400 hidden md:inline">
            — {subtitle}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-bold ${textColors[color] || "text-gray-700"}`}
          >
            {formatCurrency(section.total)}
          </span>
          <span
            className={`text-gray-400 text-xs transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            ▶
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t">
          {section.by_contact.map((group) => (
            <div key={group.contact} className="border-b last:border-b-0">
              <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50">
                <div className="flex items-center gap-2">
                  {group.contact_id ? (
                    <button
                      onClick={() => navigate(`/contacts/${group.contact_id}`)}
                      className="text-sm font-semibold text-blue-700 hover:underline"
                    >
                      {group.contact}
                    </button>
                  ) : (
                    <span className="text-sm font-semibold text-gray-800">
                      {group.contact}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400">
                    {group.count} payment{group.count !== 1 ? "s" : ""}
                  </span>
                </div>
                <span
                  className={`text-sm font-bold ${textColors[color] || "text-gray-700"}`}
                >
                  {formatCurrency(group.total)}
                </span>
              </div>
              <div className="divide-y">
                {group.items.map((it, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-6 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400 font-mono w-20">
                        {it.date}
                      </span>
                      {it.loan_type && (
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] uppercase">
                          {it.loan_type}
                        </span>
                      )}
                      {it.interest_rate > 0 && (
                        <span className="text-gray-400">
                          @ {it.interest_rate}% p.a.
                        </span>
                      )}
                      {it.payment_mode && (
                        <span className="text-gray-400 capitalize">
                          via {it.payment_mode}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {it.interest_portion > 0 && (
                        <span className="text-emerald-600">
                          int: {formatCurrency(it.interest_portion)}
                        </span>
                      )}
                      {it.principal_portion > 0 && (
                        <span className="text-teal-600">
                          prn: {formatCurrency(it.principal_portion)}
                        </span>
                      )}
                      <span className="font-semibold text-gray-800 w-24 text-right">
                        {formatCurrency(it.amount)}
                      </span>
                      {it.loan_id && (
                        <button
                          onClick={() => navigate(`/loans/${it.loan_id}`)}
                          className="text-blue-500 hover:underline"
                        >
                          →
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ForecastSummary({ forecast, forecastLoading, navigate }) {
  if (forecastLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse h-32 bg-gray-100 rounded" />
      </div>
    );
  }
  if (!forecast?.periods) return null;
  const pd = forecast.periods["30_days"];
  if (!pd) return null;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">30-Day Forecast</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Confidence based on actual payment behavior
          </p>
        </div>
        <button
          onClick={() => navigate("/forecast")}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition"
        >
          View Full Forecast →
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-[11px] text-green-600 font-medium">
            Reliable Inflow
          </p>
          <p className="text-xl font-bold text-green-800 mt-1">
            {formatCurrency(pd.inflow.high)}
          </p>
          <p className="text-[10px] text-green-500 mt-0.5">
            Paid within 30 days
          </p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-[11px] text-red-600 font-medium">
            Committed Outflow
          </p>
          <p className="text-xl font-bold text-red-800 mt-1">
            {formatCurrency(pd.outflow.high + pd.outflow.medium)}
          </p>
          <p className="text-[10px] text-red-500 mt-0.5">EMIs + Beesi</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-[11px] text-amber-600 font-medium">
            Possible Inflow
          </p>
          <p className="text-xl font-bold text-amber-800 mt-1">
            {formatCurrency(pd.inflow.medium + pd.inflow.low)}
          </p>
          <p className="text-[10px] text-amber-500 mt-0.5">
            Irregular / overdue payers
          </p>
        </div>
        <div
          className={`border rounded-lg p-3 ${pd.net >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-orange-50 border-orange-200"}`}
        >
          <p
            className={`text-[11px] font-medium ${pd.net >= 0 ? "text-emerald-600" : "text-orange-600"}`}
          >
            Net Position
          </p>
          <p
            className={`text-xl font-bold mt-1 ${pd.net >= 0 ? "text-emerald-800" : "text-orange-800"}`}
          >
            {pd.net >= 0 ? "+" : ""}
            {formatCurrency(pd.net)}
          </p>
          <p
            className={`text-[10px] mt-0.5 ${pd.net >= 0 ? "text-emerald-500" : "text-orange-500"}`}
          >
            All confidence levels
          </p>
        </div>
      </div>

      {(pd.inflow.emi_receipts > 0 || pd.inflow.interest_receipts > 0) && (
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-600">
          {pd.inflow.emi_receipts > 0 && (
            <span>
              EMI Receipts:{" "}
              <strong className="text-green-700">
                {formatCurrency(pd.inflow.emi_receipts)}
              </strong>
            </span>
          )}
          {pd.inflow.interest_receipts > 0 && (
            <span>
              Interest:{" "}
              <strong className="text-green-700">
                {formatCurrency(pd.inflow.interest_receipts)}
              </strong>
            </span>
          )}
          {pd.inflow.principal_returns > 0 && (
            <span>
              Principal:{" "}
              <strong className="text-teal-700">
                {formatCurrency(pd.inflow.principal_returns)}
              </strong>
            </span>
          )}
        </div>
      )}
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
