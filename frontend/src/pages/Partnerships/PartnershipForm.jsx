import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";
import { PageHero, PageBody, Card } from "../../components/ui";

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
  total_deal_value: partnership.total_deal_value ? String(partnership.total_deal_value) : "",
  start_date: partnership.start_date || "",
  expected_end_date: partnership.expected_end_date || "",
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
    total_deal_value: "",
    start_date: "",
    expected_end_date: "",
    notes: "",
    status: "active",
  });
  const [errors, setErrors] = useState({});

  // Partners list (only used in create mode)
  const [partners, setPartners] = useState([
    {
      contact_id: "",
      is_self: false,
      share_percentage: "",
      notes: "",
    },
  ]);

  const set = (field, value) => setFormData((p) => ({ ...p, [field]: value }));

  const addPartner = () =>
    setPartners((prev) => [
      ...prev,
      {
        contact_id: "",
        is_self: false,
        share_percentage: "",
        notes: "",
      },
    ]);

  const removePartner = (idx) =>
    setPartners((prev) => prev.filter((_, i) => i !== idx));

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
      const res = await api.get("/api/contacts", { params: { limit: 500 } });
      return res.data;
    },
  });

  // Load properties (plot or site, not settled)
  const { data: properties = [] } = useQuery({
    queryKey: ["properties", "for-partnership-form"],
    queryFn: async () => {
      const res = await api.get("/api/properties", {
        params: { limit: 500 },
      });
      return res.data.filter(
        (p) => ["plot", "site"].includes(p.property_type) && p.status !== "settled" && p.status !== "cancelled",
      );
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

  // Auto-populate total_deal_value from linked property
  useEffect(() => {
    if (linkedProperty?.total_seller_value && !formData.total_deal_value) {
      set("total_deal_value", String(linkedProperty.total_seller_value));
    }
  }, [linkedProperty?.total_seller_value]);

  const totalSharePct = partners.reduce(
    (sum, p) => sum + (parseFloat(p.share_percentage) || 0),
    0,
  );

  const submitMutation = useMutation({
    mutationFn: async ({ partnershipPayload, partnersToCreate }) => {
      let partnershipId = id;
      if (isEditMode) {
        const res = await api.put(
          `/api/partnerships/${id}`,
          partnershipPayload,
        );
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
      if (isEditMode)
        queryClient.invalidateQueries({ queryKey: ["partnership", id] });
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
      if (selfCount > 1)
        errs.partners = "Only one partner can be marked as 'self'";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    const partnershipPayload = {
      title: formData.title.trim(),
      linked_property_deal_id: toNullableNumber(
        formData.linked_property_deal_id,
      ),
      total_deal_value: toNullableNumber(formData.total_deal_value),
      start_date: toNullableString(formData.start_date),
      expected_end_date: toNullableString(formData.expected_end_date),
      notes: toNullableString(formData.notes),
    };
    if (isEditMode) {
      partnershipPayload.status = formData.status;
    }

    const partnersToCreate = !isEditMode
      ? partners
          .filter((p) => p.is_self || p.contact_id)
          .map((p) => ({
            contact_id: p.is_self ? null : toNullableNumber(p.contact_id),
            is_self: p.is_self,
            share_percentage: parseFloat(p.share_percentage) || 0,
            notes: toNullableString(p.notes),
          }))
      : [];

    submitMutation.mutate({ partnershipPayload, partnersToCreate });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        compact
        backTo="/partnerships"
        title={isEditMode ? "Edit Partnership" : "New Partnership"}
        subtitle={
          isEditMode
            ? "Update partnership details"
            : "Create a new investment partnership"
        }
      />

      <PageBody>
        <Card className="p-0">
          <form onSubmit={handleSubmit} className="space-y-5 p-5 sm:p-6">
            {/* Step 1: Basic Info */}
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 sm:p-6">
              <h2 className="text-base font-bold text-slate-800 mb-4">
                Basic Info
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Title <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => set("title", e.target.value)}
                    className={`w-full border rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all ${errors.title ? "border-rose-400" : "border-slate-200"}`}
                    placeholder="e.g. Shivaji Nagar Plot Partnership"
                  />
                  {errors.title && (
                    <p className="text-rose-500 text-xs mt-1">{errors.title}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Linked Property Deal
                    <span className="text-xs text-slate-400 ml-2">
                      (Plot & Site deals)
                    </span>
                  </label>
                  <select
                    value={formData.linked_property_deal_id}
                    onChange={(e) =>
                      set("linked_property_deal_id", e.target.value)
                    }
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all disabled:bg-slate-50 disabled:text-slate-400"
                    disabled={isEditMode}
                  >
                    <option value="">— No linked property —</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                        {p.location ? ` (${p.location})` : ""}
                      </option>
                    ))}
                  </select>
                  {isEditMode && (
                    <p className="text-xs text-slate-400 mt-1">
                      Linked property cannot be changed after creation.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Total Deal Value (₹)
                    {linkedProperty?.total_seller_value && (
                      <span className="ml-2 text-xs text-indigo-500 font-normal">auto-filled from property</span>
                    )}
                  </label>
                  <input
                    type="number"
                    value={formData.total_deal_value}
                    onChange={(e) => set("total_deal_value", e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    placeholder="Total deal value"
                    min="0"
                    step="any"
                  />
                </div>

                {/* Linked property info box */}
                {linkedProperty && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-sm space-y-1.5">
                    <div className="font-semibold text-indigo-800 mb-2">
                      Linked Property Details
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Area:</span>
                      <span className="font-medium">
                        {linkedProperty.total_area_sqft
                          ? `${Number(linkedProperty.total_area_sqft).toLocaleString()} sqft`
                          : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">
                        Total Seller Value:
                      </span>
                      <span className="font-medium">
                        {linkedProperty.total_seller_value
                          ? formatCurrency(linkedProperty.total_seller_value)
                          : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Advance Paid:</span>
                      <span className="font-medium">
                        {formatCurrency(linkedProperty.advance_paid || 0)}
                      </span>
                    </div>
                    {linkedProperty.broker_commission > 0 && (
                      <div className="flex justify-between">
                        <span className="text-slate-600">
                          Broker Commission:
                        </span>
                        <span className="font-medium">
                          {formatCurrency(linkedProperty.broker_commission)}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => set("notes", e.target.value)}
                    rows={2}
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    placeholder="Any notes..."
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={formData.start_date}
                      onChange={(e) => set("start_date", e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Expected End Date
                    </label>
                    <input
                      type="date"
                      value={formData.expected_end_date}
                      onChange={(e) => set("expected_end_date", e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    />
                  </div>
                </div>

                {isEditMode && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Status
                    </label>
                    <select
                      value={formData.status}
                      onChange={(e) => set("status", e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
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
              <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-bold text-slate-800">
                    Partners
                  </h2>
                  <div className="flex items-center gap-3 text-sm">
                    <span
                      className={`font-medium ${Math.abs(totalSharePct - 100) < SHARE_PERCENTAGE_TOLERANCE ? "text-emerald-600" : "text-orange-600"}`}
                    >
                      Total: {totalSharePct.toFixed(1)}%
                    </span>
                    <button
                      type="button"
                      onClick={addPartner}
                      className="text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      + Add Partner
                    </button>
                  </div>
                </div>

                {errors.partners && (
                  <p className="text-rose-700 text-sm mb-3 bg-rose-50 border border-rose-200 rounded-xl p-2">
                    ⚠ {errors.partners}
                  </p>
                )}

                <div className="space-y-4">
                  {partners.map((partner, idx) => (
                    <div
                      key={idx}
                      className="border border-slate-200/60 rounded-xl p-4 relative"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-slate-700">
                          Partner {idx + 1}
                        </span>
                        {partners.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removePartner(idx)}
                            className="text-rose-500 hover:text-rose-700 text-xs"
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
                              onChange={(e) =>
                                updatePartner(idx, "is_self", e.target.checked)
                              }
                              className="rounded"
                            />
                            <span className="text-sm text-slate-700">
                              This is me (Self)
                            </span>
                          </label>
                        </div>

                        {!partner.is_self && (
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-medium text-slate-500 mb-1">
                              Contact
                            </label>
                            <select
                              value={partner.contact_id}
                              onChange={(e) =>
                                updatePartner(idx, "contact_id", e.target.value)
                              }
                              className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                            >
                              <option value="">— Select Contact —</option>
                              {contacts.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                  {c.phone ? ` (${c.phone})` : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">
                            Share % <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="number"
                            value={partner.share_percentage}
                            onChange={(e) =>
                              updatePartner(
                                idx,
                                "share_percentage",
                                e.target.value,
                              )
                            }
                            className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                            placeholder="e.g. 40"
                            min="0"
                            max="100"
                            step="0.01"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">
                            Notes (optional)
                          </label>
                          <input
                            type="text"
                            value={partner.notes}
                            onChange={(e) =>
                              updatePartner(idx, "notes", e.target.value)
                            }
                            className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                            placeholder="Optional note for this partner"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Totals summary */}
                <div className="mt-4 border-t border-slate-200 pt-3 text-sm flex flex-wrap gap-4">
                  <div
                    className={`${Math.abs(totalSharePct - 100) < SHARE_PERCENTAGE_TOLERANCE ? "text-emerald-600" : "text-orange-600"}`}
                  >
                    Share Total: <strong>{totalSharePct.toFixed(2)}%</strong>
                    {Math.abs(totalSharePct - 100) < SHARE_PERCENTAGE_TOLERANCE
                      ? " ✓"
                      : ` (need ${(100 - totalSharePct).toFixed(2)}% more)`}
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-medium text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitMutation.isPending}
                className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl text-sm font-medium hover:from-indigo-600 hover:to-indigo-700 shadow-sm shadow-indigo-500/20 active:scale-[0.98] disabled:opacity-50 transition-all"
              >
                {submitMutation.isPending
                  ? "Saving..."
                  : isEditMode
                    ? "Save Changes"
                    : "Create Partnership"}
              </button>
            </div>
          </form>
        </Card>
      </PageBody>
    </div>
  );
}
