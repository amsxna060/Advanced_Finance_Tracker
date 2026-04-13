import { useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import LinkedRecordSelect from "../../components/LinkedRecordSelect";
import { PageHero, HeroStat, PageBody, Button } from "../../components/ui";

const defaultForm = {
  obligation_type: "receivable",
  contact_id: "",
  amount: "",
  reason: "",
  linked_type: "",
  linked_id: "",
  due_date: new Date().toISOString().split("T")[0],
  account_id: "",
  notes: "",
};

const defaultSettleForm = {
  amount: "",
  settlement_date: new Date().toISOString().split("T")[0],
  payment_mode: "cash",
  account_id: "",
  notes: "",
};

function ObligationList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("active"); // "active" | "archived"
  const [filters, setFilters] = useState({
    obligation_type: "",
    contact_id: "",
    search: "",
  });
  const [showModal, setShowModal] = useState(false);
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [settleTarget, setSettleTarget] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [settleForm, setSettleForm] = useState(defaultSettleForm);
  const [errorMessage, setErrorMessage] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [contactSearch, setContactSearch] = useState("");
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const contactSearchRef = useRef(null);

  const { data: obligations = [], isLoading } = useQuery({
    queryKey: ["obligations", filters],
    queryFn: async () => {
      const params = { limit: 200 };
      Object.entries(filters).forEach(([k, v]) => {
        if (v) params[k] = v;
      });
      const res = await api.get("/api/obligations", { params });
      return res.data;
    },
  });

  const { data: summary } = useQuery({
    queryKey: ["obligations-summary"],
    queryFn: async () =>
      (await api.get("/api/obligations/summary/overview")).data,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () =>
      (await api.get("/api/contacts", { params: { limit: 500 } })).data,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await api.get("/api/accounts")).data,
  });

  const { data: detailData, refetch: refetchDetail } = useQuery({
    queryKey: ["obligation-detail", expandedId],
    queryFn: async () => (await api.get(`/api/obligations/${expandedId}`)).data,
    enabled: !!expandedId,
  });

  const createMutation = useMutation({
    mutationFn: async (payload) =>
      (await api.post("/api/obligations", payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["obligations"] });
      queryClient.invalidateQueries({ queryKey: ["obligations-summary"] });
      setShowModal(false);
      setForm(defaultForm);
      setErrorMessage("");
      setContactSearch("");
      setShowContactDropdown(false);
    },
    onError: (e) =>
      setErrorMessage(
        e.response?.data?.detail || "Failed to create obligation",
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => api.delete(`/api/obligations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["obligations"] });
      queryClient.invalidateQueries({ queryKey: ["obligations-summary"] });
    },
  });

  const settleMutation = useMutation({
    mutationFn: async ({ id, payload }) =>
      (await api.post(`/api/obligations/${id}/settle`, payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["obligations"] });
      queryClient.invalidateQueries({ queryKey: ["obligations-summary"] });
      queryClient.invalidateQueries({
        queryKey: ["obligation-detail", settleTarget],
      });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setShowSettleModal(false);
      setSettleTarget(null);
      setSettleForm(defaultSettleForm);
      setErrorMessage("");
    },
    onError: (e) =>
      setErrorMessage(e.response?.data?.detail || "Settlement failed"),
  });

  const totals = useMemo(() => {
    let receivable = 0,
      payable = 0;
    obligations.forEach((o) => {
      const remaining =
        parseFloat(o.obligation?.amount || 0) -
        parseFloat(o.obligation?.amount_settled || 0);
      if (o.obligation?.obligation_type === "receivable")
        receivable += remaining;
      else payable += remaining;
    });
    return { receivable, payable };
  }, [obligations]);

  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return contacts;
    const q = contactSearch.toLowerCase();
    return contacts.filter((c) => c.name.toLowerCase().includes(q));
  }, [contacts, contactSearch]);

  const handleCreate = (e) => {
    e.preventDefault();
    createMutation.mutate({
      ...form,
      amount: parseFloat(form.amount),
      contact_id: parseInt(form.contact_id),
      linked_type: form.linked_type || null,
      linked_id: form.linked_id ? parseInt(form.linked_id) : null,
      due_date: form.due_date || null,
      account_id: form.account_id ? parseInt(form.account_id) : null,
    });
  };

  const handleSettle = (e) => {
    e.preventDefault();
    settleMutation.mutate({
      id: settleTarget,
      payload: {
        amount: parseFloat(settleForm.amount),
        settlement_date: settleForm.settlement_date,
        payment_mode: settleForm.payment_mode || null,
        account_id: settleForm.account_id
          ? parseInt(settleForm.account_id)
          : null,
        notes: settleForm.notes || null,
      },
    });
  };

  const openSettle = (ob) => {
    const remaining = parseFloat(ob.amount) - parseFloat(ob.amount_settled);
    setSettleTarget(ob.id);
    setSettleForm({ ...defaultSettleForm, amount: remaining.toString() });
    setShowSettleModal(true);
    setErrorMessage("");
  };

  const statusColor = (s) => {
    if (s === "settled") return "bg-emerald-100 text-emerald-700";
    if (s === "partial") return "bg-amber-100 text-amber-700";
    return "bg-rose-100 text-rose-700";
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title="Money Flow"
        subtitle="Track receivables and payables"
        backTo="/dashboard"
        actions={
          <Button
            variant="white"
            onClick={() => {
              setShowModal(true);
              setErrorMessage("");
              setContactSearch("");
              setShowContactDropdown(false);
            }}
          >
            + New Obligation
          </Button>
        }
      >
        {summary && (
          <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <HeroStat
              label="Receivable"
              value={formatCurrency(summary.total_receivable)}
              accent="emerald"
            />
            <HeroStat
              label="Payable"
              value={formatCurrency(summary.total_payable)}
              accent="rose"
            />
            <HeroStat
              label="Net Position"
              value={formatCurrency(summary.net_position)}
              accent="indigo"
            />
            <HeroStat
              label="Pending"
              value={String(summary.pending_count)}
              accent="teal"
            />
          </div>
        )}
      </PageHero>
      <PageBody>
        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
          <button
            onClick={() => setTab("active")}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${tab === "active" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            Active
            {(() => {
              const cnt = obligations.filter(
                ({ obligation: ob }) => ob.status !== "settled",
              ).length;
              return cnt > 0 ? (
                <span className="ml-2 bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full">
                  {cnt}
                </span>
              ) : null;
            })()}
          </button>
          <button
            onClick={() => setTab("archived")}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${tab === "archived" ? "bg-white text-slate-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            Settled
            {(() => {
              const cnt = obligations.filter(
                ({ obligation: ob }) => ob.status === "settled",
              ).length;
              return cnt > 0 ? (
                <span className="ml-2 bg-slate-200 text-slate-600 text-xs px-2 py-0.5 rounded-full">
                  {cnt}
                </span>
              ) : null;
            })()}
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select
              value={filters.obligation_type}
              onChange={(e) =>
                setFilters({ ...filters, obligation_type: e.target.value })
              }
              className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
            >
              <option value="">All Types</option>
              <option value="receivable">Receivable</option>
              <option value="payable">Payable</option>
            </select>
            <select
              value={filters.contact_id}
              onChange={(e) =>
                setFilters({ ...filters, contact_id: e.target.value })
              }
              className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
            >
              <option value="">All Contacts</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Search reason / notes..."
              value={filters.search}
              onChange={(e) =>
                setFilters({ ...filters, search: e.target.value })
              }
              className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
            />
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-200 border-t-indigo-600" />
          </div>
        ) : (
          (() => {
            const visible = obligations.filter(({ obligation: ob }) => {
              if (tab === "active" && ob.status === "settled") return false;
              if (tab === "archived" && ob.status !== "settled") return false;
              if (
                filters.search &&
                !(ob.reason || "")
                  .toLowerCase()
                  .includes(filters.search.toLowerCase()) &&
                !(ob.notes || "")
                  .toLowerCase()
                  .includes(filters.search.toLowerCase())
              )
                return false;
              return true;
            });
            if (visible.length === 0)
              return (
                <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-16 text-center">
                  <div className="text-4xl mb-3">
                    {tab === "archived" ? "🗄️" : "📋"}
                  </div>
                  <p className="text-slate-400 text-sm">
                    {tab === "archived"
                      ? "No settled obligations"
                      : "No active obligations"}
                  </p>
                </div>
              );
            return (
              <div className="space-y-3">
                {tab === "archived" && (
                  <div className="flex items-center gap-2 text-sm text-slate-400 px-1">
                    <span>🗄️</span>
                    <span>Showing settled obligations</span>
                  </div>
                )}
                {visible.map(({ obligation: ob, contact }) => {
                  const remaining =
                    parseFloat(ob.amount) - parseFloat(ob.amount_settled);
                  const isExpanded = expandedId === ob.id;
                  return (
                    <div
                      key={ob.id}
                      className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden hover:border-slate-300 transition-colors"
                    >
                      <div
                        className="p-4 sm:p-5 cursor-pointer hover:bg-slate-50/50 flex items-center justify-between transition-colors"
                        onClick={() => setExpandedId(isExpanded ? null : ob.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${ob.obligation_type === "receivable" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}
                            >
                              {ob.obligation_type === "receivable"
                                ? "▲ Receivable"
                                : "▼ Payable"}
                            </span>
                            <span
                              className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${statusColor(ob.status)}`}
                            >
                              {ob.status}
                            </span>
                            {ob.linked_type && (
                              <span className="text-xs text-slate-400">
                                via {ob.linked_type} #{ob.linked_id}
                              </span>
                            )}
                          </div>
                          <p className="font-semibold text-slate-900 mt-1.5">
                            {ob.contact_id === null
                              ? "Self (You)"
                              : contact?.name || "Unknown"}
                          </p>
                          {ob.reason && (
                            <p className="text-sm text-slate-500 truncate">
                              {ob.reason}
                            </p>
                          )}
                        </div>
                        <div className="text-right ml-4 flex-shrink-0">
                          <p className="text-lg font-bold text-slate-900">
                            {formatCurrency(ob.amount)}
                          </p>
                          {ob.amount_settled > 0 && (
                            <p className="text-xs text-slate-400">
                              Settled: {formatCurrency(ob.amount_settled)}
                            </p>
                          )}
                          {remaining > 0 && ob.status !== "settled" && (
                            <p className="text-xs font-medium text-amber-600">
                              Due: {formatCurrency(remaining)}
                            </p>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-slate-100 px-4 sm:px-5 py-4 bg-slate-50/50 space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                            {ob.due_date && (
                              <div>
                                <span className="text-xs font-medium text-slate-400">
                                  Due:
                                </span>{" "}
                                <span className="text-slate-700">
                                  {formatDate(ob.due_date)}
                                </span>
                              </div>
                            )}
                            {ob.notes && (
                              <div className="col-span-2">
                                <span className="text-xs font-medium text-slate-400">
                                  Notes:
                                </span>{" "}
                                <span className="text-slate-700">
                                  {ob.notes}
                                </span>
                              </div>
                            )}
                            <div>
                              <span className="text-xs font-medium text-slate-400">
                                Created:
                              </span>{" "}
                              <span className="text-slate-700">
                                {formatDate(ob.created_at)}
                              </span>
                            </div>
                          </div>

                          {detailData?.settlements?.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                Settlements
                              </h4>
                              <div className="space-y-1.5">
                                {detailData.settlements.map((s) => (
                                  <div
                                    key={s.id}
                                    className="flex items-center justify-between text-sm bg-white rounded-xl px-3 py-2.5 border border-slate-200/60"
                                  >
                                    <div>
                                      <span className="font-medium text-slate-900">
                                        {formatCurrency(s.amount)}
                                      </span>
                                      <span className="text-slate-400 ml-2 text-xs">
                                        {formatDate(s.settlement_date)}
                                      </span>
                                      {s.payment_mode && (
                                        <span className="text-xs text-slate-400 ml-2">
                                          ({s.payment_mode})
                                        </span>
                                      )}
                                    </div>
                                    {s.notes && (
                                      <span className="text-xs text-slate-400">
                                        {s.notes}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="flex gap-2 pt-1">
                            {ob.status !== "settled" && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openSettle(ob);
                                }}
                                className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white px-4 py-1.5 rounded-xl text-sm font-medium hover:from-emerald-600 hover:to-emerald-700 shadow-sm shadow-emerald-500/20 transition-all active:scale-[0.98]"
                              >
                                Record Settlement
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm("Delete this obligation?"))
                                  deleteMutation.mutate(ob.id);
                              }}
                              className="bg-rose-50 text-rose-600 border border-rose-200/60 px-4 py-1.5 rounded-xl text-sm font-medium hover:bg-rose-100 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()
        )}
      </PageBody>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/60 max-w-lg w-full max-h-[90vh] overflow-y-auto animate-slideUp">
            <div className="p-6">
              <h2 className="text-lg font-bold text-slate-900 mb-5">
                New Obligation
              </h2>
              {errorMessage && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 mb-4">
                  {errorMessage}
                </div>
              )}
              <form onSubmit={handleCreate} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Type
                    </label>
                    <select
                      value={form.obligation_type}
                      onChange={(e) =>
                        setForm({ ...form, obligation_type: e.target.value })
                      }
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    >
                      <option value="receivable">
                        Receivable (they owe me)
                      </option>
                      <option value="payable">Payable (I owe them)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Contact *
                    </label>
                    <div
                      className="relative"
                      onBlur={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget))
                          setShowContactDropdown(false);
                      }}
                    >
                      <input
                        ref={contactSearchRef}
                        type="text"
                        required={!form.contact_id}
                        placeholder={
                          form.contact_id
                            ? contacts.find(
                                (c) => c.id === parseInt(form.contact_id),
                              )?.name || "Search contact..."
                            : "Search contact..."
                        }
                        value={contactSearch}
                        onFocus={() => setShowContactDropdown(true)}
                        onChange={(e) => {
                          setContactSearch(e.target.value);
                          setForm({ ...form, contact_id: "" });
                          setShowContactDropdown(true);
                        }}
                        className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                      />
                      {form.contact_id && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-emerald-600">
                          ✓
                        </span>
                      )}
                      {showContactDropdown && (
                        <div className="absolute z-50 w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto">
                          {filteredContacts.length === 0 ? (
                            <div className="px-3 py-3 text-sm text-slate-400">
                              No contacts found
                            </div>
                          ) : (
                            filteredContacts.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                className="w-full text-left px-3 py-2.5 text-sm hover:bg-indigo-50 flex items-center gap-2 transition-colors"
                                onMouseDown={() => {
                                  setForm({
                                    ...form,
                                    contact_id: String(c.id),
                                  });
                                  setContactSearch(c.name);
                                  setShowContactDropdown(false);
                                }}
                              >
                                <span className="text-slate-400 text-xs">
                                  {c.contact_type === "institution"
                                    ? "🏦"
                                    : "👤"}
                                </span>
                                {c.name}
                                {c.relationship_type && (
                                  <span className="text-xs text-slate-400 ml-auto">
                                    {c.relationship_type}
                                  </span>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Amount *
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      step="0.01"
                      value={form.amount}
                      onChange={(e) =>
                        setForm({ ...form, amount: e.target.value })
                      }
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={form.due_date}
                      onChange={(e) =>
                        setForm({ ...form, due_date: e.target.value })
                      }
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Reason
                  </label>
                  <input
                    type="text"
                    value={form.reason}
                    onChange={(e) =>
                      setForm({ ...form, reason: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    placeholder="e.g. Property sale balance, partnership profit share"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Linked Type
                    </label>
                    <select
                      value={form.linked_type}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          linked_type: e.target.value,
                          linked_id: "",
                        })
                      }
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    >
                      <option value="">None</option>
                      <option value="property">Property</option>
                      <option value="partnership">Partnership</option>
                      <option value="loan">Loan</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Linked Record
                    </label>
                    {form.linked_type && form.linked_type !== "other" ? (
                      <LinkedRecordSelect
                        linkedType={form.linked_type}
                        value={form.linked_id}
                        onChange={(val) => setForm({ ...form, linked_id: val })}
                      />
                    ) : (
                      <input
                        type="text"
                        value={form.linked_id}
                        onChange={(e) =>
                          setForm({ ...form, linked_id: e.target.value })
                        }
                        className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all disabled:bg-slate-50 disabled:text-slate-400"
                        placeholder={
                          form.linked_type === "other"
                            ? "Reference"
                            : "Select linked type first"
                        }
                        disabled={!form.linked_type}
                      />
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Account
                  </label>
                  <select
                    value={form.account_id}
                    onChange={(e) =>
                      setForm({ ...form, account_id: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  >
                    <option value="">— No account —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={form.notes}
                    onChange={(e) =>
                      setForm({ ...form, notes: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all resize-none"
                    rows={2}
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowModal(false);
                      setForm(defaultForm);
                      setContactSearch("");
                      setShowContactDropdown(false);
                    }}
                    className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 text-sm font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="flex-1 px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl hover:from-indigo-600 hover:to-indigo-700 text-sm font-medium shadow-sm shadow-indigo-500/20 disabled:opacity-50 transition-all active:scale-[0.98]"
                  >
                    {createMutation.isPending ? "Saving…" : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Settlement Modal */}
      {showSettleModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/60 max-w-md w-full animate-slideUp">
            <div className="p-6">
              <h2 className="text-lg font-bold text-slate-900 mb-5">
                Record Settlement
              </h2>
              {errorMessage && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 mb-4">
                  {errorMessage}
                </div>
              )}
              <form onSubmit={handleSettle} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Amount *
                    </label>
                    <input
                      type="number"
                      required
                      min="0.01"
                      step="0.01"
                      value={settleForm.amount}
                      onChange={(e) =>
                        setSettleForm({ ...settleForm, amount: e.target.value })
                      }
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={settleForm.settlement_date}
                      onChange={(e) =>
                        setSettleForm({
                          ...settleForm,
                          settlement_date: e.target.value,
                        })
                      }
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Payment Mode
                    </label>
                    <select
                      value={settleForm.payment_mode}
                      onChange={(e) =>
                        setSettleForm({
                          ...settleForm,
                          payment_mode: e.target.value,
                        })
                      }
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    >
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="cheque">Cheque</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Account
                    </label>
                    <select
                      value={settleForm.account_id}
                      onChange={(e) =>
                        setSettleForm({
                          ...settleForm,
                          account_id: e.target.value,
                        })
                      }
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    >
                      <option value="">— no ledger entry —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Notes
                  </label>
                  <input
                    type="text"
                    value={settleForm.notes}
                    onChange={(e) =>
                      setSettleForm({ ...settleForm, notes: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSettleModal(false);
                      setSettleTarget(null);
                    }}
                    className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 text-sm font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={settleMutation.isPending}
                    className="flex-1 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl hover:from-emerald-600 hover:to-emerald-700 text-sm font-medium shadow-sm shadow-emerald-500/20 disabled:opacity-50 transition-all active:scale-[0.98]"
                  >
                    {settleMutation.isPending ? "Saving…" : "Record Settlement"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ObligationList;
