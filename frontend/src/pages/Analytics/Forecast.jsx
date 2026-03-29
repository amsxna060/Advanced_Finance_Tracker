import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

const PERIOD_OPTIONS = [
  { key: "15_days", label: "15 Days" },
  { key: "30_days", label: "30 Days" },
  { key: "90_days", label: "90 Days" },
  { key: "1_year", label: "1 Year" },
];

const CONF_BADGE = {
  high: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-gray-100 text-gray-600",
};

const SOURCE_LABELS = {
  emi_receipt: "EMI",
  interest_receipt: "Interest",
  principal_return: "Principal",
  property: "Property",
  beesi: "Beesi",
  obligation_receivable: "Receivable",
  emi_payment: "EMI",
  interest_payment: "Interest",
  principal_payment: "Principal",
  beesi_installment: "Beesi",
  obligation_payable: "Payable",
};

const SOURCE_COLORS = {
  emi_receipt: "bg-green-500",
  interest_receipt: "bg-emerald-500",
  principal_return: "bg-teal-500",
  property: "bg-purple-500",
  beesi: "bg-blue-500",
  obligation_receivable: "bg-indigo-500",
  emi_payment: "bg-red-500",
  interest_payment: "bg-orange-500",
  principal_payment: "bg-rose-500",
  beesi_installment: "bg-amber-500",
  obligation_payable: "bg-pink-500",
};

const SOURCE_TAG = {
  emi_receipt: "text-green-700 bg-green-50 border-green-200",
  interest_receipt: "text-emerald-700 bg-emerald-50 border-emerald-200",
  principal_return: "text-teal-700 bg-teal-50 border-teal-200",
  property: "text-purple-700 bg-purple-50 border-purple-200",
  beesi: "text-blue-700 bg-blue-50 border-blue-200",
  obligation_receivable: "text-indigo-700 bg-indigo-50 border-indigo-200",
  emi_payment: "text-red-700 bg-red-50 border-red-200",
  interest_payment: "text-orange-700 bg-orange-50 border-orange-200",
  principal_payment: "text-rose-700 bg-rose-50 border-rose-200",
  beesi_installment: "text-amber-700 bg-amber-50 border-amber-200",
  obligation_payable: "text-pink-700 bg-pink-50 border-pink-200",
};

export default function Forecast() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState("30_days");
  const [direction, setDirection] = useState("inflow"); // inflow | outflow
  const [confFilter, setConfFilter] = useState("all"); // all | high | medium | low
  const [typeFilter, setTypeFilter] = useState("all"); // all | emi_receipt | interest_receipt | ...

  const { data: forecast, isLoading } = useQuery({
    queryKey: ["analytics-forecast"],
    queryFn: async () => (await api.get("/api/analytics/forecast")).data,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!forecast?.periods) return null;
  const pd = forecast.periods[period];
  if (!pd) return null;

  const flow = pd[direction];
  const otherFlow = pd[direction === "inflow" ? "outflow" : "inflow"];

  // Get unique source types in current direction for filter dropdown
  const allSourceTypes = [...new Set(flow.items.map((i) => i.source))];

  // Apply filters
  let filtered = flow.items;
  if (confFilter !== "all") {
    filtered = filtered.filter((i) => i.confidence === confFilter);
  }
  if (typeFilter !== "all") {
    filtered = filtered.filter((i) => i.source === typeFilter);
  }

  // Group by contact
  const groups = {};
  for (const it of filtered) {
    const key = it.contact || "Unknown";
    if (!groups[key])
      groups[key] = {
        contact: key,
        contactId: it.contact_id,
        items: [],
        total: 0,
      };
    groups[key].items.push(it);
    groups[key].total += it.amount;
  }
  const contactGroups = Object.values(groups).sort((a, b) => b.total - a.total);
  const filteredTotal = filtered.reduce((s, i) => s + i.amount, 0);

  // Category breakdown for the bar chart
  const categories =
    direction === "inflow"
      ? [
          {
            key: "emi_receipts",
            label: "EMI Receipts",
            amount: flow.emi_receipts,
            color: "bg-green-500",
          },
          {
            key: "interest_receipts",
            label: "Interest",
            amount: flow.interest_receipts,
            color: "bg-emerald-500",
          },
          {
            key: "principal_returns",
            label: "Principal",
            amount: flow.principal_returns,
            color: "bg-teal-500",
          },
          {
            key: "property",
            label: "Property",
            amount: flow.property,
            color: "bg-purple-500",
          },
          {
            key: "beesi",
            label: "Beesi",
            amount: flow.beesi,
            color: "bg-blue-500",
          },
          {
            key: "receivables",
            label: "Receivables",
            amount: flow.receivables,
            color: "bg-indigo-500",
          },
        ].filter((c) => c.amount > 0)
      : [
          {
            key: "emi_payments",
            label: "EMI Payments",
            amount: flow.emi_payments,
            color: "bg-red-500",
          },
          {
            key: "interest_payments",
            label: "Interest",
            amount: flow.interest_payments,
            color: "bg-orange-500",
          },
          {
            key: "principal_payments",
            label: "Principal",
            amount: flow.principal_payments,
            color: "bg-rose-500",
          },
          {
            key: "beesi_installments",
            label: "Beesi",
            amount: flow.beesi_installments,
            color: "bg-amber-500",
          },
          {
            key: "payables",
            label: "Payables",
            amount: flow.payables,
            color: "bg-pink-500",
          },
        ].filter((c) => c.amount > 0);

  const isIn = direction === "inflow";

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={() => navigate("/analytics")}
              className="text-gray-600 hover:text-gray-900 mb-1 text-sm"
            >
              ← Back to Analytics
            </button>
            <h1 className="text-2xl font-bold text-gray-900">
              Cash Flow Forecast
            </h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Projected money movement — who owes you, what you owe
            </p>
          </div>
          <div className="text-xs text-gray-400">
            As of {forecast.as_of_date}
          </div>
        </div>

        {/* Period + Direction selector */}
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Period */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {PERIOD_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setPeriod(key)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                    period === key
                      ? "bg-white text-indigo-700 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Direction toggle */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => {
                  setDirection("inflow");
                  setTypeFilter("all");
                }}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                  direction === "inflow"
                    ? "bg-green-600 text-white shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Inflows
              </button>
              <button
                onClick={() => {
                  setDirection("outflow");
                  setTypeFilter("all");
                }}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                  direction === "outflow"
                    ? "bg-red-600 text-white shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Outflows
              </button>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            <SummaryCard
              label={isIn ? "Total Inflow" : "Total Outflow"}
              value={flow.total}
              color={isIn ? "green" : "red"}
            />
            <SummaryCard
              label="High Confidence"
              value={flow.high}
              color="emerald"
            />
            <SummaryCard
              label="Medium Confidence"
              value={flow.medium}
              color="yellow"
            />
            <SummaryCard label="Low Confidence" value={flow.low} color="gray" />
          </div>
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap gap-3">
          {/* Confidence filter */}
          <div className="flex gap-1 bg-white rounded-lg shadow p-1">
            {["all", "high", "medium", "low"].map((c) => (
              <button
                key={c}
                onClick={() => setConfFilter(c)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition capitalize ${
                  confFilter === c
                    ? "bg-indigo-600 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {c === "all" ? "All Confidence" : c}
              </button>
            ))}
          </div>

          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-white rounded-lg shadow px-3 py-1.5 text-xs font-medium text-gray-700 border-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Types</option>
            {allSourceTypes.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s] || s}
              </option>
            ))}
          </select>

          <div className="ml-auto text-sm text-gray-500">
            Showing {filtered.length} items · {formatCurrency(filteredTotal)}
          </div>
        </div>

        {/* Category breakdown */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Breakdown by Type
          </h3>
          <div className="space-y-2">
            {categories.map((cat) => (
              <div key={cat.key} className="flex items-center gap-3">
                <div className="w-24 text-xs text-gray-600 truncate">
                  {cat.label}
                </div>
                <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                  <div
                    className={`${cat.color} h-full rounded-full transition-all`}
                    style={{
                      width: `${Math.min((cat.amount / flow.total) * 100, 100)}%`,
                    }}
                  />
                </div>
                <div className="w-24 text-right text-xs font-semibold text-gray-800">
                  {formatCurrency(cat.amount)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Contact-wise list */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">
            {isIn ? "From whom" : "To whom"} — {contactGroups.length} contact
            {contactGroups.length !== 1 ? "s" : ""} / source
            {contactGroups.length !== 1 ? "s" : ""}
          </h3>

          {contactGroups.length === 0 && (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500 text-sm">
              No items match the current filters.
            </div>
          )}

          {contactGroups.map((group) => (
            <div key={group.contact} className="bg-white rounded-lg shadow">
              {/* Contact header */}
              <div className="flex items-center justify-between p-4 border-b">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">
                    {group.contact}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {group.items.length} item
                    {group.items.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <span
                  className={`text-sm font-bold ${isIn ? "text-green-700" : "text-red-700"}`}
                >
                  {formatCurrency(group.total)}
                </span>
              </div>

              {/* Items */}
              <div className="divide-y">
                {group.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-medium ${
                          SOURCE_TAG[item.source] ||
                          "text-gray-700 bg-gray-50 border-gray-200"
                        }`}
                      >
                        {SOURCE_LABELS[item.source] || item.source}
                      </span>
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          CONF_BADGE[item.confidence] || CONF_BADGE.low
                        }`}
                      >
                        {item.confidence}
                      </span>
                      <span className="text-xs text-gray-600 truncate">
                        {item.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-2">
                      {item.due_date && (
                        <span className="text-[11px] text-gray-400 font-mono">
                          {item.due_date}
                        </span>
                      )}
                      <span className="text-xs font-semibold text-gray-800 w-20 text-right">
                        {formatCurrency(item.amount)}
                      </span>
                      {item.loan_id && (
                        <button
                          onClick={() => navigate(`/loans/${item.loan_id}`)}
                          className="text-[10px] text-blue-600 hover:underline"
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
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  const styles = {
    green: "bg-green-50 border-green-200 text-green-800",
    red: "bg-red-50 border-red-200 text-red-800",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
    yellow: "bg-yellow-50 border-yellow-200 text-yellow-800",
    gray: "bg-gray-50 border-gray-200 text-gray-800",
  };
  return (
    <div className={`rounded-lg border p-3 ${styles[color] || styles.gray}`}>
      <p className="text-[11px] opacity-70">{label}</p>
      <p className="text-lg font-bold mt-0.5">{formatCurrency(value)}</p>
    </div>
  );
}
