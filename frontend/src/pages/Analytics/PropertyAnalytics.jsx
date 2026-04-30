import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

const STATUS_LABELS = {
  holding_pot_money: { text: "Holding pot money", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  pot_owes_them: { text: "Pot owes them", cls: "bg-blue-100 text-blue-800 border-blue-200" },
  ahead_of_share: { text: "Ahead of share", cls: "bg-purple-100 text-purple-800 border-purple-200" },
  balanced: { text: "Balanced", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
};

const TXN_LABELS = {
  advance_to_seller: "Advance → Seller",
  payment_to_seller: "Payment → Seller",
  remaining_to_seller: "Remaining → Seller",
  received_from_buyer: "Received ← Buyer",
  buyer_advance: "Buyer Advance",
  buyer_payment: "Buyer Payment",
  buyer_payment_received: "Buyer Payment",
  commission_paid: "Broker Commission",
  broker_commission: "Broker Commission",
  expense: "Expense",
  other_expense: "Other Expense",
  refund: "Refund",
  sale_proceeds: "Sale Proceeds",
  profit_received: "Profit Received",
  partner_transfer: "Partner Transfer",
  invested: "Invested",
  advance_given: "Advance Given",
  broker_paid: "Broker Paid",
  profit_distributed: "Profit Distributed",
};

function txnLabel(t) {
  return TXN_LABELS[t] || (t || "Other").replace(/_/g, " ");
}

function buildScopeQuery({ propertyIds, sitePlotIds, partnershipIds, allMode }) {
  const params = new URLSearchParams();
  if (allMode && !propertyIds.length && !sitePlotIds.length && !partnershipIds.length) {
    params.append("scope", "all");
  } else {
    propertyIds.forEach((id) => params.append("property_ids", id));
    sitePlotIds.forEach((id) => params.append("site_plot_ids", id));
    partnershipIds.forEach((id) => params.append("partnership_ids", id));
  }
  return params.toString();
}

function MoneyCard({ title, amount, sub, color, icon, hint }) {
  return (
    <div className={`rounded-xl border ${color.border} ${color.bg} p-5 shadow-sm`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-semibold uppercase tracking-wider ${color.label}`}>
          {title}
        </span>
        <span className="text-2xl">{icon}</span>
      </div>
      <div className={`text-2xl font-bold ${color.amount}`}>{formatCurrency(amount)}</div>
      {sub && <div className="text-xs text-slate-600 mt-1">{sub}</div>}
      {hint && <div className="text-[11px] text-slate-500 mt-2 italic">{hint}</div>}
    </div>
  );
}

function BucketCards({ buckets }) {
  const cards = [
    {
      title: "To Receive From Buyers",
      amount: buckets.to_receive_from_buyers,
      icon: "📥",
      color: { border: "border-emerald-200", bg: "bg-emerald-50", label: "text-emerald-700", amount: "text-emerald-900" },
      hint: "Money buyers still owe us",
    },
    {
      title: "To Pay To Seller",
      amount: buckets.to_pay_to_seller,
      icon: "📤",
      color: { border: "border-rose-200", bg: "bg-rose-50", label: "text-rose-700", amount: "text-rose-900" },
      hint: "What we still owe the seller",
    },
    {
      title: "Already Received",
      amount: buckets.already_received,
      icon: "✅",
      color: { border: "border-green-200", bg: "bg-green-50", label: "text-green-700", amount: "text-green-900" },
      hint: "Money in so far",
    },
    {
      title: "Already Paid Out",
      amount: buckets.already_paid_out,
      icon: "💸",
      color: { border: "border-orange-200", bg: "bg-orange-50", label: "text-orange-700", amount: "text-orange-900" },
      hint: "Money out so far",
    },
    {
      title: "Projected Gross Profit",
      amount: buckets.projected_gross_profit,
      icon: "📊",
      color: { border: "border-indigo-200", bg: "bg-indigo-50", label: "text-indigo-700", amount: "text-indigo-900" },
      hint: "Buyer value − seller value",
    },
    {
      title: "Projected Net Profit",
      amount: buckets.projected_net_profit,
      icon: "💎",
      color: { border: "border-blue-200", bg: "bg-blue-50", label: "text-blue-700", amount: "text-blue-900" },
      hint: "After broker + other expenses",
    },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map((c) => (
        <MoneyCard key={c.title} {...c} />
      ))}
    </div>
  );
}

function MembersTable({ members, showPartnership }) {
  if (!members || members.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic p-4 bg-slate-50 rounded-lg border border-slate-200">
        No partners on this scope.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">Partner</th>
            {showPartnership && <th className="text-left px-3 py-2 font-semibold">Partnership</th>}
            <th className="text-right px-3 py-2 font-semibold">Share %</th>
            <th className="text-right px-3 py-2 font-semibold">Contributed</th>
            <th className="text-right px-3 py-2 font-semibold">Received Out</th>
            <th className="text-right px-3 py-2 font-semibold">Collected For Pot</th>
            <th className="text-right px-3 py-2 font-semibold">Currently Holding</th>
            <th className="text-right px-3 py-2 font-semibold">Projected Share</th>
            <th className="text-right px-3 py-2 font-semibold">Final Settlement</th>
            <th className="text-left px-3 py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m, idx) => {
            const status = STATUS_LABELS[m.status] || STATUS_LABELS.balanced;
            return (
              <tr
                key={`${m.member_id || m.name}-${idx}`}
                className={`border-t border-slate-100 ${m.is_self ? "bg-blue-50/40" : ""}`}
              >
                <td className="px-3 py-2 font-medium text-slate-800">
                  {m.name}
                  {m.is_self && (
                    <span className="ml-2 inline-flex text-[10px] font-semibold bg-blue-600 text-white px-1.5 py-0.5 rounded">
                      YOU
                    </span>
                  )}
                </td>
                {showPartnership && (
                  <td className="px-3 py-2 text-slate-600">{m.partnership_title || "—"}</td>
                )}
                <td className="px-3 py-2 text-right text-slate-700">
                  {m.share_percentage != null ? `${m.share_percentage}%` : "—"}
                </td>
                <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(m.contributed)}</td>
                <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(m.received_out)}</td>
                <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(m.collected_for_pot)}</td>
                <td
                  className={`px-3 py-2 text-right font-semibold ${
                    m.currently_holding > 0 ? "text-amber-700" : m.currently_holding < 0 ? "text-blue-700" : "text-slate-600"
                  }`}
                >
                  {formatCurrency(m.currently_holding)}
                </td>
                <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(m.projected_share)}</td>
                <td
                  className={`px-3 py-2 text-right font-semibold ${
                    m.final_settlement > 0 ? "text-emerald-700" : m.final_settlement < 0 ? "text-rose-700" : "text-slate-600"
                  }`}
                >
                  {formatCurrency(m.final_settlement)}
                </td>
                <td className="px-3 py-2">
                  {m.status && (
                    <span className={`inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full border ${status.cls}`}>
                      {status.text}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BuyersList({ buyers }) {
  if (!buyers || buyers.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">Buyer</th>
            <th className="text-right px-3 py-2 font-semibold">Total Value</th>
            <th className="text-right px-3 py-2 font-semibold">Paid</th>
            <th className="text-right px-3 py-2 font-semibold">Outstanding</th>
            <th className="text-left px-3 py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {buyers.map((b) => (
            <tr key={`${b.kind}-${b.id}`} className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium text-slate-800">{b.name}</td>
              <td className="px-3 py-2 text-right">{formatCurrency(b.total_value)}</td>
              <td className="px-3 py-2 text-right text-emerald-700">{formatCurrency(b.paid)}</td>
              <td
                className={`px-3 py-2 text-right font-semibold ${
                  b.outstanding > 0 ? "text-amber-700" : "text-slate-500"
                }`}
              >
                {formatCurrency(b.outstanding)}
              </td>
              <td className="px-3 py-2 text-xs text-slate-600">{b.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic p-4 bg-slate-50 rounded-lg border border-slate-200">
        No transactions recorded yet.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {rows.slice(0, 50).map((t, idx) => {
        const isInflow = ["received_from_buyer", "sale_proceeds", "buyer_payment",
          "buyer_advance", "buyer_payment_received", "profit_received", "received"].includes(t.type);
        return (
          <div
            key={idx}
            className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-white"
          >
            <span
              className={`shrink-0 w-2 h-2 rounded-full ${isInflow ? "bg-emerald-500" : "bg-rose-500"}`}
            />
            <span className="text-xs text-slate-500 w-24 shrink-0">{formatDate(t.date)}</span>
            <span className="text-sm font-medium text-slate-800 flex-1 truncate">
              {txnLabel(t.type)}
              {t.received_by && (
                <span className="text-xs text-slate-500 ml-2">→ {t.received_by}</span>
              )}
              {t.from_member && (
                <span className="text-xs text-slate-500 ml-2">paid by {t.from_member}</span>
              )}
              {t.description && (
                <span className="text-xs text-slate-400 ml-2 italic">{t.description}</span>
              )}
            </span>
            <span
              className={`text-sm font-semibold tabular-nums ${
                isInflow ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {isInflow ? "+" : "−"}
              {formatCurrency(t.amount)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Block({ block }) {
  const linkTo =
    block.kind === "property" ? `/properties/${block.id}` :
    block.kind === "partnership" ? `/partnerships/${block.id}` :
    block.kind === "site_plot" ? `/properties/${block.property_deal_id}` : null;
  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {block.kind.replace("_", " ")}
            {block.status && (
              <span className="ml-2 px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full text-[10px] normal-case">
                {block.status}
              </span>
            )}
          </div>
          <h3 className="text-lg font-bold text-slate-900 mt-0.5">{block.title || block.label}</h3>
          {block.seller_name && (
            <div className="text-xs text-slate-500 mt-0.5">Seller: {block.seller_name}</div>
          )}
        </div>
        {linkTo && (
          <Link
            to={linkTo}
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium shrink-0"
          >
            Open →
          </Link>
        )}
      </div>
      <div className="p-6 space-y-6">
        <BucketCards buckets={block.buckets} />
        {block.buyers && block.buyers.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-slate-700 mb-2">Buyers</h4>
            <BuyersList buyers={block.buyers} />
          </div>
        )}
        {block.members && block.members.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-slate-700 mb-2">Per-Partner Money Position</h4>
            <MembersTable members={block.members} showPartnership={block.kind === "property"} />
          </div>
        )}
        {block.timeline && (
          <div>
            <h4 className="text-sm font-semibold text-slate-700 mb-2">Money Flow Timeline</h4>
            <Timeline rows={block.timeline} />
          </div>
        )}
      </div>
    </section>
  );
}

function ScopePicker({ options, selection, setSelection, allMode, setAllMode }) {
  const toggle = (key, id) => {
    setAllMode(false);
    setSelection((prev) => {
      const set = new Set(prev[key]);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, [key]: Array.from(set) };
    });
  };
  const clear = () => {
    setAllMode(false);
    setSelection({ propertyIds: [], sitePlotIds: [], partnershipIds: [] });
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-semibold text-slate-800">Choose what to analyze</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setAllMode(true);
              setSelection({ propertyIds: [], sitePlotIds: [], partnershipIds: [] });
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              allMode
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            Everything Combined
          </button>
          <button
            onClick={clear}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
          >
            Clear
          </button>
        </div>
      </div>

      <details className="rounded-lg border border-slate-200 open:bg-slate-50/50" open>
        <summary className="px-4 py-2 cursor-pointer text-sm font-semibold text-slate-700">
          Properties ({selection.propertyIds.length} selected)
        </summary>
        <div className="px-4 py-3 flex flex-wrap gap-2">
          {(options?.properties || []).map((p) => {
            const on = selection.propertyIds.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggle("propertyIds", p.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  on
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                }`}
              >
                {p.title}
                {p.status && <span className="ml-1 opacity-70">· {p.status}</span>}
              </button>
            );
          })}
          {!options?.properties?.length && (
            <span className="text-xs text-slate-500 italic">No properties yet.</span>
          )}
        </div>
      </details>

      <details className="rounded-lg border border-slate-200 open:bg-slate-50/50">
        <summary className="px-4 py-2 cursor-pointer text-sm font-semibold text-slate-700">
          Partnerships ({selection.partnershipIds.length} selected)
        </summary>
        <div className="px-4 py-3 flex flex-wrap gap-2">
          {(options?.partnerships || []).map((p) => {
            const on = selection.partnershipIds.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggle("partnershipIds", p.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  on
                    ? "bg-purple-600 text-white border-purple-600"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                }`}
              >
                {p.title}
              </button>
            );
          })}
          {!options?.partnerships?.length && (
            <span className="text-xs text-slate-500 italic">No partnerships yet.</span>
          )}
        </div>
      </details>

      <details className="rounded-lg border border-slate-200 open:bg-slate-50/50">
        <summary className="px-4 py-2 cursor-pointer text-sm font-semibold text-slate-700">
          Site Plots ({selection.sitePlotIds.length} selected)
        </summary>
        <div className="px-4 py-3 flex flex-wrap gap-2">
          {(options?.site_plots || []).map((sp) => {
            const on = selection.sitePlotIds.includes(sp.id);
            return (
              <button
                key={sp.id}
                onClick={() => toggle("sitePlotIds", sp.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  on
                    ? "bg-amber-600 text-white border-amber-600"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                }`}
              >
                Plot {sp.plot_number || sp.id}
              </button>
            );
          })}
          {!options?.site_plots?.length && (
            <span className="text-xs text-slate-500 italic">No site plots yet.</span>
          )}
        </div>
      </details>
    </div>
  );
}

export default function PropertyAnalytics() {
  const [allMode, setAllMode] = useState(true);
  const [selection, setSelection] = useState({
    propertyIds: [],
    sitePlotIds: [],
    partnershipIds: [],
  });

  const queryString = useMemo(
    () => buildScopeQuery({ ...selection, allMode }),
    [selection, allMode]
  );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["property-analytics", queryString],
    queryFn: async () =>
      (await api.get(`/api/analytics/property?${queryString}`)).data,
    keepPreviousData: true,
  });

  const blocks = data?.blocks || [];
  const combined = data?.combined;
  const showCombined = blocks.length > 1 || allMode;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Property Analytics</h1>
          <p className="text-sm text-slate-600 mt-1">
            See exactly who has how much money, what's owed where, and how profits will split — for any property, plot, or partnership.
          </p>
        </div>

        {data?.summary_sentence && (
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-2xl p-5 shadow-md">
            <div className="text-xs font-semibold uppercase tracking-wider text-indigo-100 mb-1">
              At a glance
            </div>
            <div className="text-base sm:text-lg font-medium leading-relaxed">
              {data.summary_sentence}
            </div>
          </div>
        )}

        <ScopePicker
          options={data?.options}
          selection={selection}
          setSelection={setSelection}
          allMode={allMode}
          setAllMode={setAllMode}
        />

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
          </div>
        )}

        {isError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg p-4 text-sm">
            Failed to load analytics: {error?.message || "Unknown error"}
          </div>
        )}

        {!isLoading && !isError && blocks.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">
            Pick a property, plot, or partnership above to see the money flow.
          </div>
        )}

        {showCombined && combined && blocks.length > 0 && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="px-6 py-4 border-b border-slate-200">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Combined view
              </div>
              <h2 className="text-lg font-bold text-slate-900">All selected scopes together</h2>
            </div>
            <div className="p-6 space-y-6">
              <BucketCards buckets={combined.buckets} />
              {combined.members && combined.members.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 mb-2">
                    Per-Partner Money Position (across all selected)
                  </h4>
                  <MembersTable members={combined.members} showPartnership={false} />
                </div>
              )}
            </div>
          </section>
        )}

        {blocks.map((b) => (
          <Block key={`${b.kind}-${b.id}`} block={b} />
        ))}
      </div>
    </div>
  );
}
