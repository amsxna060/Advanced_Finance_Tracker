import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  Edit,
  User,
  Building,
} from "lucide-react";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const {
    data: contactData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["contact", id],
    queryFn: async () => {
      const response = await api.get(`/api/contacts/${id}`);
      return response.data;
    },
    staleTime: 0,
    gcTime: 0,
    retry: 2,
  });

  const deleteContactMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/api/contacts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      navigate("/contacts");
    },
    onError: (err) => {
      alert(err?.response?.data?.detail || "Failed to delete contact");
    },
  });

  const handleDelete = () => {
    if (window.confirm("Delete this contact? This cannot be undone.")) {
      deleteContactMutation.mutate();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  const contact = contactData?.contact;
  const summary = contactData?.summary;

  if (isError || !contact) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {isError ? "Failed to load contact" : "Contact not found"}
          </h2>
          <button
            onClick={() => navigate("/contacts")}
            className="text-blue-600 hover:text-blue-800"
          >
            ← Back to contacts
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate("/contacts")}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {contact.name}
                </h1>
                <p className="text-sm text-gray-600 capitalize">
                  {contact.relationship_type}
                </p>
              </div>
            </div>
            {user?.role === "admin" && (
              <div className="flex gap-2">
                <button
                  onClick={() => navigate(`/contacts/${id}/edit`)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  <Edit className="w-4 h-4" />
                  Edit
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleteContactMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200 disabled:opacity-50"
                >
                  🗑️ Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Contact Info Card */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center gap-4 mb-6">
                {contact.contact_type === "institution" ? (
                  <Building className="w-16 h-16 text-gray-400" />
                ) : (
                  <User className="w-16 h-16 text-gray-400" />
                )}
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    {contact.name}
                  </h2>
                  <p className="text-sm text-gray-500 capitalize">
                    {contact.contact_type}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {contact.phone && (
                  <div className="flex items-center gap-3">
                    <Phone className="w-5 h-5 text-gray-400" />
                    <div>
                      <p className="text-sm text-gray-600">Phone</p>
                      <p className="font-medium">{contact.phone}</p>
                    </div>
                  </div>
                )}

                {contact.alternate_phone && (
                  <div className="flex items-center gap-3">
                    <Phone className="w-5 h-5 text-gray-400" />
                    <div>
                      <p className="text-sm text-gray-600">Alternate Phone</p>
                      <p className="font-medium">{contact.alternate_phone}</p>
                    </div>
                  </div>
                )}

                {contact.address && (
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-gray-400 mt-1" />
                    <div>
                      <p className="text-sm text-gray-600">Address</p>
                      <p className="font-medium">{contact.address}</p>
                      {contact.city && (
                        <p className="text-sm text-gray-500">{contact.city}</p>
                      )}
                    </div>
                  </div>
                )}

                {contact.is_handshake && (
                  <div className="mt-4 pt-4 border-t">
                    <span className="inline-block px-3 py-1 text-sm bg-yellow-100 text-yellow-800 rounded-full">
                      🤝 Handshake Deal (Trust-based)
                    </span>
                  </div>
                )}

                {contact.notes && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-sm text-gray-600 mb-1">Notes</p>
                    <p className="text-sm text-gray-900">{contact.notes}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Summary & Activity */}
          <div className="lg:col-span-2 space-y-6">
            {/* Financial Summary */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Financial Summary
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm text-green-600 mb-1">Total Lent</p>
                  <p className="text-2xl font-bold text-green-900">
                    {formatCurrency(summary?.total_lent || 0)}
                  </p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-600 mb-1">Total Borrowed</p>
                  <p className="text-2xl font-bold text-red-900">
                    {formatCurrency(summary?.total_borrowed || 0)}
                  </p>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-600 mb-1">Active Loans</p>
                  <p className="text-2xl font-bold text-blue-900">
                    {summary?.active_loans_count || 0}
                  </p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-sm text-gray-600 mb-1">Total Loans</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {summary?.total_loans_count || 0}
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Quick Actions
              </h3>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => navigate(`/contacts/${id}/edit`)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  ✏️ Edit Contact
                </button>
                <button
                  onClick={() =>
                    navigate("/loans/new", { state: { contactId: contact.id } })
                  }
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  Create Loan
                </button>
                <button
                  onClick={() => navigate(`/loans?contact_id=${contact.id}`)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                >
                  View All Loans
                </button>
              </div>
            </div>

            {/* Recent Activity - Placeholder */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Recent Activity
              </h3>
              <p className="text-gray-600 text-sm">
                Activity tracking coming soon...
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
