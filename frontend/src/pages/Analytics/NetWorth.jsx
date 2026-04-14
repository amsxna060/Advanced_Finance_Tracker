import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from "recharts";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

const ASSET_COLORS = ["#10b981", "#6366f1", "#8b5cf6", "#06b6d4", "#f59e0b", "#ec4899"];
const LIABILITY_COLORS = ["#ef4444", "#f97316", "#e11d48", "#d946ef"];

const SECTION_META = {
  cash: { label: "Cash & Bank Accounts", icon: "💰", link: (id) => `/accounts/${id}` },
  loans_given: { label: "Loans Given (Receivable)", icon: "📤", link: (id) => `/loans/${id}` },
  properties: { label: "Property Investments", icon: "🏠", link: (id) => `/properties/${id}` },
  partnerships: { label: "Partnership Investments", icon: "🤝", link: (id) => `/partnerships/${id}` },
  receivables: { label: "Receivables", icon: "📋" },
  collateral_held: { label: "Collateral Held", icon: "🔒" },
  loans_taken: { label: "Loans Taken (Owed)", icon: "📥", link: (id) => `/loans/${id}` },
  payables: { label: "Payables", icon: "📋" },
  partner_payables: { label: "Partner Payables", icon: "🤝" },
};

export default function NetWorth() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["net-worth-assets"],
    queryFn: async () => (await api.get("/api/analytics/assets")).data,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
      </div>
    );
  }
  if (!data) return null;

  const { net_worth, total_assets, total_liabilities, assets, liabilities } = data;

  const assetDonut = Object.entries(assets)
    .filter(([, v]) => v.total > 0)
    .map(([k, v], i) => ({
      name: SECTION_META[k]?.label || k,
      value: v.total,
      color: ASSET_COLORS[i % ASSET_COLORS.length],
    }));

  const liabilityDonut = Object.entries(liabilities)
    .filter(([, v]) => v.total > 0)
    .map(([k, v], i) => ({
      name: SECTION_META[k]?.label || k,
      value: v.total,
      color: LIABILITY_COLORS[i % LIABILITY_COLORS.length],
    }));

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Net Worth & Assets</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Complete balance sheet &middot; As of {data.as_of_date}
          </p>
        </div>

        {/* Net Worth Hero */}
        <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-2xl p-6 text-white">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
            <div className="text-center md:text-left">
              <p className="text-xs uppercase tracking-wider text-white/60 font-medium">Total Assets</p>
              <p className="text-2xl font-bold mt-1">{formatCurrency(total_assets)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs uppercase tracking-wider text-white/60 font-medium">Net Worth</p>
              <p className="text-4xl font-extrabold mt-1">{formatCurrency(net_worth)}</p>
              <p className="text-xs text-white/50 mt-1">assets − liabilities</p>
            </div>
            <div className="text-center md:text-right">
              <p className="text-xs uppercase tracking-wider text-white/60 font-medium">Total Liabilities</p>
              <p className="text-2xl font-bold mt-1">{formatCurrency(total_liabilities)}</p>
            </div>
          </div>
          {/* Proportion bar */}
          <div className="mt-4">
            <div className="h-3 bg-white/20 rounded-full overflow-hidden flex">
              {total_assets + total_liabilities > 0 && (
                <>
                  <div className="bg-emerald-400 h-full rounded-l-full"
                    style={{ width: `${(total_assets / (total_assets + total_liabilities) * 100)}%` }} />
                  <div className="bg-red-400 h-full rounded-r-full"
                    style={{ width: `${(total_liabilities / (total_assets + total_liabilities) * 100)}%` }} />
                </>
              )}
            </div>
            <div className="flex justify-between text-[10px] text-white/50 mt-1">
              <span>Assets ({total_assets + total_liabilities > 0 ? (total_assets / (total_assets + total_liabilities) * 100).toFixed(0) : 0}%)</span>
              <span>Liabilities ({total_assets + total_liabilities > 0 ? (total_liabilities / (total_assets + total_liabilities) * 100).toFixed(0) : 0}%)</span>
            </div>
          </div>
        </div>

        {/* Donut Charts */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <DonutSection title="Assets Breakdown" data={assetDonut} total={total_assets} />
          <DonutSection title="Liabilities Breakdown" data={liabilityDonut} total={total_liabilities} />
        </div>

        {/* Asset sections */}
        <div>
          <h2 className="text-lg font-bold text-slate-900 mb-3">Assets</h2>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {Object.entries(assets).map(([key, section]) => (
              <ItemSection key={key} sectionKey={key} section={section} navigate={navigate} />
            ))}
          </div>
        </div>

        {/* Liability sections */}
        <div>
          <h2 className="text-lg font-bold text-slate-900 mb-3">Liabilities</h2>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {Object.entries(liabilities).map(([key, section]) => (
              <ItemSection key={key} sectionKey={key} section={section} navigate={navigate} isLiability />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sub Components ────────────────────────────────────────────────── */

function DonutSection({ title, data, total }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">{title}</h3>
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-slate-400 text-sm">No data</div>
      ) : (
        <div className="flex items-center gap-6">
          <div className="w-48 h-48 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={85}
                  paddingAngle={2} dataKey="value" nameKey="name" stroke="none">
                  {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip formatter={(v) => formatCurrency(v)}
                  contentStyle={{ borderRadius: "10px", border: "1px solid #e2e8f0", fontSize: "13px" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {data.map((d) => {
              const pct = total > 0 ? (d.value / total * 100).toFixed(1) : "0";
              return (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="text-slate-600 truncate flex-1">{d.name}</span>
                  <span className="text-slate-400 shrink-0">{pct}%</span>
                  <span className="font-semibold text-slate-800 shrink-0 w-24 text-right">
                    {formatCurrency(d.value)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ItemSection({ sectionKey, section, navigate, isLiability }) {
  const [expanded, setExpanded] = useState(false);
  const meta = SECTION_META[sectionKey] || { label: sectionKey, icon: "📦" };
  const items = section.items || [];
  if (section.total <= 0 && items.length === 0) return null;

  const displayItems = expanded ? items : items.slice(0, 5);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition">
        <div className="flex items-center gap-2">
          <span className="text-lg">{meta.icon}</span>
          <span className="text-sm font-semibold text-slate-800">{meta.label}</span>
          <span className="text-xs text-slate-400">({items.length})</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-base font-bold ${isLiability ? "text-red-700" : "text-emerald-700"}`}>
            {formatCurrency(section.total)}
          </span>
          <span className="text-slate-400 text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Collapsed summary - principal/interest if applicable */}
      {!expanded && section.principal !== undefined && (
        <div className="px-4 pb-3 flex gap-4 text-xs text-slate-500">
          <span>Principal: {formatCurrency(section.principal)}</span>
          <span>Interest: {formatCurrency(section.interest)}</span>
        </div>
      )}

      {/* Expanded items */}
      {expanded && items.length > 0 && (
        <div className="border-t border-slate-100 divide-y divide-slate-50">
          {displayItems.map((item, i) => (
            <ItemRow key={i} item={item} sectionKey={sectionKey} navigate={navigate} isLiability={isLiability} />
          ))}
          {items.length > 5 && !expanded && (
            <div className="px-4 py-2 text-center">
              <button onClick={() => setExpanded(true)} className="text-xs text-indigo-600 hover:underline">
                Show all {items.length} items
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ItemRow({ item, sectionKey, navigate, isLiability }) {
  const meta = SECTION_META[sectionKey];
  const linkFn = meta?.link;
  const primary = item.name || item.contact || item.title || item.partner || "—";
  const amount = item.total_outstanding || item.balance || item.current_value || item.net_value || item.pending || item.estimated_value || 0;
  const sub = item.loan_type || item.property_type || item.type || item.reason || item.description || "";

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-800 truncate">{primary}</span>
          {sub && <span className="text-[10px] text-slate-400 capitalize truncate">{sub}</span>}
          {item.status && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              item.status === "active" ? "bg-green-50 text-green-700" :
              item.status === "settled" ? "bg-blue-50 text-blue-700" :
              "bg-slate-100 text-slate-600"
            }`}>{item.status}</span>
          )}
          {item.rate > 0 && <span className="text-[10px] text-slate-400">{item.rate}%</span>}
        </div>
        {item.due_date && <p className="text-[10px] text-slate-400 mt-0.5">Due: {item.due_date}</p>}
        {item.principal_outstanding !== undefined && (
          <p className="text-[10px] text-slate-400 mt-0.5">
            P: {formatCurrency(item.principal_outstanding)} · I: {formatCurrency(item.interest_outstanding)}
          </p>
        )}
      </div>
      <div className="text-right shrink-0 flex items-center gap-2">
        <span className={`text-sm font-bold ${isLiability ? "text-red-700" : "text-emerald-700"}`}>
          {formatCurrency(amount)}
        </span>
        {linkFn && item.id && (
          <button onClick={() => navigate(linkFn(item.id))}
            className="text-xs text-indigo-600 hover:text-indigo-800">→</button>
        )}
      </div>
    </div>
  );
}
