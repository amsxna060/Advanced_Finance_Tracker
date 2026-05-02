import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

/* ── Constants ──────────────────────────────────────────────────────────── */

const ALL_SOURCES = [
  { value: "loan",        label: "Loan" },
  { value: "expense",     label: "Expense" },
  { value: "property",    label: "Property" },
  { value: "partnership", label: "Partnership" },
  { value: "obligation",  label: "Obligation" },
  { value: "beesi",       label: "Beesi" },
  { value: "transfer",    label: "Transfer" },
  { value: "manual",      label: "Manual" },
  { value: "unlinked",    label: "Unlinked ⚠" },
];

const SOURCE_BADGE = {
  loan:        "bg-blue-100 text-blue-700",
  expense:     "bg-orange-100 text-orange-700",
  property:    "bg-purple-100 text-purple-700",
  partnership: "bg-indigo-100 text-indigo-700",
  beesi:       "bg-pink-100 text-pink-700",
  obligation:  "bg-teal-100 text-teal-700",
  transfer:    "bg-sky-100 text-sky-700",
  manual:      "bg-slate-100 text-slate-500",
};

const DATE_PRESETS = [
  { label: "Today", days: 0 },
  { label: "7D",    days: 7 },
  { label: "30D",   days: 30 },
  { label: "3M",    days: 90 },
  { label: "6M",    days: 180 },
  { label: "1Y",    days: 365 },
];

const PAGE_SIZE = 100;

/* ── Source multi-select dropdown ───────────────────────────────────────── */

function SourceDropdown({ selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggle(value) {
    onChange((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  const label = selected.size === 0
    ? "All Sources"
    : selected.size === 1
      ? ALL_SOURCES.find((s) => selected.has(s.value))?.label ?? "1 source"
      : `${selected.size} sources`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
          selected.size > 0
            ? "border-indigo-400 bg-indigo-50 text-indigo-700"
            : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
        }`}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 4h18M7 8h10M11 12h6M13 16h4" />
        </svg>
        {label}
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 bg-white rounded-xl border border-slate-200 shadow-lg py-1.5 w-44">
          <button
            onClick={() => onChange(new Set())}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 font-medium"
          >
            Clear all
          </button>
          <div className="h-px bg-slate-100 my-1" />
          {ALL_SOURCES.map((s) => (
            <label key={s.value}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(s.value)}
                onChange={() => toggle(s.value)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              {s.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────────── */

export default function Reconciliation() {
  const [range, setRange] = useState(() => {
    const to   = new Date().toISOString().split("T")[0];
    const from = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    return { from_date: from, to_date: to };
  });
  const [accountId,     setAccountId]     = useState("");
  const [selectedSrcs,  setSelectedSrcs]  = useState(() => new Set());
  const [txnTypeFilter, setTxnTypeFilter] = useState("");
  const [search,        setSearch]        = useState("");
  const [showVoided,    setShowVoided]    = useState(false);
  const [page,          setPage]          = useState(1);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [range, accountId, selectedSrcs, txnTypeFilter, search, showVoided]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["reconciliation", range, accountId, showVoided],
    queryFn: async () => {
      const params = {
        from_date: range.from_date,
        to_date: range.to_date,
        include_voided: showVoided,
      };
      if (accountId) params.account_id = accountId;
      return (await api.get("/api/analytics/reconciliation", { params })).data;
    },
    placeholderData: (prev) => prev,
  });

  const qc = useQueryClient();

  const voidMutation = useMutation({
    mutationFn: (txnId) => api.delete(`/api/accounts/transactions/${txnId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reconciliation"] }),
  });

  const accounts = data?.accounts  || [];
  const ledger   = data?.ledger    || [];
  const summary  = data?.summary   || {};
  const opening  = data?.opening_balances || {};
  const closing  = data?.closing_balances || {};

  // Client-side filter — keeps server running_balance intact
  const filteredLedger = useMemo(() => {
    const q = search.toLowerCase();
    return ledger.filter((row) => {
      if (selectedSrcs.size > 0) {
        const effectiveSrc = row.is_unlinked ? "unlinked" : row.source;
        if (!selectedSrcs.has(effectiveSrc)) return false;
      }
      if (txnTypeFilter && row.type !== txnTypeFilter) return false;
      if (q && !row.description.toLowerCase().includes(q) &&
               !row.account.toLowerCase().includes(q) &&
               !(row.payment_mode || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [ledger, selectedSrcs, txnTypeFilter, search]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredLedger.length / PAGE_SIZE));
  const paginated  = useMemo(
    () => filteredLedger.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredLedger, page],
  );

  const selectedAcctName = useMemo(() => {
    if (!accountId) return "All Accounts";
    return accounts.find((a) => a.id === Number(accountId))?.name || "Unknown";
  }, [accountId, accounts]);

  function setPreset(days) {
    const to   = new Date().toISOString().split("T")[0];
    const from = days === 0
      ? to
      : new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
    setRange({ from_date: from, to_date: to });
  }

  const hasActiveFilter = selectedSrcs.size > 0 || txnTypeFilter || search;
  const voidedCount = summary.voided_count || 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reconciliation &amp; Ledger</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Verified audit trail · running balance · soft-void history
          </p>
        </div>

        {/* Controls */}
        <div className={`bg-white rounded-xl border border-slate-200 p-4 space-y-3 transition-opacity ${isFetching ? "opacity-70" : ""}`}>

          {/* Row 1: presets · date range · account · voided toggle */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setPreset(p.days)}
                  disabled={isFetching}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 transition-colors disabled:pointer-events-none"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input type="date" value={range.from_date}
                onChange={(e) => setRange((r) => ({ ...r, from_date: e.target.value }))}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
              <span className="text-slate-400 text-xs">to</span>
              <input type="date" value={range.to_date}
                onChange={(e) => setRange((r) => ({ ...r, to_date: e.target.value }))}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
            </div>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white">
              <option value="">All Accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
              ))}
            </select>

            {/* Voided toggle — far right */}
            <label className="ml-auto flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setShowVoided((v) => !v)}
                className={`relative w-9 h-5 rounded-full transition-colors ${showVoided ? "bg-rose-500" : "bg-slate-200"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${showVoided ? "translate-x-4" : ""}`} />
              </div>
              <span className={`text-xs font-medium ${showVoided ? "text-rose-700" : "text-slate-500"}`}>
                Show voided
                {voidedCount > 0 && showVoided && (
                  <span className="ml-1 bg-rose-100 text-rose-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">{voidedCount}</span>
                )}
              </span>
            </label>
          </div>

          {/* Row 2: source dropdown · credit/debit toggle · search · clear */}
          <div className="flex flex-wrap items-center gap-2">
            <SourceDropdown selected={selectedSrcs} onChange={setSelectedSrcs} />

            {/* Credit / Debit toggle */}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
              {[
                { val: "",       label: "All"     },
                { val: "credit", label: "Credits" },
                { val: "debit",  label: "Debits"  },
              ].map(({ val, label }) => (
                <button
                  key={val || "all"}
                  onClick={() => setTxnTypeFilter(val)}
                  className={`px-3 py-1.5 font-medium transition-colors ${
                    txnTypeFilter === val
                      ? val === "credit" ? "bg-emerald-500 text-white"
                        : val === "debit" ? "bg-rose-500 text-white"
                        : "bg-slate-700 text-white"
                      : "bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-44"
              />
              <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
            </div>

            {hasActiveFilter && (
              <button
                onClick={() => { setSelectedSrcs(new Set()); setTxnTypeFilter(""); setSearch(""); }}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                Clear filters ✕
              </button>
            )}

            {isFetching && (
              <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
                <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-indigo-500" />
                Updating…
              </div>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              <SummaryCard label="Credits (In)"
                value={formatCurrency(summary.total_credits)}
                color="text-emerald-700" bg="bg-emerald-50 border-emerald-200" />
              <SummaryCard label="Debits (Out)"
                value={formatCurrency(summary.total_debits)}
                color="text-rose-700" bg="bg-rose-50 border-rose-200" />
              <SummaryCard label="Net"
                value={formatCurrency(summary.net)}
                color={(summary.net ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}
                bg="bg-white border-slate-200" />
              <SummaryCard label="Transactions"
                value={summary.transaction_count ?? 0}
                color="text-slate-900" bg="bg-white border-slate-200" />
              <SummaryCard label="Unlinked"
                value={summary.unlinked_count ?? 0}
                color={(summary.unlinked_count ?? 0) > 0 ? "text-amber-700" : "text-slate-900"}
                bg={(summary.unlinked_count ?? 0) > 0 ? "bg-amber-50 border-amber-200" : "bg-white border-slate-200"} />
              <SummaryCard label="Voided"
                value={voidedCount}
                color={voidedCount > 0 ? "text-rose-600" : "text-slate-400"}
                bg={voidedCount > 0 ? "bg-rose-50 border-rose-200" : "bg-white border-slate-200"} />
            </div>

            {/* Opening / Closing Balances */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <BalanceBlock title="Opening Balance" balances={opening} accounts={accounts} />
              <BalanceBlock title="Closing Balance"  balances={closing} accounts={accounts} />
            </div>

            {/* Ledger Table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
                  Ledger — {selectedAcctName}
                </h2>
                <span className="text-xs text-slate-400">
                  {filteredLedger.length !== ledger.length
                    ? `${filteredLedger.length} of ${ledger.length} entries`
                    : `${ledger.length} entries`}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Account</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Description</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Source</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Mode</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-emerald-600 uppercase tracking-wide">Credit (In)</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-rose-600 uppercase tracking-wide">Debit (Out)</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Balance</th>
                      <th className="px-4 py-2.5 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginated.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                          {ledger.length > 0
                            ? "No transactions match the selected filters"
                            : "No transactions in this period"}
                        </td>
                      </tr>
                    ) : (
                      paginated.map((row) => (
                        <LedgerRow
                          key={row.id}
                          row={row}
                          onVoid={() => voidMutation.mutate(row.id)}
                          isVoiding={voidMutation.isPending && voidMutation.variables === row.id}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs text-slate-400">
                    Page {page} of {totalPages} · {filteredLedger.length} rows
                  </span>
                  <div className="flex items-center gap-1">
                    <PaginationBtn onClick={() => setPage(1)} disabled={page === 1}>«</PaginationBtn>
                    <PaginationBtn onClick={() => setPage((p) => p - 1)} disabled={page === 1}>‹</PaginationBtn>
                    {getPaginationRange(page, totalPages).map((p, i) =>
                      p === "…" ? (
                        <span key={`ellipsis-${i}`} className="px-1 text-xs text-slate-400">…</span>
                      ) : (
                        <PaginationBtn key={p} onClick={() => setPage(p)} active={page === p}>{p}</PaginationBtn>
                      )
                    )}
                    <PaginationBtn onClick={() => setPage((p) => p + 1)} disabled={page === totalPages}>›</PaginationBtn>
                    <PaginationBtn onClick={() => setPage(totalPages)} disabled={page === totalPages}>»</PaginationBtn>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── LedgerRow ──────────────────────────────────────────────────────────── */

function LedgerRow({ row, onVoid, isVoiding }) {
  const [confirmVoid, setConfirmVoid] = useState(false);
  const voided = row.is_voided;

  const rowClass = voided
    ? "bg-slate-50/80 opacity-60"
    : row.is_unlinked
      ? "bg-amber-50/30 hover:bg-amber-50/60"
      : "hover:bg-slate-50/80";

  const textClass = voided ? "line-through text-slate-400" : "";

  return (
    <tr className={`transition-colors ${rowClass}`}>
      <td className={`px-4 py-2.5 text-xs font-mono whitespace-nowrap ${voided ? "text-slate-400 line-through" : "text-slate-600"}`}>
        {row.date}
      </td>
      <td className={`px-4 py-2.5 text-xs max-w-[110px] truncate ${voided ? "text-slate-400" : "text-slate-700"}`}>
        {row.account}
      </td>
      <td className={`px-4 py-2.5 text-xs max-w-[220px] truncate ${voided ? "text-slate-400 line-through" : "text-slate-700"}`}
        title={row.description}>
        {voided && (
          <span className="mr-1.5 text-[9px] font-bold tracking-wide text-rose-500 bg-rose-50 border border-rose-200 rounded px-1 py-px uppercase">voided</span>
        )}
        {row.description || <span className="text-slate-300">—</span>}
      </td>
      <td className="px-4 py-2.5">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium capitalize ${
          row.is_unlinked
            ? "bg-amber-100 text-amber-700 border border-amber-200"
            : SOURCE_BADGE[row.source] || "bg-slate-100 text-slate-500"
        } ${voided ? "opacity-50" : ""}`}>
          {row.source || "unlinked"}
        </span>
        {row.is_unlinked && !voided && (
          <span className="ml-1 text-[10px] text-amber-500" title="No linked record">⚠</span>
        )}
      </td>
      <td className={`px-4 py-2.5 text-xs capitalize ${voided ? "text-slate-400" : "text-slate-500"}`}>
        {row.payment_mode || <span className="text-slate-300">—</span>}
      </td>

      {/* Credit (In) */}
      <td className="px-4 py-2.5 text-right text-xs tabular-nums">
        {row.type === "credit" ? (
          <span className={`font-semibold ${voided ? "text-slate-400 line-through" : "text-emerald-700"}`}>
            +{formatCurrency(row.amount)}
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>

      {/* Debit (Out) */}
      <td className="px-4 py-2.5 text-right text-xs tabular-nums">
        {row.type === "debit" ? (
          <span className={`font-semibold ${voided ? "text-slate-400 line-through" : "text-rose-700"}`}>
            −{formatCurrency(row.amount)}
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>

      {/* Running Balance */}
      <td className={`px-4 py-2.5 text-right text-xs font-semibold tabular-nums ${voided ? "text-slate-400" : "text-slate-800"}`}>
        {voided
          ? <span className="italic text-slate-300" title="Balance unaffected by voided transaction">—</span>
          : formatCurrency(row.running_balance)
        }
      </td>

      {/* Void action */}
      <td className="px-3 py-2.5 text-right">
        {!voided && (
          confirmVoid ? (
            <span className="flex items-center gap-1 justify-end">
              <button
                onClick={() => { onVoid(); setConfirmVoid(false); }}
                disabled={isVoiding}
                className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 border border-rose-300 text-rose-700 hover:bg-rose-200 transition font-medium"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmVoid(false)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-500 hover:bg-slate-200 transition"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmVoid(true)}
              className="opacity-0 group-hover:opacity-100 text-[10px] text-slate-300 hover:text-rose-500 transition-colors"
              title="Void this transaction"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </button>
          )
        )}
      </td>
    </tr>
  );
}

/* ── Pagination helpers ─────────────────────────────────────────────────── */

function getPaginationRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  if (current <= 4) {
    pages.push(1, 2, 3, 4, 5, "…", total);
  } else if (current >= total - 3) {
    pages.push(1, "…", total - 4, total - 3, total - 2, total - 1, total);
  } else {
    pages.push(1, "…", current - 1, current, current + 1, "…", total);
  }
  return pages;
}

function PaginationBtn({ children, onClick, disabled, active }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
        active
          ? "bg-indigo-600 text-white"
          : disabled
            ? "text-slate-300 cursor-not-allowed"
            : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

/* ── Sub Components ─────────────────────────────────────────────────────── */

function SummaryCard({ label, value, color, bg }) {
  return (
    <div className={`rounded-xl border p-4 ${bg}`}>
      <p className="text-xs text-slate-500 font-medium">{label}</p>
      <p className={`text-xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function BalanceBlock({ title, balances, accounts }) {
  const acctMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const entries = Object.entries(balances);
  const total   = entries.reduce((s, [, v]) => s + v, 0);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <span className="text-sm font-bold text-slate-900">{formatCurrency(total)}</span>
      </div>
      <div className="space-y-1.5">
        {entries.map(([id, bal]) => {
          const acct = acctMap[Number(id)];
          return (
            <div key={id} className="flex justify-between text-xs">
              <span className="text-slate-600">{acct?.name || `Account #${id}`}</span>
              <span className="font-medium text-slate-800">{formatCurrency(bal)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
