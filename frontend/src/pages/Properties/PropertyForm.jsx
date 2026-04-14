import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";
import { PageHero, PageBody } from "../../components/ui";

const toNullableNumber = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
};

const toNullableString = (value) => (value?.trim() ? value.trim() : null);

function PlotDiagram({ north, south, east, west, area, roads }) {
  const hasAny = north || south || east || west;
  if (!hasAny) return null;

  const l = parseFloat(west) || 0;
  const r = parseFloat(east) || 0;
  const t = parseFloat(north) || 0;
  const b = parseFloat(south) || 0;

  let parsedRoads = [];
  try {
    if (roads)
      parsedRoads = typeof roads === "string" ? JSON.parse(roads) : roads;
  } catch {
    /* ignore */
  }

  const maxSide = Math.max(l, r, t, b, 1);
  const BASE_W = 200,
    BASE_H = 140,
    PAD = 55;
  const ROAD_W = 22;

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

  const hasRoadN = parsedRoads.some(
    (rd) => (rd.direction || "").toLowerCase() === "north",
  );
  const hasRoadS = parsedRoads.some(
    (rd) => (rd.direction || "").toLowerCase() === "south",
  );
  const hasRoadE = parsedRoads.some(
    (rd) => (rd.direction || "").toLowerCase() === "east",
  );
  const hasRoadW = parsedRoads.some(
    (rd) => (rd.direction || "").toLowerCase() === "west",
  );

  const roadRects = parsedRoads.map((rd, i) => {
    const dir = (rd.direction || "").toLowerCase();
    const w = parseFloat(rd.width_ft) || 20;
    const label = `Road ${w}ft`;
    if (dir === "north") {
      return (
        <g key={i}>
          <rect
            x={cx - topW / 2 - 5}
            y={Math.min(y1L, y1R) - ROAD_W - 2}
            width={topW + 10}
            height={ROAD_W}
            rx={3}
            fill="#e2e8f0"
            stroke="#94a3b8"
            strokeWidth={1}
          />
          <text
            x={cx}
            y={Math.min(y1L, y1R) - ROAD_W / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={9}
            fill="#475569"
          >
            {label}
          </text>
        </g>
      );
    }
    if (dir === "south") {
      return (
        <g key={i}>
          <rect
            x={cx - botW / 2 - 5}
            y={y4 + 2}
            width={botW + 10}
            height={ROAD_W}
            rx={3}
            fill="#e2e8f0"
            stroke="#94a3b8"
            strokeWidth={1}
          />
          <text
            x={cx}
            y={y4 + ROAD_W / 2 + 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={9}
            fill="#475569"
          >
            {label}
          </text>
        </g>
      );
    }
    if (dir === "east") {
      return (
        <g key={i}>
          <rect
            x={Math.max(x3, cx + topW / 2) + 2}
            y={Math.min(y1R, y1L)}
            width={ROAD_W}
            height={plotH}
            rx={3}
            fill="#e2e8f0"
            stroke="#94a3b8"
            strokeWidth={1}
          />
          <text
            x={Math.max(x3, cx + topW / 2) + ROAD_W / 2 + 2}
            y={midY}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={9}
            fill="#475569"
            transform={`rotate(90, ${Math.max(x3, cx + topW / 2) + ROAD_W / 2 + 2}, ${midY})`}
          >
            {label}
          </text>
        </g>
      );
    }
    if (dir === "west") {
      return (
        <g key={i}>
          <rect
            x={Math.min(x4, cx - topW / 2) - ROAD_W - 2}
            y={Math.min(y1L, y1R)}
            width={ROAD_W}
            height={plotH}
            rx={3}
            fill="#e2e8f0"
            stroke="#94a3b8"
            strokeWidth={1}
          />
          <text
            x={Math.min(x4, cx - topW / 2) - ROAD_W / 2 - 2}
            y={midY}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={9}
            fill="#475569"
            transform={`rotate(-90, ${Math.min(x4, cx - topW / 2) - ROAD_W / 2 - 2}, ${midY})`}
          >
            {label}
          </text>
        </g>
      );
    }
    return null;
  });

  return (
    <div className="mt-3 flex justify-center">
      <svg
        width={svgW}
        height={svgH}
        className="text-blue-700"
        style={{ overflow: "visible" }}
      >
        {roadRects}
        <polygon
          points={points}
          fill="#eff6ff"
          stroke="#3b82f6"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <text
          x={cx}
          y={Math.min(y1L, y1R) - (hasRoadN ? ROAD_W + 10 : 8)}
          textAnchor="middle"
          fontSize={12}
          fill="#1d4ed8"
        >
          {north ? `N: ${north} ft` : "—"}
        </text>
        <text
          x={cx}
          y={y4 + (hasRoadS ? ROAD_W + 10 : 18)}
          textAnchor="middle"
          fontSize={12}
          fill="#1d4ed8"
        >
          {south ? `S: ${south} ft` : "—"}
        </text>
        <text
          x={Math.min(x4, cx - topW / 2) - (hasRoadW ? ROAD_W + 8 : 8)}
          y={(y1L + y4) / 2}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize={12}
          fill="#1d4ed8"
        >
          {west ? `W: ${west} ft` : "—"}
        </text>
        <text
          x={Math.max(x3, cx + topW / 2) + (hasRoadE ? ROAD_W + 8 : 8)}
          y={(y1R + y4) / 2}
          textAnchor="start"
          dominantBaseline="middle"
          fontSize={12}
          fill="#1d4ed8"
        >
          {east ? `E: ${east} ft` : "—"}
        </text>
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
    </div>
  );
}

const EMPTY_FORM_PLOT = {
  title: "",
  location: "",
  property_type: "plot",
  deal_type: "middleman",
  total_area_sqft: "",
  side_north_ft: "",
  side_south_ft: "",
  side_east_ft: "",
  side_west_ft: "",
  road_count: "0",
  roads_json: "[]",
  seller_contact_id: "",
  seller_rate_per_sqft: "",
  total_seller_value: "",
  negotiating_date: new Date().toISOString().split("T")[0],
  expected_registry_date: "",
  notes: "",
  status: "negotiating",
  actual_registry_date: "",
};

const EMPTY_FORM_SITE = {
  title: "",
  location: "",
  property_type: "site",
  deal_type: "middleman",
  total_area_sqft: "",
  total_seller_value: "",
  seller_contact_id: "",
  seller_rate_per_sqft: "",
  negotiating_date: new Date().toISOString().split("T")[0],
  expected_registry_date: "",
  site_deal_start_date: "",
  notes: "",
  status: "negotiating",
};

function normalizeForForm(property) {
  const base = {
    title: property.title || "",
    location: property.location || "",
    property_type: property.property_type || "plot",
    deal_type: property.deal_type || "middleman",
    total_area_sqft: property.total_area_sqft
      ? String(property.total_area_sqft)
      : "",
    side_north_ft: property.side_north_ft ? String(property.side_north_ft) : (property.side_top_ft ? String(property.side_top_ft) : ""),
    side_south_ft: property.side_south_ft ? String(property.side_south_ft) : (property.side_bottom_ft ? String(property.side_bottom_ft) : ""),
    side_east_ft: property.side_east_ft ? String(property.side_east_ft) : (property.side_right_ft ? String(property.side_right_ft) : ""),
    side_west_ft: property.side_west_ft ? String(property.side_west_ft) : (property.side_left_ft ? String(property.side_left_ft) : ""),
    road_count: property.road_count != null ? String(property.road_count) : "0",
    roads_json: property.roads_json || "[]",
    seller_contact_id: property.seller_contact_id
      ? String(property.seller_contact_id)
      : "",
    seller_rate_per_sqft: property.seller_rate_per_sqft
      ? String(property.seller_rate_per_sqft)
      : "",
    total_seller_value: property.total_seller_value
      ? String(property.total_seller_value)
      : "",
    negotiating_date: property.negotiating_date || "",
    expected_registry_date: property.expected_registry_date || "",
    actual_registry_date: property.actual_registry_date || "",
    notes: property.notes || "",
    status: property.status || "negotiating",
    // site fields
    site_deal_start_date: property.site_deal_start_date || "",
  };
  return base;
}

function buildPayload(formData, isEditMode) {
  const isSite = formData.property_type === "site";

  const payload = {
    title: formData.title.trim(),
    location: toNullableString(formData.location),
    property_type: formData.property_type,
    notes: toNullableString(formData.notes),
  };
  // Only send deal_type for new properties (always middleman); skip on edits to avoid overwriting
  if (!isEditMode) {
    payload.deal_type = formData.deal_type;
  }

  if (isSite) {
    payload.total_area_sqft = toNullableNumber(formData.total_area_sqft);
    payload.total_seller_value = toNullableNumber(formData.total_seller_value);
    payload.seller_contact_id = toNullableNumber(formData.seller_contact_id);
    payload.seller_rate_per_sqft = toNullableNumber(formData.seller_rate_per_sqft);
    payload.negotiating_date = toNullableString(formData.negotiating_date);
    payload.expected_registry_date = toNullableString(formData.expected_registry_date);
    payload.site_deal_start_date = toNullableString(
      formData.site_deal_start_date,
    );
  } else {
    payload.total_area_sqft = toNullableNumber(formData.total_area_sqft);
    payload.side_north_ft = toNullableNumber(formData.side_north_ft);
    payload.side_south_ft = toNullableNumber(formData.side_south_ft);
    payload.side_east_ft = toNullableNumber(formData.side_east_ft);
    payload.side_west_ft = toNullableNumber(formData.side_west_ft);
    payload.road_count = toNullableNumber(formData.road_count);
    payload.roads_json = formData.roads_json || null;
    payload.seller_contact_id = toNullableNumber(formData.seller_contact_id);
    payload.seller_rate_per_sqft = toNullableNumber(
      formData.seller_rate_per_sqft,
    );
    payload.total_seller_value = toNullableNumber(formData.total_seller_value);
    payload.deal_locked_date = toNullableString(formData.negotiating_date);
    payload.negotiating_date = toNullableString(formData.negotiating_date);
    payload.expected_registry_date = toNullableString(
      formData.expected_registry_date,
    );
    if (isEditMode) {
      payload.actual_registry_date = toNullableString(
        formData.actual_registry_date,
      );
    }
  }

  if (isEditMode) {
    // Don't send status — it's auto-derived from partnership state
  }

  return payload;
}

export default function PropertyForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(id);

  const [formData, setFormData] = useState({ ...EMPTY_FORM_PLOT });
  const [errors, setErrors] = useState({});

  // Load contacts
  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts", "for-form"],
    queryFn: async () => {
      const res = await api.get("/api/contacts", { params: { limit: 500 } });
      return res.data;
    },
  });

  // Quick seller contact creation
  const [showSellerCreate, setShowSellerCreate] = useState(false);
  const [sellerForm, setSellerForm] = useState({ name: "", phone: "", city: "" });
  const createSellerMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await api.post("/api/contacts", payload);
      return res.data;
    },
    onSuccess: (newContact) => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      set("seller_contact_id", String(newContact.id));
      setShowSellerCreate(false);
      setSellerForm({ name: "", phone: "", city: "" });
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to create contact"),
  });
  const handleCreateSeller = () => {
    if (!sellerForm.name.trim()) return;
    createSellerMutation.mutate({
      name: sellerForm.name.trim(),
      phone: sellerForm.phone.trim() || null,
      city: sellerForm.city.trim() || null,
      contact_type: "individual",
      relationship_type: "seller",
    });
  };

  // Load existing deal for edit mode
  useQuery({
    queryKey: ["property", id],
    enabled: isEditMode,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await api.get(`/api/properties/${id}`);
      setFormData(normalizeForForm(res.data.property));
      return res.data;
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (payload) => {
      if (isEditMode) {
        const res = await api.put(`/api/properties/${id}`, payload);
        return res.data;
      }
      const res = await api.post("/api/properties", payload);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      if (isEditMode) {
        queryClient.invalidateQueries({ queryKey: ["property", id] });
      }
      navigate(`/properties/${data.id}`);
    },
    onError: (err) => {
      const detail = err?.response?.data?.detail;
      if (Array.isArray(detail)) {
        const fieldErrors = {};
        detail.forEach((e) => {
          const field = e.loc?.[e.loc.length - 1];
          if (field) fieldErrors[field] = e.msg;
        });
        setErrors(fieldErrors);
      } else {
        alert(detail || "Failed to save property deal");
      }
    },
  });

  const set = (field, value) => {
    setFormData((prev) => {
      const updated = { ...prev, [field]: value };
      // Auto-calc total_seller_value for plot and site
      if (
        (field === "seller_rate_per_sqft" || field === "total_area_sqft")
      ) {
        const rate = parseFloat(updated.seller_rate_per_sqft);
        const area = parseFloat(updated.total_area_sqft);
        if (!isNaN(rate) && !isNaN(area) && rate > 0 && area > 0) {
          updated.total_seller_value = String(rate * area);
        }
      }
      return updated;
    });
  };

  const handlePropertyTypeChange = (newType) => {
    if (newType === "site") {
      setFormData((prev) => ({
        ...EMPTY_FORM_SITE,
        title: prev.title,
        location: prev.location,
        notes: prev.notes,
        property_type: "site",
      }));
    } else {
      setFormData((prev) => ({
        ...EMPTY_FORM_PLOT,
        title: prev.title,
        location: prev.location,
        notes: prev.notes,
        property_type: newType,
      }));
    }
  };

  const validate = () => {
    const errs = {};
    if (!formData.title.trim()) errs.title = "Title is required";
    if (formData.property_type === "site") {
      if (!formData.site_deal_start_date)
        errs.site_deal_start_date = "Deal start date is required";
    } else {
      if (!formData.seller_rate_per_sqft)
        errs.seller_rate_per_sqft = "Seller rate is required";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;
    submitMutation.mutate(buildPayload(formData, isEditMode));
  };

  const isSite = formData.property_type === "site";

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        compact
        title={isEditMode ? "Edit Property Deal" : "New Property Deal"}
        subtitle={
          isSite
            ? "Site — investment tracking only"
            : "Plot — middleman deal with partners"
        }
        backTo="/properties"
      />
      <PageBody className="max-w-4xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* ── Section 1: Basic Info ── */}
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 sm:p-6">
            <h2 className="text-base font-bold text-slate-800 mb-4">
              Basic Info
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Title */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => set("title", e.target.value)}
                  className={`w-full border rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all ${errors.title ? "border-rose-400" : "border-slate-200"}`}
                  placeholder="e.g. Shivaji Nagar Plot Deal"
                />
                {errors.title && (
                  <p className="text-rose-600 text-xs mt-1">{errors.title}</p>
                )}
              </div>

              {/* Location */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Location
                </label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => set("location", e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  placeholder="e.g. Shivaji Nagar, Nagpur"
                />
              </div>

              {/* Property Type */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Property Type
                </label>
                <select
                  value={formData.property_type}
                  onChange={(e) => handlePropertyTypeChange(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all disabled:bg-slate-50 disabled:text-slate-400"
                  disabled={isEditMode}
                >
                  <option value="plot">Plot</option>
                  <option value="site">Site</option>
                </select>
                {isEditMode && (
                  <p className="text-xs text-slate-400 mt-1">
                    Property type cannot be changed after creation.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── SITE SECTIONS ── */}
          {isSite && (
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 sm:p-6">
              <h2 className="text-base font-bold text-slate-800 mb-4">
                Site Details
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Seller Contact */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Seller Contact
                  </label>
                  <div className="flex gap-2 items-start">
                    <select
                      value={formData.seller_contact_id}
                      onChange={(e) => set("seller_contact_id", e.target.value)}
                      className="flex-1 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    >
                      <option value="">— Select seller —</option>
                      {contacts.filter(c => c.relationship_type === "seller" || c.relationship_type === "borrower" || !c.relationship_type).map(c => (
                        <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ""}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowSellerCreate(!showSellerCreate)}
                      className="shrink-0 p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-indigo-600 transition-all"
                      title={showSellerCreate ? "Cancel" : "New Seller"}
                    >
                      {showSellerCreate ? <X size={16} /> : <Plus size={16} />}
                    </button>
                  </div>
                  {showSellerCreate && (
                    <div className="mt-2 p-3 bg-slate-50 rounded-xl border border-slate-200/60 space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <input type="text" placeholder="Name *" value={sellerForm.name} onChange={e => setSellerForm(p => ({...p, name: e.target.value}))} className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
                        <input type="text" placeholder="Phone" value={sellerForm.phone} onChange={e => setSellerForm(p => ({...p, phone: e.target.value}))} className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
                        <input type="text" placeholder="City" value={sellerForm.city} onChange={e => setSellerForm(p => ({...p, city: e.target.value}))} className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
                      </div>
                      <button type="button" onClick={handleCreateSeller} disabled={!sellerForm.name.trim() || createSellerMutation.isPending} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50">
                        {createSellerMutation.isPending ? "Creating..." : "Create & Select"}
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Total Area (sqft)
                  </label>
                  <input
                    type="number"
                    value={formData.total_area_sqft}
                    onChange={(e) => set("total_area_sqft", e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    placeholder="e.g. 50000"
                    min="0"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Seller Rate (₹/sqft)
                  </label>
                  <input
                    type="number"
                    value={formData.seller_rate_per_sqft}
                    onChange={(e) => set("seller_rate_per_sqft", e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    placeholder="e.g. 150"
                    min="0"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Total Value to Seller (₹)
                  </label>
                  <input
                    type="number"
                    value={formData.total_seller_value}
                    onChange={(e) => set("total_seller_value", e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    placeholder="Total amount paid to seller"
                    min="0"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Deal Start Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={formData.site_deal_start_date}
                    onChange={(e) =>
                      set("site_deal_start_date", e.target.value)
                    }
                    className={`w-full border rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all ${errors.site_deal_start_date ? "border-rose-400" : "border-slate-200"}`}
                  />
                  {errors.site_deal_start_date && (
                    <p className="text-rose-600 text-xs mt-1">
                      {errors.site_deal_start_date}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Negotiating Date
                  </label>
                  <input
                    type="date"
                    value={formData.negotiating_date}
                    onChange={(e) => set("negotiating_date", e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Expected Registry Date
                  </label>
                  <input
                    type="date"
                    value={formData.expected_registry_date}
                    onChange={(e) => set("expected_registry_date", e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── PLOT SECTIONS ── */}
          {!isSite && (
            <>
              {/* Section 2: Plot Dimensions */}
              <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 sm:p-6">
                <h2 className="text-base font-bold text-slate-800 mb-1">
                  Plot Dimensions
                </h2>
                <p className="text-xs text-slate-400 mb-4">
                  Optional — fill in to see a visual diagram.
                </p>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <div className="sm:col-span-1">
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Total Area (sqft)
                    </label>
                    <input
                      type="number"
                      value={formData.total_area_sqft}
                      onChange={(e) => set("total_area_sqft", e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                      placeholder="e.g. 1200"
                      min="0"
                      step="0.001"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      West Side (ft)
                    </label>
                    <input
                      type="number"
                      value={formData.side_west_ft}
                      onChange={(e) => set("side_west_ft", e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                      placeholder="West"
                      min="0"
                      step="0.001"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      East Side (ft)
                    </label>
                    <input
                      type="number"
                      value={formData.side_east_ft}
                      onChange={(e) => set("side_east_ft", e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                      placeholder="East"
                      min="0"
                      step="0.001"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      North Side (ft)
                    </label>
                    <input
                      type="number"
                      value={formData.side_north_ft}
                      onChange={(e) => set("side_north_ft", e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                      placeholder="North"
                      min="0"
                      step="0.001"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      South Side (ft)
                    </label>
                    <input
                      type="number"
                      value={formData.side_south_ft}
                      onChange={(e) => set("side_south_ft", e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                      placeholder="South"
                      min="0"
                      step="0.001"
                    />
                  </div>
                </div>

                {/* Road inputs */}
                <div className="mt-4">
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Number of Roads
                  </label>
                  <select
                    value={formData.road_count}
                    onChange={(e) => {
                      const count = parseInt(e.target.value) || 0;
                      set("road_count", String(count));
                      try {
                        let existing = JSON.parse(formData.roads_json || "[]");
                        while (existing.length < count)
                          existing.push({ direction: "north", width_ft: "20" });
                        existing = existing.slice(0, count);
                        set("roads_json", JSON.stringify(existing));
                      } catch {
                        set(
                          "roads_json",
                          JSON.stringify(
                            Array.from({ length: count }, () => ({
                              direction: "north",
                              width_ft: "20",
                            })),
                          ),
                        );
                      }
                    }}
                    className="w-32 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  >
                    {[0, 1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                {(() => {
                  let roads = [];
                  try {
                    roads = JSON.parse(formData.roads_json || "[]");
                  } catch {
                    /* ignore */
                  }
                  if (roads.length === 0) return null;
                  return (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {roads.map((rd, idx) => (
                        <div
                          key={idx}
                          className="flex gap-2 items-center bg-slate-50 rounded-xl p-2 border border-slate-200"
                        >
                          <span className="text-xs font-medium text-slate-500 w-14">
                            Road {idx + 1}
                          </span>
                          <select
                            value={rd.direction}
                            onChange={(e) => {
                              const copy = [...roads];
                              copy[idx] = {
                                ...copy[idx],
                                direction: e.target.value,
                              };
                              set("roads_json", JSON.stringify(copy));
                            }}
                            className="border border-slate-200 rounded-xl px-2 py-1 text-sm"
                          >
                            <option value="north">North</option>
                            <option value="south">South</option>
                            <option value="east">East</option>
                            <option value="west">West</option>
                          </select>
                          <input
                            type="number"
                            value={rd.width_ft}
                            onChange={(e) => {
                              const copy = [...roads];
                              copy[idx] = {
                                ...copy[idx],
                                width_ft: e.target.value,
                              };
                              set("roads_json", JSON.stringify(copy));
                            }}
                            className="w-20 border border-slate-200 rounded-xl px-2 py-1 text-sm"
                            placeholder="Width"
                            min="0"
                            step="0.001"
                          />
                          <span className="text-xs text-slate-400">ft</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                <PlotDiagram
                  north={formData.side_north_ft}
                  south={formData.side_south_ft}
                  east={formData.side_east_ft}
                  west={formData.side_west_ft}
                  area={formData.total_area_sqft}
                  roads={formData.roads_json}
                />
              </div>

              {/* Section 3: Seller Details */}
              <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 sm:p-6">
                <h2 className="text-base font-bold text-slate-800 mb-4">
                  Seller Details
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Seller Contact
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={formData.seller_contact_id}
                        onChange={(e) => set("seller_contact_id", e.target.value)}
                        className="flex-1 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                      >
                        <option value="">— Select Seller —</option>
                        {contacts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {c.phone ? ` (${c.phone})` : ""}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setShowSellerCreate(!showSellerCreate)}
                        className="px-3 py-2.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-sm hover:bg-emerald-100 flex items-center gap-1 whitespace-nowrap"
                      >
                        {showSellerCreate ? <X size={14} /> : <Plus size={14} />}
                        {showSellerCreate ? "Cancel" : "New"}
                      </button>
                    </div>
                    {showSellerCreate && (
                      <div className="mt-2 p-3 bg-slate-50 rounded-xl border border-slate-200/60 space-y-2">
                        <div className="grid grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={sellerForm.name}
                            onChange={(e) => setSellerForm(p => ({ ...p, name: e.target.value }))}
                            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                            placeholder="Name *"
                          />
                          <input
                            type="text"
                            value={sellerForm.phone}
                            onChange={(e) => setSellerForm(p => ({ ...p, phone: e.target.value }))}
                            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                            placeholder="Phone"
                          />
                          <input
                            type="text"
                            value={sellerForm.city}
                            onChange={(e) => setSellerForm(p => ({ ...p, city: e.target.value }))}
                            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                            placeholder="City"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleCreateSeller}
                          disabled={!sellerForm.name.trim() || createSellerMutation.isPending}
                          className="px-4 py-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-lg text-sm font-medium hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-50"
                        >
                          {createSellerMutation.isPending ? "Creating..." : "Create & Select"}
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Seller Rate / sqft (₹){" "}
                      <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      value={formData.seller_rate_per_sqft}
                      onChange={(e) =>
                        set("seller_rate_per_sqft", e.target.value)
                      }
                      className={`w-full border rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all ${errors.seller_rate_per_sqft ? "border-rose-400" : "border-slate-200"}`}
                      placeholder="e.g. 500.000"
                      min="0"
                      step="0.001"
                    />
                    {errors.seller_rate_per_sqft && (
                      <p className="text-rose-600 text-xs mt-1">
                        {errors.seller_rate_per_sqft}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Total Seller Value (₹)
                      <span className="ml-2 text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
                        auto
                      </span>
                    </label>
                    <input
                      type="number"
                      value={formData.total_seller_value}
                      onChange={(e) =>
                        set("total_seller_value", e.target.value)
                      }
                      className="w-full border border-indigo-200 bg-indigo-50 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                      placeholder="Rate × Area"
                      min="0"
                    />
                    {formData.total_seller_value && (
                      <p className="text-xs text-indigo-600 mt-1">
                        ={" "}
                        {formatCurrency(
                          parseFloat(formData.total_seller_value),
                        )}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Negotiating Date
                    </label>
                    <input
                      type="date"
                      value={formData.negotiating_date}
                      onChange={(e) => set("negotiating_date", e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Expected Registry Date
                    </label>
                    <input
                      type="date"
                      value={formData.expected_registry_date}
                      onChange={(e) =>
                        set("expected_registry_date", e.target.value)
                      }
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    />
                  </div>

                  {isEditMode && (
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        Actual Registry Date
                      </label>
                      <input
                        type="date"
                        value={formData.actual_registry_date}
                        onChange={(e) =>
                          set("actual_registry_date", e.target.value)
                        }
                        className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                      />
                    </div>
                  )}
                </div>
              </div>

            </>
          )}

          {/* Notes */}
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 sm:p-6">
            <h2 className="text-base font-bold text-slate-800 mb-4">Notes</h2>
            {isEditMode && (
              <div className="mb-4">
                <p className="text-xs text-slate-400">Status: <span className="font-medium text-slate-700">{formData.status?.replace(/_/g, ' ')}</span></p>
                <p className="text-xs text-slate-400 mt-0.5">Status is auto-managed by the system based on partnership state.</p>
              </div>
            )}
            <textarea
              value={formData.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
              placeholder="Any additional notes..."
            />
          </div>

          {/* Submit */}
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200 transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitMutation.isPending}
              className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl text-sm font-medium hover:from-indigo-600 hover:to-indigo-700 disabled:opacity-50 shadow-sm shadow-indigo-500/20 active:scale-[0.98] transition-all"
            >
              {submitMutation.isPending
                ? "Saving..."
                : isEditMode
                  ? "Save Changes"
                  : "Create Deal"}
            </button>
          </div>
        </form>
      </PageBody>
    </div>
  );
}
