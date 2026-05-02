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

function PaidToSellerCard({ buckets }) {
  const total = buckets.paid_to_seller ?? buckets.already_paid_out ?? 0;
  const advance = buckets.paid_to_seller_advance ?? 0;
  const additional = buckets.paid_to_seller_additional ?? 0;
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-700">
          Paid to Seller
        </span>
        <span className="text-xl">💸</span>
      </div>
      <div className="text-xl font-bold text-rose-900">{formatCurrency(total)}</div>
      <div className="text-[11px] text-rose-700/80 mt-1.5 flex items-center gap-1.5 flex-wrap">
        <span>
          Advance: <span className="font-semibold">{formatCurrency(advance)}</span>
        </span>
        <span className="text-rose-300">|</span>
        <span>
          Additional: <span className="font-semibold">{formatCurrency(additional)}</span>
        </span>
      </div>
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
        <PaidToSellerCard buckets={buckets} />
        <SummaryCard
          title="Remaining to Pay Seller"
          value={formatCurrency(buckets.to_pay_to_seller)}
          sub="Outstanding to seller"
          icon="📤"
          color={{ border: "border-red-200", bg: "bg-red-50", label: "text-red-700", amount: "text-red-900" }}
        />
      </div>
    </div>
  );
}

// ── Buyers (SaaS-style data table with expandable rows) ──────────────────────

const STATUS_BADGE = {
  payment_done: { label: "Payment Done", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  fully_paid: { label: "Fully Paid", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  registered: { label: "Registered", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  registry_done: { label: "Registry Done", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  sold: { label: "Sold", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  advance_received: { label: "Advance Received", cls: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  negotiating: { label: "Negotiating", cls: "bg-slate-50 text-slate-700 ring-slate-500/20" },
  available: { label: "Available", cls: "bg-blue-50 text-blue-700 ring-blue-600/20" },
};

function StatusBadge({ status }) {
  if (!status) return null;
  const meta = STATUS_BADGE[status] || {
    label: status.replace(/_/g, " "),
    cls: "bg-slate-50 text-slate-700 ring-slate-500/20",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset capitalize ${meta.cls}`}
    >
      {meta.label}
    </span>
  );
}

function ProgressBar({ value, total }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
      <div
        className={`h-full transition-all ${
          pct >= 100 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-400"
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function BuyerTransactionsTable({ txns }) {
  if (!txns || txns.length === 0) {
    return (
      <div className="text-xs text-slate-500 italic px-4 py-3">
        No transactions recorded for this buyer.
      </div>
    );
  }
  return (
    <div className="overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-100/60 text-[10px] uppercase tracking-wider text-slate-500">
            <th className="text-left font-semibold px-4 py-2 w-28">Date</th>
            <th className="text-right font-semibold px-3 py-2 w-32">Amount</th>
            <th className="text-left font-semibold px-3 py-2">Notes</th>
            <th className="text-left font-semibold px-3 py-2 w-40">Partner</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200/70">
          {txns.map((t, i) => (
            <tr key={i} className="hover:bg-white/60">
              <td className="px-4 py-2.5 text-slate-700 tabular-nums whitespace-nowrap">
                {formatDate(t.date)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                +{formatCurrency(t.amount)}
              </td>
              <td className="px-3 py-2.5 text-slate-700">
                <div className="font-medium text-slate-800">{txnLabel(t.type)}</div>
                {(t.description || t.payment_mode) && (
                  <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    {t.description && <span className="italic">{t.description}</span>}
                    {t.payment_mode && (
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 bg-slate-100 text-slate-600 uppercase text-[9px] tracking-wider font-medium">
                        {t.payment_mode}
                      </span>
                    )}
                  </div>
                )}
              </td>
              <td className="px-3 py-2.5 text-slate-700">
                {t.received_by ? (
                  <span className="font-medium text-slate-800">{t.received_by}</span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BuyerRow({ buyer }) {
  const [open, setOpen] = useState(false);
  const txns = buyer.transactions || [];
  const hasTxns = txns.length > 0;

  return (
    <>
      <tr
        className={`group transition-colors ${
          hasTxns ? "cursor-pointer hover:bg-slate-50/70" : ""
        } ${open ? "bg-slate-50/70" : ""}`}
        onClick={() => hasTxns && setOpen((v) => !v)}
      >
        <td className="px-4 py-3 align-middle w-8">
          <span
            className={`inline-block text-slate-400 transition-transform duration-150 ${
              open ? "rotate-90" : ""
            } ${hasTxns ? "group-hover:text-slate-600" : "opacity-20"}`}
          >
            ▸
          </span>
        </td>
        <td className="px-3 py-3 align-middle">
          <div className="font-medium text-slate-900 text-sm">{buyer.name}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {formatArea(buyer.area_sqft)}
            {buyer.rate_per_sqft > 0 && (
              <span className="text-slate-400"> · ₹{buyer.rate_per_sqft.toLocaleString("en-IN")}/sqft</span>
            )}
          </div>
        </td>
        <td className="px-3 py-3 text-right align-middle tabular-nums whitespace-nowrap">
          <div className="text-sm font-semibold text-slate-900">
            {formatCurrency(buyer.total_value)}
          </div>
        </td>
        <td className="px-3 py-3 text-right align-middle tabular-nums whitespace-nowrap">
          <div className="text-sm font-semibold text-emerald-700">
            {formatCurrency(buyer.paid)}
          </div>
          <div className="mt-1 max-w-[100px] ml-auto">
            <ProgressBar value={buyer.paid} total={buyer.total_value} />
          </div>
        </td>
        <td className="px-3 py-3 text-right align-middle tabular-nums whitespace-nowrap">
          <div
            className={`text-sm font-semibold ${
              buyer.outstanding > 0 ? "text-amber-700" : "text-slate-400"
            }`}
          >
            {formatCurrency(buyer.outstanding)}
          </div>
        </td>
        <td className="px-3 py-3 align-middle whitespace-nowrap">
          <StatusBadge status={buyer.status} />
        </td>
        <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
          <span className="text-[11px] text-slate-400">
            {hasTxns ? `${txns.length} txn${txns.length === 1 ? "" : "s"}` : "—"}
          </span>
        </td>
      </tr>
      {open && hasTxns && (
        <tr className="bg-slate-50/40">
          <td colSpan={7} className="p-0">
            <div className="border-t border-slate-200">
              <BuyerTransactionsTable txns={txns} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function BuyersAccordion({ buyers }) {
  if (!buyers || buyers.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic p-6 bg-white rounded-xl border border-dashed border-slate-300 text-center">
        No buyers registered yet.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50/70 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5 w-8" />
              <th className="px-3 py-2.5 text-left font-semibold">Buyer</th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">Total Value</th>
              <th className="px-3 py-2.5 text-right font-semibold">Paid</th>
              <th className="px-3 py-2.5 text-right font-semibold">Outstanding</th>
              <th className="px-3 py-2.5 text-left font-semibold">Status</th>
              <th className="px-4 py-2.5 text-right font-semibold w-20">Activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {buyers.map((b) => (
              <BuyerRow key={`${b.kind}-${b.id}`} buyer={b} />
            ))}
          </tbody>
        </table>
      </div>
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
  // Advance Given = capital they put in (just advance_contributed; never doubled with txns)
  const advanceGiven = member.own_invested ?? member.advance_contributed ?? 0;
  // Current Holding (per spec):
  //   collected from buyers + received from partners − sent to partners − paid to seller
  const currentHolding =
    member.current_holding ??
    ((member.collected_from_buyers ?? member.collected_for_pot ?? 0) +
      (member.transferred_in ?? 0) -
      (member.transferred_out ?? 0) -
      (member.paid_to_seller ?? 0));

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
          <div className="text-[10px] font-semibold uppercase tracking-wider text-purple-700">
            Advance Given
          </div>
          <div className="text-base font-bold text-purple-900 mt-0.5">
            {formatCurrency(advanceGiven)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Capital from their pocket</div>
        </div>
        <div className="bg-white p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            Current Holding
          </div>
          <div
            className={`text-base font-bold mt-0.5 ${
              currentHolding > 0.5
                ? "text-amber-700"
                : currentHolding < -0.5
                ? "text-blue-700"
                : "text-slate-500"
            }`}
          >
            {formatCurrency(currentHolding)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {currentHolding > 0.5
              ? "Pot money sitting with them"
              : currentHolding < -0.5
              ? "They owe the pot"
              : "Settled"}
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
