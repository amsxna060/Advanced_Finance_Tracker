import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

const COLORS = {
  cash: "#3b82f6",
  loans_given: "#10b981",
  properties: "#8b5cf6",
  partnerships: "#f59e0b",
  receivables: "#ec4899",
  collateral: "#6366f1",
  loans_taken: "#ef4444",
  payables: "#f97316",
  partner_payables: "#e11d48",
};

const ASSET_LABELS = {
  cash: "Cash & Bank Accounts",
  loans_given: "Loans Given (Receivable)",
  properties: "Property Investments",
  partnerships: "Partnership Investments",
  receivables: "Other Receivables",
  collateral_held: "Collateral Held (Security)",
};

const LIABILITY_LABELS = {
  loans_taken: "Loans Taken (Payable)",
  payables: "Other Payables",
  partner_payables: "Partner Payables",
};

function HeroCard({ label, value, sub, color }) {
  return (
    <div className={`rounded-xl p-5 shadow-sm border ${color}`}>
      <p className="text-xs font-medium uppercase tracking-wider opacity-70">
        {label}
      </p>
      <p className="text-2xl font-bold mt-1">{formatCurrency(value)}</p>
      {sub && <p className="text-xs mt-1 opacity-60">{sub}</p>}
    </div>
  );
}

function SectionHeader({ title, total, count, color, expanded, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full ${color}`} />
        <span className="font-semibold text-sm text-gray-800">{title}</span>
        {count != null && (
          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
            {count}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-gray-700">
          {formatCurrency(total)}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </div>
    </button>
  );
}

export default function Assets() {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState({});

  const { data, isLoading } = useQuery({
    queryKey: ["analytics-assets"],
    queryFn: async () => (await api.get("/api/analytics/assets")).data,
  });

  const toggle = (key) => setExpanded((p) => ({ ...p, [key]: !p[key] }));

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }
  if (!data) return null;

  const { assets, liabilities } = data;

  // Pie chart data
  const assetPie = [
    { name: "Cash", value: assets.cash.total, color: COLORS.cash },
    {
      name: "Loans Given",
      value: assets.loans_given.total,
      color: COLORS.loans_given,
    },
    {
      name: "Properties",
      value: assets.properties.total,
      color: COLORS.properties,
    },
    {
      name: "Partnerships",
      value: assets.partnerships.total,
      color: COLORS.partnerships,
    },
    {
      name: "Receivables",
      value: assets.receivables.total,
      color: COLORS.receivables,
    },
  ].filter((d) => d.value > 0);

  const liabilityPie = [
    {
      name: "Loans Taken",
      value: liabilities.loans_taken.total,
      color: COLORS.loans_taken,
    },
    {
      name: "Payables",
      value: liabilities.payables.total,
      color: COLORS.payables,
    },
    {
      name: "Partner Payables",
      value: liabilities.partner_payables.total,
      color: COLORS.partner_payables,
    },
  ].filter((d) => d.value > 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">
              Assets & Liabilities
            </h1>
            <p className="text-xs text-gray-500">
              Balance sheet as of {data.as_of_date}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Hero: Net Worth */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <HeroCard
            label="Total Assets"
            value={data.total_assets}
            sub={`${Object.values(assets).reduce((a, s) => a + (s.count || s.items?.length || 0), 0)} items across ${Object.keys(assets).length} categories`}
            color="bg-green-50 border-green-200 text-green-900"
          />
          <HeroCard
            label="Total Liabilities"
            value={data.total_liabilities}
            sub={`${Object.values(liabilities).reduce((a, s) => a + (s.count || s.items?.length || 0), 0)} items across ${Object.keys(liabilities).length} categories`}
            color="bg-red-50 border-red-200 text-red-900"
          />
          <HeroCard
            label="Net Worth"
            value={data.net_worth}
            sub={
              data.net_worth >= 0
                ? "You're in the green"
                : "Liabilities exceed assets"
            }
            color={
              data.net_worth >= 0
                ? "bg-blue-50 border-blue-200 text-blue-900"
                : "bg-orange-50 border-orange-200 text-orange-900"
            }
          />
        </div>

        {/* Two-column layout: Assets / Liabilities */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── ASSETS COLUMN ── */}
          <div className="space-y-4">
            <h2 className="text-base font-bold text-green-800 flex items-center gap-2">
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
              What I Own
              <span className="text-sm font-medium text-gray-500 ml-auto">
                {formatCurrency(data.total_assets)}
              </span>
            </h2>

            {/* Pie Chart */}
            {assetPie.length > 0 && (
              <div className="bg-white rounded-xl border p-4">
                <div className="flex items-center gap-4">
                  <div className="w-36 h-36">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={assetPie}
                          dataKey="value"
                          innerRadius={30}
                          outerRadius={60}
                          paddingAngle={2}
                        >
                          {assetPie.map((d, i) => (
                            <Cell key={i} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v) => formatCurrency(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    {assetPie.map((d) => (
                      <div
                        key={d.name}
                        className="flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ background: d.color }}
                          />
                          <span className="text-gray-600">{d.name}</span>
                        </div>
                        <span className="font-medium text-gray-800">
                          {formatCurrency(d.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Cash & Bank Accounts */}
            <div className="bg-white rounded-xl border overflow-hidden">
              <SectionHeader
                title={ASSET_LABELS.cash}
                total={assets.cash.total}
                count={assets.cash.items.length}
                color="bg-blue-500"
                expanded={expanded.cash}
                onToggle={() => toggle("cash")}
              />
              {expanded.cash && (
                <div className="divide-y border-t">
                  {assets.cash.items.map((a) => (
                    <div
                      key={a.id}
                      onClick={() => navigate(`/accounts/${a.id}`)}
                      className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {a.name}
                        </p>
                        <p className="text-[11px] text-gray-400">
                          {a.bank_name ? `${a.bank_name} · ` : ""}
                          {a.type}
                        </p>
                      </div>
                      <span
                        className={`text-sm font-semibold ${a.balance >= 0 ? "text-green-700" : "text-red-600"}`}
                      >
                        {formatCurrency(a.balance)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Loans Given */}
            <div className="bg-white rounded-xl border overflow-hidden">
              <SectionHeader
                title={ASSET_LABELS.loans_given}
                total={assets.loans_given.total}
                count={assets.loans_given.count}
                color="bg-emerald-500"
                expanded={expanded.loans_given}
                onToggle={() => toggle("loans_given")}
              />
              {expanded.loans_given && (
                <div className="border-t overflow-x-auto">
                  <div className="flex gap-4 px-4 py-2 bg-gray-50 text-[10px] text-gray-500 font-medium uppercase min-w-[400px]">
                    <span className="flex-1">Borrower</span>
                    <span className="w-20 text-right">Principal</span>
                    <span className="w-20 text-right">Interest</span>
                    <span className="w-24 text-right">Total Due</span>
                  </div>
                  <div className="divide-y">
                    {assets.loans_given.items.map((l) => (
                      <div
                        key={l.id}
                        onClick={() => navigate(`/loans/${l.id}`)}
                        className="flex items-center gap-4 px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {l.contact}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            {l.institution_name
                              ? `${l.institution_name} · `
                              : ""}
                            {l.loan_type} · {l.rate}% p.a.
                          </p>
                        </div>
                        <span className="w-20 text-right text-xs text-gray-600">
                          {formatCurrency(l.principal_outstanding)}
                        </span>
                        <span className="w-20 text-right text-xs text-amber-600">
                          {formatCurrency(l.interest_outstanding)}
                        </span>
                        <span className="w-24 text-right text-sm font-semibold text-green-700">
                          {formatCurrency(l.total_outstanding)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-4 px-4 py-2 bg-gray-50 border-t text-xs font-medium">
                    <span className="flex-1 text-gray-500">Total</span>
                    <span className="w-20 text-right text-gray-600">
                      {formatCurrency(assets.loans_given.principal)}
                    </span>
                    <span className="w-20 text-right text-amber-600">
                      {formatCurrency(assets.loans_given.interest)}
                    </span>
                    <span className="w-24 text-right font-bold text-green-700">
                      {formatCurrency(assets.loans_given.total)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Properties */}
            {assets.properties.count > 0 && (
              <div className="bg-white rounded-xl border overflow-hidden">
                <SectionHeader
                  title={ASSET_LABELS.properties}
                  total={assets.properties.total}
                  count={assets.properties.count}
                  color="bg-violet-500"
                  expanded={expanded.properties}
                  onToggle={() => toggle("properties")}
                />
                {expanded.properties && (
                  <div className="divide-y border-t">
                    {assets.properties.items.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => navigate(`/properties/${p.id}`)}
                        className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {p.title}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            {p.property_type} · {p.deal_type} ·{" "}
                            {p.location || "—"} ·{" "}
                            <span
                              className={`font-medium ${p.status === "settled" ? "text-green-600" : "text-blue-500"}`}
                            >
                              {p.status}
                            </span>
                          </p>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <p className="text-sm font-semibold text-gray-800">
                            {formatCurrency(p.current_value)}
                          </p>
                          {p.invested !== p.current_value && (
                            <p className="text-[10px] text-gray-400">
                              invested {formatCurrency(p.invested)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Partnerships */}
            {assets.partnerships.count > 0 && (
              <div className="bg-white rounded-xl border overflow-hidden">
                <SectionHeader
                  title={ASSET_LABELS.partnerships}
                  total={assets.partnerships.total}
                  count={assets.partnerships.count}
                  color="bg-amber-500"
                  expanded={expanded.partnerships}
                  onToggle={() => toggle("partnerships")}
                />
                {expanded.partnerships && (
                  <div className="divide-y border-t">
                    {assets.partnerships.items.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => navigate(`/partnerships/${p.id}`)}
                        className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {p.title}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            Invested {formatCurrency(p.invested)} · Received{" "}
                            {formatCurrency(p.received)} ·{" "}
                            <span className="font-medium">{p.status}</span>
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-gray-800 shrink-0 ml-3">
                          {formatCurrency(p.net_value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Receivables */}
            {assets.receivables.count > 0 && (
              <div className="bg-white rounded-xl border overflow-hidden">
                <SectionHeader
                  title={ASSET_LABELS.receivables}
                  total={assets.receivables.total}
                  count={assets.receivables.count}
                  color="bg-pink-500"
                  expanded={expanded.receivables}
                  onToggle={() => toggle("receivables")}
                />
                {expanded.receivables && (
                  <div className="divide-y border-t">
                    {assets.receivables.items.map((o) => (
                      <div
                        key={o.id}
                        className="flex items-center justify-between px-4 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800">
                            {o.contact}
                          </p>
                          <p className="text-[11px] text-gray-400 truncate">
                            {o.reason}
                            {o.due_date ? ` · Due ${o.due_date}` : ""}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-green-700 shrink-0 ml-3">
                          {formatCurrency(o.pending)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Collateral Held */}
            {assets.collateral_held.count > 0 && (
              <div className="bg-white rounded-xl border overflow-hidden">
                <SectionHeader
                  title={ASSET_LABELS.collateral_held}
                  total={assets.collateral_held.total}
                  count={assets.collateral_held.count}
                  color="bg-indigo-500"
                  expanded={expanded.collateral}
                  onToggle={() => toggle("collateral")}
                />
                {expanded.collateral && (
                  <div className="divide-y border-t">
                    {assets.collateral_held.items.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => navigate(`/loans/${c.loan_id}`)}
                        className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800">
                            {c.contact}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            {c.type}
                            {c.gold_weight_grams
                              ? ` · ${c.gold_weight_grams}g ${c.gold_carat}K gold`
                              : ""}
                            {c.description ? ` · ${c.description}` : ""}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-indigo-700 shrink-0 ml-3">
                          {formatCurrency(c.estimated_value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── LIABILITIES COLUMN ── */}
          <div className="space-y-4">
            <h2 className="text-base font-bold text-red-800 flex items-center gap-2">
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"
                />
              </svg>
              What I Owe
              <span className="text-sm font-medium text-gray-500 ml-auto">
                {formatCurrency(data.total_liabilities)}
              </span>
            </h2>

            {/* Pie Chart */}
            {liabilityPie.length > 0 && (
              <div className="bg-white rounded-xl border p-4">
                <div className="flex items-center gap-4">
                  <div className="w-36 h-36">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={liabilityPie}
                          dataKey="value"
                          innerRadius={30}
                          outerRadius={60}
                          paddingAngle={2}
                        >
                          {liabilityPie.map((d, i) => (
                            <Cell key={i} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v) => formatCurrency(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    {liabilityPie.map((d) => (
                      <div
                        key={d.name}
                        className="flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ background: d.color }}
                          />
                          <span className="text-gray-600">{d.name}</span>
                        </div>
                        <span className="font-medium text-gray-800">
                          {formatCurrency(d.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Loans Taken */}
            <div className="bg-white rounded-xl border overflow-hidden">
              <SectionHeader
                title={LIABILITY_LABELS.loans_taken}
                total={liabilities.loans_taken.total}
                count={liabilities.loans_taken.count}
                color="bg-red-500"
                expanded={expanded.loans_taken}
                onToggle={() => toggle("loans_taken")}
              />
              {expanded.loans_taken && (
                <div className="border-t overflow-x-auto">
                  <div className="flex gap-4 px-4 py-2 bg-gray-50 text-[10px] text-gray-500 font-medium uppercase min-w-[400px]">
                    <span className="flex-1">Lender</span>
                    <span className="w-20 text-right">Principal</span>
                    <span className="w-20 text-right">Interest</span>
                    <span className="w-24 text-right">Total Owed</span>
                  </div>
                  <div className="divide-y">
                    {liabilities.loans_taken.items.map((l) => (
                      <div
                        key={l.id}
                        onClick={() => navigate(`/loans/${l.id}`)}
                        className="flex items-center gap-4 px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {l.institution_name || l.contact}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            {l.loan_type} · {l.rate}% p.a.
                            {l.expected_end_date
                              ? ` · Ends ${l.expected_end_date}`
                              : ""}
                          </p>
                        </div>
                        <span className="w-20 text-right text-xs text-gray-600">
                          {formatCurrency(l.principal_outstanding)}
                        </span>
                        <span className="w-20 text-right text-xs text-amber-600">
                          {formatCurrency(l.interest_outstanding)}
                        </span>
                        <span className="w-24 text-right text-sm font-semibold text-red-700">
                          {formatCurrency(l.total_outstanding)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-4 px-4 py-2 bg-gray-50 border-t text-xs font-medium">
                    <span className="flex-1 text-gray-500">Total</span>
                    <span className="w-20 text-right text-gray-600">
                      {formatCurrency(liabilities.loans_taken.principal)}
                    </span>
                    <span className="w-20 text-right text-amber-600">
                      {formatCurrency(liabilities.loans_taken.interest)}
                    </span>
                    <span className="w-24 text-right font-bold text-red-700">
                      {formatCurrency(liabilities.loans_taken.total)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Payables */}
            {liabilities.payables.count > 0 && (
              <div className="bg-white rounded-xl border overflow-hidden">
                <SectionHeader
                  title={LIABILITY_LABELS.payables}
                  total={liabilities.payables.total}
                  count={liabilities.payables.count}
                  color="bg-orange-500"
                  expanded={expanded.payables}
                  onToggle={() => toggle("payables")}
                />
                {expanded.payables && (
                  <div className="divide-y border-t">
                    {liabilities.payables.items.map((o) => (
                      <div
                        key={o.id}
                        className="flex items-center justify-between px-4 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800">
                            {o.contact}
                          </p>
                          <p className="text-[11px] text-gray-400 truncate">
                            {o.reason}
                            {o.due_date ? ` · Due ${o.due_date}` : ""}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-red-700 shrink-0 ml-3">
                          {formatCurrency(o.pending)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Partner Payables */}
            {liabilities.partner_payables.count > 0 && (
              <div className="bg-white rounded-xl border overflow-hidden">
                <SectionHeader
                  title={LIABILITY_LABELS.partner_payables}
                  total={liabilities.partner_payables.total}
                  count={liabilities.partner_payables.count}
                  color="bg-rose-500"
                  expanded={expanded.partner_payables}
                  onToggle={() => toggle("partner_payables")}
                />
                {expanded.partner_payables && (
                  <div className="divide-y border-t">
                    {liabilities.partner_payables.items.map((pp, i) => (
                      <div
                        key={i}
                        onClick={() =>
                          navigate(`/partnerships/${pp.partnership_id}`)
                        }
                        className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800">
                            {pp.partner}
                          </p>
                          <p className="text-[11px] text-gray-400 truncate">
                            {pp.partnership} · Owed {formatCurrency(pp.owed)} ·
                            Paid {formatCurrency(pp.paid)}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-red-700 shrink-0 ml-3">
                          {formatCurrency(pp.pending)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Empty state for liabilities */}
            {data.total_liabilities === 0 && (
              <div className="bg-white rounded-xl border p-8 text-center">
                <p className="text-gray-400 text-sm">
                  No outstanding liabilities
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
