import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

const toNullableNumber = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
};

const toNullableString = (value) =>
  value?.trim() ? value.trim() : null;

function PlotDiagram({ left, right, top, bottom, area }) {
  const hasAny = left || right || top || bottom;
  if (!hasAny) return null;

  const W = 220;
  const H = 140;
  const PAD = 30;

  return (
    <div className="mt-3 flex justify-center">
      <svg width={W + PAD * 2} height={H + PAD * 2} className="text-blue-700">
        {/* Rectangle */}
        <rect x={PAD} y={PAD} width={W} height={H} fill="#eff6ff" stroke="#3b82f6" strokeWidth={2} />

        {/* Top label */}
        <text x={PAD + W / 2} y={PAD - 8} textAnchor="middle" fontSize={12} fill="#1d4ed8">
          {top ? `${top} ft` : "—"}
        </text>
        {/* Bottom label */}
        <text x={PAD + W / 2} y={PAD + H + 18} textAnchor="middle" fontSize={12} fill="#1d4ed8">
          {bottom ? `${bottom} ft` : "—"}
        </text>
        {/* Left label */}
        <text x={PAD - 6} y={PAD + H / 2} textAnchor="end" dominantBaseline="middle" fontSize={12} fill="#1d4ed8">
          {left ? `${left} ft` : "—"}
        </text>
        {/* Right label */}
        <text x={PAD + W + 6} y={PAD + H / 2} textAnchor="start" dominantBaseline="middle" fontSize={12} fill="#1d4ed8">
          {right ? `${right} ft` : "—"}
        </text>
        {/* Area in center */}
        {area && (
          <text x={PAD + W / 2} y={PAD + H / 2} textAnchor="middle" dominantBaseline="middle" fontSize={13} fill="#1e40af" fontWeight="600">
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
  side_left_ft: "",
  side_right_ft: "",
  side_top_ft: "",
  side_bottom_ft: "",
  seller_contact_id: "",
  seller_rate_per_sqft: "",
  total_seller_value: "",
  advance_paid: "0",
  advance_date: "",
  deal_locked_date: "",
  expected_registry_date: "",
  broker_name: "",
  broker_commission: "0",
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
  my_investment: "",
  my_share_percentage: "",
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
    total_area_sqft: property.total_area_sqft ? String(property.total_area_sqft) : "",
    side_left_ft: property.side_left_ft ? String(property.side_left_ft) : "",
    side_right_ft: property.side_right_ft ? String(property.side_right_ft) : "",
    side_top_ft: property.side_top_ft ? String(property.side_top_ft) : "",
    side_bottom_ft: property.side_bottom_ft ? String(property.side_bottom_ft) : "",
    seller_contact_id: property.seller_contact_id ? String(property.seller_contact_id) : "",
    seller_rate_per_sqft: property.seller_rate_per_sqft ? String(property.seller_rate_per_sqft) : "",
    total_seller_value: property.total_seller_value ? String(property.total_seller_value) : "",
    advance_paid: property.advance_paid ? String(property.advance_paid) : "0",
    advance_date: property.advance_date || "",
    deal_locked_date: property.deal_locked_date || "",
    expected_registry_date: property.expected_registry_date || "",
    actual_registry_date: property.actual_registry_date || "",
    broker_name: property.broker_name || "",
    broker_commission: property.broker_commission ? String(property.broker_commission) : "0",
    notes: property.notes || "",
    status: property.status || "negotiating",
    // site fields
    my_investment: property.my_investment ? String(property.my_investment) : "",
    my_share_percentage: property.my_share_percentage ? String(property.my_share_percentage) : "",
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
    deal_type: formData.deal_type,
    notes: toNullableString(formData.notes),
  };

  if (isSite) {
    payload.total_area_sqft = toNullableNumber(formData.total_area_sqft);
    payload.total_seller_value = toNullableNumber(formData.total_seller_value);
    payload.my_investment = toNullableNumber(formData.my_investment);
    payload.my_share_percentage = toNullableNumber(formData.my_share_percentage);
    payload.site_deal_start_date = toNullableString(formData.site_deal_start_date);
  } else {
    payload.total_area_sqft = toNullableNumber(formData.total_area_sqft);
    payload.side_left_ft = toNullableNumber(formData.side_left_ft);
    payload.side_right_ft = toNullableNumber(formData.side_right_ft);
    payload.side_top_ft = toNullableNumber(formData.side_top_ft);
    payload.side_bottom_ft = toNullableNumber(formData.side_bottom_ft);
    payload.seller_contact_id = toNullableNumber(formData.seller_contact_id);
    payload.seller_rate_per_sqft = toNullableNumber(formData.seller_rate_per_sqft);
    payload.total_seller_value = toNullableNumber(formData.total_seller_value);
    payload.advance_paid = toNullableNumber(formData.advance_paid) ?? 0;
    payload.advance_date = toNullableString(formData.advance_date);
    payload.deal_locked_date = toNullableString(formData.deal_locked_date);
    payload.expected_registry_date = toNullableString(formData.expected_registry_date);
    payload.broker_name = toNullableString(formData.broker_name);
    payload.broker_commission = toNullableNumber(formData.broker_commission) ?? 0;
    if (isEditMode) {
      payload.actual_registry_date = toNullableString(formData.actual_registry_date);
    }
  }

  if (isEditMode) {
    payload.status = formData.status;
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
      // Auto-calc total_seller_value for plot
      if (
        updated.property_type === "plot" &&
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
      if (!formData.my_investment) errs.my_investment = "My investment is required";
      if (!formData.my_share_percentage) errs.my_share_percentage = "Share % is required";
      if (!formData.site_deal_start_date) errs.site_deal_start_date = "Deal start date is required";
    } else {
      if (!formData.seller_rate_per_sqft) errs.seller_rate_per_sqft = "Seller rate is required";
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
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-200"
          >
            ←
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {isEditMode ? "Edit Property Deal" : "New Property Deal"}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {isSite ? "Site — investment tracking only" : "Plot — middleman deal with partners"}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* ── Section 1: Basic Info ── */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">Basic Info</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Title */}
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => set("title", e.target.value)}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.title ? "border-red-400" : "border-gray-300"}`}
                  placeholder="e.g. Shivaji Nagar Plot Deal"
                />
                {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title}</p>}
              </div>

              {/* Location */}
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => set("location", e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Shivaji Nagar, Nagpur"
                />
              </div>

              {/* Deal Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Deal Type</label>
                <select
                  value={formData.deal_type}
                  onChange={(e) => set("deal_type", e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="middleman">Middleman</option>
                  <option value="purchase_and_hold">Purchase &amp; Hold</option>
                </select>
              </div>

              {/* Property Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Property Type</label>
                <select
                  value={formData.property_type}
                  onChange={(e) => handlePropertyTypeChange(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isEditMode}
                >
                  <option value="plot">Plot</option>
                  <option value="site">Site</option>
                </select>
                {isEditMode && (
                  <p className="text-xs text-gray-400 mt-1">Property type cannot be changed after creation.</p>
                )}
              </div>
            </div>
          </div>

          {/* ── SITE SECTIONS ── */}
          {isSite && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-base font-semibold text-gray-800 mb-4">Site Details</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Total Area (sqft)</label>
                  <input
                    type="number"
                    value={formData.total_area_sqft}
                    onChange={(e) => set("total_area_sqft", e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. 50000"
                    min="0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Total Value to Seller (₹)</label>
                  <input
                    type="number"
                    value={formData.total_seller_value}
                    onChange={(e) => set("total_seller_value", e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Total amount paid to seller"
                    min="0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    My Investment Amount (₹) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={formData.my_investment}
                    onChange={(e) => set("my_investment", e.target.value)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.my_investment ? "border-red-400" : "border-gray-300"}`}
                    placeholder="How much I personally invested"
                    min="0"
                  />
                  {errors.my_investment && <p className="text-red-500 text-xs mt-1">{errors.my_investment}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    My Share % <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={formData.my_share_percentage}
                    onChange={(e) => set("my_share_percentage", e.target.value)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.my_share_percentage ? "border-red-400" : "border-gray-300"}`}
                    placeholder="e.g. 10"
                    min="0"
                    max="100"
                    step="0.001"
                  />
                  {errors.my_share_percentage && <p className="text-red-500 text-xs mt-1">{errors.my_share_percentage}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Deal Start Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={formData.site_deal_start_date}
                    onChange={(e) => set("site_deal_start_date", e.target.value)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.site_deal_start_date ? "border-red-400" : "border-gray-300"}`}
                  />
                  {errors.site_deal_start_date && <p className="text-red-500 text-xs mt-1">{errors.site_deal_start_date}</p>}
                </div>
              </div>
            </div>
          )}

          {/* ── PLOT SECTIONS ── */}
          {!isSite && (
            <>
              {/* Section 2: Plot Dimensions */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-base font-semibold text-gray-800 mb-1">Plot Dimensions</h2>
                <p className="text-xs text-gray-400 mb-4">Optional — fill in to see a visual diagram.</p>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <div className="sm:col-span-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Total Area (sqft)</label>
                    <input
                      type="number"
                      value={formData.total_area_sqft}
                      onChange={(e) => set("total_area_sqft", e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g. 1200"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Left Side (ft)</label>
                    <input
                      type="number"
                      value={formData.side_left_ft}
                      onChange={(e) => set("side_left_ft", e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Left"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Right Side (ft)</label>
                    <input
                      type="number"
                      value={formData.side_right_ft}
                      onChange={(e) => set("side_right_ft", e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Right"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Top Side (ft)</label>
                    <input
                      type="number"
                      value={formData.side_top_ft}
                      onChange={(e) => set("side_top_ft", e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Top"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Bottom Side (ft)</label>
                    <input
                      type="number"
                      value={formData.side_bottom_ft}
                      onChange={(e) => set("side_bottom_ft", e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Bottom"
                      min="0"
                    />
                  </div>
                </div>

                <PlotDiagram
                  left={formData.side_left_ft}
                  right={formData.side_right_ft}
                  top={formData.side_top_ft}
                  bottom={formData.side_bottom_ft}
                  area={formData.total_area_sqft}
                />
              </div>

              {/* Section 3: Seller Details */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-base font-semibold text-gray-800 mb-4">Seller Details</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Seller Contact</label>
                    <select
                      value={formData.seller_contact_id}
                      onChange={(e) => set("seller_contact_id", e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">— Select Seller —</option>
                      {contacts.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ""}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Seller Rate / sqft (₹) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      value={formData.seller_rate_per_sqft}
                      onChange={(e) => set("seller_rate_per_sqft", e.target.value)}
                      className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.seller_rate_per_sqft ? "border-red-400" : "border-gray-300"}`}
                      placeholder="e.g. 500"
                      min="0"
                    />
                    {errors.seller_rate_per_sqft && <p className="text-red-500 text-xs mt-1">{errors.seller_rate_per_sqft}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Total Seller Value (₹)
                      <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">auto</span>
                    </label>
                    <input
                      type="number"
                      value={formData.total_seller_value}
                      onChange={(e) => set("total_seller_value", e.target.value)}
                      className="w-full border border-blue-200 bg-blue-50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Rate × Area"
                      min="0"
                    />
                    {formData.total_seller_value && (
                      <p className="text-xs text-blue-600 mt-1">= {formatCurrency(parseFloat(formData.total_seller_value))}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Advance Paid to Seller (₹)</label>
                    <input
                      type="number"
                      value={formData.advance_paid}
                      onChange={(e) => set("advance_paid", e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0"
                      min="0"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Advance Date</label>
                    <input
                      type="date"
                      value={formData.advance_date}
                      onChange={(e) => set("advance_date", e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Deal Locked Date</label>
                    <input
                      type="date"
                      value={formData.deal_locked_date}
                      onChange={(e) => set("deal_locked_date", e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Expected Registry Date</label>
                    <input
                      type="date"
                      value={formData.expected_registry_date}
                      onChange={(e) => set("expected_registry_date", e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {isEditMode && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Actual Registry Date</label>
                      <input
                        type="date"
                        value={formData.actual_registry_date}
                        onChange={(e) => set("actual_registry_date", e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Section 4: Broker Details (only for middleman) */}
              {formData.deal_type === "middleman" && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <h2 className="text-base font-semibold text-gray-800 mb-4">Broker Details</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Broker Name</label>
                      <input
                        type="text"
                        value={formData.broker_name}
                        onChange={(e) => set("broker_name", e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="e.g. Ramesh Broker"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Broker Commission (₹)</label>
                      <input
                        type="number"
                        value={formData.broker_commission}
                        onChange={(e) => set("broker_commission", e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="0"
                        min="0"
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Notes */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">Notes</h2>
            {isEditMode && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => set("status", e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="negotiating">Negotiating</option>
                  <option value="advance_given">Advance Given</option>
                  <option value="buyer_found">Buyer Found</option>
                  <option value="registry_done">Registry Done</option>
                  <option value="settled">Settled</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            )}
            <textarea
              value={formData.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Any additional notes..."
            />
          </div>

          {/* Submit */}
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="px-5 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitMutation.isPending}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {submitMutation.isPending ? "Saving..." : isEditMode ? "Save Changes" : "Create Deal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
