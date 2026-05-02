import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

const EVENT_LABELS = {
  advance_given: "Gave Advance",
  paid_to_seller: "Paid to Seller",
  paid_broker: "Paid Broker",
  paid_expense: "Paid Expense",
  received_from_buyer: "Received from Buyer",
  transfer_in: "Received from Partner",
  transfer_out: "Sent to Partner",
};

const EVENT_COLORS = {
  advance_given: { dot: "bg-purple-500", text: "text-purple-700" },
  paid_to_seller: { dot: "bg-rose-500", text: "text-rose-700" },
  paid_broker: { dot: "bg-orange-500", text: "text-orange-700" },
  paid_expense: { dot: "bg-orange-500", text: "text-orange-700" },
  received_from_buyer: { dot: "bg-emerald-500", text: "text-emerald-700" },
  transfer_in: { dot: "bg-blue-500", text: "text-blue-700" },
  transfer_out: { dot: "bg-violet-500", text: "text-violet-700" },
};

function txnLabel(t) {
  return TXN_LABELS[t] || (t || "Other").replace(/_/g, " ");
}

function buildScopeQuery({ propertyIds, allMode }) {
  const params = new URLSearchParams();
  if (allMode && !propertyIds.length) {
    params.append("scope", "all");
  } else {
    propertyIds.forEach((id) => params.append("property_ids", id));
  }
  return params.toString();
}

function formatArea(sqft) {
  if (!sqft && sqft !== 0) return "—";
  return `${new Intl.NumberFormat("en-IN").format(Math.round(sqft))} sqft`;
}

// ── Summary cards ────────────────────────────────────────────────────────────

function SummaryCard({ title, value, sub, color, icon }) {
  return (
    <div className={`rounded-xl border ${color.border} ${color.bg} p-4 shadow-sm`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${color.label}`}>
          {title}
        </span>
        <span className="text-xl">{icon}</span>
      </div>
      <div className={`text-xl font-bold ${color.amount}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function AreaMetricsGroup({ buckets }) {
  const total = buckets.total_land_area || 0;
  const sold = buckets.sold_area || 0;
  const remaining = buckets.remaining_area || 0;
  const pct = total > 0 ? Math.min(100, (sold / total) * 100) : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 px-1">
        <h3 className="text-sm font-semibold text-slate-700">📐 Area</h3>
        <span className="text-xs text-slate-500">{pct.toFixed(0)}% sold</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard
          title="Total Land Area"
          value={formatArea(total)}
          icon="🗺️"
          color={{ border: "border-slate-200", bg: "bg-white", label: "text-slate-600", amount: "text-slate-900" }}
        />
        <SummaryCard
          title="Sold Area"
          value={formatArea(sold)}
          sub={total > 0 ? `${pct.toFixed(1)}% of total` : null}
          icon="✅"
          color={{ border: "border-emerald-200", bg: "bg-emerald-50", label: "text-emerald-700", amount: "text-emerald-900" }}
        />
        <SummaryCard
          title="Remaining Area"
          value={formatArea(remaining)}
          sub={total > 0 ? `${(100 - pct).toFixed(1)}% available` : null}
          icon="🟨"
          color={{ border: "border-amber-200", bg: "bg-amber-50", label: "text-amber-700", amount: "text-amber-900" }}
        />
      </div>
      {total > 0 && (
        <div className="mt-3 px-1">
          <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FinancialMetricsGroup({ buckets }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700 mb-2 px-1">💰 Money Flow</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <SummaryCard
          title="Total Received"
          value={formatCurrency(buckets.already_received)}
          sub="Already paid by buyers"
          icon="📥"
          color={{ border: "border-emerald-200", bg: "bg-emerald-50", label: "text-emerald-700", amount: "text-emerald-900" }}
        />
        <SummaryCard
          title="Total Outstanding"
          value={formatCurrency(buckets.to_receive_from_buyers)}
          sub="Buyers still to pay"
          icon="⏳"
          color={{ border: "border-amber-200", bg: "bg-amber-50", label: "text-amber-700", amount: "text-amber-900" }}
        />
        <SummaryCard
          title="Partner Advances"
          value={formatCurrency(buckets.partner_advances)}
          sub="Capital from partners"
          icon="🤝"
          color={{ border: "border-purple-200", bg: "bg-purple-50", label: "text-purple-700", amount: "text-purple-900" }}
        />
        <SummaryCard
          title="Paid to Seller"
          value={formatCurrency(buckets.already_paid_out)}
          sub="Sent to seller so far"
          icon="💸"
          color={{ border: "border-rose-200", bg: "bg-rose-50", label: "text-rose-700", amount: "text-rose-900" }}
        />
        <SummaryCard
          title="Remaining to Pay Seller"
          value={formatCurrency(buckets.to_pay_to_seller)}
          sub="Outstanding to seller"
          icon="📤"
          color={{ border: "border-red-200", bg: "bg-red-50", label: "text-red-700", amount: "text-red-900" }}
        />
        <SummaryCard
          title="Projected Net Profit"
          value={formatCurrency(buckets.projected_net_profit)}
          sub="After broker + expenses"
          icon="💎"
          color={{ border: "border-blue-200", bg: "bg-blue-50", label: "text-blue-700", amount: "text-blue-900" }}
        />
      </div>
    </div>
  );
}

// ── Buyers (expandable rows) ─────────────────────────────────────────────────

function BuyerRow({ buyer }) {
  const [open, setOpen] = useState(false);
  const txns = buyer.transactions || [];
  const hasTxns = txns.length > 0;

  return (
    <div className="border-t border-slate-100 first:border-t-0">
      <button
        type="button"
        onClick={() => hasTxns && setOpen((v) => !v)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left ${
          hasTxns ? "hover:bg-slate-50 cursor-pointer" : "cursor-default"
        }`}
      >
        <span
          className={`shrink-0 w-4 text-slate-400 transition-transform ${open ? "rotate-90" : ""} ${
            hasTxns ? "" : "opacity-30"
          }`}
        >
          ▶
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-slate-800 truncate">{buyer.name}</div>
          <div className="text-xs text-slate-500">
            {formatArea(buyer.area_sqft)}
            {buyer.rate_per_sqft > 0 && ` @ ₹${buyer.rate_per_sqft}/sqft`}
            {buyer.status && ` · ${buyer.status}`}
          </div>
        </div>
        <div className="hidden sm:block text-right">
          <div className="text-xs text-slate-500">Total</div>
          <div className="font-semibold text-slate-800">{formatCurrency(buyer.total_value)}</div>
        </div>
        <div className="hidden md:block text-right">
          <div className="text-xs text-slate-500">Paid</div>
          <div className="font-semibold text-emerald-700">{formatCurrency(buyer.paid)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Outstanding</div>
          <div className={`font-semibold ${buyer.outstanding > 0 ? "text-amber-700" : "text-slate-500"}`}>
            {formatCurrency(buyer.outstanding)}
          </div>
        </div>
      </button>
      {open && hasTxns && (
        <div className="bg-slate-50 px-12 py-3 border-t border-slate-100">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Transactions ({txns.length})
          </div>
          <div className="space-y-1.5">
            {txns.map((t, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-white border border-slate-200 rounded-md px-3 py-2 text-sm"
              >
                <span className="text-xs text-slate-500 w-24 shrink-0">{formatDate(t.date)}</span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium text-slate-800">{txnLabel(t.type)}</span>
                  {t.received_by && (
                    <span className="text-xs text-slate-500 ml-2">
                      → received by <span className="font-medium text-slate-700">{t.received_by}</span>
                    </span>
                  )}
                  {t.payment_mode && (
                    <span className="text-[10px] text-slate-400 ml-2 uppercase">{t.payment_mode}</span>
                  )}
                  {t.description && (
                    <div className="text-xs text-slate-500 italic mt-0.5 truncate">{t.description}</div>
                  )}
                </span>
                <span className="font-semibold text-emerald-700 tabular-nums shrink-0">
                  +{formatCurrency(t.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BuyersAccordion({ buyers }) {
  if (!buyers || buyers.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic p-4 bg-slate-50 rounded-lg border border-slate-200">
        No buyers registered yet.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      {buyers.map((b) => (
        <BuyerRow key={`${b.kind}-${b.id}`} buyer={b} />
      ))}
    </div>
  );
}

// ── Partner cards (with embedded timeline) ───────────────────────────────────

function PartnerEvents({ events }) {
  if (!events || events.length === 0) {
    return (
      <div className="text-xs text-slate-500 italic p-3 bg-slate-50 rounded-md border border-slate-200">
        No events recorded for this partner yet.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {events.map((e, i) => {
        const meta = EVENT_COLORS[e.kind] || { dot: "bg-slate-400", text: "text-slate-700" };
        const label = EVENT_LABELS[e.kind] || e.kind;
        return (
          <div
            key={i}
            className="flex items-center gap-3 bg-white border border-slate-200 rounded-md px-3 py-2 text-sm"
          >
            <span className={`shrink-0 w-2 h-2 rounded-full ${meta.dot}`} />
            <span className="text-xs text-slate-500 w-24 shrink-0">{formatDate(e.date)}</span>
            <span className="flex-1 min-w-0">
              <span className={`font-medium ${meta.text}`}>{label}</span>
              {e.counterparty && (
                <span className="text-xs text-slate-500 ml-2">
                  {e.direction === "in" ? "from" : "to"}{" "}
                  <span className="font-medium text-slate-700">{e.counterparty}</span>
                </span>
              )}
              {e.description && (
                <div className="text-xs text-slate-500 italic mt-0.5 truncate">{e.description}</div>
              )}
            </span>
            <span
              className={`font-semibold tabular-nums shrink-0 ${
                e.direction === "in" ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {e.direction === "in" ? "+" : "−"}
              {formatCurrency(e.amount)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PartnerCard({ member }) {
  const [open, setOpen] = useState(false);
  const ownInvested = member.own_invested ?? member.advance_contributed ?? 0;
  const paidOut = member.all_paid_out ?? member.paid_for_pot ?? 0;
  const collected = member.collected_from_buyers ?? member.collected_for_pot ?? 0;
  const transferIn = member.transferred_in ?? 0;
  const transferOut = member.transferred_out ?? 0;
  const netHolding = member.net_holding ?? member.currently_holding ?? 0;
  const projShare = member.projected_share ?? 0;
  const settlement = member.settlement_balance ?? member.final_settlement ?? 0;

  // Net Outflow = own money out of pocket (advance + amounts paid from own funds)
  const netOutflow = ownInvested + Math.max(0, paidOut - collected);
  // Current Holding = net_holding (already accounts for collected - paid_out) + transfers
  const currentHolding = netHolding + transferIn - transferOut;

  const events = member.events || [];

  return (
    <div
      className={`rounded-xl border shadow-sm bg-white overflow-hidden ${
        member.is_self ? "border-blue-300 ring-1 ring-blue-200" : "border-slate-200"
      }`}
    >
      <div className="px-4 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-bold text-slate-900 truncate">{member.name}</h4>
              {member.is_self && (
                <span className="inline-flex text-[10px] font-semibold bg-blue-600 text-white px-1.5 py-0.5 rounded">
                  YOU
                </span>
              )}
              {member.share_percentage > 0 && (
                <span className="text-xs text-slate-500">{member.share_percentage}% share</span>
              )}
            </div>
            {member.partnership_title && (
              <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                {member.partnership_title}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-slate-100">
        <div className="bg-white p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-700">
            Net Outflow
          </div>
          <div className="text-base font-bold text-rose-900 mt-0.5">
            {formatCurrency(netOutflow)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">From their own pocket</div>
        </div>
        <div className="bg-white p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            Current Holding
          </div>
          <div
            className={`text-base font-bold mt-0.5 ${
              currentHolding > 0.5 ? "text-amber-700" : currentHolding < -0.5 ? "text-blue-700" : "text-slate-500"
            }`}
          >
            {formatCurrency(currentHolding)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {currentHolding > 0.5 ? "Pot money sitting with them" : currentHolding < -0.5 ? "Pot owes them this" : "Settled"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-slate-100 border-t border-slate-100">
        <div className="bg-white p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
            Profit Share
          </div>
          <div className="text-sm font-semibold text-indigo-900 mt-0.5">
            {formatCurrency(projShare)}
          </div>
        </div>
        <div className="bg-white p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            At Settlement
          </div>
          <div
            className={`text-sm font-bold mt-0.5 ${
              settlement > 0.5 ? "text-emerald-700" : settlement < -0.5 ? "text-rose-700" : "text-slate-500"
            }`}
          >
            {settlement > 0.5
              ? `+${formatCurrency(settlement)}`
              : settlement < -0.5
              ? formatCurrency(settlement)
              : "—"}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2 text-xs font-medium text-indigo-600 hover:bg-indigo-50 border-t border-slate-100 flex items-center justify-center gap-1"
      >
        <span className={`transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
        {open ? "Hide" : "Show"} Timeline ({events.length})
      </button>

      {open && (
        <div className="bg-slate-50 px-3 py-3 border-t border-slate-100">
          <PartnerEvents events={events} />
        </div>
      )}
    </div>
  );
}

function PartnersGrid({ members }) {
  if (!members || members.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic p-4 bg-slate-50 rounded-lg border border-slate-200">
        No partners on this property.
      </div>
    );
  }
  // Self first, then sort by descending share percentage
  const sorted = [...members].sort((a, b) => {
    if (a.is_self !== b.is_self) return a.is_self ? -1 : 1;
    return (b.share_percentage || 0) - (a.share_percentage || 0);
  });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {sorted.map((m, i) => (
        <PartnerCard key={`${m.member_id || m.name}-${i}`} member={m} />
      ))}
    </div>
  );
}

// ── Block (per-property) ─────────────────────────────────────────────────────

function PropertyBlock({ block }) {
  const linkTo = `/properties/${block.id}`;
  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Property
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
        <Link to={linkTo} className="text-sm text-indigo-600 hover:text-indigo-700 font-medium shrink-0">
          Open →
        </Link>
      </div>

      <div className="p-6 space-y-6">
        {block.buckets?.is_partial_projection && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            <span className="text-lg leading-none mt-0.5">⚠️</span>
            <div>
              <strong>Partial projection.</strong> Only{" "}
              {formatCurrency(block.buckets.registered_buyer_value)} of buyer value is registered
              against a seller cost of {formatCurrency(block.buckets.total_seller_value)}. Add
              remaining plot buyers for accurate profit projection.
            </div>
          </div>
        )}

        <AreaMetricsGroup buckets={block.buckets} />
        <FinancialMetricsGroup buckets={block.buckets} />

        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-2">
            Buyers ({block.buyers?.length || 0})
          </h4>
          <BuyersAccordion buyers={block.buyers} />
        </div>

        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-2">
            Partners ({block.members?.length || 0})
          </h4>
          <PartnersGrid members={block.members} />
        </div>
      </div>
    </section>
  );
}

// ── Property filter ──────────────────────────────────────────────────────────

function PropertyFilter({ options, selection, setSelection, allMode, setAllMode }) {
  const toggle = (id) => {
    setAllMode(false);
    setSelection((prev) => {
      const set = new Set(prev.propertyIds);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { propertyIds: Array.from(set) };
    });
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Choose Properties</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Selecting a property automatically pulls its plots and partners.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setAllMode(true);
              setSelection({ propertyIds: [] });
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              allMode
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            All Properties
          </button>
          {!allMode && selection.propertyIds.length > 0 && (
            <button
              onClick={() => setSelection({ propertyIds: [] })}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(options?.properties || []).map((p) => {
          const on = selection.propertyIds.includes(p.id);
          return (
            <button
              key={p.id}
              onClick={() => toggle(p.id)}
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
    </div>
  );
}

// ── Combined view (when multiple properties or All) ──────────────────────────

function CombinedSection({ combined, blockCount }) {
  if (!combined || blockCount < 2) return null;
  return (
    <section className="bg-gradient-to-br from-indigo-50 via-white to-purple-50 rounded-2xl border border-indigo-200 shadow-sm">
      <div className="px-6 py-4 border-b border-indigo-100">
        <div className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
          Aggregated across {blockCount} properties
        </div>
        <h2 className="text-lg font-bold text-slate-900">Combined Money Flow</h2>
      </div>
      <div className="p-6 space-y-6">
        <AreaMetricsGroup buckets={combined.buckets} />
        <FinancialMetricsGroup buckets={combined.buckets} />
      </div>
    </section>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function PropertyAnalytics() {
  const [allMode, setAllMode] = useState(true);
  const [selection, setSelection] = useState({ propertyIds: [] });

  const queryString = useMemo(
    () => buildScopeQuery({ ...selection, allMode }),
    [selection, allMode]
  );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["property-analytics", queryString],
    queryFn: async () => (await api.get(`/api/analytics/property?${queryString}`)).data,
    keepPreviousData: true,
  });

  const blocks = data?.blocks || [];
  const combined = data?.combined;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Property Analytics</h1>
          <p className="text-sm text-slate-600 mt-1">
            Pick a property to see its area, money flow, buyers, and per-partner positions in one place.
          </p>
        </div>

        <PropertyFilter
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
            Select one or more properties above to see the money flow.
          </div>
        )}

        <CombinedSection combined={combined} blockCount={blocks.length} />

        {blocks.map((b) => (
          <PropertyBlock key={`${b.kind}-${b.id}`} block={b} />
        ))}
      </div>
    </div>
  );
}
