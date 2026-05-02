import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

const TXN_LABELS = {
  advance_to_seller: "Advance \u2192 Seller",
  payment_to_seller: "Payment \u2192 Seller",
  remaining_to_seller: "Remaining \u2192 Seller",
  received_from_buyer: "Received \u2190 Buyer",
  buyer_advance: "Buyer Advance",
  buyer_payment: "Buyer Payment",
  buyer_payment_received: "Buyer Payment",
  commission_paid: "Broker Commission",
  broker_commission: "Broker Commission",
  expense: "Expense",
  other_expense: "Other Expense",
  refund: "Refund",
  sale_proceeds: "Sale Proceeds",
  partner_transfer: "Partner Transfer",
  invested: "Invested",
  advance_given: "Advance Given",
  broker_paid: "Broker Paid",
};

const STATUS_BADGE = {
  payment_done:     { label: "Payment Done",     cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  fully_paid:       { label: "Fully Paid",        cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  registered:       { label: "Registered",        cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  registry_done:    { label: "Registry Done",     cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  sold:             { label: "Sold",              cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  advance_received: { label: "Advance Received",  cls: "bg-amber-50  text-amber-700  ring-amber-600/20"   },
  negotiating:      { label: "Negotiating",       cls: "bg-slate-50  text-slate-600  ring-slate-500/20"   },
  available:        { label: "Available",         cls: "bg-blue-50   text-blue-700   ring-blue-600/20"    },
};

function txnLabel(t) {
  return TXN_LABELS[t] || (t || "Other").replace(/_/g, " ");
}

function formatArea(sqft) {
  if (sqft == null) return "\u2014";
  return `${new Intl.NumberFormat("en-IN").format(Math.round(sqft))} sqft`;
}

function normalizeName(name) {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function aggregateSellerData(blocks) {
  const map = {};
  for (const block of blocks) {
    const rawName = block.seller_name || "Unknown Seller";
    const key = normalizeName(rawName);
    if (!map[key]) {
      map[key] = {
        name: rawName,
        advance_received: 0,
        remaining_received: 0,
        pending_balance: 0,
        total_value: 0,
        seller_events: [],
        property_titles: [],
      };
    }
    const s = map[key];
    const b = block.buckets || {};
    s.advance_received   += b.paid_to_seller_advance    || 0;
    s.remaining_received += b.paid_to_seller_additional || 0;
    s.pending_balance    += b.to_pay_to_seller          || 0;
    s.total_value        += b.total_seller_value        || 0;
    s.property_titles.push(block.title || block.label || "");
    for (const member of block.members || []) {
      for (const event of member.events || []) {
        if (event.kind === "paid_to_seller") {
          s.seller_events.push({ ...event, property: block.title });
        }
      }
    }
  }
  for (const s of Object.values(map)) {
    s.seller_events.sort((a, b) => (b.date || "") > (a.date || "") ? 1 : -1);
  }
  return Object.values(map);
}

function aggregatePartnerData(blocks) {
  const map = {};
  for (const block of blocks) {
    for (const member of block.members || []) {
      const key = normalizeName(member.name);
      if (!map[key]) {
        map[key] = {
          name: member.name,
          is_self: member.is_self,
          own_invested: 0,
          collected_from_buyers: 0,
          paid_to_seller: 0,
          transferred_out: 0,
          transferred_in: 0,
          current_holding: 0,
          events: [],
          property_titles: [],
        };
      }
      const p = map[key];
      p.is_self            = p.is_self || member.is_self;
      p.own_invested          += member.own_invested          || 0;
      p.collected_from_buyers += member.collected_from_buyers || 0;
      p.paid_to_seller        += member.paid_to_seller        || 0;
      p.transferred_out       += member.transferred_out       || 0;
      p.transferred_in        += member.transferred_in        || 0;
      p.current_holding       += member.current_holding       || 0;
      if (member.events?.length) p.events.push(...member.events);
      if (block.title) p.property_titles.push(block.title);
    }
  }
  return Object.values(map).sort((a, b) => {
    if (a.is_self !== b.is_self) return a.is_self ? -1 : 1;
    return (b.collected_from_buyers || 0) - (a.collected_from_buyers || 0);
  });
}

function StatusBadge({ status }) {
  if (!status) return null;
  const meta = STATUS_BADGE[status] || {
    label: status.replace(/_/g, " "),
    cls: "bg-slate-50 text-slate-600 ring-slate-500/20",
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset capitalize ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function Pill({ children }) {
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-semibold bg-slate-100 text-slate-600">
      {children}
    </span>
  );
}

function EventDot({ direction }) {
  return (
    <span className={`shrink-0 w-2.5 h-2.5 rounded-full mt-0.5 ${direction === "in" ? "bg-emerald-500" : "bg-rose-400"}`} />
  );
}

function ProgressBar({ value, total, color = "emerald" }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  const colorMap = { emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-400" };
  return (
    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div
        className={`h-full transition-all ${colorMap[color] || colorMap.emerald}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function SectionLabel({ children, extra }) {
  return (
    <div className="flex items-center gap-1 mb-3">
      <h4 className="text-sm font-semibold text-slate-700">{children}</h4>
      {extra}
    </div>
  );
}

function PropertySelector({ options, pending, setPending, onApply, isLoading }) {
  const properties = options?.properties || [];
  const toggle = (id) =>
    setPending((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Select Properties</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Choose one or more properties, then click Apply to load analytics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {properties.length > 0 && (
            <>
              <button
                onClick={() => setPending(properties.map((p) => p.id))}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                All
              </button>
              <button
                onClick={() => setPending([])}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Clear
              </button>
            </>
          )}
          <button
            onClick={onApply}
            disabled={pending.length === 0 || isLoading}
            className="px-5 py-1.5 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {isLoading ? "Loading\u2026" : "Apply"}
          </button>
        </div>
      </div>
      <div className="px-6 py-4">
        {properties.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No properties found.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {properties.map((p) => {
              const active = pending.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    active
                      ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                      : "bg-white text-slate-700 border-slate-300 hover:border-indigo-400 hover:text-indigo-700"
                  }`}
                >
                  {active && (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  )}
                  {p.title}
                  {p.status && (
                    <span className={`text-[9px] font-semibold uppercase tracking-wider ${active ? "text-indigo-200" : "text-slate-400"}`}>
                      {p.status}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AreaSection({ buckets }) {
  const total     = buckets.total_land_area || 0;
  const sold      = buckets.sold_area       || 0;
  const remaining = buckets.remaining_area  || 0;
  const pct       = total > 0 ? Math.min(100, (sold / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-slate-700">Area Overview</span>
        <span className="text-xs text-slate-400">{pct.toFixed(0)}% sold</span>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">Total Land</div>
          <div className="text-base font-bold text-slate-800 tabular-nums">{formatArea(total)}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 mb-0.5">Sold</div>
          <div className="text-base font-bold text-emerald-800 tabular-nums">{formatArea(sold)}</div>
          {total > 0 && <div className="text-[10px] text-slate-400 mt-0.5">{pct.toFixed(1)}%</div>}
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 mb-0.5">Remaining</div>
          <div className="text-base font-bold text-amber-800 tabular-nums">{formatArea(remaining)}</div>
          {total > 0 && <div className="text-[10px] text-slate-400 mt-0.5">{(100 - pct).toFixed(1)}%</div>}
        </div>
      </div>
      {total > 0 && (
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function MoneyFlowBar({ buckets }) {
  const paidToSeller = buckets.paid_to_seller ?? buckets.already_paid_out ?? 0;
  const metrics = [
    {
      label: "Collected from Buyers",
      value: formatCurrency(buckets.already_received),
      sub: null,
      accent: "emerald",
    },
    {
      label: "Buyers Still to Pay",
      value: formatCurrency(buckets.to_receive_from_buyers),
      sub: null,
      accent: "amber",
    },
    {
      label: "Total Paid to Seller",
      value: formatCurrency(paidToSeller),
      sub: buckets.paid_to_seller_advance > 0
        ? `Adv: ${formatCurrency(buckets.paid_to_seller_advance)}`
        : null,
      accent: "rose",
    },
    {
      label: "Remaining to Seller",
      value: formatCurrency(buckets.to_pay_to_seller),
      sub: null,
      accent: "red",
    },
    {
      label: "Partner Capital",
      value: formatCurrency(buckets.partner_advances),
      sub: null,
      accent: "purple",
    },
  ];
  const accentMap = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber:   "border-amber-200  bg-amber-50  text-amber-800",
    rose:    "border-rose-200   bg-rose-50   text-rose-800",
    red:     "border-red-200    bg-red-50    text-red-800",
    purple:  "border-purple-200 bg-purple-50 text-purple-800",
  };
  const labelMap = {
    emerald: "text-emerald-600",
    amber:   "text-amber-600",
    rose:    "text-rose-600",
    red:     "text-red-600",
    purple:  "text-purple-600",
  };
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {metrics.map((m) => (
        <div key={m.label} className={`rounded-xl border p-4 shadow-sm ${accentMap[m.accent]}`}>
          <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${labelMap[m.accent]}`}>{m.label}</div>
          <div className="text-base font-bold tabular-nums">{m.value}</div>
          {m.sub && <div className={`text-[10px] mt-1 ${labelMap[m.accent]}`}>{m.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function SellerCard({ seller, isMultiProperty }) {
  const [open, setOpen] = useState(false);
  const totalPaid = seller.advance_received + seller.remaining_received;
  const pct = seller.total_value > 0 ? Math.min(100, (totalPaid / seller.total_value) * 100) : 0;
  return (
    <div className="rounded-2xl border border-rose-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-rose-100 bg-rose-50/50">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="font-bold text-slate-900 truncate">{seller.name}</div>
              <div className="text-[10px] text-rose-600 font-semibold uppercase tracking-wider mt-0.5">Seller</div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Total Deal</div>
            <div className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(seller.total_value)}</div>
            <div className="text-[10px] text-slate-400">{pct.toFixed(0)}% paid</div>
          </div>
        </div>
        {isMultiProperty && seller.property_titles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {seller.property_titles.map((t, i) => (
              <span key={i} className="text-[10px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">{t}</span>
            ))}
          </div>
        )}
      </div>
      <div className="px-5 pt-3">
        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
          <span>Payment progress</span>
          <span>{formatCurrency(totalPaid)} of {formatCurrency(seller.total_value)}</span>
        </div>
        <ProgressBar value={totalPaid} total={seller.total_value} color={pct >= 100 ? "emerald" : pct >= 50 ? "amber" : "rose"} />
      </div>
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 mt-4">
        <div className="px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-600 mb-1">Advance Received</div>
          <div className="text-sm font-bold text-rose-800 tabular-nums">{formatCurrency(seller.advance_received)}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Initial token paid</div>
        </div>
        <div className="px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-600 mb-1">Further Payments</div>
          <div className="text-sm font-bold text-rose-800 tabular-nums">{formatCurrency(seller.remaining_received)}</div>
          {seller.seller_events.length > 0 && (
            <div className="text-[10px] text-slate-400 mt-0.5">
              {seller.seller_events.length} payment{seller.seller_events.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
        <div className="px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 mb-1">Pending Balance</div>
          <div className={`text-sm font-bold tabular-nums ${seller.pending_balance > 0 ? "text-amber-800" : "text-emerald-700"}`}>
            {formatCurrency(seller.pending_balance)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {seller.pending_balance > 0 ? "Still owed" : "Fully settled"}
          </div>
        </div>
      </div>
      {seller.seller_events.length > 0 && (
        <>
          <div className="border-t border-slate-100">
            <button
              onClick={() => setOpen((v) => !v)}
              className="w-full px-5 py-2.5 text-xs font-medium text-rose-600 hover:bg-rose-50/60 flex items-center justify-between transition-colors"
            >
              <span>Payment history ({seller.seller_events.length})</span>
              <svg className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
          </div>
          {open && (
            <div className="px-5 py-3 bg-slate-50/60 border-t border-slate-100">
              {seller.seller_events.map((e, i) => (
                <div key={i} className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
                  <EventDot direction="out" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-rose-700 tabular-nums">{formatCurrency(e.amount)}</span>
                      {e.payment_mode && <Pill>{e.payment_mode}</Pill>}
                      {isMultiProperty && e.property && (
                        <span className="text-[10px] text-indigo-600 font-medium bg-indigo-50 px-1.5 py-0.5 rounded">{e.property}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{formatDate(e.date)}</div>
                    {e.description && (
                      <div className="text-[10px] text-slate-400 italic mt-0.5 truncate">{e.description}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PartnerTimeline({ events }) {
  if (!events?.length) {
    return <div className="text-xs text-slate-400 italic py-3 text-center">No events recorded.</div>;
  }
  return (
    <div>
      {events.map((e, i) => (
        <div key={i} className="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
          <EventDot direction={e.direction} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-bold tabular-nums ${e.direction === "in" ? "text-emerald-700" : "text-rose-700"}`}>
                {e.direction === "in" ? "+" : "\u2212"}{formatCurrency(e.amount)}
              </span>
              <span className="text-[11px] text-slate-600">{txnLabel(e.type)}</span>
              {e.payment_mode && <Pill>{e.payment_mode}</Pill>}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>{formatDate(e.date)}</span>
              {e.counterparty && (
                <span className="text-slate-500">
                  {e.direction === "in" ? "from" : "to"} <strong>{e.counterparty}</strong>
                </span>
              )}
            </div>
            {e.description && (
              <div className="text-[10px] text-slate-400 italic mt-0.5 truncate">{e.description}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function PartnerCard({ member, isMultiProperty }) {
  const [open, setOpen] = useState(false);
  const hasEvents = (member.events?.length ?? 0) > 0;
  return (
    <div className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${member.is_self ? "border-indigo-300 ring-2 ring-indigo-100" : "border-slate-200"}`}>
      <div className={`px-5 py-4 border-b ${member.is_self ? "bg-indigo-50/60 border-indigo-100" : "bg-slate-50/60 border-slate-100"}`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${member.is_self ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-600"}`}>
            {(member.name || "?")[0].toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-slate-900 truncate">{member.name}</span>
              {member.is_self && (
                <span className="text-[9px] font-bold bg-indigo-600 text-white px-1.5 py-0.5 rounded uppercase tracking-wider">You</span>
              )}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wider font-medium">Partner</div>
          </div>
        </div>
        {isMultiProperty && member.property_titles?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {[...new Set(member.property_titles)].map((t, i) => (
              <span key={i} className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{t}</span>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 border-b border-slate-100">
        <div className="px-4 py-3.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-purple-600 mb-1">Advance Given</div>
          <div className="text-sm font-bold text-purple-900 tabular-nums">{formatCurrency(member.own_invested)}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Capital from their pocket</div>
        </div>
        <div className="px-4 py-3.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 mb-1">Current Holding</div>
          <div className={`text-sm font-bold tabular-nums ${member.current_holding > 0.5 ? "text-amber-700" : member.current_holding < -0.5 ? "text-blue-700" : "text-slate-400"}`}>
            {formatCurrency(member.current_holding)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {member.current_holding > 0.5 ? "Pot money with them" : member.current_holding < -0.5 ? "Pot owes them" : "Settled"}
          </div>
        </div>
        <div className="px-4 py-3.5">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Collected from Buyers</div>
          </div>
          <div className="text-sm font-bold text-emerald-800 tabular-nums">{formatCurrency(member.collected_from_buyers)}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Inflow they received</div>
        </div>
        <div className="px-4 py-3.5">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
            <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-600">Sent to Seller</div>
          </div>
          <div className="text-sm font-bold text-rose-800 tabular-nums">{formatCurrency(member.paid_to_seller)}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Outflow to seller</div>
        </div>
      </div>
      <div className="px-4 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
          <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-600">Transferred to Partners</div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] text-slate-400 mb-0.5">Sent out</div>
            <div className="text-sm font-bold text-violet-800 tabular-nums">{formatCurrency(member.transferred_out)}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400 mb-0.5">Received in</div>
            <div className="text-sm font-bold text-violet-800 tabular-nums">{formatCurrency(member.transferred_in)}</div>
          </div>
        </div>
      </div>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={!hasEvents}
        className={`w-full px-5 py-2.5 text-xs font-medium flex items-center justify-between transition-colors ${hasEvents ? "text-indigo-600 hover:bg-indigo-50/50 cursor-pointer" : "text-slate-300 cursor-default"}`}
      >
        <span>{hasEvents ? `Transaction history (${member.events.length})` : "No transactions recorded"}</span>
        {hasEvents && (
          <svg className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        )}
      </button>
      {open && (
        <div className="px-5 py-3 bg-slate-50/60 border-t border-slate-100">
          <PartnerTimeline events={member.events} />
        </div>
      )}
    </div>
  );
}

function BuyerTransactionsTable({ txns }) {
  if (!txns?.length) {
    return <div className="text-xs text-slate-400 italic px-4 py-3">No transactions recorded.</div>;
  }
  return (
    <div className="overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <th className="text-left font-semibold px-4 py-2 w-28">Date</th>
            <th className="text-right font-semibold px-3 py-2 w-32">Amount</th>
            <th className="text-left font-semibold px-3 py-2">Type</th>
            <th className="text-left font-semibold px-3 py-2 w-36">Received By</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {txns.map((t, i) => (
            <tr key={i} className="hover:bg-white/60">
              <td className="px-4 py-2.5 text-slate-600 tabular-nums whitespace-nowrap">{formatDate(t.date)}</td>
              <td className="px-3 py-2.5 text-right font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                +{formatCurrency(t.amount)}
              </td>
              <td className="px-3 py-2.5 text-slate-700">
                <div className="font-medium text-slate-800">{txnLabel(t.type)}</div>
                {(t.description || t.payment_mode) && (
                  <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    {t.description && <span className="italic">{t.description}</span>}
                    {t.payment_mode && <Pill>{t.payment_mode}</Pill>}
                  </div>
                )}
              </td>
              <td className="px-3 py-2.5 text-slate-700">
                {t.received_by ? <span className="font-medium">{t.received_by}</span> : <span className="text-slate-300">\u2014</span>}
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
  const txns    = buyer.transactions || [];
  const hasTxns = txns.length > 0;
  const paidPct = buyer.total_value > 0 ? (buyer.paid / buyer.total_value) : 0;
  const barColor = paidPct >= 1 ? "emerald" : paidPct >= 0.5 ? "amber" : "rose";
  return (
    <>
      <tr
        className={`group transition-colors ${hasTxns ? "cursor-pointer hover:bg-slate-50/70" : ""} ${open ? "bg-slate-50/70" : ""}`}
        onClick={() => hasTxns && setOpen((v) => !v)}
      >
        <td className="px-4 py-3 align-middle w-8">
          <svg
            className={`w-3.5 h-3.5 transition-all ${open ? "rotate-90 text-slate-500" : "text-slate-300 group-hover:text-slate-500"} ${!hasTxns ? "opacity-20" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </td>
        <td className="px-3 py-3 align-middle">
          <div className="font-semibold text-slate-900 text-sm">{buyer.name}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {formatArea(buyer.area_sqft)}
            {buyer.rate_per_sqft > 0 && (
              <span className="text-slate-300"> \u00b7 \u20b9{buyer.rate_per_sqft.toLocaleString("en-IN")}/sqft</span>
            )}
          </div>
        </td>
        <td className="px-3 py-3 text-right align-middle tabular-nums whitespace-nowrap">
          <div className="text-sm font-semibold text-slate-800">{formatCurrency(buyer.total_value)}</div>
        </td>
        <td className="px-3 py-3 align-middle min-w-[90px]">
          <div className="text-sm font-semibold text-emerald-700 text-right tabular-nums">{formatCurrency(buyer.paid)}</div>
          <div className="mt-1"><ProgressBar value={buyer.paid} total={buyer.total_value} color={barColor} /></div>
        </td>
        <td className="px-3 py-3 text-right align-middle tabular-nums whitespace-nowrap">
          <div className={`text-sm font-semibold ${buyer.outstanding > 0 ? "text-amber-700" : "text-slate-300"}`}>
            {formatCurrency(buyer.outstanding)}
          </div>
        </td>
        <td className="px-3 py-3 align-middle whitespace-nowrap">
          <StatusBadge status={buyer.status} />
        </td>
        <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
          <span className="text-[11px] text-slate-400">
            {hasTxns ? `${txns.length} txn${txns.length !== 1 ? "s" : ""}` : "\u2014"}
          </span>
        </td>
      </tr>
      {open && hasTxns && (
        <tr className="bg-slate-50/40">
          <td colSpan={7} className="p-0">
            <div className="border-t border-slate-100"><BuyerTransactionsTable txns={txns} /></div>
          </td>
        </tr>
      )}
    </>
  );
}

function BuyersSection({ buyers }) {
  if (!buyers?.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400 italic">
        No buyers registered yet.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">
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
            {buyers.map((b) => <BuyerRow key={`${b.kind}-${b.id}`} buyer={b} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PropertyBlock({ block }) {
  const sellers  = useMemo(() => aggregateSellerData([block]),  [block]);
  const partners = useMemo(() => aggregatePartnerData([block]), [block]);
  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Property</span>
            {block.status && (
              <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full capitalize">{block.status}</span>
            )}
          </div>
          <h3 className="text-lg font-bold text-slate-900">{block.title || block.label}</h3>
          {block.seller_name && (
            <div className="text-xs text-slate-500 mt-0.5">
              Seller: <span className="font-medium text-slate-700">{block.seller_name}</span>
            </div>
          )}
        </div>
        <Link
          to={`/properties/${block.id}`}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-800 shrink-0 flex items-center gap-1"
        >
          Open
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </Link>
      </div>
      <div className="p-6 space-y-8">
        {block.buckets?.is_partial_projection && (
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            <span className="text-base leading-none mt-0.5">\u26a0\ufe0f</span>
            <div>
              <strong>Partial data.</strong> Only {formatCurrency(block.buckets.registered_buyer_value)} of buyer
              value is registered against seller cost of {formatCurrency(block.buckets.total_seller_value)}.
            </div>
          </div>
        )}
        <div>
          <SectionLabel>Money Flow</SectionLabel>
          <MoneyFlowBar buckets={block.buckets} />
        </div>
        {(block.buckets?.total_land_area > 0) && (
          <div>
            <SectionLabel>Area</SectionLabel>
            <AreaSection buckets={block.buckets} />
          </div>
        )}
        {sellers.length > 0 && (
          <div>
            <SectionLabel>Seller</SectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sellers.map((s, i) => <SellerCard key={i} seller={s} isMultiProperty={false} />)}
            </div>
          </div>
        )}
        <div>
          <SectionLabel extra={<span className="text-slate-400 text-xs font-normal">({block.buyers?.length || 0})</span>}>
            Buyers
          </SectionLabel>
          <BuyersSection buyers={block.buyers} />
        </div>
        {partners.length > 0 && (
          <div>
            <SectionLabel extra={<span className="text-slate-400 text-xs font-normal">({partners.length})</span>}>
              Partners
            </SectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {partners.map((m, i) => (
                <PartnerCard key={`${m.name}-${i}`} member={m} isMultiProperty={false} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function CombinedView({ blocks, combined }) {
  const sellers  = useMemo(() => aggregateSellerData(blocks),  [blocks]);
  const partners = useMemo(() => aggregatePartnerData(blocks), [blocks]);
  return (
    <section className="bg-gradient-to-br from-indigo-50/80 via-white to-purple-50/60 rounded-2xl border border-indigo-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-indigo-100 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 mb-0.5">
            Combined \u00b7 {blocks.length} properties
          </div>
          <h2 className="text-lg font-bold text-slate-900">Aggregated Overview</h2>
        </div>
        <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center">
          <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
          </svg>
        </div>
      </div>
      <div className="p-6 space-y-8">
        <div>
          <SectionLabel>Money Flow</SectionLabel>
          <MoneyFlowBar buckets={combined?.buckets || {}} />
        </div>
        {(combined?.buckets?.total_land_area > 0) && (
          <div>
            <SectionLabel>Area</SectionLabel>
            <AreaSection buckets={combined.buckets} />
          </div>
        )}
        {sellers.length > 0 && (
          <div>
            <SectionLabel extra={<span className="ml-2 text-[10px] font-medium text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">{sellers.length} unique</span>}>
              Sellers
            </SectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sellers.map((s, i) => <SellerCard key={i} seller={s} isMultiProperty />)}
            </div>
          </div>
        )}
        {partners.length > 0 && (
          <div>
            <SectionLabel extra={<span className="ml-2 text-[10px] font-medium text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">{partners.length} unique</span>}>
              Partners
            </SectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {partners.map((m, i) => (
                <PartnerCard key={`${m.name}-${i}`} member={m} isMultiProperty />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default function PropertyAnalytics() {
  const [pendingIds, setPendingIds] = useState([]);
  const [appliedIds, setAppliedIds] = useState(null);

  const queryString = useMemo(() => {
    if (!appliedIds?.length) return "";
    const p = new URLSearchParams();
    appliedIds.forEach((id) => p.append("property_ids", id));
    return p.toString();
  }, [appliedIds]);

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ["property-analytics", queryString],
    queryFn: async () => (await api.get(`/api/analytics/property?${queryString}`)).data,
    enabled: !!queryString,
    keepPreviousData: true,
    staleTime: 30_000,
  });

  const { data: optionsData } = useQuery({
    queryKey: ["property-analytics-options"],
    queryFn: async () => (await api.get("/api/analytics/property?scope=none")).data,
    staleTime: 60_000,
    retry: false,
  });

  const options  = data?.options  || optionsData?.options;
  const blocks   = data?.blocks   || [];
  const combined = data?.combined;
  const isMulti  = blocks.length > 1;

  const handleApply = useCallback(() => {
    if (pendingIds.length > 0) setAppliedIds([...pendingIds]);
  }, [pendingIds]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Property Analytics</h1>
            <p className="text-sm text-slate-500 mt-1">
              Select properties to analyse money flow, sellers, buyers, and partner positions.
            </p>
          </div>
          {appliedIds?.length > 0 && !isFetching && blocks.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              {blocks.length} propert{blocks.length !== 1 ? "ies" : "y"} loaded
            </div>
          )}
        </div>

        <PropertySelector
          options={options}
          pending={pendingIds}
          setPending={setPendingIds}
          onApply={handleApply}
          isLoading={isFetching}
        />

        {isFetching && (
          <div className="flex items-center justify-center gap-3 py-16 bg-white rounded-2xl border border-slate-200">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-indigo-600" />
            <span className="text-sm text-slate-500">Calculating money flow\u2026</span>
          </div>
        )}

        {isError && !isFetching && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-5 text-sm flex items-start gap-3">
            <svg className="w-5 h-5 shrink-0 mt-0.5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <div>
              <strong>Failed to load analytics</strong>
              <div className="mt-0.5 text-rose-700">{error?.message || "Unknown error"}</div>
            </div>
          </div>
        )}

        {!appliedIds && !isFetching && (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-2xl border border-dashed border-slate-200">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-slate-700">No properties selected</p>
            <p className="text-xs text-slate-400 mt-1">Select one or more properties above, then click <strong>Apply</strong>.</p>
          </div>
        )}

        {appliedIds && !isFetching && !isError && blocks.length === 0 && (
          <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-10 text-center text-slate-400 text-sm">
            No data found for the selected properties.
          </div>
        )}

        {!isFetching && !isError && blocks.length > 0 && (
          <div className="space-y-6">
            {isMulti && <CombinedView blocks={blocks} combined={combined} />}
            {blocks.map((b) => <PropertyBlock key={`${b.kind}-${b.id}`} block={b} />)}
          </div>
        )}
      </div>
    </div>
  );
}
