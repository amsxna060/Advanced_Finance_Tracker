import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

const STATUS_COLORS = {
  negotiating: "bg-yellow-100 text-yellow-800",
  advance_given: "bg-orange-100 text-orange-800",
  buyer_found: "bg-blue-100 text-blue-800",
  registry_done: "bg-purple-100 text-purple-800",
  settled: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

function PlotDiagram({ left, right, top, bottom, area, roads }) {
  const hasAny = left || right || top || bottom;
  if (!hasAny) return null;

  const l = parseFloat(left) || 0;
  const r = parseFloat(right) || 0;
  const t = parseFloat(top) || 0;
  const b = parseFloat(bottom) || 0;

  // Parse roads
  let parsedRoads = [];
  try {
    if (roads) parsedRoads = typeof roads === "string" ? JSON.parse(roads) : roads;
  } catch { /* ignore */ }

  // Scale sides proportionally for visual representation
  const maxSide = Math.max(l, r, t, b, 1);
  const BASE_W = 200,
    BASE_H = 140,
    PAD = 55;
  const ROAD_W = 22;

  // Top and bottom widths proportional to actual measurements
  const topW = t > 0 ? Math.max((t / maxSide) * BASE_W, 80) : BASE_W;
  const botW = b > 0 ? Math.max((b / maxSide) * BASE_W, 80) : BASE_W;
  const leftH = l > 0 ? Math.max((l / maxSide) * BASE_H, 60) : BASE_H;
  const rightH = r > 0 ? Math.max((r / maxSide) * BASE_H, 60) : BASE_H;
  const plotH = Math.max(leftH, rightH);

  const svgW = Math.max(topW, botW) + PAD * 2 + ROAD_W * 2;
  const svgH = plotH + PAD * 2 + ROAD_W * 2;
  const cx = svgW / 2;
  const oY = PAD + ROAD_W;

  const x3 = cx + botW / 2,
    y4 = oY + plotH;
  const x4 = cx - botW / 2;
  const y1L = oY + (plotH - leftH);
  const y1R = oY + (plotH - rightH);

  const points = `${x4},${y4} ${cx - topW / 2},${y1L} ${cx + topW / 2},${y1R} ${x3},${y4}`;
  const midY = (Math.min(y1L, y1R) + y4) / 2;

  // Detect which sides have roads for label offsets
  const hasRoadN = parsedRoads.some((rd) => (rd.direction || "").toLowerCase() === "north");
  const hasRoadS = parsedRoads.some((rd) => (rd.direction || "").toLowerCase() === "south");
  const hasRoadE = parsedRoads.some((rd) => (rd.direction || "").toLowerCase() === "east");
  const hasRoadW = parsedRoads.some((rd) => (rd.direction || "").toLowerCase() === "west");

  // Road rectangles
  const roadRects = parsedRoads.map((rd, i) => {
    const dir = (rd.direction || "").toLowerCase();
    const w = parseFloat(rd.width_ft) || 20;
    const label = `Road ${w}ft`;
    if (dir === "north") {
      return (
        <g key={i}>
          <rect x={cx - topW / 2 - 5} y={Math.min(y1L, y1R) - ROAD_W - 2} width={topW + 10} height={ROAD_W} rx={3} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={1} />
          <text x={cx} y={Math.min(y1L, y1R) - ROAD_W / 2} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#475569">{label}</text>
        </g>
      );
    }
    if (dir === "south") {
      return (
        <g key={i}>
          <rect x={cx - botW / 2 - 5} y={y4 + 2} width={botW + 10} height={ROAD_W} rx={3} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={1} />
          <text x={cx} y={y4 + ROAD_W / 2 + 2} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#475569">{label}</text>
        </g>
      );
    }
    if (dir === "east") {
      return (
        <g key={i}>
          <rect x={Math.max(x3, cx + topW / 2) + 2} y={Math.min(y1R, y1L)} width={ROAD_W} height={plotH} rx={3} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={1} />
          <text x={Math.max(x3, cx + topW / 2) + ROAD_W / 2 + 2} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#475569" transform={`rotate(90, ${Math.max(x3, cx + topW / 2) + ROAD_W / 2 + 2}, ${midY})`}>{label}</text>
        </g>
      );
    }
    if (dir === "west") {
      return (
        <g key={i}>
          <rect x={Math.min(x4, cx - topW / 2) - ROAD_W - 2} y={Math.min(y1L, y1R)} width={ROAD_W} height={plotH} rx={3} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={1} />
          <text x={Math.min(x4, cx - topW / 2) - ROAD_W / 2 - 2} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#475569" transform={`rotate(-90, ${Math.min(x4, cx - topW / 2) - ROAD_W / 2 - 2}, ${midY})`}>{label}</text>
        </g>
      );
    }
    return null;
  });

  return (
    <svg width={svgW} height={svgH} style={{ overflow: "visible" }}>
      {roadRects}
      <polygon
        points={points}
        fill="#eff6ff"
        stroke="#3b82f6"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {/* North label */}
      <text
        x={cx}
        y={Math.min(y1L, y1R) - (hasRoadN ? ROAD_W + 10 : 10)}
        textAnchor="middle"
        fontSize={12}
        fill="#1d4ed8"
      >
        {top ? `N: ${top} ft` : "—"}
      </text>
      {/* South label */}
      <text x={cx} y={y4 + (hasRoadS ? ROAD_W + 10 : 20)} textAnchor="middle" fontSize={12} fill="#1d4ed8">
        {bottom ? `S: ${bottom} ft` : "—"}
      </text>
      {/* West label */}
      <text
        x={Math.min(x4, cx - topW / 2) - (hasRoadW ? ROAD_W + 8 : 8)}
        y={(y1L + y4) / 2}
        textAnchor="end"
        dominantBaseline="middle"
        fontSize={12}
        fill="#1d4ed8"
      >
        {left ? `W: ${left} ft` : "—"}
      </text>
      {/* East label */}
      <text
        x={Math.max(x3, cx + topW / 2) + (hasRoadE ? ROAD_W + 8 : 8)}
        y={(y1R + y4) / 2}
        textAnchor="start"
        dominantBaseline="middle"
        fontSize={12}
        fill="#1d4ed8"
      >
        {right ? `E: ${right} ft` : "—"}
      </text>
      {/* Area in center */}
      {area && (
        <text
          x={cx}
          y={midY}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={13}
          fill="#1e40af"
          fontWeight="600"
        >
          {Number(area).toLocaleString()} sqft
        </text>
      )}
    </svg>
  );
}

function InfoRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900 text-right max-w-[60%]">
        {value}
      </span>
    </div>
  );
}

function SitePlotsSection({ propertyId, plots, accounts, isSettled }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const emptyPlot = {
    plot_number: "",
    area_sqft: "",
    side_north_ft: "",
    side_south_ft: "",
    side_east_ft: "",
    side_west_ft: "",
    sold_price_per_sqft: "",
    calculated_price: "",
    buyer_name: "",
    notes: "",
    sold_date: new Date().toISOString().split("T")[0],
  };
  const [form, setForm] = useState(emptyPlot);

  const set = (k, v) => {
    setForm((prev) => {
      const next = { ...prev, [k]: v };
      if ((k === "area_sqft" || k === "sold_price_per_sqft") && next.area_sqft && next.sold_price_per_sqft) {
        next.calculated_price = String((parseFloat(next.area_sqft) || 0) * (parseFloat(next.sold_price_per_sqft) || 0));
      }
      return next;
    });
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["property", propertyId] });
  };

  const saveMutation = useMutation({
    mutationFn: async (payload) => {
      if (editingId) {
        return api.put(`/api/properties/${propertyId}/plots/${editingId}`, payload);
      }
      return api.post(`/api/properties/${propertyId}/plots`, payload);
    },
    onSuccess: () => { invalidate(); setShowForm(false); setEditingId(null); setForm(emptyPlot); },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to save plot"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (plotId) => api.delete(`/api/properties/${propertyId}/plots/${plotId}`),
    onSuccess: invalidate,
    onError: (err) => alert(err?.response?.data?.detail || "Failed to delete plot"),
  });

  const handleSave = () => {
    const payload = {};
    for (const [k, v] of Object.entries(form)) {
      if (v === "" || v === null) { payload[k] = null; continue; }
      if (["area_sqft", "side_north_ft", "side_south_ft", "side_east_ft", "side_west_ft", "sold_price_per_sqft", "calculated_price"].includes(k)) {
        payload[k] = parseFloat(v) || null;
      } else {
        payload[k] = v || null;
      }
    }
    saveMutation.mutate(payload);
  };

  const openEdit = (p) => {
    setEditingId(p.id);
    setForm({
      plot_number: p.plot_number || "",
      area_sqft: p.area_sqft ? String(p.area_sqft) : "",
      side_north_ft: p.side_north_ft ? String(p.side_north_ft) : "",
      side_south_ft: p.side_south_ft ? String(p.side_south_ft) : "",
      side_east_ft: p.side_east_ft ? String(p.side_east_ft) : "",
      side_west_ft: p.side_west_ft ? String(p.side_west_ft) : "",
      sold_price_per_sqft: p.sold_price_per_sqft ? String(p.sold_price_per_sqft) : "",
      calculated_price: p.calculated_price ? String(p.calculated_price) : "",
      buyer_name: p.buyer_name || "",
      notes: p.notes || "",
      sold_date: p.sold_date || "",
    });
    setShowForm(true);
  };

  const totalRevenue = plots.reduce((s, p) => s + parseFloat(p.calculated_price || 0), 0);
  const totalAreaSold = plots.reduce((s, p) => s + parseFloat(p.area_sqft || 0), 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-800">Plots Sold</h2>
        {!isSettled && (
          <button
            onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(emptyPlot); }}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            {showForm ? "Cancel" : "+ Add Plot"}
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Plot Number</label>
              <input type="text" value={form.plot_number} onChange={(e) => set("plot_number", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. A-1" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Area (sqft)</label>
              <input type="number" step="0.001" value={form.area_sqft} onChange={(e) => set("area_sqft", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="0" min="0" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Sold Date</label>
              <input type="date" value={form.sold_date} onChange={(e) => set("sold_date", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">North (ft)</label>
              <input type="number" step="0.001" value={form.side_north_ft} onChange={(e) => set("side_north_ft", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" min="0" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">South (ft)</label>
              <input type="number" step="0.001" value={form.side_south_ft} onChange={(e) => set("side_south_ft", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" min="0" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">East (ft)</label>
              <input type="number" step="0.001" value={form.side_east_ft} onChange={(e) => set("side_east_ft", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" min="0" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">West (ft)</label>
              <input type="number" step="0.001" value={form.side_west_ft} onChange={(e) => set("side_west_ft", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" min="0" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Price / sqft (₹)</label>
              <input type="number" step="0.001" value={form.sold_price_per_sqft} onChange={(e) => set("sold_price_per_sqft", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" min="0" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Calculated Price (₹)</label>
              <input type="number" step="0.001" value={form.calculated_price} onChange={(e) => set("calculated_price", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" min="0" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Buyer Name</label>
              <input type="text" value={form.buyer_name} onChange={(e) => set("buyer_name", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Buyer name" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <input type="text" value={form.notes} onChange={(e) => set("notes", e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Optional" />
          </div>
          <button onClick={handleSave} disabled={saveMutation.isPending}
            className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {saveMutation.isPending ? "Saving…" : editingId ? "Update Plot" : "Add Plot"}
          </button>
        </div>
      )}

      {plots.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-gray-500 font-medium">Plot</th>
                  <th className="text-right py-2 text-gray-500 font-medium">Area</th>
                  <th className="text-right py-2 text-gray-500 font-medium">Rate/sqft</th>
                  <th className="text-right py-2 text-gray-500 font-medium">Price</th>
                  <th className="text-left py-2 text-gray-500 font-medium pl-3">Buyer</th>
                  <th className="text-left py-2 text-gray-500 font-medium pl-3">Date</th>
                  <th className="py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {plots.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100">
                    <td className="py-2 font-medium">{p.plot_number || "—"}</td>
                    <td className="text-right py-2">{p.area_sqft ? `${Number(p.area_sqft).toLocaleString()} sqft` : "—"}</td>
                    <td className="text-right py-2">{p.sold_price_per_sqft ? `₹${Number(p.sold_price_per_sqft).toLocaleString()}` : "—"}</td>
                    <td className="text-right py-2 font-semibold text-green-700">{p.calculated_price ? formatCurrency(p.calculated_price) : "—"}</td>
                    <td className="py-2 pl-3">{p.buyer_name || "—"}</td>
                    <td className="py-2 pl-3 text-gray-500">{p.sold_date ? formatDate(p.sold_date) : "—"}</td>
                    <td className="py-2">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => openEdit(p)} className="text-xs text-blue-600 hover:underline">Edit</button>
                        <button onClick={() => { if (window.confirm("Delete this plot?")) deleteMutation.mutate(p.id); }}
                          className="text-xs text-red-600 hover:underline">Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-gray-300 font-semibold">
                  <td className="py-2">Total</td>
                  <td className="text-right py-2">{totalAreaSold.toLocaleString()} sqft</td>
                  <td></td>
                  <td className="text-right py-2 text-green-700">{formatCurrency(totalRevenue)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-400 italic text-center py-4">No plots sold yet.</p>
      )}
    </div>
  );
}

export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showSettleModal, setShowSettleModal] = useState(false);
  const [showAddAdvance, setShowAddAdvance] = useState(false);
  const [editingTxnId, setEditingTxnId] = useState(null);
  const [editTxnForm, setEditTxnForm] = useState({
    amount: "",
    txn_date: "",
    account_id: "",
    description: "",
  });
  const [advanceForm, setAdvanceForm] = useState({
    amount: "",
    txn_date: new Date().toISOString().split("T")[0],
    account_id: "",
    description: "",
  });
  const [settleForm, setSettleForm] = useState({
    registry_date: new Date().toISOString().split("T")[0],
    buyer_rate_per_sqft: "",
    other_expenses: "0",
    total_profit_received: "",
    site_deal_end_date: "",
  });
  const [settleResult, setSettleResult] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["property", id],
    queryFn: async () => {
      const res = await api.get(`/api/properties/${id}`);
      return res.data;
    },
    retry: 2,
  });

  const deletePropertyMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/api/properties/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      navigate("/properties");
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to delete"),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await api.get("/api/accounts")).data,
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ["property-transactions", id],
    queryFn: async () =>
      (await api.get(`/api/properties/${id}/transactions`)).data,
  });

  const addAdvanceMutation = useMutation({
    mutationFn: async (payload) => {
      return api.post(`/api/properties/${id}/transactions`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["property-transactions", id],
      });
      queryClient.invalidateQueries({ queryKey: ["property", id] });
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setShowAddAdvance(false);
      setAdvanceForm({
        amount: "",
        txn_date: new Date().toISOString().split("T")[0],
        account_id: "",
        description: "",
      });
    },
    onError: (err) =>
      alert(err?.response?.data?.detail || "Failed to add advance"),
  });

  const deleteAdvanceMutation = useMutation({
    mutationFn: async (txnId) =>
      api.delete(`/api/properties/${id}/transactions/${txnId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["property-transactions", id],
      });
      queryClient.invalidateQueries({ queryKey: ["property", id] });
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to delete"),
  });

  const updateAdvanceMutation = useMutation({
    mutationFn: async ({ txnId, payload }) =>
      api.put(`/api/properties/${id}/transactions/${txnId}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["property-transactions", id],
      });
      queryClient.invalidateQueries({ queryKey: ["property", id] });
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setEditingTxnId(null);
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to update"),
  });

  const handleAddAdvance = (e) => {
    e.preventDefault();
    addAdvanceMutation.mutate({
      txn_type: "advance_to_seller",
      amount: parseFloat(advanceForm.amount),
      txn_date: advanceForm.txn_date,
      account_id: advanceForm.account_id
        ? Number(advanceForm.account_id)
        : null,
      payment_mode: "bank_transfer",
      description: advanceForm.description || "Advance to seller",
    });
  };

  const handleStartEditTxn = (t) => {
    setEditingTxnId(t.id);
    setEditTxnForm({
      amount: String(parseFloat(t.amount)),
      txn_date: t.txn_date,
      account_id: t.account_id ? String(t.account_id) : "",
      description: t.description || "",
    });
  };

  const handleSaveEditTxn = (txnId) => {
    updateAdvanceMutation.mutate({
      txnId,
      payload: {
        amount: parseFloat(editTxnForm.amount),
        txn_date: editTxnForm.txn_date,
        account_id: editTxnForm.account_id
          ? Number(editTxnForm.account_id)
          : null,
        description: editTxnForm.description || null,
      },
    });
  };

  const settleMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await api.post(`/api/properties/${id}/settle`, payload);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["property", id] });
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      setSettleResult(data.settlement_summary);
      setShowSettleModal(false);
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to settle"),
  });

  const handleSettle = () => {
    const isSite = property?.property_type === "site";
    if (isSite) {
      settleMutation.mutate({
        total_profit_received: settleForm.total_profit_received
          ? parseFloat(settleForm.total_profit_received)
          : null,
        site_deal_end_date: settleForm.site_deal_end_date || null,
      });
    } else {
      settleMutation.mutate({
        buyer_rate_per_sqft: settleForm.buyer_rate_per_sqft
          ? parseFloat(settleForm.buyer_rate_per_sqft)
          : null,
        registry_date: settleForm.registry_date || null,
        other_expenses: settleForm.other_expenses
          ? parseFloat(settleForm.other_expenses)
          : 0,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (isError || !data?.property) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Property deal not found.</p>
          <button
            onClick={() => navigate("/properties")}
            className="text-blue-600 hover:underline"
          >
            ← Back to Properties
          </button>
        </div>
      </div>
    );
  }

  const property = data.property;
  const seller = data.seller;
  const lp = data.linked_partnership;
  const isSite = property.property_type === "site";
  const isSettled = property.status === "settled";
  const members = lp?.members || [];
  const partnershipExpenses = data.partnership_expenses || []; // from linked partnership

  // Calculate site settlement summary from property data (for display after page reload)
  const calculateSiteSettlementSummary = () => {
    if (!isSite || !isSettled) return null;

    const myInvestment = parseFloat(property.my_investment || 0);
    const totalProfitReceived = parseFloat(property.total_profit_received || 0);
    const mySharePct = parseFloat(property.my_share_percentage || 0);
    const myProfit = totalProfitReceived * (mySharePct / 100);
    const totalReturned = myInvestment + myProfit;

    // Calculate duration and ROI
    let durationMonths = null;
    let roiPerAnnumPercent = null;

    if (property.site_deal_start_date && property.site_deal_end_date) {
      const startDate = new Date(property.site_deal_start_date);
      const endDate = new Date(property.site_deal_end_date);
      const durationDays = Math.floor(
        (endDate - startDate) / (1000 * 60 * 60 * 24),
      );
      durationMonths = (durationDays / 30.44).toFixed(1);

      if (myInvestment > 0 && durationDays > 0) {
        roiPerAnnumPercent =
          (myProfit / myInvestment / (durationDays / 365)) * 100;
      }
    }

    return {
      deal_type: "site",
      my_investment: myInvestment,
      my_profit: myProfit,
      total_returned_to_me: totalReturned,
      roi_per_annum_percent: roiPerAnnumPercent,
      duration_months: durationMonths ? parseFloat(durationMonths) : null,
    };
  };

  const siteSettlementSummary = calculateSiteSettlementSummary();

  // Calculate plot settlement summary from property data (for display after page reload)
  const calculatePlotSettlementSummary = () => {
    if (isSite || !isSettled || !property.net_profit) return null;
    const netProfit = parseFloat(property.net_profit || 0);
    const sellerValue = parseFloat(property.total_seller_value || 0);
    const advancePaid = parseFloat(property.advance_paid || 0);
    // Build per-member expense map from stored partnership_expenses
    // member_id null = property-level expense = self
    const memberExpMap = {};
    partnershipExpenses.forEach((pe) => {
      const key = pe.member_id ?? "self";
      memberExpMap[key] = (memberExpMap[key] || 0) + pe.amount;
    });
    // property-level transactions (stored in property.other_expenses at settle time)
    // property.other_expenses includes all after settlement
    const partnerPartnershipExpTotal = partnershipExpenses.reduce((s, pe) => s + pe.amount, 0);
    const propLevelExpTotal = parseFloat(property.other_expenses || 0) - partnerPartnershipExpTotal;

    const partnerSettlements = members.map((m) => {
      const sharePct = parseFloat(m.member?.share_percentage || 0);
      const advance = parseFloat(m.member?.advance_contributed || 0);
      const profitShare = netProfit * (sharePct / 100);
      // Expenses this member paid: by member.id in partnership_expenses + prop-level if self
      let otherExpReturned = memberExpMap[m.member?.id] || 0;
      if (m.member?.is_self) otherExpReturned += Math.max(propLevelExpTotal, 0);
      return {
        contact_name: m.member?.is_self ? "Self" : m.contact?.name || "Unknown",
        is_self: m.member?.is_self,
        share_percentage: sharePct,
        advance_returned: advance,
        other_expense_returned: otherExpReturned,
        profit_share: profitShare,
        total_to_receive: advance + otherExpReturned + profitShare,
      };
    });
    return {
      deal_type: "plot",
      total_buyer_value: parseFloat(property.total_buyer_value || 0),
      total_seller_value: sellerValue,
      advance_paid: advancePaid,
      seller_remaining: sellerValue - advancePaid,
      broker_name: property.broker_name,
      broker_commission: parseFloat(property.broker_commission || 0),
      other_expenses: parseFloat(property.other_expenses || 0),
      gross_profit: parseFloat(property.gross_profit || 0),
      net_profit: netProfit,
      partner_settlements: partnerSettlements,
    };
  };

  const plotSettlementSummary = calculatePlotSettlementSummary();
  const displaySettlementSummary =
    settleResult || siteSettlementSummary || plotSettlementSummary;

  // Live calculation for plot settle modal
  const area = parseFloat(property.total_area_sqft || 0);
  const sellerTotal = parseFloat(property.total_seller_value || 0);
  const brokerComm = parseFloat(property.broker_commission || 0);
  const liveBuyerTotal = (() => {
    const rate = parseFloat(settleForm.buyer_rate_per_sqft);
    return !isNaN(rate) && area > 0 ? rate * area : null;
  })();
  const liveGross =
    liveBuyerTotal !== null ? liveBuyerTotal - sellerTotal : null;
  const liveOther = parseFloat(settleForm.other_expenses || 0);
  const liveNet =
    liveGross !== null
      ? liveGross - brokerComm - (isNaN(liveOther) ? 0 : liveOther)
      : null;

  const otherExpenseTxns = transactions.filter((t) => t.txn_type === "other_expense");
  // Combine property-level + partnership-level expenses for display
  const allOtherExpenses = [
    ...otherExpenseTxns.map((t) => ({ ...t, source: "property", payer_name: "Self" })),
    ...partnershipExpenses,
  ];
  const totalOtherExpenses = allOtherExpenses.reduce((s, t) => s + parseFloat(t.amount || 0), 0);

  const totalAdvancePool = members.reduce(
    (sum, m) => sum + parseFloat(m.member?.advance_contributed || 0),
    0,
  );

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/properties")}
              className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-200"
            >
              ←
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {property.title}
              </h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[property.status] || "bg-gray-100 text-gray-700"}`}
                >
                  {property.status?.replace(/_/g, " ")}
                </span>
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {isSite ? "Site" : "Plot"} ·{" "}
                  {property.deal_type?.replace(/_/g, " ")}
                </span>
                {property.location && (
                  <span className="text-xs text-gray-500">
                    📍 {property.location}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate(`/properties/${id}/edit`)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Edit
            </button>
            <button
              onClick={() => {
                if (window.confirm("Delete this deal?"))
                  deletePropertyMutation.mutate();
              }}
              className="px-3 py-1.5 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Settlement Result Banner */}
        {displaySettlementSummary && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">✅</span>
              <h3 className="text-lg font-bold text-green-800">
                Deal Settled Successfully!
              </h3>
            </div>
            {displaySettlementSummary.deal_type === "site" ? (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-500">My Investment:</span>{" "}
                  <span className="font-semibold">
                    {formatCurrency(displaySettlementSummary.my_investment)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">My Profit:</span>{" "}
                  <span className="font-semibold text-green-700">
                    {formatCurrency(displaySettlementSummary.my_profit)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Total Returned:</span>{" "}
                  <span className="font-semibold">
                    {formatCurrency(
                      displaySettlementSummary.total_returned_to_me,
                    )}
                  </span>
                </div>
                {displaySettlementSummary.roi_per_annum_percent && (
                  <div>
                    <span className="text-gray-500">ROI p.a.:</span>{" "}
                    <span className="font-semibold text-blue-700">
                      {displaySettlementSummary.roi_per_annum_percent.toFixed(
                        2,
                      )}
                      %
                    </span>
                  </div>
                )}
                {displaySettlementSummary.duration_months && (
                  <div>
                    <span className="text-gray-500">Duration:</span>{" "}
                    <span className="font-semibold">
                      {displaySettlementSummary.duration_months} months
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* 1. Money from Buyer */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
                  <div className="bg-blue-50 rounded-lg p-3">
                    <div className="text-xs text-blue-500 font-medium mb-0.5">
                      Money from Buyer
                    </div>
                    <div className="font-bold text-blue-800 text-base">
                      {formatCurrency(
                        displaySettlementSummary.total_buyer_value,
                      )}
                    </div>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-3">
                    <div className="text-xs text-amber-600 font-medium mb-0.5">
                      Brokerage{" "}
                      {displaySettlementSummary.broker_name
                        ? `— ${displaySettlementSummary.broker_name}`
                        : ""}
                    </div>
                    <div className="font-bold text-amber-800 text-base">
                      {formatCurrency(
                        displaySettlementSummary.broker_commission,
                      )}
                    </div>
                  </div>
                  {displaySettlementSummary.other_expenses > 0 && (
                    <div className="bg-orange-50 rounded-lg p-3">
                      <div className="text-xs text-orange-600 font-medium mb-0.5">
                        Other Expenses
                      </div>
                      <div className="font-bold text-orange-800 text-base">
                        {formatCurrency(
                          displaySettlementSummary.other_expenses,
                        )}
                      </div>
                    </div>
                  )}
                  <div className="bg-red-50 rounded-lg p-3">
                    <div className="text-xs text-red-500 font-medium mb-0.5">
                      Remaining to Seller
                    </div>
                    <div className="font-bold text-red-700 text-base">
                      {formatCurrency(
                        displaySettlementSummary.seller_remaining,
                      )}
                    </div>
                    <div className="text-xs text-red-400">
                      (Total{" "}
                      {formatCurrency(
                        displaySettlementSummary.total_seller_value,
                      )}{" "}
                      − Advance{" "}
                      {formatCurrency(displaySettlementSummary.advance_paid)}{" "}
                      paid)
                    </div>
                  </div>
                </div>

                {/* 2. Partner Shares */}
                {displaySettlementSummary.partner_settlements?.length > 0 && (
                  <div className="overflow-x-auto">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      Partner Distribution
                    </div>
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-green-200">
                          <th className="text-left py-2 text-gray-600 font-medium">
                            Partner
                          </th>
                          <th className="text-right py-2 text-gray-600 font-medium">
                            Share
                          </th>
                          <th className="text-right py-2 text-gray-600 font-medium">
                            Advance Back
                          </th>
                          <th className="text-right py-2 text-gray-600 font-medium">
                            Exp. Back
                          </th>
                          <th className="text-right py-2 text-gray-600 font-medium">
                            Profit Share
                          </th>
                          <th className="text-right py-2 text-gray-600 font-medium">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {displaySettlementSummary.partner_settlements.map(
                          (ps, i) => (
                            <tr key={i} className="border-b border-green-100">
                              <td className="py-2 font-medium">
                                {ps.contact_name}
                                {ps.is_self && " (You)"}
                              </td>
                              <td className="text-right py-2">
                                {ps.share_percentage}%
                              </td>
                              <td className="text-right py-2">
                                {formatCurrency(ps.advance_returned)}
                              </td>
                              <td className="text-right py-2">
                                {ps.other_expense_returned > 0
                                  ? formatCurrency(ps.other_expense_returned)
                                  : "—"}
                              </td>
                              <td className="text-right py-2">
                                {formatCurrency(ps.profit_share)}
                              </td>
                              <td className="text-right py-2 font-semibold text-green-700">
                                {formatCurrency(ps.total_to_receive)}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 3. Summary row */}
                <div className="mt-3 pt-3 border-t border-green-200 flex flex-wrap gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Net Profit:</span>{" "}
                    <span className="font-bold text-green-700">
                      {formatCurrency(displaySettlementSummary.net_profit)}
                    </span>
                  </div>
                  {displaySettlementSummary.broker_commission > 0 && (
                    <div>
                      <span className="text-gray-500">Brokerage paid:</span>{" "}
                      <span className="font-semibold text-amber-700">
                        {formatCurrency(
                          displaySettlementSummary.broker_commission,
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-5">
            {/* Property Overview */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <h2 className="text-base font-semibold text-gray-800 mb-4">
                Property Overview
              </h2>

              {isSite ? (
                <>
                  <InfoRow
                    label="Total Area"
                    value={
                      property.total_area_sqft
                        ? `${Number(property.total_area_sqft).toLocaleString()} sqft`
                        : null
                    }
                  />
                  <InfoRow
                    label="Total Value to Seller"
                    value={
                      property.total_seller_value
                        ? formatCurrency(property.total_seller_value)
                        : null
                    }
                  />
                  {/* My Investment with per-account breakdown */}
                  <div className="py-2 border-b border-gray-100 last:border-0">
                    <div className="flex justify-between items-start">
                      <span className="text-sm text-gray-500">
                        My Investment
                      </span>
                      <span className="text-sm font-semibold text-gray-900">
                        {property.my_investment
                          ? formatCurrency(property.my_investment)
                          : "—"}
                      </span>
                    </div>
                    {/* Per-account breakdown */}
                    {(() => {
                      const advTxns = transactions.filter(
                        (t) => t.txn_type === "advance_to_seller",
                      );
                      if (advTxns.length === 0) return null;
                      // Group by account_id
                      const byAccount = {};
                      for (const t of advTxns) {
                        const key = t.account_id ?? "__none__";
                        byAccount[key] =
                          (byAccount[key] || 0) + parseFloat(t.amount);
                      }
                      const entries = Object.entries(byAccount);
                      if (entries.length === 0) return null;
                      return (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {entries.map(([accId, total]) => {
                            const acct = accounts.find(
                              (a) => a.id === Number(accId),
                            );
                            const name = acct
                              ? acct.name
                              : accId === "__none__"
                                ? "Unspecified"
                                : "Unknown";
                            return (
                              <span
                                key={accId}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-teal-50 border border-teal-200 text-teal-700 font-medium"
                              >
                                {name}: {formatCurrency(total)}
                              </span>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                  <InfoRow
                    label="My Share %"
                    value={
                      property.my_share_percentage
                        ? `${property.my_share_percentage}%`
                        : null
                    }
                  />
                  <InfoRow
                    label="Deal Start Date"
                    value={
                      property.site_deal_start_date
                        ? formatDate(property.site_deal_start_date)
                        : null
                    }
                  />
                  {property.site_deal_end_date && (
                    <InfoRow
                      label="Deal End Date"
                      value={formatDate(property.site_deal_end_date)}
                    />
                  )}
                  {property.total_profit_received && (
                    <InfoRow
                      label="Total Profit Received"
                      value={formatCurrency(property.total_profit_received)}
                    />
                  )}
                </>
              ) : (
                <>
                  {/* Plot dimensions diagram — PlotDiagram renders nothing if no dimensions set */}
                  <div className="flex justify-center mb-4">
                    <PlotDiagram
                      left={property.side_west_ft || property.side_left_ft}
                      right={property.side_east_ft || property.side_right_ft}
                      top={property.side_north_ft || property.side_top_ft}
                      bottom={property.side_south_ft || property.side_bottom_ft}
                      area={property.total_area_sqft}
                      roads={property.roads_json}
                    />
                  </div>
                  <InfoRow
                    label="Total Area"
                    value={
                      property.total_area_sqft
                        ? `${Number(property.total_area_sqft).toLocaleString()} sqft`
                        : null
                    }
                  />
                  <InfoRow label="Seller" value={seller?.name} />
                  <InfoRow
                    label="Seller Rate"
                    value={
                      property.seller_rate_per_sqft
                        ? `₹${Number(property.seller_rate_per_sqft).toLocaleString()}/sqft`
                        : null
                    }
                  />
                  <InfoRow
                    label="Total Seller Value"
                    value={
                      property.total_seller_value
                        ? formatCurrency(property.total_seller_value)
                        : null
                    }
                  />
                  <InfoRow
                    label="Advance Paid"
                    value={
                      property.advance_paid > 0
                        ? formatCurrency(property.advance_paid)
                        : null
                    }
                  />
                  <InfoRow label="Broker" value={property.broker_name} />
                  <InfoRow
                    label="Broker Commission"
                    value={
                      property.broker_commission > 0
                        ? formatCurrency(property.broker_commission)
                        : null
                    }
                  />
                </>
              )}
            </div>

            {/* Timeline (plot only) */}
            {!isSite && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-800 mb-4">
                  Timeline
                </h2>
                <InfoRow
                  label="Advance Date"
                  value={
                    property.advance_date
                      ? formatDate(property.advance_date)
                      : null
                  }
                />
                <InfoRow
                  label="Deal Locked"
                  value={
                    property.deal_locked_date
                      ? formatDate(property.deal_locked_date)
                      : null
                  }
                />
                <InfoRow
                  label="Expected Registry"
                  value={
                    property.expected_registry_date
                      ? formatDate(property.expected_registry_date)
                      : null
                  }
                />
                {property.actual_registry_date && (
                  <InfoRow
                    label="Actual Registry"
                    value={formatDate(property.actual_registry_date)}
                  />
                )}
              </div>
            )}

            {/* Settled profit details */}
            {isSettled && !isSite && property.net_profit && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-5">
                <h2 className="text-base font-semibold text-green-800 mb-3">
                  Settlement Details
                </h2>
                <InfoRow
                  label="Total Buyer Value"
                  value={
                    property.total_buyer_value
                      ? formatCurrency(property.total_buyer_value)
                      : null
                  }
                />
                <InfoRow
                  label="Total Seller Value"
                  value={
                    property.total_seller_value
                      ? formatCurrency(property.total_seller_value)
                      : null
                  }
                />
                <InfoRow
                  label="Gross Profit"
                  value={
                    property.gross_profit
                      ? formatCurrency(property.gross_profit)
                      : null
                  }
                />
                <InfoRow
                  label="Broker Commission"
                  value={
                    property.broker_commission > 0
                      ? formatCurrency(property.broker_commission)
                      : null
                  }
                />
                <InfoRow
                  label="Net Profit"
                  value={
                    property.net_profit
                      ? formatCurrency(property.net_profit)
                      : null
                  }
                />
              </div>
            )}

            {/* ── SITE PLOTS SOLD SECTION ── */}
            {isSite && (
              <SitePlotsSection propertyId={id} plots={data.site_plots || []} accounts={accounts} isSettled={isSettled} />
            )}

            {/* Partnership Info */}
            {!isSite && lp && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-semibold text-gray-800">
                    Partnership
                  </h2>
                  <Link
                    to={`/partnerships/${lp.partnership.id}`}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    View Partnership →
                  </Link>
                </div>
                <p className="text-sm text-blue-700 bg-blue-50 px-3 py-2 rounded-lg mb-3">
                  Linked to: <strong>{lp.partnership.title}</strong> (
                  {members.length} partner{members.length !== 1 ? "s" : ""})
                </p>
                {members.length > 0 && (
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 text-gray-500 font-medium">
                          Partner
                        </th>
                        <th className="text-right py-2 text-gray-500 font-medium">
                          Share %
                        </th>
                        <th className="text-right py-2 text-gray-500 font-medium">
                          Advance
                        </th>
                        {isSettled && (
                          <th className="text-right py-2 text-gray-500 font-medium">
                            Total Received
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          <td className="py-2 font-medium">
                            {m.member.is_self
                              ? "Self (You)"
                              : m.contact?.name || "Unknown"}
                          </td>
                          <td className="text-right py-2">
                            {m.member.share_percentage}%
                          </td>
                          <td className="text-right py-2">
                            {formatCurrency(m.member.advance_contributed)}
                          </td>
                          {isSettled && (
                            <td className="text-right py-2 text-green-700 font-semibold">
                              {formatCurrency(m.member.total_received)}
                            </td>
                          )}
                        </tr>
                      ))}
                      <tr className="border-t border-gray-300 font-semibold">
                        <td className="py-2">Total</td>
                        <td className="text-right py-2"></td>
                        <td className="text-right py-2">
                          {formatCurrency(totalAdvancePool)}
                        </td>
                        {isSettled && <td className="text-right py-2"></td>}
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Property Transactions / Advance Payments */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-800">
                  Advance Payments
                </h2>
                {!isSettled && (
                  <button
                    onClick={() => setShowAddAdvance(!showAddAdvance)}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    {showAddAdvance ? "Cancel" : "+ Add Advance"}
                  </button>
                )}
              </div>

              {showAddAdvance && (
                <form
                  onSubmit={handleAddAdvance}
                  className="mb-4 p-3 bg-gray-50 rounded-lg space-y-3"
                >
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Amount (₹) *
                      </label>
                      <input
                        type="number"
                        value={advanceForm.amount}
                        onChange={(e) =>
                          setAdvanceForm((p) => ({
                            ...p,
                            amount: e.target.value,
                          }))
                        }
                        required
                        min="1"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        placeholder="50000"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Date *
                      </label>
                      <input
                        type="date"
                        value={advanceForm.txn_date}
                        onChange={(e) =>
                          setAdvanceForm((p) => ({
                            ...p,
                            txn_date: e.target.value,
                          }))
                        }
                        required
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      From Account
                    </label>
                    <select
                      value={advanceForm.account_id}
                      onChange={(e) =>
                        setAdvanceForm((p) => ({
                          ...p,
                          account_id: e.target.value,
                        }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">— Select Account —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Description
                    </label>
                    <input
                      type="text"
                      value={advanceForm.description}
                      onChange={(e) =>
                        setAdvanceForm((p) => ({
                          ...p,
                          description: e.target.value,
                        }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                      placeholder="Advance to seller"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={addAdvanceMutation.isPending}
                    className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {addAdvanceMutation.isPending
                      ? "Adding…"
                      : "Add Advance Payment"}
                  </button>
                </form>
              )}

              {(() => {
                const advanceTxns = transactions.filter(
                  (t) => t.txn_type === "advance_to_seller",
                );
                const totalAdvance = advanceTxns.reduce(
                  (s, t) => s + parseFloat(t.amount || 0),
                  0,
                );
                return advanceTxns.length > 0 ? (
                  <>
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 text-gray-500 font-medium">
                            Date
                          </th>
                          <th className="text-right py-2 text-gray-500 font-medium">
                            Amount
                          </th>
                          <th className="text-left py-2 text-gray-500 font-medium pl-3">
                            Account
                          </th>
                          {!isSettled && <th className="py-2 w-20"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {advanceTxns.map((t) => {
                          const acct = accounts.find(
                            (a) => a.id === t.account_id,
                          );
                          const isEditing = editingTxnId === t.id;
                          if (isEditing) {
                            return (
                              <tr
                                key={t.id}
                                className="border-b border-blue-100 bg-blue-50"
                              >
                                <td className="py-2 pr-2">
                                  <input
                                    type="date"
                                    value={editTxnForm.txn_date}
                                    onChange={(e) =>
                                      setEditTxnForm((p) => ({
                                        ...p,
                                        txn_date: e.target.value,
                                      }))
                                    }
                                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500"
                                  />
                                </td>
                                <td className="py-2 pr-2">
                                  <input
                                    type="number"
                                    value={editTxnForm.amount}
                                    onChange={(e) =>
                                      setEditTxnForm((p) => ({
                                        ...p,
                                        amount: e.target.value,
                                      }))
                                    }
                                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right focus:ring-1 focus:ring-blue-500"
                                    min="1"
                                  />
                                </td>
                                <td className="py-2 pl-3 pr-2">
                                  <select
                                    value={editTxnForm.account_id}
                                    onChange={(e) =>
                                      setEditTxnForm((p) => ({
                                        ...p,
                                        account_id: e.target.value,
                                      }))
                                    }
                                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500"
                                  >
                                    <option value="">— None —</option>
                                    {accounts.map((a) => (
                                      <option key={a.id} value={a.id}>
                                        {a.name}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-2 pl-2">
                                  <div className="flex gap-1 justify-end">
                                    <button
                                      onClick={() => handleSaveEditTxn(t.id)}
                                      disabled={updateAdvanceMutation.isPending}
                                      className="px-2 py-1 text-[10px] bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={() => setEditingTxnId(null)}
                                      className="px-2 py-1 text-[10px] bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          }
                          return (
                            <tr key={t.id} className="border-b border-gray-100">
                              <td className="py-2 text-gray-700">
                                {formatDate(t.txn_date)}
                              </td>
                              <td className="text-right py-2 font-medium text-gray-900">
                                {formatCurrency(t.amount)}
                              </td>
                              <td className="py-2 text-gray-600 pl-3">
                                {acct?.name || "—"}
                              </td>
                              {!isSettled && (
                                <td className="py-2 pl-2">
                                  <div className="flex gap-1 justify-end">
                                    <button
                                      onClick={() => handleStartEditTxn(t)}
                                      className="px-2 py-0.5 text-[10px] text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => {
                                        if (
                                          window.confirm(
                                            "Delete this advance payment?",
                                          )
                                        ) {
                                          deleteAdvanceMutation.mutate(t.id);
                                        }
                                      }}
                                      disabled={deleteAdvanceMutation.isPending}
                                      className="px-2 py-0.5 text-[10px] text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
                                    >
                                      Del
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                        <tr className="border-t border-gray-300 font-semibold">
                          <td className="py-2">Total</td>
                          <td className="text-right py-2 text-blue-700">
                            {formatCurrency(totalAdvance)}
                          </td>
                          <td></td>
                          {!isSettled && <td></td>}
                        </tr>
                      </tbody>
                    </table>
                  </>
                ) : (
                  <p className="text-sm text-gray-400 italic">
                    No advance payments recorded yet.
                  </p>
                );
              })()}
            </div>

            {/* Other Expenses Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-800">
                  Other Expenses
                </h2>
              </div>

              {allOtherExpenses.length > 0 ? (
                <>
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 text-gray-500 font-medium">Date</th>
                        <th className="text-left py-2 text-gray-500 font-medium pl-2">Description</th>
                        <th className="text-left py-2 text-gray-500 font-medium pl-2">Paid by</th>
                        <th className="text-right py-2 text-gray-500 font-medium">Amount</th>
                        {!isSettled && <th className="py-2 w-16"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {allOtherExpenses.map((t) => (
                        <tr key={`${t.source}-${t.id}`} className="border-b border-gray-100">
                          <td className="py-2 text-gray-700">{formatDate(t.txn_date)}</td>
                          <td className="py-2 text-gray-600 pl-2">{t.description || "—"}</td>
                          <td className="py-2 pl-2">
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${t.source === "partnership" ? "bg-purple-50 text-purple-700" : "bg-gray-100 text-gray-600"}`}>
                              {t.payer_name || "Self"}
                              {t.source === "partnership" && " (via partnership)"}
                            </span>
                          </td>
                          <td className="text-right py-2 font-medium text-orange-700">
                            {formatCurrency(t.amount)}
                          </td>
                          {!isSettled && (
                            <td className="py-2 pl-2">
                              {t.source !== "partnership" ? (
                                <button
                                  onClick={() => {
                                    if (window.confirm("Delete this expense?"))
                                      deleteAdvanceMutation.mutate(t.id);
                                  }}
                                  disabled={deleteAdvanceMutation.isPending}
                                  className="px-2 py-0.5 text-[10px] text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
                                >
                                  Del
                                </button>
                              ) : (
                                <span className="text-[10px] text-gray-400">via P</span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                      <tr className="border-t border-gray-300 font-semibold">
                        <td className="py-2" colSpan={3}>Total</td>
                        <td className="text-right py-2 text-orange-700">{formatCurrency(totalOtherExpenses)}</td>
                        {!isSettled && <td></td>}
                      </tr>
                    </tbody>
                  </table>
                  <p className="text-xs text-orange-600 mt-2">
                    ℹ️ Each person's expenses are returned to them at settlement, before profit sharing.
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-400 italic">No other expenses recorded yet.</p>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-5">
            {/* Settle button */}
            {!isSettled && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-800 mb-3">
                  Actions
                </h2>
                <button
                  onClick={() => {
                    setSettleForm((p) => ({
                      ...p,
                      other_expenses: totalOtherExpenses > 0 && p.other_expenses === "0"
                        ? String(totalOtherExpenses)
                        : p.other_expenses,
                    }));
                    setShowSettleModal(true);
                  }}
                  className="w-full py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 text-sm"
                >
                  🤝 Settle Deal
                </button>
              </div>
            )}

            {/* Property notes */}
            {property.notes && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-800 mb-2">
                  Notes
                </h2>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">
                  {property.notes}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Settle Modal */}
      {showSettleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Settle Deal</h2>
              <p className="text-sm text-gray-500">{property.title}</p>
            </div>
            <div className="p-5 space-y-4">
              {isSite ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Total Profit Received (₹)
                    </label>
                    <input
                      type="number"
                      value={settleForm.total_profit_received}
                      onChange={(e) =>
                        setSettleForm((p) => ({
                          ...p,
                          total_profit_received: e.target.value,
                        }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="Total profit from site deal"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Deal End Date
                    </label>
                    <input
                      type="date"
                      value={settleForm.site_deal_end_date}
                      onChange={(e) =>
                        setSettleForm((p) => ({
                          ...p,
                          site_deal_end_date: e.target.value,
                        }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  {/* Site preview */}
                  {settleForm.total_profit_received && (
                    <div className="bg-blue-50 rounded-lg p-4 text-sm space-y-1.5">
                      <div className="font-semibold text-blue-800 mb-2">
                        Settlement Preview
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">My Investment:</span>
                        <span className="font-medium">
                          {formatCurrency(property.my_investment)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">
                          Total Profit (project):
                        </span>
                        <span className="font-medium">
                          {formatCurrency(settleForm.total_profit_received)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">My Share %:</span>
                        <span className="font-medium">
                          {property.my_share_percentage}%
                        </span>
                      </div>
                      <hr className="border-blue-200" />
                      <div className="flex justify-between font-semibold text-blue-700">
                        <span>My Profit:</span>
                        <span>
                          {formatCurrency(
                            (parseFloat(settleForm.total_profit_received) *
                              parseFloat(property.my_share_percentage || 0)) /
                              100,
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Final Registry Date
                    </label>
                    <input
                      type="date"
                      value={settleForm.registry_date}
                      onChange={(e) =>
                        setSettleForm((p) => ({
                          ...p,
                          registry_date: e.target.value,
                        }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Buyer Rate per sqft (₹)
                    </label>
                    <input
                      type="number"
                      value={settleForm.buyer_rate_per_sqft}
                      onChange={(e) =>
                        setSettleForm((p) => ({
                          ...p,
                          buyer_rate_per_sqft: e.target.value,
                        }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="e.g. 800.000"
                      min="0"
                      step="0.001"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Other Expenses (₹)
                    </label>
                    <input
                      type="number"
                      value={settleForm.other_expenses}
                      onChange={(e) =>
                        setSettleForm((p) => ({
                          ...p,
                          other_expenses: e.target.value,
                        }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="0"
                      min="0"
                    />
                  </div>

                  {/* Live calculation preview */}
                  {liveBuyerTotal !== null && (
                    <div className="bg-gray-50 rounded-lg p-4 text-sm font-mono space-y-1.5 border border-gray-200">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Area:</span>
                        <span>{Number(area).toLocaleString()} sqft</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Buyer Rate:</span>
                        <span>
                          ₹
                          {Number(
                            settleForm.buyer_rate_per_sqft,
                          ).toLocaleString()}
                          /sqft
                        </span>
                      </div>
                      <hr className="border-gray-300 my-1" />
                      <div className="flex justify-between font-semibold">
                        <span>Total from Buyer:</span>
                        <span>{formatCurrency(liveBuyerTotal)}</span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>Total to Seller:</span>
                        <span>{formatCurrency(sellerTotal)}</span>
                      </div>
                      <hr className="border-gray-300 my-1" />
                      <div className="flex justify-between font-semibold">
                        <span>Gross Profit:</span>
                        <span>{formatCurrency(liveGross)}</span>
                      </div>
                      <div className="flex justify-between text-gray-500">
                        <span>Broker Commission:</span>
                        <span>- {formatCurrency(brokerComm)}</span>
                      </div>
                      <div className="flex justify-between text-gray-500">
                        <span>Other Expenses:</span>
                        <span>
                          - {formatCurrency(isNaN(liveOther) ? 0 : liveOther)}
                        </span>
                      </div>
                      <hr className="border-gray-300 my-1" />
                      <div className="flex justify-between font-bold text-green-700 text-base">
                        <span>Net Profit:</span>
                        <span>{formatCurrency(liveNet)}</span>
                      </div>
                      {members.length > 0 && liveNet !== null && (
                        <>
                          <div className="flex justify-between text-gray-500 mt-1">
                            <span>Total Advance Pool:</span>
                            <span>{formatCurrency(totalAdvancePool)}</span>
                          </div>
                          <hr className="border-gray-300 my-1" />
                          <div className="font-semibold text-gray-700 mt-1">
                            Partner Breakdown:
                          </div>
                          {members.map((m, i) => {
                            const sharePct = parseFloat(
                              m.member.share_percentage || 0,
                            );
                            const advance = parseFloat(
                              m.member.advance_contributed || 0,
                            );
                            const profit = (liveNet * sharePct) / 100;
                            // Per-member expense back: sum partnership expenses by member_id
                            // + property-level expenses (from form) for self
                            const partnerExpBack = partnershipExpenses
                              .filter((pe) => pe.member_id === m.member.id)
                              .reduce((s, pe) => s + pe.amount, 0);
                            const propExpBack = m.member.is_self ? (isNaN(liveOther) ? 0 : liveOther) - partnershipExpenses.filter((pe) => pe.is_self).reduce((s, pe) => s + pe.amount, 0) : 0;
                            const selfPartnerExpBack = m.member.is_self
                              ? partnershipExpenses.filter((pe) => pe.is_self).reduce((s, pe) => s + pe.amount, 0)
                              : 0;
                            const otherExpBack = partnerExpBack + Math.max(propExpBack, 0) + selfPartnerExpBack;
                            const total = advance + otherExpBack + profit;
                            const name = m.member.is_self
                              ? "Self (You)"
                              : m.contact?.name || "Unknown";
                            return (
                              <div key={i} className="text-xs text-gray-600">
                                • {name} ({sharePct}%) — Advance:{" "}
                                {formatCurrency(advance)}
                                {otherExpBack > 0 && <> · Exp. Back: {formatCurrency(otherExpBack)}</>}
                                {" · "}Profit:{" "}
                                {formatCurrency(profit)} ·{" "}
                                <strong>Total: {formatCurrency(total)}</strong>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="p-5 border-t border-gray-200 flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowSettleModal(false);
                  setSettleResult(null);
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSettle}
                disabled={settleMutation.isPending}
                className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {settleMutation.isPending
                  ? "Settling..."
                  : "Confirm Settlement"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
