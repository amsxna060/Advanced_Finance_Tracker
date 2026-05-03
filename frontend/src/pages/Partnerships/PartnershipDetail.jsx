import { useState, useMemo } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { PageBody } from "../../components/ui";

const TXN_TYPE_LABELS = {
  advance_to_seller: "Advance to Seller",
  remaining_to_seller: "Remaining to Seller",
  broker_commission: "Broker Commission",
  expense: "Expense",
  buyer_advance: "Buyer Advance",
  buyer_payment: "Buyer Payment",
  profit_received: "Profit Received",
  partner_transfer: "Partner Transfer",
  advance_given: "Advance Given",
  buyer_payment_received: "Buyer Payment Received",
  other_expense: "Other Expense",
  broker_paid: "Broker Paid",
  invested: "Invested",
  received: "Received",
  profit_distributed: "Profit Distributed",
};

const OUTFLOW_TYPES = ["advance_to_seller", "remaining_to_seller", "broker_commission", "expense"];
const INFLOW_TYPES = ["buyer_advance", "buyer_payment", "profit_received"];
const TRANSFER_TYPES = ["partner_transfer"];
const LEGACY_OUTFLOW = ["advance_given", "broker_paid", "invested", "other_expense"];

function InfoRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-900 text-right max-w-[60%]">{value}</span>
    </div>
  );
}

function InputField({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all";

export default function PartnershipDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [memberForm, setMemberForm] = useState({
    contact_id: "", is_self: false, share_percentage: "",
    notes: "",
  });
  const [showEditMemberModal, setShowEditMemberModal] = useState(false);
  const [editMemberId, setEditMemberId] = useState(null);
  const [editMemberForm, setEditMemberForm] = useState({
    share_percentage: "", notes: "",
  });

  const [showTxnForm, setShowTxnForm] = useState(false);
  const [txnForm, setTxnForm] = useState({
    txn_type: "advance_to_seller",
    amount: "",
    txn_date: new Date().toISOString().split("T")[0],
    payment_mode: "cash",
    description: "",
    account_id: "",
    member_id: "",
    received_by_member_id: "",
    plot_buyer_id: "",
    site_plot_id: "",
    broker_name: "",
    from_partnership_pot: false,
    profit_source: "",  // "partner" | "buyer" | ""
  });
  const [editingTxnId, setEditingTxnId] = useState(null);
  const [editTxnForm, setEditTxnForm] = useState(null);

  const [showBuyerForm, setShowBuyerForm] = useState(false);
  const [buyerForm, setBuyerForm] = useState({
    name: "", phone: "", city: "", notes: "",
    area_sqft: "", rate_per_sqft: "",
    side_north_ft: "", side_south_ft: "", side_east_ft: "", side_west_ft: "",
  });
  // New workflow state: add plot, then assign buyer
  const [showAddPlotForm, setShowAddPlotForm] = useState(false);
  const [plotForm, setPlotForm] = useState({
    plot_number: "", area_sqft: "", rate_per_sqft: "",
    side_north_ft: "", side_south_ft: "", side_east_ft: "", side_west_ft: "", notes: "",
  });
  const [assigningBuyerTo, setAssigningBuyerTo] = useState(null); // { type: "plot_buyer"|"site_plot", id, label }
  const [assignBuyerMode, setAssignBuyerMode] = useState("existing"); // "existing" or "new"
  const [assignBuyerForm, setAssignBuyerForm] = useState({ contact_id: "", name: "", phone: "", city: "" });

  const [showSettleModal, setShowSettleModal] = useState(false);
  const [settleForm, setSettleForm] = useState({
    total_received: "", actual_end_date: "", notes: "",
  });

  // Plot expansion & close-deal state
  const [expandedPlotId, setExpandedPlotId] = useState(null); // "sp-{id}" or "pb-{id}"
  const [closeDealPlot, setCloseDealPlot] = useState(null); // {type:"site_plot"|"plot_buyer", id, label}
  const [closeDealForm, setCloseDealForm] = useState({
    area_sqft: "", price_per_sqft: "", registry_date: "", notes: "",
  });
  // Collapsible date sections in transactions
  const [collapsedDates, setCollapsedDates] = useState({});
  // Edit plot modal
  const [editingPlot, setEditingPlot] = useState(null); // {type: "site_plot"|"plot_buyer", id, hasPaid}
  const [editPlotForm, setEditPlotForm] = useState({
    plot_number: "", area_sqft: "", price_per_sqft: "", notes: "",
    side_north_ft: "", side_south_ft: "", side_east_ft: "", side_west_ft: "",
  });
  // View plot detail popup
  const [viewingPlot, setViewingPlot] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["partnership", id],
    queryFn: async () => (await api.get(`/api/partnerships/${id}`)).data,
    retry: 2,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts", "for-form"],
    queryFn: async () => (await api.get("/api/contacts", { params: { limit: 500 } })).data,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", "for-form"],
    queryFn: async () => (await api.get("/api/accounts")).data,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["partnership", id] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["obligations"] });
    queryClient.invalidateQueries({ queryKey: ["obligations-summary"] });
    queryClient.invalidateQueries({ queryKey: ["properties"] });
    queryClient.invalidateQueries({ queryKey: ["property"] });
  };

  const deletePartnershipMutation = useMutation({
    mutationFn: () => api.delete(`/api/partnerships/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["partnerships"] }); navigate("/partnerships"); },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to delete"),
  });

  const addMemberMutation = useMutation({
    mutationFn: (payload) => api.post(`/api/partnerships/${id}/members`, payload),
    onSuccess: () => {
      invalidate();
      setShowAddMemberModal(false);
      setMemberForm({ contact_id: "", is_self: false, share_percentage: "", notes: "" });
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to add member"),
  });

  const editMemberMutation = useMutation({
    mutationFn: ({ memberId, payload }) => api.put(`/api/partnerships/${id}/members/${memberId}`, payload),
    onSuccess: () => { invalidate(); setShowEditMemberModal(false); setEditMemberId(null); },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to update member"),
  });

  const deleteMemberMutation = useMutation({
    mutationFn: (memberId) => api.delete(`/api/partnerships/${id}/members/${memberId}`),
    onSuccess: invalidate,
    onError: (err) => alert(err?.response?.data?.detail || "Failed to remove member"),
  });

  const addTxnMutation = useMutation({
    mutationFn: (payload) => api.post(`/api/partnerships/${id}/transactions`, payload),
    onSuccess: () => {
      invalidate();
      setShowTxnForm(false);
      setTxnForm({
        txn_type: "advance_to_seller", amount: "", txn_date: new Date().toISOString().split("T")[0],
        payment_mode: "cash", description: "", account_id: "", member_id: "",
        received_by_member_id: "", plot_buyer_id: "", site_plot_id: "",
        broker_name: "", from_partnership_pot: false, profit_source: "",
      });
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to add transaction"),
  });

  const deleteTxnMutation = useMutation({
    mutationFn: (txnId) => api.delete(`/api/partnerships/${id}/transactions/${txnId}`),
    onSuccess: invalidate,
    onError: (err) => alert(err?.response?.data?.detail || "Failed to delete transaction"),
  });

  const updateTxnMutation = useMutation({
    mutationFn: ({ txnId, payload }) => api.put(`/api/partnerships/${id}/transactions/${txnId}`, payload),
    onSuccess: () => { invalidate(); setEditingTxnId(null); setEditTxnForm(null); },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to update transaction"),
  });

  const createBuyerMutation = useMutation({
    mutationFn: (payload) => api.post(`/api/partnerships/${id}/create-buyer`, payload),
    onSuccess: () => {
      invalidate();
      setShowBuyerForm(false);
      setBuyerForm({ name: "", phone: "", city: "", notes: "", area_sqft: "", rate_per_sqft: "", side_north_ft: "", side_south_ft: "", side_east_ft: "", side_west_ft: "" });
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to create buyer"),
  });

  const addPlotMutation = useMutation({
    mutationFn: (payload) => api.post(`/api/partnerships/${id}/add-plot`, payload),
    onSuccess: () => {
      invalidate();
      setShowAddPlotForm(false);
      setPlotForm({ plot_number: "", area_sqft: "", rate_per_sqft: "", side_north_ft: "", side_south_ft: "", side_east_ft: "", side_west_ft: "", notes: "" });
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to add plot"),
  });

  const assignBuyerMutation = useMutation({
    mutationFn: (payload) => api.put(`/api/partnerships/${id}/assign-buyer`, payload),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      setAssigningBuyerTo(null);
      setAssignBuyerForm({ contact_id: "", name: "", phone: "", city: "" });
      setAssignBuyerMode("existing");
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to assign buyer"),
  });

  const settleMutation = useMutation({
    mutationFn: (payload) => api.put(`/api/partnerships/${id}/settle`, payload),
    onSuccess: () => { invalidate(); setShowSettleModal(false); },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to settle"),
  });

  const closeDealMutation = useMutation({
    mutationFn: ({ type, plotId, payload }) => {
      const url = type === "site_plot"
        ? `/api/partnerships/${id}/site-plots/${plotId}`
        : `/api/partnerships/${id}/plot-buyers/${plotId}`;
      return api.put(url, payload);
    },
    onSuccess: () => {
      invalidate();
      setCloseDealPlot(null);
      setCloseDealForm({ area_sqft: "", price_per_sqft: "", registry_date: "", notes: "" });
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to close deal"),
  });

  const editPlotMutation = useMutation({
    mutationFn: ({ type, plotId, payload }) => {
      const url = type === "site_plot"
        ? `/api/partnerships/${id}/site-plots/${plotId}`
        : `/api/partnerships/${id}/plot-buyers/${plotId}`;
      return api.put(url, payload);
    },
    onSuccess: () => {
      invalidate();
      setEditingPlot(null);
      setEditPlotForm({ plot_number: "", area_sqft: "", price_per_sqft: "", notes: "", side_north_ft: "", side_south_ft: "", side_east_ft: "", side_west_ft: "" });
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to update plot"),
  });

  const deletePlotMutation = useMutation({
    mutationFn: ({ type, plotId }) => {
      const url = type === "site_plot"
        ? `/api/partnerships/${id}/site-plots/${plotId}`
        : `/api/partnerships/${id}/plot-buyers/${plotId}`;
      return api.delete(url);
    },
    onSuccess: () => invalidate(),
    onError: (err) => alert(err?.response?.data?.detail || "Failed to delete plot"),
  });

  // ─── Handlers ───────────────────────────────────────────
  const handleAddTxn = () => {
    const txnType = txnForm.txn_type;
    const isOutflow = OUTFLOW_TYPES.includes(txnType);
    const isInflow = INFLOW_TYPES.includes(txnType);
    const isTransfer = TRANSFER_TYPES.includes(txnType);

    let memberId = null;
    if (isOutflow && txnForm.member_id && !txnForm.from_partnership_pot) memberId = parseInt(txnForm.member_id);
    if (isTransfer && txnForm.member_id) memberId = parseInt(txnForm.member_id); // FROM partner

    const isBuyerToSeller = ["buyer_advance", "buyer_payment"].includes(txnType) && txnForm.received_by_member_id === "seller";
    let receivedByMemberId = null;
    if (isInflow && txnForm.received_by_member_id && txnForm.received_by_member_id !== "seller") receivedByMemberId = parseInt(txnForm.received_by_member_id);
    if (isTransfer && txnForm.received_by_member_id) receivedByMemberId = parseInt(txnForm.received_by_member_id); // TO partner

    // Only send account_id if Self is the payer (outflow) or receiver (inflow/transfer)
    let accountId = null;
    if (isOutflow) {
      const payerMember = members.find(m => String(m.member?.id) === String(txnForm.member_id));
      if (payerMember?.member?.is_self && txnForm.account_id) {
        accountId = parseInt(txnForm.account_id);
      }
    } else if (isInflow && !txnForm.received_by_member_id && txnForm.account_id) {
      // Self received (no received_by_member_id means Self)
      accountId = parseInt(txnForm.account_id);
    } else if (isTransfer && txnForm.account_id) {
      const toMember = members.find(m => String(m.member?.id) === String(txnForm.received_by_member_id));
      if (toMember?.member?.is_self) accountId = parseInt(txnForm.account_id);
    }

    addTxnMutation.mutate({
      txn_type: txnType,
      amount: parseFloat(txnForm.amount) || 0,
      txn_date: txnForm.txn_date,
      payment_mode: txnForm.payment_mode,
      description: (() => { const base = txnForm.description?.trim() || ""; return (isBuyerToSeller ? [base, "→ Paid directly to Seller"].filter(Boolean).join(" · ") : base) || null; })(),
      account_id: accountId,
      member_id: memberId,
      received_by_member_id: receivedByMemberId,
      plot_buyer_id: txnForm.plot_buyer_id ? parseInt(txnForm.plot_buyer_id) : null,
      site_plot_id: txnForm.site_plot_id ? parseInt(txnForm.site_plot_id) : null,
      broker_name: txnType === "broker_commission" ? (txnForm.broker_name?.trim() || null) : null,
      from_partnership_pot: OUTFLOW_TYPES.includes(txnType) ? txnForm.from_partnership_pot : false,
    });
  };

  const openEditTxn = (txn) => {
    setEditingTxnId(txn.id);
    setEditTxnForm({
      txn_type: txn.txn_type,
      amount: String(txn.amount),
      txn_date: txn.txn_date,
      payment_mode: txn.payment_mode || "cash",
      account_id: txn.account_id ? String(txn.account_id) : "",
      member_id: txn.member_id ? String(txn.member_id) : "",
      received_by_member_id: txn.received_by_member_id
        ? String(txn.received_by_member_id)
        : (["buyer_advance", "buyer_payment"].includes(txn.txn_type) && txn.description?.includes("→ Paid directly to Seller") ? "seller" : ""),
      description: (txn.description || "").replace(" · → Paid directly to Seller", "").replace("→ Paid directly to Seller · ", "").replace("→ Paid directly to Seller", "").trim(),
      plot_buyer_id: txn.plot_buyer_id ? String(txn.plot_buyer_id) : "",
      site_plot_id: txn.site_plot_id ? String(txn.site_plot_id) : "",
      broker_name: txn.broker_name || "",
      from_partnership_pot: txn.from_partnership_pot || false,
    });
  };

  const handleUpdateTxn = () => {
    if (!editTxnForm || !editingTxnId) return;
    const txnType = editTxnForm.txn_type;
    const isOutflow = OUTFLOW_TYPES.includes(txnType);
    const isInflow = INFLOW_TYPES.includes(txnType);
    const isTransfer = txnType === "partner_transfer";

    // Only send account_id if Self is the payer/receiver
    let accountId = null;
    if (isOutflow) {
      const payerMember = members.find(m => String(m.member?.id) === String(editTxnForm.member_id));
      if (payerMember?.member?.is_self && editTxnForm.account_id) {
        accountId = parseInt(editTxnForm.account_id);
      }
    } else if (isInflow && !editTxnForm.received_by_member_id && editTxnForm.account_id) {
      accountId = parseInt(editTxnForm.account_id);
    } else if (isTransfer && editTxnForm.account_id) {
      const toMember = members.find(m => String(m.member?.id) === String(editTxnForm.received_by_member_id));
      if (toMember?.member?.is_self) accountId = parseInt(editTxnForm.account_id);
    }

    let memberId = editTxnForm.member_id ? parseInt(editTxnForm.member_id) : null;
    let receivedByMemberId = null;
    if (isTransfer) {
      receivedByMemberId = editTxnForm.received_by_member_id ? parseInt(editTxnForm.received_by_member_id) : null;
    } else {
      receivedByMemberId = editTxnForm.received_by_member_id && editTxnForm.received_by_member_id !== "seller" ? parseInt(editTxnForm.received_by_member_id) : null;
    }

    updateTxnMutation.mutate({
      txnId: editingTxnId,
      payload: {
        txn_type: txnType,
        amount: parseFloat(editTxnForm.amount) || 0,
        txn_date: editTxnForm.txn_date,
        payment_mode: editTxnForm.payment_mode,
        description: (() => {
          const isBTS = ["buyer_advance", "buyer_payment"].includes(txnType) && editTxnForm.received_by_member_id === "seller";
          const base = (editTxnForm.description || "").replace(" · → Paid directly to Seller", "").replace("→ Paid directly to Seller · ", "").replace("→ Paid directly to Seller", "").trim();
          return (isBTS ? [base, "→ Paid directly to Seller"].filter(Boolean).join(" · ") : base) || null;
        })(),
        account_id: accountId,
        member_id: memberId,
        received_by_member_id: receivedByMemberId,
        plot_buyer_id: editTxnForm.plot_buyer_id ? parseInt(editTxnForm.plot_buyer_id) : null,
        site_plot_id: editTxnForm.site_plot_id ? parseInt(editTxnForm.site_plot_id) : null,
        broker_name: editTxnForm.broker_name?.trim() || null,
        from_partnership_pot: editTxnForm.from_partnership_pot || false,
      },
    });
  };

  const handleAddMember = () => {
    addMemberMutation.mutate({
      contact_id: memberForm.is_self ? null : memberForm.contact_id ? parseInt(memberForm.contact_id) : null,
      is_self: memberForm.is_self,
      share_percentage: parseFloat(memberForm.share_percentage) || 0,
      notes: memberForm.notes?.trim() || null,
    });
  };

  const handleSettle = () => {
    settleMutation.mutate({
      total_received: settleForm.total_received ? parseFloat(settleForm.total_received) : null,
      actual_end_date: settleForm.actual_end_date || null,
      notes: settleForm.notes?.trim() || null,
    });
  };

  const openEditMember = (m) => {
    setEditMemberId(m.member?.id);
    setEditMemberForm({
      share_percentage: String(m.member?.share_percentage ?? ""),
      notes: m.member?.notes || "",
    });
    setShowEditMemberModal(true);
  };

  const handleEditMember = () => {
    const payload = {};
    if (editMemberForm.share_percentage !== "") payload.share_percentage = parseFloat(editMemberForm.share_percentage);
    payload.notes = editMemberForm.notes?.trim() || null;
    editMemberMutation.mutate({ memberId: editMemberId, payload });
  };

  const handleCreateBuyer = () => {
    if (buyerForm.area_sqft && remainingArea !== null && parseFloat(buyerForm.area_sqft) > remainingArea) {
      return alert(`Area exceeds available space. Remaining: ${remainingArea.toFixed(2)} sq ft.`);
    }
    createBuyerMutation.mutate({
      name: buyerForm.name.trim(),
      phone: buyerForm.phone?.trim() || null,
      city: buyerForm.city?.trim() || null,
      notes: buyerForm.notes?.trim() || null,
      area_sqft: buyerForm.area_sqft ? parseFloat(buyerForm.area_sqft) : null,
      rate_per_sqft: buyerForm.rate_per_sqft ? parseFloat(buyerForm.rate_per_sqft) : null,
      side_north_ft: buyerForm.side_north_ft ? parseFloat(buyerForm.side_north_ft) : null,
      side_south_ft: buyerForm.side_south_ft ? parseFloat(buyerForm.side_south_ft) : null,
      side_east_ft: buyerForm.side_east_ft ? parseFloat(buyerForm.side_east_ft) : null,
      side_west_ft: buyerForm.side_west_ft ? parseFloat(buyerForm.side_west_ft) : null,
    });
  };

  const handleAddPlot = () => {
    if (plotForm.area_sqft && remainingArea !== null && parseFloat(plotForm.area_sqft) > remainingArea) {
      return alert(`Area exceeds available space. Remaining: ${remainingArea.toFixed(2)} sq ft.`);
    }
    addPlotMutation.mutate({
      plot_number: plotForm.plot_number?.trim() || null,
      area_sqft: plotForm.area_sqft ? parseFloat(plotForm.area_sqft) : null,
      rate_per_sqft: plotForm.rate_per_sqft ? parseFloat(plotForm.rate_per_sqft) : null,
      side_north_ft: plotForm.side_north_ft ? parseFloat(plotForm.side_north_ft) : null,
      side_south_ft: plotForm.side_south_ft ? parseFloat(plotForm.side_south_ft) : null,
      side_east_ft: plotForm.side_east_ft ? parseFloat(plotForm.side_east_ft) : null,
      side_west_ft: plotForm.side_west_ft ? parseFloat(plotForm.side_west_ft) : null,
      notes: plotForm.notes?.trim() || null,
    });
  };

  const handleAssignBuyer = () => {
    if (!assigningBuyerTo) return;
    const payload = {
      plot_type: assigningBuyerTo.type,
      plot_id: assigningBuyerTo.id,
    };
    if (assignBuyerMode === "existing") {
      if (!assignBuyerForm.contact_id) return alert("Select an existing contact");
      payload.contact_id = parseInt(assignBuyerForm.contact_id);
    } else {
      if (!assignBuyerForm.name.trim()) return alert("Buyer name is required");
      payload.name = assignBuyerForm.name.trim();
      payload.phone = assignBuyerForm.phone?.trim() || null;
      payload.city = assignBuyerForm.city?.trim() || null;
    }
    assignBuyerMutation.mutate(payload);
  };

  // ─── My View scale helper (must be before early returns — Rules of Hooks) ───
  const [myViewMode, setMyViewMode] = useState(false);

  // ─── Timeline events (useMemo must be before early returns) ────────────────
  const _transactions = data?.transactions || [];
  const _partnership = data?.partnership || {};
  const _isSettled = data?.partnership?.status === "settled";
  const timelineEvents = useMemo(() => {
    const events = [];
    if (_partnership.start_date) events.push({ label: "Deal Started", date: _partnership.start_date, done: true, color: "indigo" });
    const firstAdvance = [..._transactions].reverse().find(t => t.txn_type === "advance_to_seller" || t.txn_type === "advance_given");
    if (firstAdvance) events.push({ label: "Token / First Advance", date: firstAdvance.txn_date, done: true, color: "purple" });
    const hasBuyer = _transactions.some(t => ["buyer_advance", "buyer_payment"].includes(t.txn_type));
    if (hasBuyer) events.push({ label: "Buyer Found", date: null, done: true, color: "emerald" });
    if (_partnership.expected_end_date && !_isSettled) {
      const isPast = new Date(_partnership.expected_end_date) < new Date();
      events.push({ label: "Registry / Handover", date: _partnership.expected_end_date, done: false, isPast, color: isPast ? "rose" : "amber" });
    }
    if (_isSettled && _partnership.actual_end_date) events.push({ label: "Settled", date: _partnership.actual_end_date, done: true, color: "emerald" });
    return events;
  }, [_transactions, _partnership, _isSettled]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-indigo-200 border-t-indigo-600"></div>
      </div>
    );
  }

  if (isError || !data?.partnership) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-500 mb-4">Partnership not found.</p>
          <button onClick={() => navigate("/partnerships")} className="text-indigo-600 hover:underline">← Back to Partnerships</button>
        </div>
      </div>
    );
  }

  const partnership = data.partnership;
  const members = data.members || [];
  const transactions = data.transactions || [];
  const summary = data.summary || {};
  const linkedProperty = data.linked_property;
  const plotBuyers = data.plot_buyers || [];
  const sitePlots = data.site_plots || [];
  const isLinkedToProperty = Boolean(partnership.linked_property_deal_id);
  const isActive = partnership.status === "active";
  const isSettled = partnership.status === "settled";
  const isPlotDeal = linkedProperty?.property_type === "plot";

  const totalPropertyArea = parseFloat(linkedProperty?.total_area_sqft || 0);
  const usedArea = isPlotDeal
    ? plotBuyers.reduce((s, b) => s + parseFloat(b.area_sqft || 0), 0)
    : sitePlots.reduce((s, sp) => s + parseFloat(sp.area_sqft || 0), 0);
  const remainingArea = totalPropertyArea > 0 ? totalPropertyArea - usedArea : null;

  const totalAdvance = members.reduce((sum, m) => sum + parseFloat(m.member?.advance_contributed || 0), 0);
  const selfMember = members.find((m) => m.member?.is_self);
  const selfShare = selfMember ? parseFloat(selfMember.member?.share_percentage || 0) : 0;

  const totalOutflow = parseFloat(summary.total_outflow || 0);
  const totalInflow = parseFloat(summary.total_inflow || 0);
  const netPnl = parseFloat(summary.our_pnl || 0);

  const settleTotal = parseFloat(settleForm.total_received || 0);
  const settleProfit = settleTotal - totalOutflow;

  const scale = (v) => myViewMode && selfShare > 0 ? v * (selfShare / 100) : v;

  // ─── WhatsApp report ─────────────────────────────────────────────
  const handleWhatsAppShare = () => {
    const cashOnHand = totalInflow - parseFloat(summary.total_outflow || 0) + parseFloat(summary.advance_to_seller || 0) + parseFloat(summary.remaining_to_seller || 0);
    const sellerDue = (() => {
      if (!linkedProperty) return 0;
      const sellerTotal = parseFloat(linkedProperty.total_seller_value || 0);
      const paid = parseFloat(summary.advance_to_seller || 0) + parseFloat(summary.remaining_to_seller || 0);
      return Math.max(0, sellerTotal - paid);
    })();
    const lines = [
      `*${partnership.title}* — Partnership Update`,
      `Status: ${partnership.status.toUpperCase()}`,
      ``,
      `📊 *Financial Snapshot*`,
      `Total Invested: ${formatCurrency(scale(totalOutflow))}`,
      `Buyer Inflows: ${formatCurrency(scale(parseFloat(summary.buyer_inflow || 0)))}`,
      `Net P&L: ${formatCurrency(scale(netPnl))}`,
      ``,
      sellerDue > 0 ? `⚠️ Remaining to Seller: ${formatCurrency(scale(sellerDue))}` : `✅ Seller fully paid`,
      ``,
      myViewMode ? `(your ${selfShare}% share view)` : `(full partnership view)`,
      `Generated: ${new Date().toLocaleDateString("en-IN")}`,
    ];
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  };

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Hero ── */}
      <div className="bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-600 px-6 pt-8 pb-6">
        <div className="max-w-5xl mx-auto">
          {/* Top row */}
          <div className="flex items-start justify-between gap-3 mb-6">
            <div>
              <button onClick={() => navigate("/partnerships")} className="text-indigo-200 hover:text-white text-xs flex items-center gap-1 mb-2 transition-colors">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
                Partnerships
              </button>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-white">{partnership.title}</h1>
                <span className={`text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full border ${partnership.status === "active" ? "bg-emerald-400/20 text-emerald-200 border-emerald-300/30" : "bg-white/10 text-white/70 border-white/20"}`}>
                  {partnership.status}
                </span>
                {(() => {
                  const isPastDue = partnership.expected_end_date && partnership.status === "active" && new Date(partnership.expected_end_date) < new Date();
                  return isPastDue && <span className="text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-400/30 text-amber-200 border border-amber-300/40 animate-pulse">⏰ Pending Settlement</span>;
                })()}
              </div>
              <p className="text-indigo-200 text-sm mt-1">{members.length} partner{members.length !== 1 ? "s" : ""} · {transactions.length} transaction{transactions.length !== 1 ? "s" : ""}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
              {/* My View toggle */}
              <button
                onClick={() => setMyViewMode(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border transition-all ${myViewMode ? "bg-white text-indigo-700 border-white shadow-lg" : "bg-indigo-600/50 text-indigo-100 border-indigo-400/50 hover:bg-indigo-600/70"}`}
                title={`Toggle to see your ${selfShare}% share`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
                {myViewMode ? `My ${selfShare}%` : "My View"}
              </button>
              {/* WhatsApp */}
              <button onClick={handleWhatsAppShare} className="flex items-center gap-1.5 px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-semibold transition-colors shadow-lg shadow-green-900/20" title="Share WhatsApp Status Report">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
                Share
              </button>
              <button onClick={() => navigate(`/partnerships/${id}/edit`)} className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium border border-white/20 transition-colors">
                Edit
              </button>
              <button onClick={() => { if (window.confirm("Delete this partnership and all its data?")) deletePartnershipMutation.mutate(); }} className="px-3 py-2 bg-rose-500/80 hover:bg-rose-500 text-white rounded-xl text-sm font-medium border border-rose-400/40 transition-colors">
                Delete
              </button>
            </div>
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white/10 backdrop-blur rounded-2xl p-4 border border-white/20">
              <p className="text-indigo-200 text-[11px] font-semibold uppercase tracking-wider">Total Invested</p>
              <p className="text-white text-xl font-bold mt-1 font-mono tabular-nums">{formatCurrency(scale(totalOutflow))}</p>
              {myViewMode && <p className="text-indigo-300 text-[10px]">your {selfShare}% share</p>}
            </div>
            <div className="bg-white/10 backdrop-blur rounded-2xl p-4 border border-white/20">
              <p className="text-indigo-200 text-[11px] font-semibold uppercase tracking-wider">Total Inflow</p>
              <p className="text-emerald-300 text-xl font-bold mt-1 font-mono tabular-nums">{formatCurrency(scale(totalInflow))}</p>
            </div>
            <div className={`backdrop-blur rounded-2xl p-4 border ${netPnl >= 0 ? "bg-emerald-400/10 border-emerald-300/30" : "bg-rose-400/10 border-rose-300/30"}`}>
              <p className="text-indigo-200 text-[11px] font-semibold uppercase tracking-wider">Net P&L</p>
              <p className={`text-xl font-bold mt-1 font-mono tabular-nums ${netPnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{formatCurrency(scale(netPnl))}</p>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-2xl p-4 border border-white/20">
              <p className="text-indigo-200 text-[11px] font-semibold uppercase tracking-wider">Your Share</p>
              <p className="text-violet-300 text-xl font-bold mt-1 font-mono">{selfShare > 0 ? `${selfShare}%` : "—"}</p>
            </div>
          </div>
        </div>
      </div>

      <PageBody>
        <div className="space-y-5">

          {/* Property link banner */}
          {isLinkedToProperty && linkedProperty && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-start gap-3">
              <span className="text-indigo-500 text-xl">🏘</span>
              <div>
                <p className="text-sm font-semibold text-indigo-800">Linked to property: {linkedProperty.title}</p>
                <Link to={`/properties/${partnership.linked_property_deal_id}`} className="text-sm text-indigo-600 hover:underline">View Property →</Link>
                <p className="text-xs text-indigo-600 mt-1">All financial transactions are managed here. Property page shows synced read-only data.</p>
              </div>
            </div>
          )}

          {/* ── SELLER MASTER CARD ── */}
          {isLinkedToProperty && linkedProperty && (() => {
            const sellerTotal = parseFloat(linkedProperty.total_seller_value || 0);
            if (!sellerTotal) return null;
            const alreadyPaid = parseFloat(summary.advance_to_seller || 0) + parseFloat(summary.remaining_to_seller || 0);
            const paidPct = Math.min(100, sellerTotal > 0 ? (alreadyPaid / sellerTotal) * 100 : 0);
            const outstanding = Math.max(0, sellerTotal - alreadyPaid);
            const sellerTxns = transactions.filter(t => ["advance_to_seller", "advance_given", "remaining_to_seller"].includes(t.txn_type));
            return (
              <div className="bg-white rounded-2xl shadow-sm border border-purple-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-purple-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" /></svg>
                    </div>
                    <h2 className="text-base font-bold text-slate-900">Seller Payment Tracker</h2>
                  </div>
                  {isActive && outstanding > 0 && (
                    <button
                      onClick={() => {
                        setTxnForm(p => ({ ...p, txn_type: "remaining_to_seller", amount: String(outstanding) }));
                        setShowTxnForm(true);
                      }}
                      className="px-3 py-1.5 bg-purple-600 text-white rounded-xl text-xs font-semibold hover:bg-purple-700 transition-colors shadow-sm"
                    >
                      + Record Payment
                    </button>
                  )}
                </div>

                {/* Progress bar */}
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Paid <span className="text-purple-700 font-semibold font-mono">{formatCurrency(scale(alreadyPaid))}</span></span>
                    <span>Total <span className="font-semibold font-mono text-slate-700">{formatCurrency(scale(sellerTotal))}</span></span>
                  </div>
                  <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-400 to-purple-600 rounded-full transition-all duration-700"
                      style={{ width: `${paidPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">{paidPct.toFixed(0)}% paid</span>
                    <span className={`font-bold font-mono ${outstanding > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {outstanding > 0 ? `${formatCurrency(scale(outstanding))} still due` : "Fully paid ✓"}
                    </span>
                  </div>
                </div>

                {/* Seller payment history */}
                {sellerTxns.length > 0 && (
                  <div className="border-t border-slate-100 pt-3 space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Payment History</p>
                    {sellerTxns.map((t) => (
                      <div key={t.id} className="flex justify-between items-center py-1.5 border-b border-slate-50 last:border-0">
                        <div>
                          <span className="text-xs font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-100">
                            {TXN_TYPE_LABELS[t.txn_type] || t.txn_type}
                          </span>
                          {t.description && <p className="text-[11px] text-slate-400 mt-0.5">{t.description}</p>}
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold font-mono text-rose-600">−{formatCurrency(scale(parseFloat(t.amount || 0)))}</p>
                          <p className="text-[10px] text-slate-400">{formatDate(t.txn_date)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── MAIN GRID: left + right sidebar ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-5">

              {/* ── PARTNER NET POSITION ── */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-bold text-slate-800">Partner Net Position</h2>
                  {isActive && (
                    <button onClick={() => setShowAddMemberModal(true)} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-xl text-sm hover:bg-indigo-100">+ Add Partner</button>
                  )}
                </div>

                {members.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">No partners added yet.</p>
                ) : (
                  <div className="space-y-3">
                    {members.map((m, i) => {
                      const memberId = m.member?.id;
                      const name = m.member?.is_self ? "Self (You)" : m.contact?.name || "Unknown";
                      const sharePct = parseFloat(m.member?.share_percentage || 0);
                      const advance = parseFloat(m.member?.advance_contributed || 0);
                      const expensesPaid = transactions
                        .filter(t => ["expense", "other_expense"].includes(t.txn_type) && t.member_id === memberId)
                        .reduce((s, t) => s + parseFloat(t.amount || 0), 0);
                      const withdrawals = transactions
                        .filter(t => t.txn_type === "partner_transfer" && t.member_id === memberId)
                        .reduce((s, t) => s + parseFloat(t.amount || 0), 0);
                      const profitTaken = transactions
                        .filter(t => t.txn_type === "profit_received" && t.received_by_member_id === memberId)
                        .reduce((s, t) => s + parseFloat(t.amount || 0), 0);
                      const currentStake = advance + expensesPaid - withdrawals;
                      return (
                        <div key={i} className={`rounded-xl border p-4 ${m.member?.is_self ? "bg-indigo-50 border-indigo-200" : "bg-slate-50 border-slate-200"}`}>
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <span className="text-sm font-bold text-slate-900">{name}</span>
                              {m.member?.is_self && <span className="ml-1.5 text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full font-semibold">YOU</span>}
                              {m.contact?.phone && <p className="text-xs text-slate-400 mt-0.5">{m.contact.phone}</p>}
                            </div>
                            <div className="text-right">
                              <span className="text-lg font-bold font-mono text-violet-700">{sharePct}%</span>
                              <p className="text-[10px] text-slate-400">equity share</p>
                            </div>
                          </div>
                          {/* Stake breakdown: Advance + Expenses − Withdrawals = Stake */}
                          <div className="flex items-center gap-1 text-xs flex-wrap mb-2">
                            <span className="font-mono text-slate-600 bg-slate-200 rounded px-1.5 py-0.5">{formatCurrency(scale(advance))}</span>
                            <span className="text-slate-400">advance</span>
                            {expensesPaid > 0 && <>
                              <span className="text-slate-400">+</span>
                              <span className="font-mono text-blue-600 bg-blue-50 rounded px-1.5 py-0.5 border border-blue-100">{formatCurrency(scale(expensesPaid))}</span>
                              <span className="text-slate-400">expenses</span>
                            </>}
                            {withdrawals > 0 && <>
                              <span className="text-slate-400">−</span>
                              <span className="font-mono text-amber-600 bg-amber-50 rounded px-1.5 py-0.5 border border-amber-100">{formatCurrency(scale(withdrawals))}</span>
                              <span className="text-slate-400">out</span>
                            </>}
                            <span className="text-slate-400">=</span>
                            <span className={`font-mono font-bold rounded px-1.5 py-0.5 ${currentStake > 0 ? "text-emerald-700 bg-emerald-50 border border-emerald-100" : "text-rose-700 bg-rose-50 border border-rose-100"}`}>{formatCurrency(scale(currentStake))}</span>
                            <span className="text-slate-500 font-medium">current stake</span>
                          </div>
                          {profitTaken > 0 && (
                            <p className="text-xs text-emerald-600"><span className="font-mono">{formatCurrency(scale(profitTaken))}</span> profit already taken</p>
                          )}
                          {isActive && (
                            <div className="flex gap-2 mt-2 pt-2 border-t border-slate-200">
                              <button onClick={() => openEditMember(m)} className="text-xs text-indigo-600 hover:underline">Edit</button>
                              <button onClick={() => { if (window.confirm(`Remove ${name}?`)) deleteMemberMutation.mutate(memberId); }} className="text-xs text-rose-600 hover:underline">Delete</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* Reimbursement Queue */}
                    {(() => {
                      const queue = members
                        .map(m => {
                          const memberId = m.member?.id;
                          const name = m.member?.is_self ? "Self (You)" : m.contact?.name || "Unknown";
                          const owed = transactions
                            .filter(t => ["expense", "other_expense"].includes(t.txn_type) && t.member_id === memberId && !t.from_partnership_pot)
                            .reduce((s, t) => s + parseFloat(t.amount || 0), 0);
                          return { name, owed, isSelf: m.member?.is_self };
                        })
                        .filter(r => r.owed > 0);
                      if (queue.length === 0) return null;
                      return (
                        <div className="mt-3 pt-3 border-t border-slate-200">
                          <p className="text-xs font-semibold text-blue-800 mb-2 flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                            Reimbursement Queue <span className="font-normal text-slate-400">(out-of-pocket expenses before profit split)</span>
                          </p>
                          <div className="space-y-1.5">
                            {queue.map((r, i) => (
                              <div key={i} className="flex justify-between items-center bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                                <span className="text-sm text-blue-900 font-medium">{r.name}</span>
                                <span className="text-sm font-bold font-mono text-blue-700">{formatCurrency(scale(r.owed))} to reimburse</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* ── INTERACTIVE TIMELINE ── */}
              {timelineEvents.length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                  <h2 className="text-base font-bold text-slate-800 mb-4">Deal Timeline</h2>
                  <div className="relative pl-5">
                    <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-slate-200 rounded-full" />
                    <div className="space-y-4">
                      {timelineEvents.map((ev, i) => (
                        <div key={i} className="relative flex items-start gap-3">
                          <div className={`absolute -left-3 top-1 w-4 h-4 rounded-full border-2 border-white shadow-sm flex items-center justify-center ${ev.done ? `bg-${ev.color}-500` : ev.isPast ? "bg-rose-400" : "bg-amber-400"}`}>
                            {ev.done && (
                              <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                            )}
                          </div>
                          <div>
                            <p className={`text-sm font-semibold ${ev.done ? "text-slate-800" : ev.isPast ? "text-rose-700" : "text-amber-700"}`}>{ev.label}</p>
                            {ev.date && <p className="text-xs text-slate-400">{formatDate(ev.date)}{ev.isPast ? " (overdue)" : ""}</p>}
                            {!ev.done && !ev.isPast && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">NEXT</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── PLOT BUYERS / SITE PLOTS ── */}
              {isLinkedToProperty && (plotBuyers.length > 0 || sitePlots.length > 0 || isActive) && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-bold text-slate-800">{isPlotDeal ? "Plot Subdivisions & Buyers" : "Site Plots & Buyers"}</h2>
                    {isActive && (
                      <div className="flex gap-2">
                        <button onClick={() => { setShowAddPlotForm(!showAddPlotForm); setShowBuyerForm(false); }} className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl text-sm hover:bg-blue-100">+ Add Plot</button>
                        <button onClick={() => { setShowBuyerForm(!showBuyerForm); setShowAddPlotForm(false); }} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-sm hover:bg-emerald-100">+ Quick Buyer</button>
                      </div>
                    )}
                  </div>

                  {/* Add Plot Form */}
                  {showAddPlotForm && (
                    <div className="mb-4 p-4 bg-blue-50/50 rounded-xl border border-blue-200/60 space-y-3">
                      <p className="text-xs font-semibold text-blue-800 mb-1">Add a plot subdivision (buyer can be assigned later)</p>
                      {!isPlotDeal && (
                        <InputField label="Plot Number">
                          <input type="text" value={plotForm.plot_number} onChange={(e) => setPlotForm(p => ({ ...p, plot_number: e.target.value }))} className={inputCls} placeholder="e.g. A-1" />
                        </InputField>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <InputField label="Area (sq ft)">
                          <input type="number" value={plotForm.area_sqft} onChange={(e) => setPlotForm(p => ({ ...p, area_sqft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                          {remainingArea !== null && <p className="text-xs text-blue-600 mt-0.5">Remaining: {remainingArea.toFixed(2)} sq ft</p>}
                        </InputField>
                        <InputField label={isPlotDeal ? "Rate (₹/sq ft)" : "Sold Price (₹/sq ft)"}>
                          <input type="number" value={plotForm.rate_per_sqft} onChange={(e) => setPlotForm(p => ({ ...p, rate_per_sqft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                        </InputField>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <InputField label="North (ft)"><input type="number" value={plotForm.side_north_ft} onChange={(e) => setPlotForm(p => ({ ...p, side_north_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" /></InputField>
                        <InputField label="South (ft)"><input type="number" value={plotForm.side_south_ft} onChange={(e) => setPlotForm(p => ({ ...p, side_south_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" /></InputField>
                        <InputField label="East (ft)"><input type="number" value={plotForm.side_east_ft} onChange={(e) => setPlotForm(p => ({ ...p, side_east_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" /></InputField>
                        <InputField label="West (ft)"><input type="number" value={plotForm.side_west_ft} onChange={(e) => setPlotForm(p => ({ ...p, side_west_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" /></InputField>
                      </div>
                      <InputField label="Notes">
                        <input type="text" value={plotForm.notes} onChange={(e) => setPlotForm(p => ({ ...p, notes: e.target.value }))} className={inputCls} placeholder="Optional" />
                      </InputField>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setShowAddPlotForm(false)} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200">Cancel</button>
                        <button onClick={handleAddPlot} disabled={addPlotMutation.isPending} className="px-4 py-1.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl text-sm font-medium hover:from-blue-600 hover:to-blue-700 shadow-sm active:scale-[0.98] disabled:opacity-50">
                          {addPlotMutation.isPending ? "Adding..." : "Add Plot"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Quick Buyer Form */}
                  {showBuyerForm && (
                    <div className="mb-4 p-4 bg-emerald-50/50 rounded-xl border border-emerald-200/60 space-y-3">
                      <p className="text-xs font-semibold text-emerald-800 mb-1">Quick: Create buyer contact + plot together</p>
                      <div className="grid grid-cols-2 gap-3">
                        <InputField label="Buyer Name *"><input type="text" value={buyerForm.name} onChange={(e) => setBuyerForm(p => ({ ...p, name: e.target.value }))} className={inputCls} placeholder="Full name" /></InputField>
                        <InputField label="Phone"><input type="text" value={buyerForm.phone} onChange={(e) => setBuyerForm(p => ({ ...p, phone: e.target.value }))} className={inputCls} placeholder="Optional" /></InputField>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <InputField label="City"><input type="text" value={buyerForm.city} onChange={(e) => setBuyerForm(p => ({ ...p, city: e.target.value }))} className={inputCls} placeholder="Optional" /></InputField>
                        <InputField label="Notes"><input type="text" value={buyerForm.notes} onChange={(e) => setBuyerForm(p => ({ ...p, notes: e.target.value }))} className={inputCls} placeholder="Optional" /></InputField>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <InputField label="Area (sq ft)">
                          <input type="number" value={buyerForm.area_sqft} onChange={(e) => setBuyerForm(p => ({ ...p, area_sqft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                          {remainingArea !== null && <p className="text-xs text-emerald-600 mt-0.5">Remaining: {remainingArea.toFixed(2)} sq ft</p>}
                        </InputField>
                        <InputField label="Rate (₹/sq ft)"><input type="number" value={buyerForm.rate_per_sqft} onChange={(e) => setBuyerForm(p => ({ ...p, rate_per_sqft: e.target.value }))} className={inputCls} placeholder="0" min="0" /></InputField>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <InputField label="North (ft)"><input type="number" value={buyerForm.side_north_ft} onChange={(e) => setBuyerForm(p => ({ ...p, side_north_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" /></InputField>
                        <InputField label="South (ft)"><input type="number" value={buyerForm.side_south_ft} onChange={(e) => setBuyerForm(p => ({ ...p, side_south_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" /></InputField>
                        <InputField label="East (ft)"><input type="number" value={buyerForm.side_east_ft} onChange={(e) => setBuyerForm(p => ({ ...p, side_east_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" /></InputField>
                        <InputField label="West (ft)"><input type="number" value={buyerForm.side_west_ft} onChange={(e) => setBuyerForm(p => ({ ...p, side_west_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" /></InputField>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setShowBuyerForm(false)} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200">Cancel</button>
                        <button onClick={handleCreateBuyer} disabled={!buyerForm.name.trim() || createBuyerMutation.isPending} className="px-4 py-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl text-sm font-medium hover:from-emerald-600 hover:to-emerald-700 shadow-sm shadow-emerald-500/20 active:scale-[0.98] disabled:opacity-50">
                          {createBuyerMutation.isPending ? "Creating..." : "Create Buyer"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Assign Buyer Inline */}
                  {assigningBuyerTo && (
                    <div className="mb-4 p-4 bg-amber-50/50 rounded-xl border border-amber-200/60 space-y-3">
                      <p className="text-xs font-semibold text-amber-800 mb-1">{assigningBuyerTo.isReassign ? "Reassign buyer for" : "Assign buyer to"}: {assigningBuyerTo.label}</p>
                      <div className="flex gap-2 mb-2">
                        <button onClick={() => setAssignBuyerMode("existing")} className={`px-3 py-1 rounded-lg text-xs font-medium ${assignBuyerMode === "existing" ? "bg-amber-200 text-amber-900" : "bg-white text-slate-600 border border-slate-200"}`}>Pick Existing Contact</button>
                        <button onClick={() => setAssignBuyerMode("new")} className={`px-3 py-1 rounded-lg text-xs font-medium ${assignBuyerMode === "new" ? "bg-amber-200 text-amber-900" : "bg-white text-slate-600 border border-slate-200"}`}>Create New Contact</button>
                      </div>
                      {assignBuyerMode === "existing" ? (
                        <InputField label="Select Contact">
                          <select value={assignBuyerForm.contact_id} onChange={(e) => setAssignBuyerForm(p => ({ ...p, contact_id: e.target.value }))} className={inputCls}>
                            <option value="">— Select buyer —</option>
                            {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ""}</option>)}
                          </select>
                        </InputField>
                      ) : (
                        <div className="grid grid-cols-3 gap-3">
                          <InputField label="Name *"><input type="text" value={assignBuyerForm.name} onChange={(e) => setAssignBuyerForm(p => ({ ...p, name: e.target.value }))} className={inputCls} placeholder="Full name" /></InputField>
                          <InputField label="Phone"><input type="text" value={assignBuyerForm.phone} onChange={(e) => setAssignBuyerForm(p => ({ ...p, phone: e.target.value }))} className={inputCls} placeholder="Optional" /></InputField>
                          <InputField label="City"><input type="text" value={assignBuyerForm.city} onChange={(e) => setAssignBuyerForm(p => ({ ...p, city: e.target.value }))} className={inputCls} placeholder="Optional" /></InputField>
                        </div>
                      )}
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => { setAssigningBuyerTo(null); setAssignBuyerForm({ contact_id: "", name: "", phone: "", city: "" }); }} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200">Cancel</button>
                        <button onClick={handleAssignBuyer} disabled={assignBuyerMutation.isPending} className="px-4 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-xl text-sm font-medium hover:from-amber-600 hover:to-amber-700 shadow-sm active:scale-[0.98] disabled:opacity-50">
                          {assignBuyerMutation.isPending ? "Assigning..." : "Assign Buyer"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Plot Buyer cards */}
                  {isPlotDeal ? (
                    plotBuyers.length > 0 ? (
                      <div className="space-y-3">
                        {plotBuyers.map((b) => {
                          const plotKey = `pb-${b.id}`;
                          const isExpanded = expandedPlotId === plotKey;
                          const totalValue = parseFloat(b.total_value || 0);
                          const totalPaid = parseFloat(b.total_paid || 0);
                          const paidPct = totalValue > 0 ? Math.min(100, (totalPaid / totalValue) * 100) : 0;
                          const plotTxns = transactions.filter(t => t.plot_buyer_id === b.id);
                          return (
                            <div key={b.id} className="border border-slate-200 rounded-xl overflow-hidden">
                              <div className="p-3 cursor-pointer hover:bg-slate-50/80 transition-colors" onClick={() => setExpandedPlotId(isExpanded ? null : plotKey)}>
                                <div className="flex justify-between items-start">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-slate-400 transition-transform duration-200 inline-block" style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                                      <p className="text-sm font-semibold text-slate-800">{b.buyer_name || <span className="text-slate-400 italic">No buyer assigned</span>}</p>
                                    </div>
                                    <p className="text-xs text-slate-500 ml-4">{b.area_sqft ? `${b.area_sqft} sq ft` : ""}{b.rate_per_sqft ? ` @ ₹${b.rate_per_sqft}/sqft` : ""}</p>
                                  </div>
                                  <div className="text-right ml-3 shrink-0">
                                    <p className="text-sm font-bold font-mono text-slate-800">{formatCurrency(scale(totalValue))}</p>
                                    <p className="text-xs text-emerald-600 font-mono">Paid: {formatCurrency(scale(totalPaid))}</p>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${b.status === "registry_done" ? "bg-emerald-100 text-emerald-700" : b.status === "advance_received" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{(b.status || "negotiating").replace(/_/g, " ")}</span>
                                  </div>
                                </div>
                                {totalValue > 0 && (
                                  <div className="mt-2 ml-4">
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-0.5"><span>{formatCurrency(scale(totalPaid))} paid</span><span>{formatCurrency(scale(totalValue - totalPaid))} remaining</span></div>
                                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-500" style={{ width: `${paidPct}%` }} /></div>
                                  </div>
                                )}
                                <div className="flex gap-2 mt-2 ml-4 flex-wrap">
                                  <button onClick={(e) => { e.stopPropagation(); setViewingPlot({ ...b, plotType: "plot_buyer" }); }} className="text-xs text-blue-600 hover:underline">View Details</button>
                                  {isActive && (
                                    <>
                                      <button onClick={(e) => { e.stopPropagation(); setAssigningBuyerTo({ type: "plot_buyer", id: b.id, label: b.buyer_name || `Plot Buyer #${b.id}`, isReassign: !!b.buyer_name }); }} className="text-xs text-amber-600 hover:underline">{b.buyer_name ? "Reassign" : "Assign Buyer"}</button>
                                      <button onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingPlot({ type: "plot_buyer", id: b.id, hasPaid: plotTxns.some(t => parseFloat(t.amount) > 0), area_sqft: b.area_sqft });
                                        setEditPlotForm({ plot_number: "", area_sqft: String(b.area_sqft || ""), price_per_sqft: String(b.rate_per_sqft || ""), notes: b.notes || "", side_north_ft: String(b.side_north_ft || ""), side_south_ft: String(b.side_south_ft || ""), side_east_ft: String(b.side_east_ft || ""), side_west_ft: String(b.side_west_ft || "") });
                                      }} className="text-xs text-indigo-600 hover:underline">Edit</button>
                                      {b.status !== "registry_done" && (
                                        <button onClick={(e) => { e.stopPropagation(); setCloseDealPlot({ type: "plot_buyer", id: b.id, label: b.buyer_name || `Buyer #${b.id}`, area_sqft: b.area_sqft, price_per_sqft: b.rate_per_sqft }); setCloseDealForm({ area_sqft: String(b.area_sqft || ""), price_per_sqft: String(b.rate_per_sqft || ""), registry_date: "", notes: "" }); }} className="text-xs text-emerald-600 hover:underline">Close Deal</button>
                                      )}
                                      <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete plot buyer entry?`)) deletePlotMutation.mutate({ type: "plot_buyer", plotId: b.id }); }} className="text-xs text-rose-600 hover:underline">Delete</button>
                                    </>
                                  )}
                                </div>
                              </div>
                              {isExpanded && plotTxns.length > 0 && (
                                <div className="border-t border-slate-100 bg-slate-50 p-3 space-y-2">
                                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Payment History</p>
                                  {plotTxns.map(t => (
                                    <div key={t.id} className="flex justify-between text-xs">
                                      <span className="text-slate-600">{formatDate(t.txn_date)} · {TXN_TYPE_LABELS[t.txn_type] || t.txn_type}</span>
                                      <span className="font-mono font-semibold text-emerald-600">+{formatCurrency(scale(parseFloat(t.amount || 0)))}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : <p className="text-sm text-slate-400 text-center py-4">No plot buyers yet. Add a plot to get started.</p>
                  ) : (
                    sitePlots.length > 0 ? (
                      <div className="space-y-3">
                        {sitePlots.map((sp) => {
                          const plotKey = `sp-${sp.id}`;
                          const isExpanded = expandedPlotId === plotKey;
                          const totalValue = parseFloat(sp.calculated_price || 0);
                          const totalPaid = parseFloat(sp.total_paid || 0);
                          const paidPct = totalValue > 0 ? Math.min(100, (totalPaid / totalValue) * 100) : 0;
                          const plotTxns = transactions.filter(t => t.site_plot_id === sp.id);
                          return (
                            <div key={sp.id} className="border border-slate-200 rounded-xl overflow-hidden">
                              <div className="p-3 cursor-pointer hover:bg-slate-50/80 transition-colors" onClick={() => setExpandedPlotId(isExpanded ? null : plotKey)}>
                                <div className="flex justify-between items-start">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-slate-400 inline-block transition-transform duration-200" style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                                      <p className="text-sm font-semibold text-slate-800">{sp.plot_number || `Plot #${sp.id}`}</p>
                                      {sp.buyer_name && <span className="text-xs text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded-full border border-teal-100">{sp.buyer_name}</span>}
                                    </div>
                                    <p className="text-xs text-slate-500 ml-4">{sp.area_sqft ? `${sp.area_sqft} sq ft` : ""}{sp.sold_price_per_sqft ? ` @ ₹${sp.sold_price_per_sqft}/sqft` : ""}</p>
                                  </div>
                                  <div className="text-right ml-3 shrink-0">
                                    <p className="text-sm font-bold font-mono text-slate-800">{formatCurrency(scale(totalValue))}</p>
                                    <p className="text-xs text-emerald-600 font-mono">Paid: {formatCurrency(scale(totalPaid))}</p>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${sp.status === "sold" ? "bg-emerald-100 text-emerald-700" : sp.status === "advance_received" ? "bg-amber-100 text-amber-700" : sp.status === "available" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>{(sp.status || "available").replace(/_/g, " ")}</span>
                                  </div>
                                </div>
                                {totalValue > 0 && (
                                  <div className="mt-2 ml-4">
                                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-teal-400 to-teal-500 rounded-full transition-all duration-500" style={{ width: `${paidPct}%` }} /></div>
                                  </div>
                                )}
                                <div className="flex gap-2 mt-2 ml-4 flex-wrap">
                                  <button onClick={(e) => { e.stopPropagation(); setViewingPlot({ ...sp, plotType: "site_plot" }); }} className="text-xs text-blue-600 hover:underline">View Details</button>
                                  {isActive && (
                                    <>
                                      <button onClick={(e) => { e.stopPropagation(); setAssigningBuyerTo({ type: "site_plot", id: sp.id, label: sp.plot_number || `Plot #${sp.id}`, isReassign: !!sp.buyer_name }); }} className="text-xs text-amber-600 hover:underline">{sp.buyer_name ? "Reassign Buyer" : "Assign Buyer"}</button>
                                      <button onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingPlot({ type: "site_plot", id: sp.id, hasPaid: plotTxns.some(t => parseFloat(t.amount) > 0) });
                                        setEditPlotForm({ plot_number: sp.plot_number || "", area_sqft: String(sp.area_sqft || ""), price_per_sqft: String(sp.sold_price_per_sqft || ""), notes: sp.notes || "", side_north_ft: String(sp.side_north_ft || ""), side_south_ft: String(sp.side_south_ft || ""), side_east_ft: String(sp.side_east_ft || ""), side_west_ft: String(sp.side_west_ft || "") });
                                      }} className="text-xs text-indigo-600 hover:underline">Edit</button>
                                      {sp.status !== "sold" && (
                                        <button onClick={(e) => { e.stopPropagation(); setCloseDealPlot({ type: "site_plot", id: sp.id, label: sp.plot_number || `Plot #${sp.id}`, area_sqft: sp.area_sqft, price_per_sqft: sp.sold_price_per_sqft }); setCloseDealForm({ area_sqft: String(sp.area_sqft || ""), price_per_sqft: String(sp.sold_price_per_sqft || ""), registry_date: "", notes: "" }); }} className="text-xs text-emerald-600 hover:underline">Close Deal</button>
                                      )}
                                      <button onClick={(e) => { e.stopPropagation(); if (window.confirm("Delete this site plot?")) deletePlotMutation.mutate({ type: "site_plot", plotId: sp.id }); }} className="text-xs text-rose-600 hover:underline">Delete</button>
                                    </>
                                  )}
                                </div>
                              </div>
                              {isExpanded && plotTxns.length > 0 && (
                                <div className="border-t border-slate-100 bg-slate-50 p-3 space-y-2">
                                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Payment History</p>
                                  {plotTxns.map(t => (
                                    <div key={t.id} className="flex justify-between text-xs">
                                      <span className="text-slate-600">{formatDate(t.txn_date)} · {TXN_TYPE_LABELS[t.txn_type] || t.txn_type}</span>
                                      <span className="font-mono font-semibold text-emerald-600">+{formatCurrency(scale(parseFloat(t.amount || 0)))}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : <p className="text-sm text-slate-400 text-center py-4">No site plots yet.</p>
                  )}
                  {remainingArea !== null && remainingArea > 0 && (
                    <div className="mt-3 text-xs text-slate-400 text-right">Unallocated: {remainingArea.toFixed(2)} sq ft of {totalPropertyArea.toLocaleString()} sq ft total</div>
                  )}
                </div>
              )}

              {/* ── TRANSACTIONS ── */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-bold text-slate-800">Transactions</h2>
                  {isActive && (
                    <button
                      onClick={() => setShowTxnForm(!showTxnForm)}
                      className="px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-xl text-sm hover:bg-indigo-100"
                    >
                      {showTxnForm ? "Cancel" : "+ Add Transaction"}
                    </button>
                  )}
                </div>

                {/* Add Transaction Form */}
                {showTxnForm && (
                  <div className="mb-5 p-4 bg-slate-50 rounded-xl border border-slate-200/60 space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-1">
                        <label className="block text-xs text-slate-500 mb-0.5">Type</label>
                        <select value={txnForm.txn_type} onChange={(e) => setTxnForm(p => ({ ...p, txn_type: e.target.value, member_id: "", received_by_member_id: "", plot_buyer_id: "", site_plot_id: "", account_id: "", broker_name: "", from_partnership_pot: false }))} className="w-full border border-slate-200 rounded-xl px-2.5 py-2 text-sm">
                          <optgroup label="Outflows">
                            <option value="advance_to_seller">Advance to Seller</option>
                            <option value="remaining_to_seller">Remaining to Seller</option>
                            <option value="broker_commission">Broker Commission</option>
                            <option value="expense">Expense / Other</option>
                          </optgroup>
                          <optgroup label="Inflows">
                            <option value="buyer_advance">Buyer Advance</option>
                            <option value="buyer_payment">Buyer Payment</option>
                            <option value="profit_received">Profit Received</option>
                          </optgroup>
                          <optgroup label="Transfers">
                            <option value="partner_transfer">Partner Transfer</option>
                          </optgroup>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-0.5">Amount</label>
                        <input type="number" value={txnForm.amount} onChange={(e) => setTxnForm(p => ({ ...p, amount: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2.5 py-2 text-sm" placeholder="0" />
                        {txnForm.txn_type === "remaining_to_seller" && isLinkedToProperty && linkedProperty && (() => {
                          const sellerTotal = parseFloat(linkedProperty.total_seller_value || 0);
                          const paid = parseFloat(summary.advance_to_seller || 0) + parseFloat(summary.remaining_to_seller || 0);
                          const bal = Math.max(0, sellerTotal - paid);
                          return bal > 0 ? <p className="text-xs text-rose-600 mt-0.5">Balance due: {formatCurrency(bal)}</p> : null;
                        })()}
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-0.5">Date</label>
                        <input type="date" value={txnForm.txn_date} onChange={(e) => setTxnForm(p => ({ ...p, txn_date: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2.5 py-2 text-sm" />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      {OUTFLOW_TYPES.includes(txnForm.txn_type) && (
                        <div>
                          <label className="block text-xs text-slate-500 mb-0.5">Paid by</label>
                          <select value={txnForm.member_id} onChange={(e) => setTxnForm(p => ({ ...p, member_id: e.target.value, account_id: "" }))} className="w-full border border-slate-200 rounded-xl px-2.5 py-2 text-sm">
                            <option value="">— From pot —</option>
                            {members.map(m => <option key={m.member?.id} value={String(m.member?.id)}>{m.member?.is_self ? "Self" : m.contact?.name || "Partner"}</option>)}
                          </select>
                        </div>
                      )}
                      {txnForm.txn_type === "partner_transfer" && (
                        <>
                          <div>
                            <label className="block text-xs text-slate-500 mb-0.5">From</label>
                            <select value={txnForm.member_id} onChange={(e) => setTxnForm(p => ({ ...p, member_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2.5 py-2 text-sm">
                              <option value="">— Select —</option>
                              {members.map(m => <option key={m.member?.id} value={String(m.member?.id)}>{m.member?.is_self ? "Self" : m.contact?.name || "Partner"}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-0.5">To</label>
                            <select value={txnForm.received_by_member_id} onChange={(e) => setTxnForm(p => ({ ...p, received_by_member_id: e.target.value, account_id: "" }))} className="w-full border border-slate-200 rounded-xl px-2.5 py-2 text-sm">
                              <option value="">— Select —</option>
                              {members.map(m => <option key={m.member?.id} value={String(m.member?.id)} disabled={String(m.member?.id) === txnForm.member_id}>{m.member?.is_self ? "Self" : m.contact?.name || "Partner"}</option>)}
                            </select>
                          </div>
                          {(() => { const toMember = members.find(m => String(m.member?.id) === String(txnForm.received_by_member_id)); return toMember?.member?.is_self && accounts.length > 0; })() && (
                            <div>
                              <label className="block text-xs text-slate-500 mb-0.5">Into Account</label>
                              <select value={txnForm.account_id} onChange={(e) => setTxnForm(p => ({ ...p, account_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2.5 py-2 text-sm">
                                <option value="">— None —</option>
                                {accounts.map(a => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
                              </select>
                            </div>
                          )}
                        </>
                      )}
                      {INFLOW_TYPES.includes(txnForm.txn_type) && (
                        <div>
                          <label className="block text-xs text-slate-500 mb-0.5">Received by</label>
                          <select value={txnForm.received_by_member_id} onChange={(e) => setTxnForm(p => ({ ...p, received_by_member_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2.5 py-2 text-sm">
                            <option value="">Self (Me)</option>
                            {members.filter(m => !m.member?.is_self).map(m => <option key={m.member?.id} value={String(m.member?.id)}>{m.contact?.name || "Partner"}</option>)}
                            {["buyer_advance", "buyer_payment"].includes(txnForm.txn_type) && <option value="seller">→ Seller (Buyer paid directly)</option>}
                          </select>
                        </div>
                      )}
                      {OUTFLOW_TYPES.includes(txnForm.txn_type) && (() => { const sel = members.find(m => String(m.member?.id) === String(txnForm.member_id)); return sel?.member?.is_self; })() && (
                        <div>
                          <label className="block text-xs text-slate-500 mb-0.5">Account</label>
                          <select value={txnForm.account_id} onChange={(e) => setTxnForm(p => ({ ...p, account_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2.5 py-2 text-sm">
                            <option value="">None</option>
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </div>
                      )}
                      {INFLOW_TYPES.includes(txnForm.txn_type) && !txnForm.received_by_member_id && (
                        <div>
                          <label className="block text-xs text-slate-500 mb-0.5">Account</label>
                          <select value={txnForm.account_id} onChange={(e) => setTxnForm(p => ({ ...p, account_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2.5 py-2 text-sm">
                            <option value="">None</option>
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </div>
                      )}
                    </div>

                    {["buyer_advance", "buyer_payment"].includes(txnForm.txn_type) && (plotBuyers.length > 0 || sitePlots.length > 0) && (
                      <div className="grid grid-cols-2 gap-3">
                        {plotBuyers.length > 0 && (
                          <div>
                            <label className="block text-xs text-slate-500 mb-0.5">Plot Buyer</label>
                            <select value={txnForm.plot_buyer_id} onChange={(e) => setTxnForm(p => ({ ...p, plot_buyer_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2.5 py-2 text-sm">
                              <option value="">— None —</option>
                              {plotBuyers.map(b => <option key={b.id} value={b.id}>{b.buyer_name || `Buyer #${b.id}`}</option>)}
                            </select>
                          </div>
                        )}
                        {sitePlots.length > 0 && (
                          <div>
                            <label className="block text-xs text-slate-500 mb-0.5">Site Plot</label>
                            <select value={txnForm.site_plot_id} onChange={(e) => setTxnForm(p => ({ ...p, site_plot_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2.5 py-2 text-sm">
                              <option value="">— None —</option>
                              {sitePlots.map(sp => <option key={sp.id} value={sp.id}>{sp.plot_number || sp.buyer_name || `Plot #${sp.id}`}</option>)}
                            </select>
                          </div>
                        )}
                      </div>
                    )}

                    {txnForm.txn_type === "broker_commission" && (
                      <div className="grid grid-cols-2 gap-3">
                        <InputField label="Broker Name">
                          <input type="text" value={txnForm.broker_name} onChange={(e) => setTxnForm(p => ({ ...p, broker_name: e.target.value }))} className={inputCls} placeholder="Broker name" />
                        </InputField>
                        <div className="flex items-end pb-1">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={txnForm.from_partnership_pot} onChange={(e) => setTxnForm(p => ({ ...p, from_partnership_pot: e.target.checked }))} className="rounded" />
                            <span className="text-xs text-slate-700">From partnership pot</span>
                          </label>
                        </div>
                      </div>
                    )}

                    {OUTFLOW_TYPES.includes(txnForm.txn_type) && (
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={txnForm.from_partnership_pot} onChange={(e) => setTxnForm(p => ({ ...p, from_partnership_pot: e.target.checked, member_id: e.target.checked ? "" : p.member_id }))} className="rounded" />
                          <span className="text-xs text-slate-700">Paid from partnership pot (no individual member)</span>
                        </label>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs text-slate-500 mb-0.5">Description</label>
                      <input type="text" value={txnForm.description} onChange={(e) => setTxnForm(p => ({ ...p, description: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2.5 py-2 text-sm" placeholder="Optional" />
                    </div>

                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setShowTxnForm(false)} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200">Cancel</button>
                      <button onClick={handleAddTxn} disabled={addTxnMutation.isPending || !txnForm.amount} className="px-4 py-1.5 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl text-sm font-medium hover:from-indigo-600 hover:to-indigo-700 shadow-sm shadow-indigo-500/20 active:scale-[0.98] disabled:opacity-50">
                        {addTxnMutation.isPending ? "Adding..." : "Add Transaction"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Transaction list grouped by date */}
                {transactions.length > 0 ? (() => {
                  const grouped = {};
                  transactions.forEach(t => {
                    const d = t.txn_date || "unknown";
                    if (!grouped[d]) grouped[d] = [];
                    grouped[d].push(t);
                  });
                  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

                  // Color-coding helper
                  const txnTagStyle = (type) => {
                    if (["advance_to_seller", "remaining_to_seller", "advance_given"].includes(type)) return "bg-purple-50 text-purple-700 border border-purple-100";
                    if (["expense", "other_expense"].includes(type)) return "bg-blue-50 text-blue-700 border border-blue-100";
                    if (type === "partner_transfer") return "bg-amber-50 text-amber-700 border border-amber-100";
                    if (["buyer_advance", "buyer_payment"].includes(type)) return "bg-emerald-50 text-emerald-700 border border-emerald-100";
                    if (type === "broker_commission" || type === "broker_paid") return "bg-orange-50 text-orange-700 border border-orange-100";
                    if (type === "profit_received") return "bg-teal-50 text-teal-700 border border-teal-100";
                    return "bg-slate-50 text-slate-600 border border-slate-100";
                  };

                  return sortedDates.map(date => {
                    const dayTxns = grouped[date];
                    const isCollapsed = collapsedDates[date];
                    const dayOutflow = dayTxns.filter(t => OUTFLOW_TYPES.includes(t.txn_type) || LEGACY_OUTFLOW.includes(t.txn_type)).reduce((s, t) => s + parseFloat(t.amount || 0), 0);
                    const dayInflow = dayTxns.filter(t => INFLOW_TYPES.includes(t.txn_type)).reduce((s, t) => s + parseFloat(t.amount || 0), 0);
                    return (
                      <div key={date} className="border border-slate-100 rounded-xl overflow-hidden mb-3">
                        <div
                          className="flex items-center justify-between px-3 py-2 bg-slate-50 cursor-pointer hover:bg-slate-100/70 select-none"
                          onClick={() => setCollapsedDates(p => ({ ...p, [date]: !p[date] }))}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400 inline-block transition-transform" style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▼</span>
                            <span className="text-xs font-semibold text-slate-600">{formatDate(date)}</span>
                            <span className="text-xs text-slate-400">({dayTxns.length} txn{dayTxns.length !== 1 ? "s" : ""})</span>
                          </div>
                          <div className="flex gap-2 text-xs">
                            {dayOutflow > 0 && <span className="text-rose-600 font-mono font-semibold">−{formatCurrency(scale(dayOutflow))}</span>}
                            {dayInflow > 0 && <span className="text-emerald-600 font-mono font-semibold">+{formatCurrency(scale(dayInflow))}</span>}
                          </div>
                        </div>
                        {!isCollapsed && (
                          <>
                            <div className="divide-y divide-slate-50">
                              {dayTxns.map((txn) => {
                                const isOut = OUTFLOW_TYPES.includes(txn.txn_type) || LEGACY_OUTFLOW.includes(txn.txn_type);
                                const buyerName = txn.plot_buyer_id
                                  ? plotBuyers.find(b => b.id === txn.plot_buyer_id)?.buyer_name || `Buyer #${txn.plot_buyer_id}`
                                  : txn.site_plot_id
                                    ? sitePlots.find(sp => sp.id === txn.site_plot_id)?.buyer_name || sitePlots.find(sp => sp.id === txn.site_plot_id)?.plot_number || `Plot #${txn.site_plot_id}`
                                    : null;
                                return (
                                  <div key={txn.id} className="px-3 py-3 hover:bg-slate-50/50 transition-colors">
                                    {editingTxnId === txn.id && editTxnForm ? (
                                      <div className="space-y-2">
                                        <div className="grid grid-cols-3 gap-2">
                                          <div>
                                            <label className="block text-xs text-slate-500 mb-0.5">Type</label>
                                            <select value={editTxnForm.txn_type} onChange={(e) => setEditTxnForm(p => ({ ...p, txn_type: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm">
                                              <optgroup label="Outflows">
                                                <option value="advance_to_seller">Advance to Seller</option>
                                                <option value="remaining_to_seller">Remaining to Seller</option>
                                                <option value="broker_commission">Broker Commission</option>
                                                <option value="expense">Expense</option>
                                              </optgroup>
                                              <optgroup label="Inflows">
                                                <option value="buyer_advance">Buyer Advance</option>
                                                <option value="buyer_payment">Buyer Payment</option>
                                                <option value="profit_received">Profit Received</option>
                                              </optgroup>
                                              <optgroup label="Transfers">
                                                <option value="partner_transfer">Partner Transfer</option>
                                              </optgroup>
                                            </select>
                                          </div>
                                          <div>
                                            <label className="block text-xs text-slate-500 mb-0.5">Amount</label>
                                            <input type="number" value={editTxnForm.amount} onChange={(e) => setEditTxnForm(p => ({ ...p, amount: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm" />
                                          </div>
                                          <div>
                                            <label className="block text-xs text-slate-500 mb-0.5">Date</label>
                                            <input type="date" value={editTxnForm.txn_date} onChange={(e) => setEditTxnForm(p => ({ ...p, txn_date: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm" />
                                          </div>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2">
                                          {OUTFLOW_TYPES.includes(editTxnForm.txn_type) && (
                                            <div>
                                              <label className="block text-xs text-slate-500 mb-0.5">Paid by</label>
                                              <select value={editTxnForm.member_id} onChange={(e) => setEditTxnForm(p => ({ ...p, member_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm">
                                                <option value="">— Select —</option>
                                                {members.map(m => <option key={m.member?.id} value={String(m.member?.id)}>{m.member?.is_self ? "Self" : m.contact?.name || "Partner"}</option>)}
                                              </select>
                                            </div>
                                          )}
                                          {editTxnForm.txn_type === "partner_transfer" && (
                                            <>
                                              <div>
                                                <label className="block text-xs text-slate-500 mb-0.5">From</label>
                                                <select value={editTxnForm.member_id} onChange={(e) => setEditTxnForm(p => ({ ...p, member_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm">
                                                  <option value="">— Select —</option>
                                                  {members.map(m => <option key={m.member?.id} value={String(m.member?.id)}>{m.member?.is_self ? "Self" : m.contact?.name || "Partner"}</option>)}
                                                </select>
                                              </div>
                                              <div>
                                                <label className="block text-xs text-slate-500 mb-0.5">To</label>
                                                <select value={editTxnForm.received_by_member_id} onChange={(e) => setEditTxnForm(p => ({ ...p, received_by_member_id: e.target.value, account_id: "" }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm">
                                                  <option value="">— Select —</option>
                                                  {members.map(m => <option key={m.member?.id} value={String(m.member?.id)} disabled={String(m.member?.id) === editTxnForm.member_id}>{m.member?.is_self ? "Self" : m.contact?.name || "Partner"}</option>)}
                                                </select>
                                              </div>
                                              {(() => { const toMember = members.find(m => String(m.member?.id) === String(editTxnForm.received_by_member_id)); return toMember?.member?.is_self && accounts.length > 0; })() && (
                                                <div>
                                                  <label className="block text-xs text-slate-500 mb-0.5">Into Account</label>
                                                  <select value={editTxnForm.account_id} onChange={(e) => setEditTxnForm(p => ({ ...p, account_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm">
                                                    <option value="">— None —</option>
                                                    {accounts.map(a => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
                                                  </select>
                                                </div>
                                              )}
                                            </>
                                          )}
                                          {INFLOW_TYPES.includes(editTxnForm.txn_type) && (
                                            <div>
                                              <label className="block text-xs text-slate-500 mb-0.5">Received by</label>
                                              <select value={editTxnForm.received_by_member_id} onChange={(e) => setEditTxnForm(p => ({ ...p, received_by_member_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm">
                                                <option value="">Self (Me)</option>
                                                {members.filter(m => !m.member?.is_self).map(m => <option key={m.member?.id} value={String(m.member?.id)}>{m.contact?.name || "Partner"}</option>)}
                                                {["buyer_advance", "buyer_payment"].includes(editTxnForm.txn_type) && <option value="seller">→ Seller (Buyer paid directly)</option>}
                                              </select>
                                            </div>
                                          )}
                                          {(() => { const sel = members.find(m => String(m.member?.id) === String(editTxnForm.member_id)); return OUTFLOW_TYPES.includes(editTxnForm.txn_type) && sel?.member?.is_self; })() && (
                                            <div>
                                              <label className="block text-xs text-slate-500 mb-0.5">Account</label>
                                              <select value={editTxnForm.account_id} onChange={(e) => setEditTxnForm(p => ({ ...p, account_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm">
                                                <option value="">None</option>
                                                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                              </select>
                                            </div>
                                          )}
                                          {INFLOW_TYPES.includes(editTxnForm.txn_type) && !editTxnForm.received_by_member_id && (
                                            <div>
                                              <label className="block text-xs text-slate-500 mb-0.5">Account</label>
                                              <select value={editTxnForm.account_id} onChange={(e) => setEditTxnForm(p => ({ ...p, account_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm">
                                                <option value="">None</option>
                                                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                              </select>
                                            </div>
                                          )}
                                        </div>
                                        {["buyer_advance", "buyer_payment"].includes(editTxnForm.txn_type) && (plotBuyers.length > 0 || sitePlots.length > 0) && (
                                          <div className="grid grid-cols-2 gap-2">
                                            {plotBuyers.length > 0 && <div><label className="block text-xs text-slate-500 mb-0.5">Plot Buyer</label><select value={editTxnForm.plot_buyer_id} onChange={(e) => setEditTxnForm(p => ({ ...p, plot_buyer_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm"><option value="">— None —</option>{plotBuyers.map(b => <option key={b.id} value={b.id}>{b.buyer_name || `Buyer #${b.id}`}</option>)}</select></div>}
                                            {sitePlots.length > 0 && <div><label className="block text-xs text-slate-500 mb-0.5">Site Plot</label><select value={editTxnForm.site_plot_id} onChange={(e) => setEditTxnForm(p => ({ ...p, site_plot_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm"><option value="">— None —</option>{sitePlots.map(sp => <option key={sp.id} value={sp.id}>{sp.plot_number || sp.buyer_name || `Plot #${sp.id}`}</option>)}</select></div>}
                                          </div>
                                        )}
                                        {editTxnForm.txn_type === "broker_commission" && (
                                          <div className="grid grid-cols-2 gap-2">
                                            <InputField label="Broker Name"><input type="text" value={editTxnForm.broker_name} onChange={(e) => setEditTxnForm(p => ({ ...p, broker_name: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm" placeholder="Broker name" /></InputField>
                                            <div className="flex items-end pb-1"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={editTxnForm.from_partnership_pot} onChange={(e) => setEditTxnForm(p => ({ ...p, from_partnership_pot: e.target.checked }))} className="rounded" /><span className="text-xs text-slate-700">From partnership pot</span></label></div>
                                          </div>
                                        )}
                                        <div><label className="block text-xs text-slate-500 mb-0.5">Description</label><input type="text" value={editTxnForm.description} onChange={(e) => setEditTxnForm(p => ({ ...p, description: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm" /></div>
                                        <div className="flex gap-2 justify-end">
                                          <button onClick={() => { setEditingTxnId(null); setEditTxnForm(null); }} className="px-2 py-1 bg-slate-100 text-slate-700 rounded-xl text-xs font-medium hover:bg-slate-200">Cancel</button>
                                          <button onClick={handleUpdateTxn} disabled={updateTxnMutation.isPending} className="px-3 py-1 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl text-xs font-medium hover:from-indigo-600 hover:to-indigo-700 shadow-sm shadow-indigo-500/20 active:scale-[0.98] disabled:opacity-50">
                                            {updateTxnMutation.isPending ? "Saving..." : "Update"}
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex justify-between items-start gap-3">
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap mb-1">
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${txnTagStyle(txn.txn_type)}`}>
                                              {TXN_TYPE_LABELS[txn.txn_type] || txn.txn_type.replace(/_/g, " ")}
                                            </span>
                                            {buyerName && <span className="text-[10px] text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded-full border border-teal-100">{buyerName}</span>}
                                          </div>
                                          {txn.txn_type === "partner_transfer" && (() => {
                                            const fromName = txn.member_id ? (members.find(m => m.member?.id === txn.member_id)?.member?.is_self ? "Self" : members.find(m => m.member?.id === txn.member_id)?.contact?.name || "?") : "?";
                                            const toName = txn.received_by_member_id ? (members.find(m => m.member?.id === txn.received_by_member_id)?.member?.is_self ? "Self" : members.find(m => m.member?.id === txn.received_by_member_id)?.contact?.name || "?") : "?";
                                            return <p className="text-xs font-semibold text-amber-700">{fromName} → {toName}</p>;
                                          })()}
                                          {txn.member_id && txn.txn_type !== "partner_transfer" && (
                                            <p className="text-xs text-slate-500">
                                              {["profit_received"].includes(txn.txn_type) ? "Given by" : "Paid by"}: <span className="font-medium">{members.find(m => m.member?.id === txn.member_id)?.member?.is_self ? "Self" : members.find(m => m.member?.id === txn.member_id)?.contact?.name || "Partner"}</span>
                                            </p>
                                          )}
                                          {txn.received_by_member_id && txn.txn_type !== "partner_transfer" && (
                                            <p className="text-xs text-slate-500">Received by: <span className="font-medium">{members.find(m => m.member?.id === txn.received_by_member_id)?.member?.is_self ? "Self" : members.find(m => m.member?.id === txn.received_by_member_id)?.contact?.name || "Partner"}</span></p>
                                          )}
                                          {txn.broker_name && <p className="text-xs text-slate-400">Broker: {txn.broker_name}</p>}
                                          {txn.from_partnership_pot && <p className="text-xs text-violet-600">From partnership pot</p>}
                                          {(() => {
                                            const cleanDesc = (txn.description || "").replace(" · → Paid directly to Seller", "").replace("→ Paid directly to Seller · ", "").replace("→ Paid directly to Seller", "").trim();
                                            return cleanDesc ? <p className="text-xs text-slate-400">{cleanDesc}</p> : null;
                                          })()}
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                          <span className={`text-sm font-bold font-mono tabular-nums ${txn.txn_type === "partner_transfer" ? "text-amber-600" : isOut ? "text-rose-600" : "text-emerald-600"}`}>
                                            {txn.txn_type === "partner_transfer" ? "↕" : isOut ? "−" : "+"}{formatCurrency(scale(parseFloat(txn.amount || 0)))}
                                          </span>
                                          {isActive && (
                                            <>
                                              <button onClick={() => openEditTxn(txn)} className="text-xs text-indigo-600 hover:underline">Edit</button>
                                              <button onClick={() => { if (window.confirm("Delete this transaction?")) deleteTxnMutation.mutate(txn.id); }} className="text-xs text-rose-600 hover:underline">Del</button>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            {/* Day subtotals when multiple same-type txns */}
                            {(() => {
                              const typeGroups = {};
                              dayTxns.forEach(t => { if (!typeGroups[t.txn_type]) typeGroups[t.txn_type] = { count: 0, total: 0 }; typeGroups[t.txn_type].count++; typeGroups[t.txn_type].total += parseFloat(t.amount || 0); });
                              const multi = Object.entries(typeGroups).filter(([, g]) => g.count > 1);
                              if (!multi.length) return null;
                              return (
                                <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 flex flex-wrap gap-1.5">
                                  {multi.map(([type, group]) => {
                                    const isOut2 = OUTFLOW_TYPES.includes(type) || LEGACY_OUTFLOW.includes(type);
                                    return <div key={type} className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 ${isOut2 ? "bg-rose-50 text-rose-700 border border-rose-100" : "bg-emerald-50 text-emerald-700 border border-emerald-100"}`}><span className="font-medium">{TXN_TYPE_LABELS[type] || type.replace(/_/g, " ")}</span><span className="opacity-50">×{group.count}</span><span className="font-bold font-mono">{isOut2 ? "−" : "+"}{formatCurrency(scale(group.total))}</span></div>;
                                  })}
                                </div>
                              );
                            })()}
                          </>
                        )}
                      </div>
                    );
                  });
                })() : (
                  <p className="text-sm text-slate-400 text-center py-6">No transactions yet.</p>
                )}
              </div>
            </div>

            {/* ── SIDEBAR ── */}
            <div className="space-y-5">

              {/* Financial Summary */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                <h2 className="text-base font-bold text-slate-800 mb-4">Financial Summary</h2>
                <div className="space-y-1">
                  <div className="flex justify-between py-1.5 border-b border-slate-50">
                    <span className="text-sm text-purple-600 font-medium">Advance to Seller</span>
                    <span className="text-sm font-bold font-mono text-rose-600">−{formatCurrency(scale(parseFloat(summary.advance_to_seller || 0)))}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-50">
                    <span className="text-sm text-purple-600 font-medium">Remaining to Seller</span>
                    <span className="text-sm font-bold font-mono text-rose-600">−{formatCurrency(scale(parseFloat(summary.remaining_to_seller || 0)))}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-50">
                    <span className="text-sm text-orange-600 font-medium">Broker Commission</span>
                    <span className="text-sm font-mono text-rose-500">−{formatCurrency(scale(parseFloat(summary.broker_commission || 0)))}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-200">
                    <span className="text-sm text-blue-600 font-medium">Expenses</span>
                    <span className="text-sm font-mono text-rose-500">−{formatCurrency(scale(parseFloat(summary.expense_total || 0)))}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-sm font-bold text-slate-700">Total Outflow</span>
                    <span className="text-sm font-bold font-mono text-rose-600">−{formatCurrency(scale(totalOutflow))}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-50">
                    <span className="text-sm text-emerald-600 font-medium">Buyer Payments</span>
                    <span className="text-sm font-mono text-emerald-600">+{formatCurrency(scale(parseFloat(summary.buyer_inflow || 0)))}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-200">
                    <span className="text-sm text-teal-600 font-medium">Profit Received</span>
                    <span className="text-sm font-mono text-emerald-600">+{formatCurrency(scale(parseFloat(summary.profit_received || 0)))}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-sm font-bold text-slate-700">Total Inflow</span>
                    <span className="text-sm font-bold font-mono text-emerald-600">+{formatCurrency(scale(totalInflow))}</span>
                  </div>
                  <div className={`flex justify-between py-2 border-t-2 ${netPnl >= 0 ? "border-emerald-200" : "border-rose-200"}`}>
                    <span className="text-sm font-bold text-slate-800">Net P&L</span>
                    <span className={`text-base font-bold font-mono ${netPnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{formatCurrency(scale(netPnl))}</span>
                  </div>
                </div>
                {myViewMode && <p className="text-[10px] text-indigo-400 mt-2 text-center">Showing your {selfShare}% share</p>}
              </div>

              {/* Details */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                <h2 className="text-base font-bold text-slate-800 mb-3">Details</h2>
                <div className="space-y-2 text-sm">
                  {partnership.start_date && <div className="flex justify-between"><span className="text-slate-500">Start Date</span><span className="font-medium">{formatDate(partnership.start_date)}</span></div>}
                  {partnership.expected_end_date && <div className="flex justify-between"><span className="text-slate-500">Expected End</span><span className={`font-medium ${new Date(partnership.expected_end_date) < new Date() && isActive ? "text-amber-600 font-bold" : ""}`}>{formatDate(partnership.expected_end_date)}</span></div>}
                  {isSettled && partnership.actual_end_date && <div className="flex justify-between"><span className="text-slate-500">Settled</span><span className="font-medium text-emerald-600">{formatDate(partnership.actual_end_date)}</span></div>}
                  <div className="flex justify-between"><span className="text-slate-500">Created</span><span className="font-medium text-slate-400">{formatDate(partnership.created_at)}</span></div>
                </div>
              </div>

              {/* Settlement Action */}
              {isActive && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                  <h2 className="text-base font-bold text-slate-800 mb-3">Actions</h2>
                  <button onClick={() => setShowSettleModal(true)} className="w-full py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium hover:from-emerald-600 hover:to-emerald-700 shadow-sm shadow-emerald-500/20 active:scale-[0.98] text-sm">
                    🤝 Record Settlement
                  </button>
                </div>
              )}

              {/* Notes */}
              {partnership.notes && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                  <h2 className="text-base font-bold text-slate-800 mb-2">Notes</h2>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{partnership.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </PageBody>

      {/* Edit Plot Modal */}
      {editingPlot && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/60 w-full max-w-md">
            <div className="p-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Edit Plot Details</h2>
              {editingPlot.hasPaid && <p className="text-xs text-amber-600 mt-1">⚠ Payments recorded — buyer cannot be changed, but other details can be edited.</p>}
            </div>
            <div className="p-5 space-y-4">
              {editingPlot.type === "site_plot" && (
                <InputField label="Plot Number">
                  <input type="text" value={editPlotForm.plot_number} onChange={(e) => setEditPlotForm(p => ({ ...p, plot_number: e.target.value }))} className={inputCls} placeholder="e.g. A-1" />
                </InputField>
              )}
              <div className="grid grid-cols-2 gap-3">
                <InputField label="Area (sq ft)">
                  <input type="number" value={editPlotForm.area_sqft} onChange={(e) => setEditPlotForm(p => ({ ...p, area_sqft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                </InputField>
                <InputField label="Rate (₹/sqft)">
                  <input type="number" value={editPlotForm.price_per_sqft} onChange={(e) => setEditPlotForm(p => ({ ...p, price_per_sqft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                </InputField>
              </div>
              {editPlotForm.area_sqft && editPlotForm.price_per_sqft && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-2 text-sm">
                  <span className="text-blue-700 font-medium">Deal Value: </span>
                  <span className="text-blue-800 font-bold">{formatCurrency(parseFloat(editPlotForm.area_sqft) * parseFloat(editPlotForm.price_per_sqft))}</span>
                </div>
              )}
              <div className="grid grid-cols-4 gap-2">
                <InputField label="North (ft)">
                  <input type="number" value={editPlotForm.side_north_ft} onChange={(e) => setEditPlotForm(p => ({ ...p, side_north_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                </InputField>
                <InputField label="South (ft)">
                  <input type="number" value={editPlotForm.side_south_ft} onChange={(e) => setEditPlotForm(p => ({ ...p, side_south_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                </InputField>
                <InputField label="East (ft)">
                  <input type="number" value={editPlotForm.side_east_ft} onChange={(e) => setEditPlotForm(p => ({ ...p, side_east_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                </InputField>
                <InputField label="West (ft)">
                  <input type="number" value={editPlotForm.side_west_ft} onChange={(e) => setEditPlotForm(p => ({ ...p, side_west_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                </InputField>
              </div>
              <InputField label="Notes">
                <input type="text" value={editPlotForm.notes} onChange={(e) => setEditPlotForm(p => ({ ...p, notes: e.target.value }))} className={inputCls} placeholder="Optional notes about this plot" />
              </InputField>
            </div>
            <div className="p-5 border-t border-slate-200 flex gap-3 justify-end">
              <button onClick={() => setEditingPlot(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200">Cancel</button>
              <button
                onClick={() => {
                  const payload = {};
                  if (editingPlot.type === "site_plot") {
                    if (editPlotForm.plot_number !== "") payload.plot_number = editPlotForm.plot_number || null;
                    if (editPlotForm.area_sqft) payload.area_sqft = parseFloat(editPlotForm.area_sqft);
                    if (editPlotForm.price_per_sqft) payload.sold_price_per_sqft = parseFloat(editPlotForm.price_per_sqft);
                  } else {
                    if (editPlotForm.area_sqft) payload.area_sqft = parseFloat(editPlotForm.area_sqft);
                    if (editPlotForm.price_per_sqft) payload.rate_per_sqft = parseFloat(editPlotForm.price_per_sqft);
                  }
                  if (editPlotForm.side_north_ft) payload.side_north_ft = parseFloat(editPlotForm.side_north_ft);
                  if (editPlotForm.side_south_ft) payload.side_south_ft = parseFloat(editPlotForm.side_south_ft);
                  if (editPlotForm.side_east_ft) payload.side_east_ft = parseFloat(editPlotForm.side_east_ft);
                  if (editPlotForm.side_west_ft) payload.side_west_ft = parseFloat(editPlotForm.side_west_ft);
                  payload.notes = editPlotForm.notes || null;
                  editPlotMutation.mutate({ type: editingPlot.type, plotId: editingPlot.id, payload });
                }}
                disabled={editPlotMutation.isPending}
                className="px-5 py-2 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl text-sm font-medium hover:from-indigo-600 hover:to-indigo-700 shadow-sm shadow-indigo-500/20 active:scale-[0.98] disabled:opacity-50"
              >
                {editPlotMutation.isPending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Plot Details Popup */}
      {viewingPlot && (() => {
        const vp = viewingPlot;
        const isSp = vp.plotType === "site_plot";
        const area = vp.area_sqft;
        const rate = isSp ? vp.sold_price_per_sqft : vp.rate_per_sqft;
        const totalValue = isSp ? parseFloat(vp.calculated_price || 0) : parseFloat(vp.total_value || 0);
        const totalPaid = parseFloat(vp.total_paid || 0);
        const paidPct = totalValue > 0 ? Math.min(100, (totalPaid / totalValue) * 100) : 0;
        const north = vp.side_north_ft, south = vp.side_south_ft, east = vp.side_east_ft, west = vp.side_west_ft;
        const hasAnyDim = north || south || east || west;
        return (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/60 w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="p-5 border-b border-slate-200 flex justify-between items-start">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{vp.buyer_name || vp.plot_number || `Plot #${vp.id}`}</h2>
                  {vp.buyer_name && vp.plot_number && <p className="text-xs text-slate-400 mt-0.5">Plot: {vp.plot_number}</p>}
                </div>
                <button onClick={() => setViewingPlot(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none ml-4">✕</button>
              </div>
              <div className="p-5 space-y-4">
                {/* Dimensions diagram */}
                {hasAnyDim && (
                  <div className="border border-slate-200 rounded-xl p-4">
                    <p className="text-xs font-semibold text-slate-500 mb-3">Plot Dimensions</p>
                    <div className="relative mx-auto" style={{ width: 220, height: 180 }}>
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 text-[11px] text-blue-600 font-medium whitespace-nowrap">N: {north ? `${north} ft` : "—"}</div>
                      <div className="absolute border-2 border-blue-400 bg-blue-50 rounded flex items-center justify-center text-center" style={{ top: 24, bottom: 24, left: 36, right: 36 }}>
                        {area && <div><div className="text-xs font-bold text-blue-700">{Number(area).toLocaleString()}</div><div className="text-[10px] text-blue-500">sqft</div></div>}
                      </div>
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[11px] text-blue-600 font-medium whitespace-nowrap">S: {south ? `${south} ft` : "—"}</div>
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 text-[11px] text-blue-600 font-medium" style={{ writingMode: "vertical-rl" }}>E: {east ? `${east} ft` : "—"}</div>
                      <div className="absolute left-0 top-1/2 text-[11px] text-blue-600 font-medium" style={{ writingMode: "vertical-rl", transform: "translateY(-50%) rotate(180deg)" }}>W: {west ? `${west} ft` : "—"}</div>
                    </div>
                  </div>
                )}
                {/* Financial summary */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Area</span><span className="font-medium">{area ? `${Number(area).toLocaleString()} sqft` : "—"}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Rate</span><span className="font-medium">{rate ? `₹${Number(rate).toLocaleString()}/sqft` : "—"}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Total Value</span><span className="font-semibold">{formatCurrency(totalValue)}</span></div>
                  <div className="border-t border-slate-100 pt-2">
                    <div className="flex justify-between mb-1"><span className="text-slate-500">Paid</span><span className="font-semibold text-emerald-600">{formatCurrency(totalPaid)}</span></div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full" style={{ width: `${paidPct}%` }} />
                    </div>
                    <div className="flex justify-between text-xs mt-1 text-slate-400">
                      <span>{paidPct.toFixed(0)}% paid</span>
                      <span>{formatCurrency(Math.max(0, totalValue - totalPaid))} remaining</span>
                    </div>
                  </div>
                </div>
                {/* Status */}
                <div className="flex gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${vp.status === "sold" || vp.status === "registry_done" ? "bg-emerald-100 text-emerald-700" : vp.status === "advance_received" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                    {(vp.status || "available").replace(/_/g, " ")}
                  </span>
                  {(vp.registry_date || vp.sold_date) && (
                    <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700">Registry: {formatDate(vp.registry_date || vp.sold_date)}</span>
                  )}
                </div>
                {vp.notes && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 mb-1">Notes</p>
                    <p className="text-sm text-slate-600 whitespace-pre-wrap bg-slate-50 rounded-xl p-3">{vp.notes}</p>
                  </div>
                )}
              </div>
              <div className="p-5 border-t border-slate-200 flex justify-end">
                <button onClick={() => setViewingPlot(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200">Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Close Deal Modal */}
      {closeDealPlot && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/60 w-full max-w-md">
            <div className="p-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Close Deal — {closeDealPlot.label}</h2>
              <p className="text-xs text-slate-500 mt-1">Confirm final area & rate at registry time (adjust if different from estimate). The deal will be marked as sold.</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <InputField label="Final Area (sq ft)">
                  <input type="number" value={closeDealForm.area_sqft} onChange={(e) => setCloseDealForm(p => ({ ...p, area_sqft: e.target.value }))} className={inputCls} placeholder={String(closeDealPlot.area_sqft || "")} min="0" />
                </InputField>
                <InputField label={closeDealPlot.type === "site_plot" ? "Final Rate (₹/sqft)" : "Final Rate (₹/sqft)"}>
                  <input type="number" value={closeDealForm.price_per_sqft} onChange={(e) => setCloseDealForm(p => ({ ...p, price_per_sqft: e.target.value }))} className={inputCls} placeholder={String(closeDealPlot.price_per_sqft || closeDealPlot.rate_per_sqft || "")} min="0" />
                </InputField>
              </div>
              {closeDealForm.area_sqft && closeDealForm.price_per_sqft && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2 text-sm">
                  <span className="text-emerald-700 font-medium">Final Deal Value: </span>
                  <span className="text-emerald-800 font-bold">{formatCurrency(parseFloat(closeDealForm.area_sqft) * parseFloat(closeDealForm.price_per_sqft))}</span>
                </div>
              )}
              <InputField label="Registry Date">
                <input type="date" value={closeDealForm.registry_date} onChange={(e) => setCloseDealForm(p => ({ ...p, registry_date: e.target.value }))} className={inputCls} />
              </InputField>
              <InputField label="Notes (optional)">
                <input type="text" value={closeDealForm.notes} onChange={(e) => setCloseDealForm(p => ({ ...p, notes: e.target.value }))} className={inputCls} placeholder="Any notes about the closing" />
              </InputField>
            </div>
            <div className="p-5 border-t border-slate-200 flex gap-3 justify-end">
              <button onClick={() => { setCloseDealPlot(null); setCloseDealForm({ area_sqft: "", price_per_sqft: "", registry_date: "", notes: "" }); }} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200">Cancel</button>
              <button
                onClick={() => {
                  const payload = { status: closeDealPlot.type === "site_plot" ? "sold" : "registry_done" };
                  if (closeDealForm.area_sqft) payload[closeDealPlot.type === "site_plot" ? "area_sqft" : "area_sqft"] = parseFloat(closeDealForm.area_sqft);
                  if (closeDealForm.price_per_sqft) payload[closeDealPlot.type === "site_plot" ? "sold_price_per_sqft" : "rate_per_sqft"] = parseFloat(closeDealForm.price_per_sqft);
                  if (closeDealForm.registry_date) payload.registry_date = closeDealForm.registry_date;
                  if (closeDealForm.notes) payload.notes = closeDealForm.notes;
                  closeDealMutation.mutate({ type: closeDealPlot.type, plotId: closeDealPlot.id, payload });
                }}
                disabled={closeDealMutation.isPending}
                className="px-5 py-2 bg-gradient-to-r from-rose-500 to-rose-600 text-white rounded-xl text-sm font-medium hover:from-rose-600 hover:to-rose-700 shadow-sm shadow-rose-500/20 active:scale-[0.98] disabled:opacity-50"
              >
                {closeDealMutation.isPending ? "Closing..." : "Confirm Close Deal"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {showAddMemberModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/60 w-full max-w-md">
            <div className="p-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Add Partner</h2>
            </div>
            <div className="p-5 space-y-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={memberForm.is_self} onChange={(e) => setMemberForm(p => ({ ...p, is_self: e.target.checked, contact_id: "" }))} className="rounded" />
                <span className="text-sm font-medium text-slate-700">This is me (Self)</span>
              </label>

              {!memberForm.is_self && (
                <InputField label="Contact">
                  <select value={memberForm.contact_id} onChange={(e) => setMemberForm(p => ({ ...p, contact_id: e.target.value }))} className={inputCls}>
                    <option value="">— Select Contact —</option>
                    {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ""}</option>)}
                  </select>
                </InputField>
              )}

              <InputField label="Share %">
                <input type="number" value={memberForm.share_percentage} onChange={(e) => setMemberForm(p => ({ ...p, share_percentage: e.target.value }))} className={inputCls} placeholder="e.g. 40" min="0" max="100" />
              </InputField>

              <InputField label="Notes (optional)">
                <input type="text" value={memberForm.notes} onChange={(e) => setMemberForm(p => ({ ...p, notes: e.target.value }))} className={inputCls} placeholder="Optional" />
              </InputField>
            </div>
            <div className="p-5 border-t border-slate-200 flex gap-3 justify-end">
              <button onClick={() => setShowAddMemberModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200">Cancel</button>
              <button onClick={handleAddMember} disabled={addMemberMutation.isPending} className="px-5 py-2 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl text-sm font-medium hover:from-indigo-600 hover:to-indigo-700 shadow-sm shadow-indigo-500/20 active:scale-[0.98] disabled:opacity-50">
                {addMemberMutation.isPending ? "Adding..." : "Add Partner"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Member Modal */}
      {showEditMemberModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/60 w-full max-w-md">
            <div className="p-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Edit Partner</h2>
            </div>
            <div className="p-5 space-y-4">
              <InputField label="Share %">
                <input type="number" value={editMemberForm.share_percentage} onChange={(e) => setEditMemberForm(p => ({ ...p, share_percentage: e.target.value }))} className={inputCls} placeholder="e.g. 40" min="0" max="100" />
              </InputField>
              <InputField label="Notes (optional)">
                <input type="text" value={editMemberForm.notes} onChange={(e) => setEditMemberForm(p => ({ ...p, notes: e.target.value }))} className={inputCls} placeholder="Optional" />
              </InputField>
            </div>
            <div className="p-5 border-t border-slate-200 flex gap-3 justify-end">
              <button onClick={() => { setShowEditMemberModal(false); setEditMemberId(null); }} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200">Cancel</button>
              <button onClick={handleEditMember} disabled={editMemberMutation.isPending} className="px-5 py-2 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl text-sm font-medium hover:from-indigo-600 hover:to-indigo-700 shadow-sm shadow-indigo-500/20 active:scale-[0.98] disabled:opacity-50">
                {editMemberMutation.isPending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settle Modal */}
      {showSettleModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/60 w-full max-w-md">
            <div className="p-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Record Settlement</h2>
            </div>
            <div className="p-5 space-y-4">
              <InputField label="Total Received (₹)">
                <input type="number" value={settleForm.total_received} onChange={(e) => setSettleForm(p => ({ ...p, total_received: e.target.value }))} className={inputCls} placeholder="Total amount received" min="0" />
              </InputField>
              <InputField label="Settlement Date">
                <input type="date" value={settleForm.actual_end_date} onChange={(e) => setSettleForm(p => ({ ...p, actual_end_date: e.target.value }))} className={inputCls} />
              </InputField>
              <InputField label="Notes (optional)">
                <input type="text" value={settleForm.notes} onChange={(e) => setSettleForm(p => ({ ...p, notes: e.target.value }))} className={inputCls} placeholder="Optional" />
              </InputField>

              {settleForm.total_received && members.length > 0 && (
                <div className="bg-slate-50 rounded-xl p-4 text-sm space-y-1.5 border border-slate-200/60">
                  <div className="font-semibold text-slate-700 mb-2">Settlement Preview</div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Received:</span>
                    <span>{formatCurrency(settleTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Outflow:</span>
                    <span>{formatCurrency(totalOutflow)}</span>
                  </div>
                  <hr className="border-slate-300" />
                  <div className="flex justify-between font-semibold">
                    <span>Net Profit:</span>
                    <span className={settleProfit >= 0 ? "text-emerald-600" : "text-rose-600"}>{formatCurrency(settleProfit)}</span>
                  </div>
                  <hr className="border-slate-300" />
                  {members.map((m, i) => {
                    const sharePct = parseFloat(m.member?.share_percentage || 0);
                    const advanceBack = parseFloat(m.member?.advance_contributed || 0);
                    const profitShare = (settleProfit * sharePct) / 100;
                    // Compute expense paid by this member
                    const expensePaid = transactions.filter(t => ["expense", "other_expense"].includes(t.txn_type) && t.member_id === m.member?.id).reduce((s, t) => s + parseFloat(t.amount || 0), 0);
                    // Profit already taken by this member
                    const alreadyReceived = transactions.filter(t => t.txn_type === "profit_received" && t.received_by_member_id === m.member?.id).reduce((s, t) => s + parseFloat(t.amount || 0), 0);
                    const entitlement = advanceBack + expensePaid + profitShare - alreadyReceived;
                    const name = m.member?.is_self ? "Self (You)" : m.contact?.name || "Unknown";
                    return (
                      <div key={i} className="space-y-0.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-600 font-medium">{name} ({sharePct}%)</span>
                          <span className={`font-semibold ${entitlement >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{formatCurrency(entitlement)}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 ml-2">
                          Advance: {formatCurrency(advanceBack)} + Expenses: {formatCurrency(expensePaid)} + Profit: {formatCurrency(profitShare)}{alreadyReceived > 0 ? ` − Already: ${formatCurrency(alreadyReceived)}` : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="p-5 border-t border-slate-200 flex gap-3 justify-end">
              <button onClick={() => setShowSettleModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200">Cancel</button>
              <button onClick={handleSettle} disabled={settleMutation.isPending} className="px-5 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl text-sm font-medium hover:from-emerald-600 hover:to-emerald-700 shadow-sm shadow-emerald-500/20 active:scale-[0.98] disabled:opacity-50">
                {settleMutation.isPending ? "Settling..." : "Confirm Settlement"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
