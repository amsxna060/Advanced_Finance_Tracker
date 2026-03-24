import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

const SHARE_PERCENTAGE_TOLERANCE = 0.01;

const toNullableNumber = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
};

const toNullableString = (value) => (value?.trim() ? value.trim() : null);

const normalizeForForm = (partnership) => ({
  title: partnership.title || "",
  linked_property_deal_id: partnership.linked_property_deal_id
    ? String(partnership.linked_property_deal_id)
    : "",
  notes: partnership.notes || "",
  status: partnership.status || "active",
});

export default function PartnershipForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(id);

  const [formData, setFormData] = useState({
    title: "",
    linked_property_deal_id: "",
    notes: "",
    status: "active",
  });
  const [errors, setErrors] = useState({});

  // Partners list (only used in create mode)
  const [partners, setPartners] = useState([
    { contact_id: "", is_self: false, share_percentage: "", advance_contributed: "0", notes: "" },
  ]);

  const set = (field, value) => setFormData((p) => ({ ...p, [field]: value }));

  const addPartner = () =>
    setPartners((prev) => [
      ...prev,
      { contact_id: "", is_self: false, share_percentage: "", advance_contributed: "0", notes: "" },
    ]);

  const removePartner = (idx) => setPartners((prev) => prev.filter((_, i) => i !== idx));

  const updatePartner = (idx, field, value) => {
    setPartners((prev) =>
      prev.map((p, i) => {
        if (i !== idx) {
          // If toggling is_self on, uncheck all others
          if (field === "is_self" && value === true) {
            return { ...p, is_self: false };
          }
          return p;
        }
        return { ...p, [field]: value };
      }),
    );
  };

  // Load contacts
  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts", "for-form"],
    queryFn: async () => {
      const res = await api.get("/api/contacts", { params: { limit: 200 } });
      return res.data;
    },
  });

  // Load properties (only plot type, not settled)
  const { data: properties = [] } = useQuery({
    queryKey: ["properties", "for-partnership-form"],
    queryFn: async () => {
      const res = await api.get("/api/properties", { params: { limit: 100, property_type: "plot" } });
      return res.data.filter((p) => p.status !== "settled" && p.status !== "cancelled");
    },
  });

  // Load existing partnership for edit
  useQuery({
    queryKey: ["partnership", id],
    enabled: isEditMode,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await api.get(`/api/partnerships/${id}`);
      setFormData(normalizeForForm(res.data.partnership));
      return res.data;
    },
  });

  // Load linked property detail when selected
  const selectedPropertyId = formData.linked_property_deal_id;
  const { data: linkedPropertyData } = useQuery({
    queryKey: ["property", selectedPropertyId],
    enabled: Boolean(selectedPropertyId),
    queryFn: async () => {
      const res = await api.get(`/api/properties/${selectedPropertyId}`);
      return res.data;
    },
  });
  const linkedProperty = linkedPropertyData?.property;

  const totalSharePct = partners.reduce(
    (sum, p) => sum + (parseFloat(p.share_percentage) || 0),
    0,
  );
  const totalAdvance = partners.reduce(
    (sum, p) => sum + (parseFloat(p.advance_contributed) || 0),
    0,
  );
  const propertyAdvance = parseFloat(linkedProperty?.advance_paid || 0);
  const advanceMismatch = linkedProperty && propertyAdvance > 0 && Math.abs(totalAdvance - propertyAdvance) > SHARE_PERCENTAGE_TOLERANCE;

  const submitMutation = useMutation({
    mutationFn: async ({ partnershipPayload, partnersToCreate }) => {
      let partnershipId = id;
      if (isEditMode) {
        const res = await api.put(`/api/partnerships/${id}`, partnershipPayload);
        return res.data;
      }
      const res = await api.post("/api/partnerships", partnershipPayload);
      partnershipId = res.data.id;
      // Add partners
      for (const partner of partnersToCreate) {
        await api.post(`/api/partnerships/${partnershipId}/members`, partner);
      }
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["partnerships"] });
      if (isEditMode) queryClient.invalidateQueries({ queryKey: ["partnership", id] });
      navigate(`/partnerships/${data.id}`);
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
        alert(detail || "Failed to save partnership");
      }
    },
  });

  const validate = () => {
    const errs = {};
    if (!formData.title.trim()) errs.title = "Title is required";
    if (!isEditMode) {
      if (Math.abs(totalSharePct - 100) > SHARE_PERCENTAGE_TOLERANCE) {
        errs.partners = `Share percentages must sum to 100% (currently ${totalSharePct.toFixed(2)}%)`;
      }
      const selfCount = partners.filter((p) => p.is_self).length;
      if (selfCount > 1) errs.partners = "Only one partner can be marked as 'self'";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    const partnershipPayload = {
      title: formData.title.trim(),
      linked_property_deal_id: toNullableNumber(formData.linked_property_deal_id),
      notes: toNullableString(formData.notes),
    };
    if (isEditMode) {
      partnershipPayload.status = formData.status;
    }

    // For create: derive dates from linked property deal
    if (!isEditMode && linkedProperty) {
      partnershipPayload.start_date = linkedProperty.deal_locked_date || null;
    }

    const partnersToCreate = !isEditMode
      ? partners
          .filter((p) => p.is_self || p.contact_id)
          .map((p) => ({
            contact_id: p.is_self ? null : toNullableNumber(p.contact_id),
            is_self: p.is_self,
            share_percentage: parseFloat(p.share_percentage) || 0,
            advance_contributed: parseFloat(p.advance_contributed) || 0,
            notes: toNullableString(p.notes),
          }))
      : [];

    submitMutation.mutate({ partnershipPayload, partnersToCreate });
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-200"
          >
            ←
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {isEditMode ? "Edit Partnership" : "New Partnership"}
            </h1>
            <p className="text-sm text-gray-500">
              {isEditMode ? "Update partnership details" : "Create a new investment partnership"}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Step 1: Basic Info */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <h2 className="text-base font-semibold text-gray-800 mb-4">Basic Info</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => set("title", e.target.value)}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.title ? "border-red-400" : "border-gray-300"}`}
                  placeholder="e.g. Shivaji Nagar Plot Partnership"
                />
                {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Linked Property Deal
                  <span className="text-xs text-gray-400 ml-2">(Plot deals only)</span>
                </label>
                <select
                  value={formData.linked_property_deal_id}
                  onChange={(e) => set("linked_property_deal_id", e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isEditMode}
                >
                  <option value="">— No linked property —</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}{p.location ? ` (${p.location})` : ""}
                    </option>
                  ))}
                </select>
                {isEditMode && (
                  <p className="text-xs text-gray-400 mt-1">Linked property cannot be changed after creation.</p>
                )}
              </div>

              {/* Linked property info box */}
              {linkedProperty && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm space-y-1.5">
                  <div className="font-semibold text-blue-800 mb-2">Linked Property Details</div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Area:</span>
                    <span className="font-medium">{linkedProperty.total_area_sqft ? `${Number(linkedProperty.total_area_sqft).toLocaleString()} sqft` : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total Seller Value:</span>
                    <span className="font-medium">{linkedProperty.total_seller_value ? formatCurrency(linkedProperty.total_seller_value) : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Advance Paid:</span>
                    <span className="font-medium">{formatCurrency(linkedProperty.advance_paid || 0)}</span>
                  </div>
                  {linkedProperty.broker_commission > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Broker Commission:</span>
                      <span className="font-medium">{formatCurrency(linkedProperty.broker_commission)}</span>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Any notes..."
                />
              </div>

              {isEditMode && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => set("status", e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="active">Active</option>
                    <option value="settled">Settled</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Step 2: Partners (create mode only) */}
          {!isEditMode && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-800">Partners</h2>
                <div className="flex items-center gap-3 text-sm">
                  <span className={`font-medium ${Math.abs(totalSharePct - 100) < SHARE_PERCENTAGE_TOLERANCE ? "text-green-600" : "text-orange-600"}`}>
                    Total: {totalSharePct.toFixed(1)}%
                  </span>
                  <button
                    type="button"
                    onClick={addPartner}
                    className="px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100"
                  >
                    + Add Partner
                  </button>
                </div>
              </div>

              {errors.partners && (
                <p className="text-red-500 text-sm mb-3 bg-red-50 border border-red-200 rounded-lg p-2">
                  ⚠ {errors.partners}
                </p>
              )}

              <div className="space-y-4">
                {partners.map((partner, idx) => (
                  <div key={idx} className="border border-gray-200 rounded-lg p-4 relative">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-gray-700">Partner {idx + 1}</span>
                      {partners.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePartner(idx)}
                          className="text-red-400 hover:text-red-600 text-xs"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2 flex items-center gap-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={partner.is_self}
                            onChange={(e) => updatePartner(idx, "is_self", e.target.checked)}
                            className="rounded"
                          />
                          <span className="text-sm text-gray-700">This is me (Self)</span>
                        </label>
                      </div>

                      {!partner.is_self && (
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Contact</label>
                          <select
                            value={partner.contact_id}
                            onChange={(e) => updatePartner(idx, "contact_id", e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">— Select Contact —</option>
                            {contacts.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}{c.phone ? ` (${c.phone})` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Share % <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="number"
                          value={partner.share_percentage}
                          onChange={(e) => updatePartner(idx, "share_percentage", e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="e.g. 40"
                          min="0"
                          max="100"
                          step="0.01"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Advance Contributed (₹) <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="number"
                          value={partner.advance_contributed}
                          onChange={(e) => updatePartner(idx, "advance_contributed", e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="0"
                          min="0"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
                        <input
                          type="text"
                          value={partner.notes}
                          onChange={(e) => updatePartner(idx, "notes", e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Optional note for this partner"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals summary */}
              <div className="mt-4 border-t border-gray-200 pt-3 text-sm flex flex-wrap gap-4">
                <div className={`${Math.abs(totalSharePct - 100) < SHARE_PERCENTAGE_TOLERANCE ? "text-green-600" : "text-orange-600"}`}>
                  Share Total: <strong>{totalSharePct.toFixed(2)}%</strong>
                  {Math.abs(totalSharePct - 100) < SHARE_PERCENTAGE_TOLERANCE
                    ? " ✓"
                    : ` (need ${(100 - totalSharePct).toFixed(2)}% more)`}
                </div>
                <div className={advanceMismatch ? "text-orange-600" : "text-gray-500"}>
                  Advance Total: <strong>{formatCurrency(totalAdvance)}</strong>
                  {advanceMismatch && ` ⚠ Property advance: ${formatCurrency(propertyAdvance)}`}
                </div>
              </div>
            </div>
          )}

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
              {submitMutation.isPending
                ? "Saving..."
                : isEditMode
                ? "Save Changes"
                : "Create Partnership"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
