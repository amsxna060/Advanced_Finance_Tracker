import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";
import {
  PageHero,
  HeroStat,
  PageBody,
  Button,
  Badge,
  Select,
  Input,
  SearchInput,
  EmptyState,
} from "../../components/ui";

const ACTION_META = {
  create: { variant: "success", label: "Created" },
  update: { variant: "info", label: "Updated" },
  delete: { variant: "danger", label: "Deleted" },
  void: { variant: "warning", label: "Voided" },
  login: { variant: "purple", label: "Login" },
  logout: { variant: "purple", label: "Logout" },
};

const MODULE_LABELS = {
  loans: "Loans",
  contacts: "Contacts",
  accounts: "Accounts",
  obligations: "Money Flow",
  properties: "Properties",
  partnerships: "Partnerships",
  expenses: "Expenses",
  beesi: "Beesi",
  forecast: "Forecast",
  assets: "Assets",
  auth: "Auth",
  other: "Other",
};

const defaultFilters = {
  module: "",
  action: "",
  account_id: "",
  date_from: "",
  date_to: "",
};

function formatTimestamp(iso) {
  if (!iso) return "-";
  try {
    return format(parseISO(iso), "dd MMM yyyy · hh:mm:ss a");
  } catch {
    return iso;
  }
}

function formatFieldValue(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (v === true) return "Yes";
  if (v === false) return "No";
  return String(v);
}

// Where does clicking this log entry take you?
function entityLink(log) {
  const t = log.entity_type;
  if (t === "loans" && log.entity_id) return `/loans/${log.entity_id}`;
  if ((t === "loan_payments" || t === "loan_capitalization_events" || t === "collaterals") && log.loan_id)
    return `/loans/${log.loan_id}`;
  if (t === "contacts" && log.entity_id) return `/contacts/${log.entity_id}`;
  if (t === "cash_accounts" && log.entity_id) return `/accounts/${log.entity_id}`;
  if (t === "account_transactions" && log.account_id) return `/accounts/${log.account_id}`;
  if (t === "property_deals" && log.entity_id) return `/properties/${log.entity_id}`;
  if (t === "partnerships" && log.entity_id) return `/partnerships/${log.entity_id}`;
  if (t === "beesi" && log.entity_id) return `/beesi/${log.entity_id}`;
  if (log.module === "obligations") return "/obligations";
  if (log.module === "expenses") return "/expenses";
  return null;
}

function ChangesTable({ changes, action }) {
  if (!changes || Object.keys(changes).length === 0) {
    return <p className="text-xs text-slate-400 italic">No field details recorded.</p>;
  }
  const isDiff = action === "update" || action === "void";
  const entries = Object.entries(changes);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-400 uppercase tracking-wider">
            <th className="py-1.5 pr-4 font-semibold">Field</th>
            {isDiff ? (
              <>
                <th className="py-1.5 pr-4 font-semibold">Before</th>
                <th className="py-1.5 pr-4 font-semibold" />
                <th className="py-1.5 font-semibold">After</th>
              </>
            ) : (
              <th className="py-1.5 font-semibold">Value</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {entries.map(([field, val]) => (
            <tr key={field}>
              <td className="py-1.5 pr-4 font-medium text-slate-600 whitespace-nowrap">
                {field}
              </td>
              {isDiff ? (
                <>
                  <td className="py-1.5 pr-4 text-rose-600/80 break-all">
                    {formatFieldValue(val?.old)}
                  </td>
                  <td className="py-1.5 pr-4 text-slate-300">→</td>
                  <td className="py-1.5 text-emerald-700 break-all">
                    {formatFieldValue(val?.new)}
                  </td>
                </>
              ) : (
                <td className="py-1.5 text-slate-700 break-all">
                  {formatFieldValue(val)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogRow({ log }) {
  const [expanded, setExpanded] = useState(false);
  const meta = ACTION_META[log.action] || { variant: "default", label: log.action };
  const link = entityLink(log);

  return (
    <div className="bg-white border border-slate-200 rounded-xl hover:border-indigo-200 transition-colors">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
      >
        <div className="flex items-center gap-3 shrink-0 sm:w-56">
          <Badge variant={meta.variant} dot>
            {meta.label}
          </Badge>
          <span className="text-xs text-slate-400 whitespace-nowrap">
            {formatTimestamp(log.created_at)}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-800 truncate">{log.description}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge className="!text-[10px]">
              {MODULE_LABELS[log.module] || log.module}
            </Badge>
            <span className="text-[11px] text-slate-400">{log.entity_type}</span>
            {log.contact_name && (
              <span className="text-[11px] text-slate-500">
                👤 {log.contact_name}
              </span>
            )}
            {log.account_name && (
              <span className="text-[11px] text-slate-500">
                🏦 {log.account_name}
              </span>
            )}
            {log.username && (
              <span className="text-[11px] text-slate-400">by {log.username}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {log.amount != null && (
            <span className="text-sm font-semibold text-slate-700 whitespace-nowrap">
              {formatCurrency(log.amount)}
            </span>
          )}
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/60 rounded-b-xl space-y-3">
          <div className="flex items-center gap-4 flex-wrap text-[11px] text-slate-400">
            <span>Log #{log.id}</span>
            {log.entity_id != null && (
              <span>
                Record: {log.entity_type} #{log.entity_id}
              </span>
            )}
            {log.request_info && <span className="font-mono">{log.request_info}</span>}
            {link && (
              <Link
                to={link}
                onClick={(e) => e.stopPropagation()}
                className="text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Open record →
              </Link>
            )}
          </div>
          <ChangesTable changes={log.changes} action={log.action} />
        </div>
      )}
    </div>
  );
}

export default function ActivityLogs() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(defaultFilters);
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Debounce the search box so we don't refetch per keystroke
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params = { page, page_size: pageSize, sort };
  if (search) params.search = search;
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params[k] = v;
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["activity-logs", params],
    queryFn: async () => (await api.get("/api/activity-logs", { params })).data,
    placeholderData: keepPreviousData,
  });

  const { data: filterMeta } = useQuery({
    queryKey: ["activity-log-filters"],
    queryFn: async () => (await api.get("/api/activity-logs/filters")).data,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await api.get("/api/accounts")).data,
  });

  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = data?.total_pages || 1;
  const hasActiveFilters =
    search || Object.values(filters).some(Boolean);

  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const clearAll = () => {
    setFilters(defaultFilters);
    setSearchInput("");
    setSearch("");
    setPage(1);
  };

  return (
    <div>
      <PageHero
        title="Activity Logs"
        subtitle="Every action taken in the app — creations, updates, deletions, payments, logins — with full before/after detail"
        actions={
          <Button
            variant="ghost-light"
            size="sm"
            onClick={() => setSort((s) => (s === "newest" ? "oldest" : "newest"))}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
            </svg>
            {sort === "newest" ? "Newest first" : "Oldest first"}
          </Button>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-6 max-w-2xl">
          <HeroStat label="Total Entries" value={total.toLocaleString("en-IN")} accent="indigo" />
          <HeroStat
            label="Page"
            value={`${page} / ${totalPages}`}
            sub={`${pageSize} per page`}
            accent="violet"
          />
          <HeroStat
            label="Filters"
            value={hasActiveFilters ? "Active" : "None"}
            sub={hasActiveFilters ? "Showing filtered results" : "Showing everything"}
            accent={hasActiveFilters ? "amber" : "teal"}
          />
        </div>
      </PageHero>

      <PageBody>
        {/* Filter bar */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm mb-5 space-y-3">
          <SearchInput
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Search anything — names, amounts, accounts, credit/debit, field values…"
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Select
              value={filters.module}
              onChange={(e) => setFilter("module", e.target.value)}
            >
              <option value="">All modules</option>
              {(filterMeta?.modules || Object.keys(MODULE_LABELS)).map((mod) => (
                <option key={mod} value={mod}>
                  {MODULE_LABELS[mod] || mod}
                </option>
              ))}
            </Select>
            <Select
              value={filters.action}
              onChange={(e) => setFilter("action", e.target.value)}
            >
              <option value="">All actions</option>
              {(filterMeta?.actions || Object.keys(ACTION_META)).map((a) => (
                <option key={a} value={a}>
                  {ACTION_META[a]?.label || a}
                </option>
              ))}
            </Select>
            <Select
              value={filters.account_id}
              onChange={(e) => setFilter("account_id", e.target.value)}
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Input
              type="date"
              value={filters.date_from}
              onChange={(e) => setFilter("date_from", e.target.value)}
              title="From date"
            />
            <Input
              type="date"
              value={filters.date_to}
              onChange={(e) => setFilter("date_to", e.target.value)}
              title="To date"
            />
            <Button variant="secondary" onClick={clearAll} disabled={!hasActiveFilters}>
              Clear filters
            </Button>
          </div>
        </div>

        {/* Log list */}
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-16 bg-white border border-slate-200 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No log entries found"
            description={
              hasActiveFilters
                ? "Try adjusting or clearing your filters."
                : "Actions you take from now on will appear here automatically."
            }
            action={
              hasActiveFilters ? (
                <Button variant="secondary" onClick={clearAll}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        ) : (
          <div className={`space-y-2 ${isFetching ? "opacity-60" : ""}`}>
            {items.map((log) => (
              <LogRow key={log.id} log={log} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Previous
            </Button>
            <span className="text-sm text-slate-500">
              Page {page} of {totalPages} · {total.toLocaleString("en-IN")} entries
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next →
            </Button>
          </div>
        )}
      </PageBody>
    </div>
  );
}
