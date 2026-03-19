import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";

function ContactForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const queryClient = useQueryClient();
  const isEditMode = !!id;

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    alternate_phone: "",
    address: "",
    city: "",
    contact_type: "individual",
    relationship_type: "borrower",
    is_handshake: false,
    notes: "",
  });

  const [errors, setErrors] = useState({});

  // Fetch contact data if editing
  const { isLoading } = useQuery({
    queryKey: ["contact", id],
    queryFn: async () => {
      const response = await api.get(`/api/contacts/${id}`);
      // API returns {contact, summary} - extract contact
      const contact = response.data.contact || response.data;
      setFormData({
        name: contact.name || "",
        phone: contact.phone || "",
        alternate_phone: contact.alternate_phone || "",
        address: contact.address || "",
        city: contact.city || "",
        contact_type: contact.contact_type || "individual",
        relationship_type: contact.relationship_type || "borrower",
        is_handshake: contact.is_handshake || false,
        notes: contact.notes || "",
      });
      return contact;
    },
    enabled: isEditMode,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post("/api/contacts", data);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      navigate(`/contacts/${data.id}`);
    },
    onError: (error) => {
      if (error.response?.data?.detail) {
        setErrors({ submit: error.response.data.detail });
      }
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.put(`/api/contacts/${id}`, data);
      return response.data;
    },
    onSuccess: (data) => {
      // Remove stale cache so detail page does a clean fetch
      queryClient.removeQueries({ queryKey: ["contact", String(id)] });
      queryClient.removeQueries({ queryKey: ["contact", id] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      navigate(`/contacts/${data.id || id}`);
    },
    onError: (error) => {
      if (error.response?.data?.detail) {
        setErrors({ submit: error.response.data.detail });
      }
    },
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear error for this field
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const validate = () => {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = "Name is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    const submitData = {
      name: formData.name.trim(),
      phone: formData.phone?.trim() || null,
      alternate_phone: formData.alternate_phone?.trim() || null,
      address: formData.address?.trim() || null,
      city: formData.city?.trim() || null,
      contact_type: formData.contact_type,
      relationship_type: formData.relationship_type,
      is_handshake: formData.is_handshake,
      notes: formData.notes?.trim() || null,
    };

    if (isEditMode) {
      updateMutation.mutate(submitData);
    } else {
      createMutation.mutate(submitData);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => navigate("/contacts")}
            className="text-gray-600 hover:text-gray-900 mb-4 flex items-center"
          >
            <svg
              className="w-5 h-5 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to Contacts
          </button>

          <h1 className="text-3xl font-bold text-gray-900">
            {isEditMode ? "Edit Contact" : "New Contact"}
          </h1>
          <p className="text-gray-600 mt-1">
            {isEditMode
              ? "Update contact information"
              : "Add a new contact to your system"}
          </p>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg shadow-sm p-6 space-y-6"
        >
          {/* Error Message */}
          {errors.submit && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg">
              {errors.submit}
            </div>
          )}

          {/* Name */}
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                errors.name ? "border-red-500" : "border-gray-300"
              }`}
              placeholder="Enter contact name"
            />
            {errors.name && (
              <p className="mt-1 text-sm text-red-600">{errors.name}</p>
            )}
          </div>

          {/* Phone */}
          <div>
            <label
              htmlFor="phone"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Phone
            </label>
            <input
              type="tel"
              id="phone"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="+91 98765 43210"
            />
          </div>

          {/* Alternate Phone */}
          <div>
            <label
              htmlFor="alternate_phone"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Alternate Phone
            </label>
            <input
              type="tel"
              id="alternate_phone"
              name="alternate_phone"
              value={formData.alternate_phone}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="+91 98765 43210"
            />
          </div>

          {/* Contact Type */}
          <div>
            <label
              htmlFor="contact_type"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Contact Type
            </label>
            <select
              id="contact_type"
              name="contact_type"
              value={formData.contact_type}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="individual">Individual</option>
              <option value="institution">Institution</option>
            </select>
          </div>

          {/* Relationship Type */}
          <div>
            <label
              htmlFor="relationship_type"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Relationship Type
            </label>
            <select
              id="relationship_type"
              name="relationship_type"
              value={formData.relationship_type}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="borrower">Borrower</option>
              <option value="lender">Lender</option>
              <option value="partner">Partner</option>
              <option value="agent">Agent</option>
              <option value="buyer">Buyer</option>
              <option value="seller">Seller</option>
              <option value="mixed">Mixed</option>
            </select>
          </div>

          {/* Handshake Deal */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="is_handshake"
              name="is_handshake"
              checked={formData.is_handshake}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  is_handshake: e.target.checked,
                }))
              }
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label
              htmlFor="is_handshake"
              className="text-sm font-medium text-gray-700"
            >
              Handshake Deal (Trust-based, no formal agreement)
            </label>
          </div>

          {/* City */}
          <div>
            <label
              htmlFor="city"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              City
            </label>
            <input
              type="text"
              id="city"
              name="city"
              value={formData.city}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter city"
            />
          </div>

          {/* Address */}
          <div>
            <label
              htmlFor="address"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Address
            </label>
            <textarea
              id="address"
              name="address"
              value={formData.address}
              onChange={handleChange}
              rows="3"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter full address"
            />
          </div>

          {/* Notes */}
          <div>
            <label
              htmlFor="notes"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows="4"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Add any additional notes about this contact"
            />
          </div>

          {/* Actions */}
          <div className="flex space-x-4 pt-4">
            <button
              type="button"
              onClick={() => navigate("/contacts")}
              className="flex-1 px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
            >
              {createMutation.isPending || updateMutation.isPending
                ? "Saving..."
                : isEditMode
                  ? "Update Contact"
                  : "Create Contact"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ContactForm;
