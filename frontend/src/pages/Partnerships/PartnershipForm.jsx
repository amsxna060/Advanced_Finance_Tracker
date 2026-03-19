import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";

const toNullableNumber = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  return Number(value);
};

const normalizePartnershipForForm = (partnership) => ({
  title: partnership.title || "",
  linked_property_deal_id: partnership.linked_property_deal_id
    ? String(partnership.linked_property_deal_id)
    : "",
  total_deal_value: partnership.total_deal_value
    ? String(partnership.total_deal_value)
    : "",
  our_investment: partnership.our_investment
    ? String(partnership.our_investment)
    : "0",
  our_share_percentage: partnership.our_share_percentage
    ? String(partnership.our_share_percentage)
    : "",
  total_received: partnership.total_received
    ? String(partnership.total_received)
    : "0",
  start_date: partnership.start_date || "",
  expected_end_date: partnership.expected_end_date || "",
  actual_end_date: partnership.actual_end_date || "",
  status: partnership.status || "active",
  notes: partnership.notes || "",
});

function PartnershipForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(id);
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState({
    title: "",
    linked_property_deal_id: "",
    total_deal_value: "",
    our_investment: "0",
    our_share_percentage: "",
    total_received: "0",
    start_date: "",
    expected_end_date: "",
    actual_end_date: "",
    status: "active",
    notes: "",
  });

  // Inline partners (only for create mode)
  const [partners, setPartners] = useState([]);
  const addPartner = () =>
    setPartners((prev) => [
      ...prev,
      {
        contact_id: "",
        share_percentage: "",
        advance_contributed: "0",
        notes: "",
      },
    ]);
  const removePartner = (idx) =>
    setPartners((prev) => prev.filter((_, i) => i !== idx));
  const updatePartner = (idx, field, value) =>
    setPartners((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)),
    );

  useQuery({
    queryKey: ["partnership", id],
    enabled: isEditMode,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await api.get(`/api/partnerships/${id}`);
      setFormData(normalizePartnershipForForm(response.data.partnership));
      return response.data;
    },
  });

  const { data: properties = [] } = useQuery({
    queryKey: ["properties", "for-form"],
    queryFn: async () => {
      const response = await api.get("/api/properties", {
        params: { limit: 100 },
      });
      return response.data;
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (payload) => {
      if (isEditMode) {
        const response = await api.put(`/api/partnerships/${id}`, payload);
        return response.data;
      }
      const response = await api.post("/api/partnerships", payload);
      const newPartnership = response.data;
      // Create each partner member
      for (const partner of partners) {
        if (!partner.contact_id && !partner.is_self) continue;
        await api.post(`/api/partnerships/${newPartnership.id}/members`, {
          contact_id: partner.contact_id ? parseInt(partner.contact_id) : null,
          is_self: false,
          share_percentage: parseFloat(partner.share_percentage) || 0,
          advance_contributed: parseFloat(partner.advance_contributed) || 0,
          notes: partner.notes?.trim() || null,
        });
      }
      return newPartnership;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["partnerships"] });
      if (isEditMode) {
        queryClient.invalidateQueries({ queryKey: ["partnership", id] });
        navigate(`/partnerships/${id}`);
      } else {
        navigate(`/partnerships/${data.id}`);
      }
    },
    onError: (error) => {
      const detail = error.response?.data?.detail;
      setErrors({
        submit:
          typeof detail === "string" ? detail : "Failed to save partnership",
      });
    },
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => {
      const response = await api.get("/api/contacts");
      return response.data;
    },
  });

  // Track whether the user has manually picked a property (vs loaded from server)
  const userChangedProperty = useRef(!isEditMode);

  const handleChange = (event) => {
    const { name, value } = event.target;
    if (name === "linked_property_deal_id") userChangedProperty.current = true;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // ── Auto-fill total_deal_value from linked property ────────────
  // Only runs when user actively selects a property (not on edit mode initial load)
  useEffect(() => {
    if (!formData.linked_property_deal_id) return;
    if (!userChangedProperty.current) return; // skip when loaded from server
    const selected = properties.find(
      (p) => String(p.id) === formData.linked_property_deal_id,
    );
    if (!selected) return;
    const netProfit = parseFloat(selected.net_profit) || 0;
    const advancePaid = parseFloat(selected.advance_paid) || 0;
    const distributable =
      netProfit > 0 ? Math.max(0, netProfit - advancePaid) : 0;
    const dealValue = distributable > 0 ? distributable.toFixed(2) : "";
    setFormData((prev) => {
      if (prev.total_deal_value === dealValue) return prev;
      return { ...prev, total_deal_value: dealValue };
    });
  }, [formData.linked_property_deal_id, properties]);

  // ── Auto-calculate expected return ──────────────────────────────
  // expected_return = (total_deal_value × our_share_percentage / 100)
  const expectedReturn = (() => {
    const dealVal = parseFloat(formData.total_deal_value) || 0;
    const pct = parseFloat(formData.our_share_percentage) || 0;
    if (dealVal > 0 && pct > 0) return ((dealVal * pct) / 100).toFixed(2);
    return "";
  })();

  // Estimated profit from linked property
  const linkedPropertyProfit = (() => {
    if (!formData.linked_property_deal_id) return null;
    const selected = properties.find(
      (p) => String(p.id) === formData.linked_property_deal_id,
    );
    if (!selected) return null;
    const gross = parseFloat(selected.gross_profit) || 0;
    const net = parseFloat(selected.net_profit) || 0;
    const advancePaid = parseFloat(selected.advance_paid) || 0;
    const distributable = Math.max(0, (net || gross) - advancePaid);
    const pct = parseFloat(formData.our_share_percentage) || 0;
    if (gross || net) {
      return {
        gross_profit: gross,
        net_profit: net,
        distributable,
        our_share_of_profit:
          pct > 0 ? ((distributable * pct) / 100).toFixed(2) : "0",
      };
    }
    return null;
  })();

  const handleSubmit = (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!formData.title.trim()) nextErrors.title = "Title is required";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const payload = {
      title: formData.title.trim(),
      linked_property_deal_id: toNullableNumber(
        formData.linked_property_deal_id,
      ),
      total_deal_value: toNullableNumber(formData.total_deal_value),
      our_investment: toNullableNumber(formData.our_investment) ?? 0,
      our_share_percentage: toNullableNumber(formData.our_share_percentage),
      total_received: toNullableNumber(formData.total_received) ?? 0,
      start_date: formData.start_date || null,
      expected_end_date: formData.expected_end_date || null,
      notes: formData.notes?.trim() || null,
    };

    if (isEditMode) {
      payload.actual_end_date = formData.actual_end_date || null;
      payload.status = formData.status;
    }

    submitMutation.mutate(payload);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <button
            onClick={() => navigate("/partnerships")}
            className="text-gray-600 hover:text-gray-900 mb-3"
          >
            ← Back to Partnerships
          </button>
          <h1 className="text-3xl font-bold text-gray-900">
            {isEditMode ? "Edit Partnership" : "New Partnership"}
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg shadow-sm p-6 space-y-6"
        >
          {errors.submit && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg">
              {errors.submit}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Title *
              </label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
              {errors.title && (
                <p className="mt-1 text-sm text-red-600">{errors.title}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Linked Property Deal
              </label>
              <select
                name="linked_property_deal_id"
                value={formData.linked_property_deal_id}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">None</option>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {formData.linked_property_deal_id
                  ? "Net Profit to Distribute"
                  : "Total Deal Value"}
                {formData.linked_property_deal_id && (
                  <span className="text-xs text-blue-500 ml-1">
                    (net profit − advance paid, auto)
                  </span>
                )}
              </label>
              <input
                type="number"
                step="0.01"
                name="total_deal_value"
                value={formData.total_deal_value}
                onChange={handleChange}
                readOnly={Boolean(formData.linked_property_deal_id)}
                className={`w-full px-4 py-2 border border-gray-300 rounded-lg ${formData.linked_property_deal_id ? "bg-gray-50 text-gray-600" : ""}`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Our Investment
              </label>
              <input
                type="number"
                step="0.01"
                name="our_investment"
                value={formData.our_investment}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Our Share Percentage (%)
              </label>
              <input
                type="number"
                step="0.001"
                name="our_share_percentage"
                value={formData.our_share_percentage}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Expected Return
                <span className="text-xs text-blue-500 ml-1">
                  (auto: deal × share %)
                </span>
              </label>
              <input
                type="text"
                value={
                  expectedReturn
                    ? `₹ ${Number(expectedReturn).toLocaleString("en-IN")}`
                    : "—"
                }
                readOnly
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Total Received
                <span className="text-xs text-gray-400 ml-1">
                  (updates via transactions)
                </span>
              </label>
              <input
                type="number"
                step="0.01"
                name="total_received"
                value={formData.total_received}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Start Date
              </label>
              <input
                type="date"
                name="start_date"
                value={formData.start_date}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Expected End Date
              </label>
              <input
                type="date"
                name="expected_end_date"
                value={formData.expected_end_date}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>
          </div>

          {linkedPropertyProfit && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-blue-800 mb-2">
                Linked Property Profit Summary
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-blue-600">Gross Profit</div>
                  <div className="font-medium text-blue-900">
                    ₹{" "}
                    {Number(linkedPropertyProfit.gross_profit).toLocaleString(
                      "en-IN",
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-blue-600">Net Profit</div>
                  <div className="font-medium text-blue-900">
                    ₹{" "}
                    {Number(linkedPropertyProfit.net_profit).toLocaleString(
                      "en-IN",
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-blue-600">
                    Distributable (after advance)
                  </div>
                  <div className="font-semibold text-green-700">
                    ₹{" "}
                    {Number(linkedPropertyProfit.distributable).toLocaleString(
                      "en-IN",
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-blue-600">Our Share of Profit</div>
                  <div className="font-medium text-blue-900">
                    ₹{" "}
                    {Number(
                      linkedPropertyProfit.our_share_of_profit,
                    ).toLocaleString("en-IN")}
                  </div>
                </div>
              </div>
            </div>
          )}

          {isEditMode && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-200">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Actual End Date
                </label>
                <input
                  type="date"
                  name="actual_end_date"
                  value={formData.actual_end_date}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Status
                </label>
                <select
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="active">Active</option>
                  <option value="settled">Settled</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
          )}

          {!isEditMode && (
            <div className="pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    Partner Members
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Add partners for this deal — their share % and advance
                    amount
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addPartner}
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                >
                  + Add Partner
                </button>
              </div>
              {partners.length === 0 ? (
                <p className="text-sm text-gray-400 italic">
                  No partners added yet. You can also add them after creating
                  the partnership.
                </p>
              ) : (
                <div className="space-y-3">
                  {partners.map((partner, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-12 gap-3 items-start bg-gray-50 p-3 rounded-lg"
                    >
                      <div className="col-span-4">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Contact
                        </label>
                        <select
                          value={partner.contact_id}
                          onChange={(e) =>
                            updatePartner(idx, "contact_id", e.target.value)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        >
                          <option value="">Select contact</option>
                          {contacts.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Share %
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          placeholder="e.g. 25"
                          value={partner.share_percentage}
                          onChange={(e) =>
                            updatePartner(
                              idx,
                              "share_percentage",
                              e.target.value,
                            )
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                      <div className="col-span-3">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Advance Given
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0"
                          value={partner.advance_contributed}
                          onChange={(e) =>
                            updatePartner(
                              idx,
                              "advance_contributed",
                              e.target.value,
                            )
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Notes
                        </label>
                        <input
                          type="text"
                          placeholder="Optional"
                          value={partner.notes}
                          onChange={(e) =>
                            updatePartner(idx, "notes", e.target.value)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                      <div className="col-span-1 pt-6">
                        <button
                          type="button"
                          onClick={() => removePartner(idx)}
                          className="text-red-500 hover:text-red-700 text-lg font-bold"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="pt-4 border-t border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows="4"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            />
          </div>

          <div className="flex gap-4 pt-4">
            <button
              type="button"
              onClick={() => navigate("/partnerships")}
              className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitMutation.isPending}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {submitMutation.isPending
                ? "Saving..."
                : isEditMode
                  ? "Update Partnership"
                  : "Create Partnership"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PartnershipForm;
