import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";

const toNullableNumber = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  return Number(value);
};

const toNullableString = (value) => {
  return value?.trim() ? value.trim() : null;
};

const normalizePropertyForForm = (property) => ({
  title: property.title || "",
  location: property.location || "",
  property_type: property.property_type || "",
  total_area_sqft: property.total_area_sqft
    ? String(property.total_area_sqft)
    : "",
  deal_type: property.deal_type || "middleman",
  seller_contact_id: property.seller_contact_id
    ? String(property.seller_contact_id)
    : "",
  buyer_contact_id: property.buyer_contact_id
    ? String(property.buyer_contact_id)
    : "",
  seller_rate_per_sqft: property.seller_rate_per_sqft
    ? String(property.seller_rate_per_sqft)
    : "",
  buyer_rate_per_sqft: property.buyer_rate_per_sqft
    ? String(property.buyer_rate_per_sqft)
    : "",
  total_seller_value: property.total_seller_value
    ? String(property.total_seller_value)
    : "",
  total_buyer_value: property.total_buyer_value
    ? String(property.total_buyer_value)
    : "",
  advance_paid: property.advance_paid ? String(property.advance_paid) : "0",
  advance_date: property.advance_date || "",
  deal_locked_date: property.deal_locked_date || "",
  expected_registry_date: property.expected_registry_date || "",
  actual_registry_date: property.actual_registry_date || "",
  broker_name: property.broker_name || "",
  broker_commission: property.broker_commission
    ? String(property.broker_commission)
    : "0",
  gross_profit: property.gross_profit ? String(property.gross_profit) : "",
  net_profit: property.net_profit ? String(property.net_profit) : "",
  purchase_price: property.purchase_price
    ? String(property.purchase_price)
    : "",
  holding_cost: property.holding_cost ? String(property.holding_cost) : "0",
  sale_price: property.sale_price ? String(property.sale_price) : "",
  sale_date: property.sale_date || "",
  status: property.status || "negotiating",
  notes: property.notes || "",
});

const buildPropertyPayload = (formData, isEditMode) => {
  const payload = {
    title: formData.title.trim(),
    location: toNullableString(formData.location),
    property_type: toNullableString(formData.property_type),
    total_area_sqft: toNullableNumber(formData.total_area_sqft),
    deal_type: formData.deal_type,
    seller_contact_id: toNullableNumber(formData.seller_contact_id),
    buyer_contact_id: toNullableNumber(formData.buyer_contact_id),
    seller_rate_per_sqft: toNullableNumber(formData.seller_rate_per_sqft),
    buyer_rate_per_sqft: toNullableNumber(formData.buyer_rate_per_sqft),
    total_seller_value: toNullableNumber(formData.total_seller_value),
    total_buyer_value: toNullableNumber(formData.total_buyer_value),
    advance_paid: toNullableNumber(formData.advance_paid) ?? 0,
    advance_date: toNullableString(formData.advance_date),
    deal_locked_date: toNullableString(formData.deal_locked_date),
    expected_registry_date: toNullableString(formData.expected_registry_date),
    broker_name: toNullableString(formData.broker_name),
    broker_commission: toNullableNumber(formData.broker_commission) ?? 0,
    gross_profit: toNullableNumber(formData.gross_profit),
    net_profit: toNullableNumber(formData.net_profit),
    purchase_price: toNullableNumber(formData.purchase_price),
    holding_cost: toNullableNumber(formData.holding_cost) ?? 0,
    sale_price: toNullableNumber(formData.sale_price),
    sale_date: toNullableString(formData.sale_date),
    notes: toNullableString(formData.notes),
  };

  if (isEditMode) {
    payload.actual_registry_date = toNullableString(
      formData.actual_registry_date,
    );
    payload.status = formData.status;
  }

  return payload;
};

function PropertyForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(id);
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState({
    title: "",
    location: "",
    property_type: "plot",
    total_area_sqft: "",
    deal_type: "middleman",
    seller_contact_id: "",
    buyer_contact_id: "",
    seller_rate_per_sqft: "",
    buyer_rate_per_sqft: "",
    total_seller_value: "",
    total_buyer_value: "",
    advance_paid: "0",
    advance_date: "",
    deal_locked_date: "",
    expected_registry_date: "",
    actual_registry_date: "",
    broker_name: "",
    broker_commission: "0",
    gross_profit: "",
    net_profit: "",
    purchase_price: "",
    holding_cost: "0",
    sale_price: "",
    sale_date: "",
    status: "negotiating",
    notes: "",
  });

  // dataLoaded ref prevents auto-calc useEffects from overwriting
  // server-fetched values on initial load in edit mode
  const dataLoaded = useRef(false);

  useQuery({
    queryKey: ["property", id],
    enabled: isEditMode,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await api.get(`/api/properties/${id}`);
      dataLoaded.current = false; // reset so next effect knows data just arrived
      setFormData(normalizePropertyForForm(response.data.property));
      // After a tick, mark as loaded so effects can run on user changes
      setTimeout(() => {
        dataLoaded.current = true;
      }, 0);
      return response.data;
    },
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => {
      const response = await api.get("/api/contacts");
      return response.data;
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (payload) => {
      if (isEditMode) {
        const response = await api.put(`/api/properties/${id}`, payload);
        return response.data;
      }
      const response = await api.post("/api/properties", payload);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      if (isEditMode) {
        queryClient.invalidateQueries({ queryKey: ["property", id] });
        navigate(`/properties/${id}`);
      } else {
        navigate(`/properties/${data.id}`);
      }
    },
    onError: (error) => {
      const detail = error.response?.data?.detail;
      setErrors({
        submit:
          typeof detail === "string" ? detail : "Failed to save property deal",
      });
    },
  });

  const sellerOptions = useMemo(() => contacts, [contacts]);
  const buyerOptions = useMemo(() => contacts, [contacts]);

  // ── Auto-calculations ──────────────────────────────────────────────
  // Middleman: total_seller_value = seller_rate × area, total_buyer_value = buyer_rate × area
  //            gross_profit = buyer_total – seller_total, net_profit = gross – commission
  useEffect(() => {
    if (formData.deal_type !== "middleman") return;
    // Skip auto-calc on first render after server data is loaded
    if (!dataLoaded.current) return;
    const area = parseFloat(formData.total_area_sqft) || 0;
    const sellerRate = parseFloat(formData.seller_rate_per_sqft) || 0;
    const buyerRate = parseFloat(formData.buyer_rate_per_sqft) || 0;
    const commission = parseFloat(formData.broker_commission) || 0;

    const newSellerValue =
      area > 0 && sellerRate > 0 ? (area * sellerRate).toFixed(2) : "";
    const newBuyerValue =
      area > 0 && buyerRate > 0 ? (area * buyerRate).toFixed(2) : "";

    const sellerVal = parseFloat(newSellerValue) || 0;
    const buyerVal = parseFloat(newBuyerValue) || 0;
    const newGross =
      buyerVal > 0 && sellerVal > 0 ? (buyerVal - sellerVal).toFixed(2) : "";
    const grossVal = parseFloat(newGross) || 0;
    const newNet = grossVal !== 0 ? (grossVal - commission).toFixed(2) : "";

    setFormData((prev) => {
      if (
        prev.total_seller_value === newSellerValue &&
        prev.total_buyer_value === newBuyerValue &&
        prev.gross_profit === newGross &&
        prev.net_profit === newNet
      )
        return prev;
      return {
        ...prev,
        total_seller_value: newSellerValue,
        total_buyer_value: newBuyerValue,
        gross_profit: newGross,
        net_profit: newNet,
      };
    });
  }, [
    formData.deal_type,
    formData.total_area_sqft,
    formData.seller_rate_per_sqft,
    formData.buyer_rate_per_sqft,
    formData.broker_commission,
  ]);

  // In create mode, mark as ready immediately
  useEffect(() => {
    if (!isEditMode) dataLoaded.current = true;
  }, [isEditMode]);

  // Purchase & Hold: gross = sale_price – purchase_price, net = gross – holding_cost
  useEffect(() => {
    if (formData.deal_type !== "purchase_and_hold") return;
    if (!dataLoaded.current) return;
    const purchasePrice = parseFloat(formData.purchase_price) || 0;
    const salePrice = parseFloat(formData.sale_price) || 0;
    const holdingCost = parseFloat(formData.holding_cost) || 0;

    const newGross =
      salePrice > 0 && purchasePrice > 0
        ? (salePrice - purchasePrice).toFixed(2)
        : "";
    const grossVal = parseFloat(newGross) || 0;
    const newNet = grossVal !== 0 ? (grossVal - holdingCost).toFixed(2) : "";

    setFormData((prev) => {
      if (prev.gross_profit === newGross && prev.net_profit === newNet)
        return prev;
      return { ...prev, gross_profit: newGross, net_profit: newNet };
    });
  }, [
    formData.deal_type,
    formData.purchase_price,
    formData.sale_price,
    formData.holding_cost,
  ]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const validate = () => {
    const nextErrors = {};
    if (!formData.title.trim()) nextErrors.title = "Title is required";
    // Seller and buyer are optional — can be added later
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!validate()) return;
    submitMutation.mutate(buildPropertyPayload(formData, isEditMode));
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <button
            onClick={() => navigate("/properties")}
            className="text-gray-600 hover:text-gray-900 mb-3"
          >
            ← Back to Property Deals
          </button>
          <h1 className="text-3xl font-bold text-gray-900">
            {isEditMode ? "Edit Property Deal" : "New Property Deal"}
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
                placeholder="1000 sqft plot in Sector 5"
              />
              {errors.title && (
                <p className="text-sm text-red-600 mt-1">{errors.title}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Location
              </label>
              <input
                type="text"
                name="location"
                value={formData.location}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                placeholder="Green Valley, Hyderabad"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Deal Type
              </label>
              <select
                name="deal_type"
                value={formData.deal_type}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              >
                <option value="middleman">Middleman</option>
                <option value="purchase_and_hold">Purchase and Hold</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Property Type
              </label>
              <select
                name="property_type"
                value={formData.property_type}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              >
                <option value="plot">Plot</option>
                <option value="site">Site</option>
                <option value="flat">Flat</option>
                <option value="commercial">Commercial</option>
                <option value="agricultural">Agricultural</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Total Area (sqft)
              </label>
              <input
                type="number"
                name="total_area_sqft"
                value={formData.total_area_sqft}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Advance Paid
              </label>
              <input
                type="number"
                step="0.01"
                name="advance_paid"
                value={formData.advance_paid}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-gray-200">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Advance Date
              </label>
              <input
                type="date"
                name="advance_date"
                value={formData.advance_date}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Deal Locked Date
              </label>
              <input
                type="date"
                name="deal_locked_date"
                value={formData.deal_locked_date}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Expected Registry Date
              </label>
              <input
                type="date"
                name="expected_registry_date"
                value={formData.expected_registry_date}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>
          </div>

          {formData.deal_type === "middleman" ? (
            <div className="space-y-6 pt-4 border-t border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Middleman Details
              </h2>

              {/* Seller Side */}
              <div>
                <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
                  Seller Side
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Seller Contact
                    </label>
                    <select
                      name="seller_contact_id"
                      value={formData.seller_contact_id}
                      onChange={handleChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    >
                      <option value="">Select seller</option>
                      {sellerOptions.map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.name}
                        </option>
                      ))}
                    </select>
                    {errors.seller_contact_id && (
                      <p className="text-sm text-red-600 mt-1">
                        {errors.seller_contact_id}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Seller Rate / sqft
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      name="seller_rate_per_sqft"
                      value={formData.seller_rate_per_sqft}
                      onChange={handleChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Total Seller Value
                      <span className="text-xs text-blue-500 ml-1">
                        (auto: rate × area)
                      </span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      name="total_seller_value"
                      value={formData.total_seller_value}
                      readOnly
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                    />
                  </div>
                </div>
              </div>

              {/* Buyer Side — optional */}
              <div>
                <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
                  Buyer Side
                  <span className="text-xs font-normal text-gray-400 ml-2">
                    (optional — fill when buyer is found)
                  </span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Buyer Contact
                    </label>
                    <select
                      name="buyer_contact_id"
                      value={formData.buyer_contact_id}
                      onChange={handleChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    >
                      <option value="">Select buyer (optional)</option>
                      {buyerOptions.map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Buyer Rate / sqft
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      name="buyer_rate_per_sqft"
                      value={formData.buyer_rate_per_sqft}
                      onChange={handleChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Total Buyer Value
                      <span className="text-xs text-blue-500 ml-1">
                        (auto: rate × area)
                      </span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      name="total_buyer_value"
                      value={formData.total_buyer_value}
                      readOnly
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                    />
                  </div>
                </div>
              </div>

              {/* Broker & Profit */}
              <div>
                <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
                  Broker &amp; Profit
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Broker Name
                    </label>
                    <input
                      type="text"
                      name="broker_name"
                      value={formData.broker_name}
                      onChange={handleChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Broker Commission
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      name="broker_commission"
                      value={formData.broker_commission}
                      onChange={handleChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Gross Profit
                      <span className="text-xs text-blue-500 ml-1">
                        (auto: buyer − seller)
                      </span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      name="gross_profit"
                      value={formData.gross_profit}
                      readOnly
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Net Profit
                      <span className="text-xs text-blue-500 ml-1">
                        (auto: gross − commission)
                      </span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      name="net_profit"
                      value={formData.net_profit}
                      readOnly
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6 pt-4 border-t border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Purchase and Hold Details
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Purchase Price
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    name="purchase_price"
                    value={formData.purchase_price}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Holding Cost
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    name="holding_cost"
                    value={formData.holding_cost}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Sale Price
                    <span className="text-xs text-gray-400 ml-1">
                      (fill later when sold)
                    </span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    name="sale_price"
                    value={formData.sale_price}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Sale Date
                  </label>
                  <input
                    type="date"
                    name="sale_date"
                    value={formData.sale_date}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Gross Profit
                    <span className="text-xs text-blue-500 ml-1">
                      (auto: sale − purchase)
                    </span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    name="gross_profit"
                    value={formData.gross_profit}
                    readOnly
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Net Profit
                    <span className="text-xs text-blue-500 ml-1">
                      (auto: gross − holding cost)
                    </span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    name="net_profit"
                    value={formData.net_profit}
                    readOnly
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                  />
                </div>
              </div>
            </div>
          )}

          {isEditMode && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-200">
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
                  <option value="negotiating">Negotiating</option>
                  <option value="advance_given">Advance Given</option>
                  <option value="buyer_found">Buyer Found</option>
                  <option value="registry_done">Registry Done</option>
                  <option value="settled">Settled</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Actual Registry Date
                </label>
                <input
                  type="date"
                  name="actual_registry_date"
                  value={formData.actual_registry_date}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
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
              onClick={() => navigate("/properties")}
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
                  ? "Update Property Deal"
                  : "Create Property Deal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PropertyForm;
