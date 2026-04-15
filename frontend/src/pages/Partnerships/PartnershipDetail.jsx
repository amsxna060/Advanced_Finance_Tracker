import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { PageHero, HeroStat, PageBody, Button } from "../../components/ui";

const TXN_TYPE_LABELS = {
  advance_to_seller: "Advance to Seller",
  remaining_to_seller: "Remaining to Seller",
  broker_commission: "Broker Commission",
  expense: "Expense",
  buyer_advance: "Buyer Advance",
  buyer_payment: "Buyer Payment",
  profit_received: "Profit Received",
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
        broker_name: "", from_partnership_pot: false,
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

  // ─── Handlers ───────────────────────────────────────────
  const handleAddTxn = () => {
    const txnType = txnForm.txn_type;
    const isOutflow = OUTFLOW_TYPES.includes(txnType);
    const isInflow = INFLOW_TYPES.includes(txnType);

    let memberId = null;
    if (isOutflow && txnForm.member_id && !txnForm.from_partnership_pot) memberId = parseInt(txnForm.member_id);

    let receivedByMemberId = null;
    if (isInflow && txnForm.received_by_member_id) receivedByMemberId = parseInt(txnForm.received_by_member_id);

    // Only send account_id if Self is the payer (outflow) or receiver (inflow with no received_by)
    let accountId = null;
    if (isOutflow) {
      const payerMember = members.find(m => String(m.member?.id) === String(txnForm.member_id));
      if (payerMember?.member?.is_self && txnForm.account_id) {
        accountId = parseInt(txnForm.account_id);
      }
    } else if (isInflow && !txnForm.received_by_member_id && txnForm.account_id) {
      // Self received (no received_by_member_id means Self)
      accountId = parseInt(txnForm.account_id);
    }

    addTxnMutation.mutate({
      txn_type: txnType,
      amount: parseFloat(txnForm.amount) || 0,
      txn_date: txnForm.txn_date,
      payment_mode: txnForm.payment_mode,
      description: txnForm.description?.trim() || null,
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
      description: txn.description || "",
      account_id: txn.account_id ? String(txn.account_id) : "",
      member_id: txn.member_id ? String(txn.member_id) : "",
      received_by_member_id: txn.received_by_member_id ? String(txn.received_by_member_id) : "",
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

    // Only send account_id if Self is the payer/receiver
    let accountId = null;
    if (isOutflow) {
      const payerMember = members.find(m => String(m.member?.id) === String(editTxnForm.member_id));
      if (payerMember?.member?.is_self && editTxnForm.account_id) {
        accountId = parseInt(editTxnForm.account_id);
      }
    } else if (isInflow && !editTxnForm.received_by_member_id && editTxnForm.account_id) {
      accountId = parseInt(editTxnForm.account_id);
    }

    updateTxnMutation.mutate({
      txnId: editingTxnId,
      payload: {
        txn_type: txnType,
        amount: parseFloat(editTxnForm.amount) || 0,
        txn_date: editTxnForm.txn_date,
        payment_mode: editTxnForm.payment_mode,
        description: editTxnForm.description?.trim() || null,
        account_id: accountId,
        member_id: editTxnForm.member_id ? parseInt(editTxnForm.member_id) : null,
        received_by_member_id: editTxnForm.received_by_member_id ? parseInt(editTxnForm.received_by_member_id) : null,
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

  const totalAdvance = members.reduce((sum, m) => sum + parseFloat(m.member?.advance_contributed || 0), 0);
  const selfMember = members.find((m) => m.member?.is_self);
  const selfShare = selfMember ? parseFloat(selfMember.member?.share_percentage || 0) : 0;

  const totalOutflow = parseFloat(summary.total_outflow || 0);
  const totalInflow = parseFloat(summary.total_inflow || 0);
  const netPnl = parseFloat(summary.our_pnl || 0);

  const settleTotal = parseFloat(settleForm.total_received || 0);
  const settleProfit = settleTotal - totalOutflow;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title={partnership.title}
        subtitle={`${partnership.status.charAt(0).toUpperCase() + partnership.status.slice(1)} · ${members.length} partner${members.length !== 1 ? "s" : ""}`}
        backTo="/partnerships"
        actions={
          <div className="flex gap-2">
            <Button variant="white" onClick={() => navigate(`/partnerships/${id}/edit`)}>Edit</Button>
            <Button variant="danger" size="sm" onClick={() => { if (window.confirm("Delete this partnership?")) deletePartnershipMutation.mutate(); }}>Delete</Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <HeroStat label="Total Outflow" value={formatCurrency(totalOutflow)} accent="indigo" />
          <HeroStat label="Total Inflow" value={formatCurrency(totalInflow)} accent="emerald" />
          <HeroStat label="Net P&L" value={formatCurrency(netPnl)} accent={netPnl >= 0 ? "teal" : "rose"} />
          <HeroStat label="Your Share" value={`${selfShare}%`} accent="violet" />
        </div>
      </PageHero>

      <PageBody>
        <div className="space-y-5">
          {isLinkedToProperty && linkedProperty && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-start gap-3">
              <span className="text-indigo-500 text-xl">🏘</span>
              <div>
                <p className="text-sm font-semibold text-indigo-800">Linked to property: {linkedProperty.title}</p>
                <Link to={`/properties/${partnership.linked_property_deal_id}`} className="text-sm text-indigo-600 hover:underline">
                  View Property →
                </Link>
                <p className="text-xs text-indigo-600 mt-1">All financial transactions are managed here. Property page shows synced read-only data.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-5">
              {/* Partners Table */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-bold text-slate-800">Partner Distribution</h2>
                  {isActive && (
                    <button onClick={() => setShowAddMemberModal(true)} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-xl text-sm hover:bg-indigo-100">+ Add Partner</button>
                  )}
                </div>

                {members.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">No partners added yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="text-left py-2 text-slate-500 font-medium">Partner</th>
                          <th className="text-right py-2 text-slate-500 font-medium">Share %</th>
                          <th className="text-right py-2 text-slate-500 font-medium">Advance</th>
                          <th className="text-right py-2 text-slate-500 font-medium">Total Received</th>
                          {isActive && <th className="text-right py-2 text-slate-500 font-medium">Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((m, i) => {
                          const received = parseFloat(m.member?.total_received || 0);
                          const advance = parseFloat(m.member?.advance_contributed || 0);
                          const isFullyReceived = isSettled && received > 0;
                          const name = m.member?.is_self ? "Self (You)" : m.contact?.name || "Unknown";
                          return (
                            <tr key={i} className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${isFullyReceived ? "bg-emerald-50" : ""}`}>
                              <td className="py-2 font-medium">
                                {name}
                                {m.member?.is_self && <span className="ml-1 text-xs bg-indigo-100 text-indigo-700 px-1.5 rounded-full">you</span>}
                              </td>
                              <td className="text-right py-2">{m.member?.share_percentage}%</td>
                              <td className="text-right py-2">{formatCurrency(advance)}</td>
                              <td className={`text-right py-2 font-semibold ${isFullyReceived ? "text-emerald-700" : "text-slate-400"}`}>
                                {isFullyReceived ? formatCurrency(received) : "—"}
                              </td>
                              {isActive && (
                                <td className="text-right py-2 space-x-1">
                                  <button onClick={() => openEditMember(m)} className="text-xs text-indigo-600 hover:underline">Edit</button>
                                  <button onClick={() => { if (window.confirm(`Remove ${name}?`)) deleteMemberMutation.mutate(m.member?.id); }} className="text-xs text-rose-600 hover:underline">Delete</button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                        <tr className="border-t border-slate-300 font-semibold">
                          <td className="py-2">Total</td>
                          <td className="text-right py-2">{members.reduce((s, m) => s + parseFloat(m.member?.share_percentage || 0), 0).toFixed(1)}%</td>
                          <td className="text-right py-2">{formatCurrency(totalAdvance)}</td>
                          <td className="text-right py-2">
                            {isSettled ? formatCurrency(members.reduce((s, m) => s + parseFloat(m.member?.total_received || 0), 0)) : "—"}
                          </td>
                          {isActive && <td />}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Plot Buyers / Site Plots */}
              {isLinkedToProperty && (plotBuyers.length > 0 || sitePlots.length > 0 || isActive) && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-bold text-slate-800">{isPlotDeal ? "Plot Subdivisions & Buyers" : "Site Plots & Buyers"}</h2>
                    {isActive && (
                      <div className="flex gap-2">
                        <button onClick={() => { setShowAddPlotForm(!showAddPlotForm); setShowBuyerForm(false); }} className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl text-sm hover:bg-blue-100">
                          + Add Plot
                        </button>
                        <button onClick={() => { setShowBuyerForm(!showBuyerForm); setShowAddPlotForm(false); }} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-sm hover:bg-emerald-100">
                          + Quick Buyer
                        </button>
                      </div>
                    )}
                  </div>

                  {/* ── Add Plot Form (Step 1: plot details, NO buyer) ── */}
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
                        </InputField>
                        <InputField label={isPlotDeal ? "Rate (₹/sq ft)" : "Sold Price (₹/sq ft)"}>
                          <input type="number" value={plotForm.rate_per_sqft} onChange={(e) => setPlotForm(p => ({ ...p, rate_per_sqft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                        </InputField>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <InputField label="North (ft)">
                          <input type="number" value={plotForm.side_north_ft} onChange={(e) => setPlotForm(p => ({ ...p, side_north_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                        </InputField>
                        <InputField label="South (ft)">
                          <input type="number" value={plotForm.side_south_ft} onChange={(e) => setPlotForm(p => ({ ...p, side_south_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                        </InputField>
                        <InputField label="East (ft)">
                          <input type="number" value={plotForm.side_east_ft} onChange={(e) => setPlotForm(p => ({ ...p, side_east_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                        </InputField>
                        <InputField label="West (ft)">
                          <input type="number" value={plotForm.side_west_ft} onChange={(e) => setPlotForm(p => ({ ...p, side_west_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                        </InputField>
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

                  {/* ── Legacy Quick Buyer + Plot (backward compat) ── */}
                  {showBuyerForm && (
                    <div className="mb-4 p-4 bg-emerald-50/50 rounded-xl border border-emerald-200/60 space-y-3">
                      <p className="text-xs font-semibold text-emerald-800 mb-1">Quick: Create buyer contact + plot together</p>
                      <div className="grid grid-cols-2 gap-3">
                        <InputField label="Buyer Name *">
                          <input type="text" value={buyerForm.name} onChange={(e) => setBuyerForm(p => ({ ...p, name: e.target.value }))} className={inputCls} placeholder="Full name" />
                        </InputField>
                        <InputField label="Phone">
                          <input type="text" value={buyerForm.phone} onChange={(e) => setBuyerForm(p => ({ ...p, phone: e.target.value }))} className={inputCls} placeholder="Optional" />
                        </InputField>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <InputField label="City">
                          <input type="text" value={buyerForm.city} onChange={(e) => setBuyerForm(p => ({ ...p, city: e.target.value }))} className={inputCls} placeholder="Optional" />
                        </InputField>
                        <InputField label="Notes">
                          <input type="text" value={buyerForm.notes} onChange={(e) => setBuyerForm(p => ({ ...p, notes: e.target.value }))} className={inputCls} placeholder="Optional" />
                        </InputField>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <InputField label="Area (sq ft)">
                          <input type="number" value={buyerForm.area_sqft} onChange={(e) => setBuyerForm(p => ({ ...p, area_sqft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                        </InputField>
                        <InputField label="Rate (₹/sq ft)">
                          <input type="number" value={buyerForm.rate_per_sqft} onChange={(e) => setBuyerForm(p => ({ ...p, rate_per_sqft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                        </InputField>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <InputField label="North (ft)">
                          <input type="number" value={buyerForm.side_north_ft} onChange={(e) => setBuyerForm(p => ({ ...p, side_north_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                        </InputField>
                        <InputField label="South (ft)">
                          <input type="number" value={buyerForm.side_south_ft} onChange={(e) => setBuyerForm(p => ({ ...p, side_south_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                        </InputField>
                        <InputField label="East (ft)">
                          <input type="number" value={buyerForm.side_east_ft} onChange={(e) => setBuyerForm(p => ({ ...p, side_east_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                        </InputField>
                        <InputField label="West (ft)">
                          <input type="number" value={buyerForm.side_west_ft} onChange={(e) => setBuyerForm(p => ({ ...p, side_west_ft: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                        </InputField>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setShowBuyerForm(false)} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200">Cancel</button>
                        <button onClick={handleCreateBuyer} disabled={!buyerForm.name.trim() || createBuyerMutation.isPending} className="px-4 py-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl text-sm font-medium hover:from-emerald-600 hover:to-emerald-700 shadow-sm shadow-emerald-500/20 active:scale-[0.98] disabled:opacity-50">
                          {createBuyerMutation.isPending ? "Creating..." : "Create Buyer"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── Assign Buyer Modal (inline) ── */}
                  {assigningBuyerTo && (
                    <div className="mb-4 p-4 bg-amber-50/50 rounded-xl border border-amber-200/60 space-y-3">
                      <p className="text-xs font-semibold text-amber-800 mb-1">Assign buyer to: {assigningBuyerTo.label}</p>
                      <div className="flex gap-2 mb-2">
                        <button onClick={() => setAssignBuyerMode("existing")} className={`px-3 py-1 rounded-lg text-xs font-medium ${assignBuyerMode === "existing" ? "bg-amber-200 text-amber-900" : "bg-white text-slate-600 border border-slate-200"}`}>
                          Pick Existing Contact
                        </button>
                        <button onClick={() => setAssignBuyerMode("new")} className={`px-3 py-1 rounded-lg text-xs font-medium ${assignBuyerMode === "new" ? "bg-amber-200 text-amber-900" : "bg-white text-slate-600 border border-slate-200"}`}>
                          Create New Contact
                        </button>
                      </div>
                      {assignBuyerMode === "existing" ? (
                        <InputField label="Select Contact">
                          <select value={assignBuyerForm.contact_id} onChange={(e) => setAssignBuyerForm(p => ({ ...p, contact_id: e.target.value }))} className={inputCls}>
                            <option value="">— Select buyer —</option>
                            {contacts.filter(c => c.relationship_type === "buyer" || !c.relationship_type).map(c => (
                              <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ""}</option>
                            ))}
                          </select>
                        </InputField>
                      ) : (
                        <div className="grid grid-cols-3 gap-3">
                          <InputField label="Name *">
                            <input type="text" value={assignBuyerForm.name} onChange={(e) => setAssignBuyerForm(p => ({ ...p, name: e.target.value }))} className={inputCls} placeholder="Full name" />
                          </InputField>
                          <InputField label="Phone">
                            <input type="text" value={assignBuyerForm.phone} onChange={(e) => setAssignBuyerForm(p => ({ ...p, phone: e.target.value }))} className={inputCls} placeholder="Optional" />
                          </InputField>
                          <InputField label="City">
                            <input type="text" value={assignBuyerForm.city} onChange={(e) => setAssignBuyerForm(p => ({ ...p, city: e.target.value }))} className={inputCls} placeholder="Optional" />
                          </InputField>
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

                  {/* ── Plot / Buyer Cards ── */}
                  {isPlotDeal ? (
                    plotBuyers.length > 0 ? (
                      <div className="space-y-3">
                        {plotBuyers.map((b) => (
                          <div key={b.id} className="p-3 border border-slate-200 rounded-xl">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-sm font-semibold text-slate-800">
                                  {b.buyer_name || <span className="text-slate-400 italic">No buyer assigned</span>}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {b.area_sqft ? `${b.area_sqft} sq ft` : ""}
                                  {b.rate_per_sqft ? ` @ ₹${b.rate_per_sqft}/sqft` : ""}
                                </p>
                                {(b.side_north_ft || b.side_south_ft || b.side_east_ft || b.side_west_ft) && (
                                  <p className="text-xs text-slate-400">
                                    Dimensions: N:{b.side_north_ft || "—"} S:{b.side_south_ft || "—"} E:{b.side_east_ft || "—"} W:{b.side_west_ft || "—"} ft
                                  </p>
                                )}
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-bold text-slate-800">{formatCurrency(b.total_value || 0)}</p>
                                <p className="text-xs text-emerald-600">Paid: {formatCurrency(b.total_paid || 0)}</p>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${b.status === "registry_done" ? "bg-emerald-100 text-emerald-700" : b.status === "advance_received" ? "bg-amber-100 text-amber-700" : b.status === "available" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                                  {(b.status || "available").replace(/_/g, " ")}
                                </span>
                                {isActive && !b.buyer_contact_id && (
                                  <button onClick={() => setAssigningBuyerTo({ type: "plot_buyer", id: b.id, label: `Plot ${b.area_sqft ? b.area_sqft + " sqft" : "#" + b.id}` })} className="block mt-1 text-xs text-amber-600 hover:underline font-medium">
                                    Assign Buyer →
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400 text-center py-4">No plots yet. Add a plot subdivision, then assign buyers.</p>
                    )
                  ) : (
                    sitePlots.length > 0 ? (
                      <div className="space-y-3">
                        {sitePlots.map((sp) => (
                          <div key={sp.id} className="p-3 border border-slate-200 rounded-xl">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-sm font-semibold text-slate-800">
                                  {sp.buyer_name || sp.plot_number || `Plot #${sp.id}`}
                                  {sp.buyer_name && sp.plot_number && <span className="text-xs text-slate-400 ml-1">({sp.plot_number})</span>}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {sp.area_sqft ? `${sp.area_sqft} sq ft` : ""}
                                  {sp.sold_price_per_sqft ? ` @ ₹${sp.sold_price_per_sqft}/sqft` : ""}
                                </p>
                                {(sp.side_north_ft || sp.side_south_ft || sp.side_east_ft || sp.side_west_ft) && (
                                  <p className="text-xs text-slate-400">
                                    Dimensions: N:{sp.side_north_ft || "—"} S:{sp.side_south_ft || "—"} E:{sp.side_east_ft || "—"} W:{sp.side_west_ft || "—"} ft
                                  </p>
                                )}
                                {!sp.buyer_contact_id && <p className="text-xs text-amber-500 italic mt-0.5">No buyer assigned</p>}
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-bold text-slate-800">{formatCurrency(sp.calculated_price || 0)}</p>
                                <p className="text-xs text-emerald-600">Paid: {formatCurrency(sp.total_paid || 0)}</p>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${sp.status === "sold" ? "bg-emerald-100 text-emerald-700" : sp.status === "advance_received" ? "bg-amber-100 text-amber-700" : sp.status === "available" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                                  {(sp.status || "available").replace(/_/g, " ")}
                                </span>
                                {isActive && !sp.buyer_contact_id && (
                                  <button onClick={() => setAssigningBuyerTo({ type: "site_plot", id: sp.id, label: sp.plot_number || `Plot #${sp.id}` })} className="block mt-1 text-xs text-amber-600 hover:underline font-medium">
                                    Assign Buyer →
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400 text-center py-4">No site plots yet. Add plots to track area and buyers.</p>
                    )
                  )}
                </div>
              )}

              {/* Transactions */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-bold text-slate-800">Transactions</h2>
                  {isActive && (
                    <button onClick={() => setShowTxnForm(!showTxnForm)} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-xl text-sm hover:bg-indigo-100">
                      + Add Transaction
                    </button>
                  )}
                </div>

                {showTxnForm && (
                  <div className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200/60 space-y-3">
                    <InputField label="Transaction Type">
                      <select
                        value={txnForm.txn_type}
                        onChange={(e) => setTxnForm(p => ({ ...p, txn_type: e.target.value, plot_buyer_id: "", site_plot_id: "", broker_name: "", from_partnership_pot: false }))}
                        className={inputCls}
                      >
                        <optgroup label="Outflows (Money Going Out)">
                          <option value="advance_to_seller">Advance to Seller</option>
                          <option value="remaining_to_seller">Remaining to Seller</option>
                          <option value="broker_commission">Broker Commission</option>
                          <option value="expense">Expense</option>
                        </optgroup>
                        <optgroup label="Inflows (Money Coming In)">
                          <option value="buyer_advance">Buyer Advance</option>
                          <option value="buyer_payment">Buyer Payment</option>
                          <option value="profit_received">Profit Received</option>
                        </optgroup>
                      </select>
                    </InputField>

                    <div className="grid grid-cols-2 gap-3">
                      <InputField label="Amount (₹)">
                        <input type="number" value={txnForm.amount} onChange={(e) => setTxnForm(p => ({ ...p, amount: e.target.value }))} className={inputCls} placeholder="0" min="0" />
                      </InputField>
                      <InputField label="Date">
                        <input type="date" value={txnForm.txn_date} onChange={(e) => setTxnForm(p => ({ ...p, txn_date: e.target.value }))} className={inputCls} />
                      </InputField>
                    </div>

                    {OUTFLOW_TYPES.includes(txnForm.txn_type) && (
                      <div className="grid grid-cols-2 gap-3">
                        <InputField label="Paid by (member)">
                          <select value={txnForm.from_partnership_pot ? "" : txnForm.member_id} onChange={(e) => setTxnForm(p => ({ ...p, member_id: e.target.value, account_id: "" }))} className={inputCls} disabled={txnForm.from_partnership_pot}>
                            <option value="">— Select —</option>
                            {members.map((m) => (
                              <option key={m.member?.id} value={String(m.member?.id)}>
                                {m.member?.is_self ? "Self (Me)" : m.contact?.name || "Partner"}
                              </option>
                            ))}
                          </select>
                        </InputField>
                        {(() => { const selMember = members.find(m => String(m.member?.id) === String(txnForm.member_id)); return selMember?.member?.is_self && !txnForm.from_partnership_pot; })() && (
                          <InputField label="From Account">
                            <select value={txnForm.account_id} onChange={(e) => setTxnForm(p => ({ ...p, account_id: e.target.value }))} className={inputCls}>
                              <option value="">— No account —</option>
                              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                          </InputField>
                        )}
                      </div>
                    )}

                    {OUTFLOW_TYPES.includes(txnForm.txn_type) && (
                      <div className="grid grid-cols-2 gap-3">
                        {txnForm.txn_type === "broker_commission" && (
                          <InputField label="Broker Name">
                            <input type="text" value={txnForm.broker_name} onChange={(e) => setTxnForm(p => ({ ...p, broker_name: e.target.value }))} className={inputCls} placeholder="Broker name" />
                          </InputField>
                        )}
                        <div className="flex items-end pb-1">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={txnForm.from_partnership_pot} onChange={(e) => setTxnForm(p => ({ ...p, from_partnership_pot: e.target.checked, ...( e.target.checked ? { member_id: "", account_id: "" } : {}) }))} className="rounded" />
                            <span className="text-sm text-slate-700">Paid from partnership pot</span>
                          </label>
                        </div>
                      </div>
                    )}

                    {INFLOW_TYPES.includes(txnForm.txn_type) && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <InputField label="Received by">
                            <select value={txnForm.received_by_member_id} onChange={(e) => setTxnForm(p => ({ ...p, received_by_member_id: e.target.value }))} className={inputCls}>
                              <option value="">Self (Me)</option>
                              {members.filter((m) => !m.member?.is_self).map((m) => (
                                <option key={m.member?.id} value={String(m.member?.id)}>{m.contact?.name || "Partner"}</option>
                              ))}
                            </select>
                          </InputField>
                          {!txnForm.received_by_member_id && (
                            <InputField label="Deposit to Account">
                              <select value={txnForm.account_id} onChange={(e) => setTxnForm(p => ({ ...p, account_id: e.target.value }))} className={inputCls}>
                                <option value="">— No account —</option>
                                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                              </select>
                            </InputField>
                          )}
                        </div>

                        {["buyer_advance", "buyer_payment"].includes(txnForm.txn_type) && (
                          <>
                            {plotBuyers.length === 0 && sitePlots.length === 0 ? (
                              <div className="col-span-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                                <p className="text-sm text-amber-800 font-medium">⚠ No buyer linked to this property. Add a buyer first before recording buyer payments.</p>
                              </div>
                            ) : (
                              <div className="grid grid-cols-2 gap-3">
                                {plotBuyers.length > 0 && (
                                  <InputField label="Plot Buyer *">
                                    <select value={txnForm.plot_buyer_id} onChange={(e) => setTxnForm(p => ({ ...p, plot_buyer_id: e.target.value }))} className={inputCls} required>
                                      <option value="">— Select Buyer —</option>
                                      {plotBuyers.map((b) => <option key={b.id} value={b.id}>{b.buyer_name || `Buyer #${b.id}`}</option>)}
                                    </select>
                                  </InputField>
                                )}
                                {sitePlots.length > 0 && (
                                  <InputField label="Site Plot *">
                                    <select value={txnForm.site_plot_id} onChange={(e) => setTxnForm(p => ({ ...p, site_plot_id: e.target.value }))} className={inputCls} required>
                                      <option value="">— Select Plot —</option>
                                      {sitePlots.map((sp) => <option key={sp.id} value={sp.id}>{sp.plot_number || sp.buyer_name || `Plot #${sp.id}`}</option>)}
                                    </select>
                                  </InputField>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}

                    <InputField label="Description">
                      <input type="text" value={txnForm.description} onChange={(e) => setTxnForm(p => ({ ...p, description: e.target.value }))} className={inputCls} placeholder="Optional" />
                    </InputField>

                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setShowTxnForm(false)} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200">Cancel</button>
                      <button onClick={handleAddTxn} disabled={!txnForm.amount || addTxnMutation.isPending || (["buyer_advance","buyer_payment"].includes(txnForm.txn_type) && !txnForm.plot_buyer_id && !txnForm.site_plot_id)} className="px-4 py-1.5 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl text-sm font-medium hover:from-indigo-600 hover:to-indigo-700 shadow-sm shadow-indigo-500/20 active:scale-[0.98] disabled:opacity-50">
                        {addTxnMutation.isPending ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                )}

                {transactions.length > 0 ? (
                  <div className="space-y-2">
                    {transactions.map((txn) => {
                      const isOut = OUTFLOW_TYPES.includes(txn.txn_type) || LEGACY_OUTFLOW.includes(txn.txn_type);
                      return (
                        <div key={txn.id} className="py-2 border-b border-slate-100 last:border-0">
                          {editingTxnId === txn.id && editTxnForm ? (
                            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 space-y-2">
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
                                      {members.map((m) => <option key={m.member?.id} value={String(m.member?.id)}>{m.member?.is_self ? "Self" : m.contact?.name || "Partner"}</option>)}
                                    </select>
                                  </div>
                                )}
                                {INFLOW_TYPES.includes(editTxnForm.txn_type) && (
                                  <div>
                                    <label className="block text-xs text-slate-500 mb-0.5">Received by</label>
                                    <select value={editTxnForm.received_by_member_id} onChange={(e) => setEditTxnForm(p => ({ ...p, received_by_member_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm">
                                      <option value="">Self (Me)</option>
                                      {members.filter(m => !m.member?.is_self).map((m) => <option key={m.member?.id} value={String(m.member?.id)}>{m.contact?.name || "Partner"}</option>)}
                                    </select>
                                  </div>
                                )}
                                {(() => { const selMember = members.find(m => String(m.member?.id) === String(editTxnForm.member_id)); return OUTFLOW_TYPES.includes(editTxnForm.txn_type) && selMember?.member?.is_self; })() && (
                                  <div>
                                    <label className="block text-xs text-slate-500 mb-0.5">Account</label>
                                    <select value={editTxnForm.account_id} onChange={(e) => setEditTxnForm(p => ({ ...p, account_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm">
                                      <option value="">None</option>
                                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                    </select>
                                  </div>
                                )}
                                {INFLOW_TYPES.includes(editTxnForm.txn_type) && !editTxnForm.received_by_member_id && (
                                  <div>
                                    <label className="block text-xs text-slate-500 mb-0.5">Account</label>
                                    <select value={editTxnForm.account_id} onChange={(e) => setEditTxnForm(p => ({ ...p, account_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm">
                                      <option value="">None</option>
                                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                    </select>
                                  </div>
                                )}
                              </div>
                              {["buyer_advance", "buyer_payment"].includes(editTxnForm.txn_type) && (plotBuyers.length > 0 || sitePlots.length > 0) && (
                                <div className="grid grid-cols-2 gap-2">
                                  {plotBuyers.length > 0 && (
                                    <div>
                                      <label className="block text-xs text-slate-500 mb-0.5">Plot Buyer</label>
                                      <select value={editTxnForm.plot_buyer_id} onChange={(e) => setEditTxnForm(p => ({ ...p, plot_buyer_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm">
                                        <option value="">— None —</option>
                                        {plotBuyers.map(b => <option key={b.id} value={b.id}>{b.buyer_name || `Buyer #${b.id}`}</option>)}
                                      </select>
                                    </div>
                                  )}
                                  {sitePlots.length > 0 && (
                                    <div>
                                      <label className="block text-xs text-slate-500 mb-0.5">Site Plot</label>
                                      <select value={editTxnForm.site_plot_id} onChange={(e) => setEditTxnForm(p => ({ ...p, site_plot_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm">
                                        <option value="">— None —</option>
                                        {sitePlots.map(sp => <option key={sp.id} value={sp.id}>{sp.plot_number || sp.buyer_name || `Plot #${sp.id}`}</option>)}
                                      </select>
                                    </div>
                                  )}
                                </div>
                              )}
                              {editTxnForm.txn_type === "broker_commission" && (
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-xs text-slate-500 mb-0.5">Broker Name</label>
                                    <input type="text" value={editTxnForm.broker_name} onChange={(e) => setEditTxnForm(p => ({ ...p, broker_name: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm" placeholder="Broker name" />
                                  </div>
                                  <div className="flex items-end pb-1">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                      <input type="checkbox" checked={editTxnForm.from_partnership_pot} onChange={(e) => setEditTxnForm(p => ({ ...p, from_partnership_pot: e.target.checked }))} className="rounded" />
                                      <span className="text-xs text-slate-700">From partnership pot</span>
                                    </label>
                                  </div>
                                </div>
                              )}
                              <div>
                                <label className="block text-xs text-slate-500 mb-0.5">Description</label>
                                <input type="text" value={editTxnForm.description} onChange={(e) => setEditTxnForm(p => ({ ...p, description: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-2 py-1 text-sm" />
                              </div>
                              <div className="flex gap-2 justify-end">
                                <button onClick={() => { setEditingTxnId(null); setEditTxnForm(null); }} className="px-2 py-1 bg-slate-100 text-slate-700 rounded-xl text-xs font-medium hover:bg-slate-200">Cancel</button>
                                <button onClick={handleUpdateTxn} disabled={updateTxnMutation.isPending} className="px-3 py-1 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl text-xs font-medium hover:from-indigo-600 hover:to-indigo-700 shadow-sm shadow-indigo-500/20 active:scale-[0.98] disabled:opacity-50">
                                  {updateTxnMutation.isPending ? "Saving..." : "Update"}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-sm font-medium text-slate-800">
                                  <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${isOut ? "bg-rose-400" : "bg-emerald-400"}`}></span>
                                  {TXN_TYPE_LABELS[txn.txn_type] || txn.txn_type.replace(/_/g, " ")}
                                </p>
                                {txn.member_id && (
                                  <p className="text-xs text-indigo-600 ml-3.5">
                                    By: {members.find((m) => m.member?.id === txn.member_id)?.member?.is_self ? "Self" : members.find((m) => m.member?.id === txn.member_id)?.contact?.name || "Partner"}
                                  </p>
                                )}
                                {txn.received_by_member_id && (
                                  <p className="text-xs text-amber-600 ml-3.5">
                                    Received by: {members.find((m) => m.member?.id === txn.received_by_member_id)?.member?.is_self ? "Self" : members.find((m) => m.member?.id === txn.received_by_member_id)?.contact?.name || "Partner"}
                                  </p>
                                )}
                                {txn.broker_name && <p className="text-xs text-slate-400 ml-3.5">Broker: {txn.broker_name}</p>}
                                {txn.from_partnership_pot && <p className="text-xs text-violet-600 ml-3.5">Paid from partnership pot</p>}
                                {txn.plot_buyer_id && (
                                  <p className="text-xs text-teal-600 ml-3.5">
                                    Buyer: {plotBuyers.find(b => b.id === txn.plot_buyer_id)?.buyer_name || `#${txn.plot_buyer_id}`}
                                  </p>
                                )}
                                {txn.site_plot_id && (
                                  <p className="text-xs text-teal-600 ml-3.5">
                                    Plot: {sitePlots.find(sp => sp.id === txn.site_plot_id)?.plot_number || sitePlots.find(sp => sp.id === txn.site_plot_id)?.buyer_name || `#${txn.site_plot_id}`}
                                  </p>
                                )}
                                {txn.description && <p className="text-xs text-slate-400 ml-3.5">{txn.description}</p>}
                                <p className="text-xs text-slate-400 ml-3.5">{formatDate(txn.txn_date)}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-semibold ${isOut ? "text-rose-600" : "text-emerald-600"}`}>
                                  {isOut ? "−" : "+"}{formatCurrency(txn.amount)}
                                </span>
                                {isActive && (
                                  <>
                                    <button onClick={() => openEditTxn(txn)} className="text-xs text-indigo-600 hover:underline">Edit</button>
                                    <button onClick={() => { if (window.confirm("Delete this transaction?")) deleteTxnMutation.mutate(txn.id); }} className="text-xs text-rose-600 hover:underline">Delete</button>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 text-center py-4">No transactions yet.</p>
                )}
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-5">
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                <h2 className="text-base font-bold text-slate-800 mb-4">Financial Summary</h2>
                <InfoRow label="Advance to Seller" value={formatCurrency(summary.advance_to_seller || 0)} />
                <InfoRow label="Remaining to Seller" value={formatCurrency(summary.remaining_to_seller || 0)} />
                <InfoRow label="Broker Commission" value={formatCurrency(summary.broker_commission || 0)} />
                <InfoRow label="Expenses" value={formatCurrency(summary.expense_total || 0)} />
                <div className="border-t border-slate-200 mt-2 pt-2">
                  <InfoRow label="Total Outflow" value={formatCurrency(summary.total_outflow || 0)} />
                </div>
                <InfoRow label="Buyer Payments" value={formatCurrency(summary.buyer_inflow || 0)} />
                <InfoRow label="Profit Received" value={formatCurrency(summary.profit_received || 0)} />
                <div className="border-t border-slate-200 mt-2 pt-2">
                  <InfoRow label="Total Inflow" value={formatCurrency(summary.total_inflow || 0)} />
                </div>
                <div className="border-t-2 border-slate-300 mt-2 pt-2">
                  <div className="flex justify-between py-1">
                    <span className="text-sm font-bold text-slate-700">Net P&L</span>
                    <span className={`text-sm font-bold ${netPnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{formatCurrency(netPnl)}</span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                <h2 className="text-base font-bold text-slate-800 mb-4">Details</h2>
                <InfoRow label="Start Date" value={partnership.start_date ? formatDate(partnership.start_date) : null} />
                <InfoRow label="Expected End" value={partnership.expected_end_date ? formatDate(partnership.expected_end_date) : null} />
                {isSettled && <InfoRow label="Actual End" value={partnership.actual_end_date ? formatDate(partnership.actual_end_date) : null} />}
                <InfoRow label="Created" value={formatDate(partnership.created_at)} />
              </div>

              {isActive && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                  <h2 className="text-base font-bold text-slate-800 mb-3">Actions</h2>
                  <button onClick={() => setShowSettleModal(true)} className="w-full py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium hover:from-emerald-600 hover:to-emerald-700 shadow-sm shadow-emerald-500/20 active:scale-[0.98] text-sm">
                    🤝 Record Settlement
                  </button>
                </div>
              )}

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
