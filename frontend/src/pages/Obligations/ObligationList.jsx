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
  interest_amount: "",
  settlement_date: new Date().toISOString().split("T")[0],
  payment_mode: "cash",
  account_id: "",
  notes: "",
};

const defaultCloseForm = {
  closed_date: new Date().toISOString().split("T")[0],
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
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeTarget, setCloseTarget] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [settleForm, setSettleForm] = useState(defaultSettleForm);
  const [closeForm, setCloseForm] = useState(defaultCloseForm);
  const [errorMessage, setErrorMessage] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [contactSearch, setContactSearch] = useState("");
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const contactSearchRef = useRef(null);
  const [editingObligation, setEditingObligation] = useState(null);
  const [groupByContact, setGroupByContact] = useState(false);

  const { data: obligations = [], isLoading } = useQuery({
    queryKey: ["obligations", filters],
    queryFn: async () => {
      const params = { limit: 500 }; // backend max — see F9 (no pagination UI yet)
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

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }) =>
      (await api.put(`/api/obligations/${id}`, payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["obligations"] });
      queryClient.invalidateQueries({ queryKey: ["obligations-summary"] });
      setShowModal(false);
      setEditingObligation(null);
      setForm(defaultForm);
      setErrorMessage("");
      setContactSearch("");
      setShowContactDropdown(false);
    },
    onError: (e) =>
      setErrorMessage(
        e.response?.data?.detail || "Failed to update obligation",
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

  const closeLossMutation = useMutation({
    mutationFn: async ({ id, payload }) =>
      (await api.post(`/api/obligations/${id}/close-loss`, payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["obligations"] });
      queryClient.invalidateQueries({ queryKey: ["obligations-summary"] });
      queryClient.invalidateQueries({ queryKey: ["obligation-detail", closeTarget] });
      setShowCloseModal(false);
      setCloseTarget(null);
      setCloseForm(defaultCloseForm);
      setErrorMessage("");
    },
    onError: (e) =>
      setErrorMessage(e.response?.data?.detail || "Failed to close obligation"),
  });

  const reopenMutation = useMutation({
    mutationFn: async (id) =>
      (await api.post(`/api/obligations/${id}/reopen`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["obligations"] });
      queryClient.invalidateQueries({ queryKey: ["obligations-summary"] });
    },
    onError: (e) =>
      window.alert(e.response?.data?.detail || "Failed to reopen obligation"),
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
    if (!form.account_id) {
      setErrorMessage("Please select an account before saving.");
      return;
    }
    const payload = {
      ...form,
      amount: parseFloat(form.amount),
      contact_id: parseInt(form.contact_id),
      linked_type: form.linked_type || null,
      linked_id: form.linked_id ? parseInt(form.linked_id) : null,
      due_date: form.due_date || null,
      account_id: form.account_id ? parseInt(form.account_id) : null,
    };
    if (editingObligation) {
      updateMutation.mutate({
        id: editingObligation.id,
        payload: {
          amount: payload.amount,
          reason: payload.reason || null,
          due_date: payload.due_date,
          notes: payload.notes || null,
        },
      });
    } else {
      createMutation.mutate(payload);
    }
  };

  const openEditObligation = (ob) => {
    setEditingObligation(ob);
    const contact = contacts.find((c) => c.id === ob.contact_id);
    setForm({
      obligation_type: ob.obligation_type,
      contact_id: String(ob.contact_id || ""),
      amount: String(ob.amount),
      reason: ob.reason || "",
      linked_type: ob.linked_type || "",
      linked_id: ob.linked_id ? String(ob.linked_id) : "",
      due_date: ob.due_date || "",
      account_id: "",
      notes: ob.notes || "",
    });
    setContactSearch(contact?.name || "");
    setShowContactDropdown(false);
    setErrorMessage("");
    setShowModal(true);
  };

  const handleSettle = (e) => {
    e.preventDefault();
    settleMutation.mutate({
      id: settleTarget,
      payload: {
        amount: parseFloat(settleForm.amount) || 0,
        interest_amount: parseFloat(settleForm.interest_amount) || 0,
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

  const handleClose = (e) => {
    e.preventDefault();
    closeLossMutation.mutate({
      id: closeTarget,
      payload: {
        closed_date: closeForm.closed_date,
        notes: closeForm.notes || null,
      },
    });
  };

  const openClose = (ob) => {
    setCloseTarget(ob.id);
    setCloseForm(defaultCloseForm);
    setShowCloseModal(true);
    setErrorMessage("");
  };

  const closeRemaining = useMemo(() => {
    if (!closeTarget) return 0;
    const item = obligations.find((o) => o.obligation?.id === closeTarget);
    if (!item) return 0;
    return (
      parseFloat(item.obligation.amount) -
      parseFloat(item.obligation.amount_settled)
    );
  }, [closeTarget, obligations]);

  const statusColor = (s) => {
    if (s === "settled") return "bg-emerald-100 text-emerald-700";
    if (s === "partial") return "bg-amber-100 text-amber-700";
    if (s === "closed") return "bg-slate-200 text-slate-600";
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
              setEditingObligation(null);
              setShowModal(true);
              setErrorMessage("");
              setContactSearch("");
              setShowContactDropdown(false);
              setForm(defaultForm);
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
                ({ obligation: ob }) =>
                  ob.status !== "settled" && ob.status !== "closed",
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
                ({ obligation: ob }) =>
                  ob.status === "settled" || ob.status === "closed",
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

        {/* Group by Contact toggle */}
        <div className="flex items-center justify-end">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-sm text-slate-500">Group by Contact</span>
            <button
              type="button"
              onClick={() => setGroupByContact((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${groupByContact ? "bg-indigo-500" : "bg-slate-200"}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${groupByContact ? "translate-x-6" : "translate-x-1"}`}
              />
            </button>
          </label>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-200 border-t-indigo-600" />
          </div>
        ) : (
          (() => {
            const visible = obligations.filter(({ obligation: ob }) => {
              const isArchived =
                ob.status === "settled" || ob.status === "closed";
              if (tab === "active" && isArchived) return false;
              if (tab === "archived" && !isArchived) return false;
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
                {(() => {
                  const renderCard = ({ obligation: ob, contact }) => {
                    const remaining = parseFloat(ob.amount) - parseFloat(ob.amount_settled);
                    const pct = parseFloat(ob.amount) > 0 ? (parseFloat(ob.amount_settled) / parseFloat(ob.amount)) * 100 : 0;
                    const isExpanded = expandedId === ob.id;
                    return (
                      <div
                        key={ob.id}
                        className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden hover:border-slate-300 transition-colors"
                      >
                        <div
                          className="p-4 sm:p-5 cursor-pointer hover:bg-slate-50/50 transition-colors"
                          onClick={() => setExpandedId(isExpanded ? null : ob.id)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${ob.obligation_type === "receivable" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}
                                >
                                  {ob.obligation_type === "receivable" ? "▲ Receivable" : "▼ Payable"}
                                </span>
                                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${statusColor(ob.status)}`}>
                                  {ob.status}
                                </span>
                                {ob.linked_type && (
                                  <span className="text-xs text-slate-400">via {ob.linked_type} #{ob.linked_id}</span>
                                )}
                              </div>
                              {!groupByContact && (
                                <p className="font-semibold text-slate-900 mt-1.5">
                                  {ob.contact_id === null ? "Self (You)" : contact?.name || "Unknown"}
                                </p>
                              )}
                              {ob.reason && <p className="text-sm text-slate-500 truncate">{ob.reason}</p>}
                            </div>
                            <div className="text-right ml-4 flex-shrink-0">
                              <p className="text-lg font-bold text-slate-900">{formatCurrency(ob.amount)}</p>
                              {ob.amount_settled > 0 && (
                                <p className="text-xs text-slate-400">Settled: {formatCurrency(ob.amount_settled)}</p>
                              )}
                              {remaining > 0 && ob.status !== "settled" && ob.status !== "closed" && (
                                <p className="text-xs font-medium text-amber-600">Due: {formatCurrency(remaining)}</p>
                              )}
                              {parseFloat(ob.interest_amount || 0) > 0 && (
                                <p className="text-xs font-medium text-emerald-600">+ {formatCurrency(ob.interest_amount)} interest</p>
                              )}
                              {ob.status === "closed" && parseFloat(ob.loss_amount || 0) > 0 && (
                                <p className="text-xs font-medium text-rose-600">Loss: {formatCurrency(ob.loss_amount)}</p>
                              )}
                            </div>
                          </div>
                          {/* Progress bar for partial obligations */}
                          {ob.status === "partial" && (
                            <div className="mt-3">
                              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                                <span>{pct.toFixed(0)}% settled</span>
                                <span>{formatCurrency(remaining)} remaining</span>
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-500"
                                  style={{ width: `${Math.min(pct, 100)}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        {isExpanded && (
                          <div className="border-t border-slate-100 px-4 sm:px-5 py-4 bg-slate-50/50 space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                              {ob.due_date && (
                                <div>
                                  <span className="text-xs font-medium text-slate-400">Due:</span>{" "}
                                  <span className="text-slate-700">{formatDate(ob.due_date)}</span>
                                </div>
                              )}
                              {ob.notes && (
                                <div className="col-span-2">
                                  <span className="text-xs font-medium text-slate-400">Notes:</span>{" "}
                                  <span className="text-slate-700 whitespace-pre-line">{ob.notes}</span>
                                </div>
                              )}
                              {ob.status === "closed" && (
                                <div className="col-span-2">
                                  <span className="text-xs font-medium text-slate-400">Closed with loss:</span>{" "}
                                  <span className="font-medium text-rose-600">{formatCurrency(ob.loss_amount)}</span>
                                  {ob.closed_date && (
                                    <span className="text-slate-500"> on {formatDate(ob.closed_date)}</span>
                                  )}
                                </div>
                              )}
                              {parseFloat(ob.interest_amount || 0) > 0 && (
                                <div>
                                  <span className="text-xs font-medium text-slate-400">Interest / profit:</span>{" "}
                                  <span className="font-medium text-emerald-600">{formatCurrency(ob.interest_amount)}</span>
                                </div>
                              )}
                              <div>
                                <span className="text-xs font-medium text-slate-400">Created:</span>{" "}
                                <span className="text-slate-700">{formatDate(ob.created_at)}</span>
                              </div>
                            </div>

                            {detailData?.settlements?.length > 0 && (
                              <div>
                                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Settlements</h4>
                                <div className="space-y-1.5">
                                  {detailData.settlements.map((s) => (
                                    <div
                                      key={s.id}
                                      className="flex items-center justify-between text-sm bg-white rounded-xl px-3 py-2.5 border border-slate-200/60"
                                    >
                                      <div>
                                        <span className="font-medium text-slate-900">{formatCurrency(s.amount)}</span>
                                        {parseFloat(s.interest_amount || 0) > 0 && (
                                          <span className="text-emerald-600 ml-1.5 text-xs font-medium">+ {formatCurrency(s.interest_amount)} int.</span>
                                        )}
                                        <span className="text-slate-400 ml-2 text-xs">{formatDate(s.settlement_date)}</span>
                                        {s.payment_mode && <span className="text-xs text-slate-400 ml-2">({s.payment_mode})</span>}
                                      </div>
                                      {s.notes && <span className="text-xs text-slate-400">{s.notes}</span>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="flex flex-wrap gap-2 pt-1">
                              {ob.status !== "settled" && ob.status !== "closed" && (
                                <>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); openSettle(ob); }}
                                    className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white px-4 py-1.5 rounded-xl text-sm font-medium hover:from-emerald-600 hover:to-emerald-700 shadow-sm shadow-emerald-500/20 transition-all active:scale-[0.98]"
                                  >
                                    Record Payment
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); openClose(ob); }}
                                    className="bg-amber-50 text-amber-700 border border-amber-200/60 px-4 py-1.5 rounded-xl text-sm font-medium hover:bg-amber-100 transition-colors"
                                  >
                                    Close with Loss
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); openEditObligation(ob); }}
                                    className="bg-indigo-50 text-indigo-600 border border-indigo-200/60 px-4 py-1.5 rounded-xl text-sm font-medium hover:bg-indigo-100 transition-colors"
                                  >
                                    Edit
                                  </button>
                                </>
                              )}
                              {ob.status === "closed" && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm("Reopen this obligation? The written-off loss will be cleared.")) reopenMutation.mutate(ob.id);
                                  }}
                                  className="bg-indigo-50 text-indigo-600 border border-indigo-200/60 px-4 py-1.5 rounded-xl text-sm font-medium hover:bg-indigo-100 transition-colors"
                                >
                                  Reopen
                                </button>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (window.confirm("Delete this obligation?")) deleteMutation.mutate(ob.id);
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
                  };

                  if (groupByContact) {
                    const groups = {};
                    visible.forEach((item) => {
                      const name = item.contact?.name || "Unknown";
                      if (!groups[name]) groups[name] = [];
                      groups[name].push(item);
                    });
                    return Object.entries(groups)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([contactName, items]) => {
                        const groupReceivable = items.reduce((s, i) => (i.obligation.obligation_type === "receivable" ? s + parseFloat(i.obligation.amount) - parseFloat(i.obligation.amount_settled) : s), 0);
                        const groupPayable = items.reduce((s, i) => (i.obligation.obligation_type === "payable" ? s + parseFloat(i.obligation.amount) - parseFloat(i.obligation.amount_settled) : s), 0);
                        return (
                          <div key={contactName} className="space-y-2">
                            <div className="flex items-center justify-between px-1 pt-2">
                              <h3 className="text-sm font-bold text-slate-700">👤 {contactName}</h3>
                              <div className="flex gap-3 text-xs">
                                {groupReceivable > 0 && <span className="text-emerald-600 font-medium">▲ {formatCurrency(groupReceivable)}</span>}
                                {groupPayable > 0 && <span className="text-rose-600 font-medium">▼ {formatCurrency(groupPayable)}</span>}
                              </div>
                            </div>
                            {items.map(renderCard)}
                          </div>
                        );
                      });
                  }
                  return visible.map(renderCard);
                })()}
              </div>
            );
          })()
        )}
      </PageBody>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/60 max-w-lg w-full max-h-[90vh] overflow-y-auto animate-slideUp">
            <div className="p-6">
              <h2 className="text-lg font-bold text-slate-900 mb-5">
                {editingObligation ? "Edit Obligation" : "New Obligation"}
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
                    Account <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={form.account_id}
                    onChange={(e) =>
                      setForm({ ...form, account_id: e.target.value })
                    }
                    className={`w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all ${
                      !form.account_id
                        ? "border-amber-400 bg-amber-50"
                        : "border-slate-200 focus:border-indigo-400"
                    }`}
                  >
                    <option value="">— Select Account (required) —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  {!form.account_id && (
                    <p className="text-xs text-amber-600 mt-1">An account is required to track money flow.</p>
                  )}
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
                      setEditingObligation(null);
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
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="flex-1 px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl hover:from-indigo-600 hover:to-indigo-700 text-sm font-medium shadow-sm shadow-indigo-500/20 disabled:opacity-50 transition-all active:scale-[0.98]"
                  >
                    {(createMutation.isPending || updateMutation.isPending) ? "Saving…" : editingObligation ? "Update" : "Create"}
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
                Record Payment
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
                      Principal Amount
                    </label>
                    <input
                      type="number"
                      min="0"
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
                      Interest / Profit
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={settleForm.interest_amount}
                      onChange={(e) =>
                        setSettleForm({ ...settleForm, interest_amount: e.target.value })
                      }
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-400 transition-all"
                    />
                  </div>
                </div>
                <p className="text-xs text-slate-400 -mt-1">
                  Principal reduces what's owed. Anything paid on top goes in
                  Interest / Profit and is recorded as income.
                </p>
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
                    {settleMutation.isPending ? "Saving…" : "Record Payment"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Close with Loss Modal */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/60 max-w-md w-full animate-slideUp">
            <div className="p-6">
              <h2 className="text-lg font-bold text-slate-900 mb-2">
                Close with Loss
              </h2>
              <p className="text-sm text-slate-500 mb-4">
                The remaining balance will be written off as a loss. No money is
                recorded as moving. You can reopen the obligation later if needed.
              </p>
              {errorMessage && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 mb-4">
                  {errorMessage}
                </div>
              )}
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-4 flex items-center justify-between">
                <span className="text-sm font-medium text-amber-700">
                  Amount to write off
                </span>
                <span className="text-lg font-bold text-amber-700">
                  {formatCurrency(closeRemaining)}
                </span>
              </div>
              <form onSubmit={handleClose} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Close Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={closeForm.closed_date}
                    onChange={(e) =>
                      setCloseForm({ ...closeForm, closed_date: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Reason / Notes
                  </label>
                  <textarea
                    value={closeForm.notes}
                    onChange={(e) =>
                      setCloseForm({ ...closeForm, notes: e.target.value })
                    }
                    rows={2}
                    placeholder="e.g. Borrower defaulted, written off as bad debt"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all resize-none"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCloseModal(false);
                      setCloseTarget(null);
                      setErrorMessage("");
                    }}
                    className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 text-sm font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={closeLossMutation.isPending}
                    className="flex-1 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-xl hover:from-amber-600 hover:to-amber-700 text-sm font-medium shadow-sm shadow-amber-500/20 disabled:opacity-50 transition-all active:scale-[0.98]"
                  >
                    {closeLossMutation.isPending ? "Closing…" : "Close with Loss"}
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
