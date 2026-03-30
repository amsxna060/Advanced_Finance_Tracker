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
import { formatCurrency, formatDate } from "../../lib/utils";
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

  const { data: paymentBehavior } = useQuery({
    queryKey: ["contact-payment-behavior", id],
    queryFn: async () => {
      const res = await api.get("/api/dashboard/payment-behavior", {
        params: { contact_id: id },
      });
      return res.data;
    },
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
  const loans = contactData?.loans || [];
  const properties = contactData?.properties || [];
  const partnerships = contactData?.partnerships || [];
  const beesis = contactData?.beesis || [];

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
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <p className="text-sm text-orange-600 mb-1">
                    Total Interest Accrued
                  </p>
                  <p className="text-2xl font-bold text-orange-900">
                    {formatCurrency(summary?.total_interest_due || 0)}
                  </p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-600 mb-1">Total Outstanding</p>
                  <p className="text-2xl font-bold text-red-900">
                    {formatCurrency(summary?.total_outstanding || 0)}
                  </p>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-600 mb-1">Active Loans</p>
                  <p className="text-2xl font-bold text-blue-900">
                    {summary?.active_loans_count || 0}
                  </p>
                </div>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm text-yellow-700 mb-1">
                    Total Collateral Value
                  </p>
                  <p className="text-2xl font-bold text-yellow-900">
                    {formatCurrency(summary?.total_collateral_value || 0)}
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

            {/* Loans */}
            {loans.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Loans ({loans.length})
                </h3>
                <div className="space-y-3">
                  {loans.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => navigate(`/loans/${l.id}`)}
                      className="w-full flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 transition-colors text-left"
                    >
                      <div>
                        <span
                          className={`inline-block px-2 py-0.5 text-xs rounded-full mr-2 ${l.loan_direction === "given" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
                        >
                          {l.loan_direction === "given" ? "Given" : "Taken"}
                        </span>
                        <span className="text-sm font-medium text-gray-900 capitalize">
                          {l.loan_type?.replace("_", " ")}
                        </span>
                        {l.interest_rate ? (
                          <span className="text-xs text-gray-500 ml-2">
                            @ {l.interest_rate}%
                          </span>
                        ) : null}
                      </div>
                      <div className="text-right">
                        {(() => {
                          // For capitalized loans where interest has been rolled into principal,
                          // show the original principal and the full true interest (including
                          // what was capitalized). For all other loans show current outstanding principal.
                          const capGrown = l.capitalization_enabled &&
                            l.current_principal != null &&
                            l.current_principal > l.principal_amount;
                          const showPrincipal = capGrown
                            ? l.principal_amount
                            : (l.current_principal ?? l.principal_amount);
                          const showInterest = capGrown
                            ? (l.total_outstanding != null ? l.total_outstanding - l.principal_amount : null)
                            : l.interest_outstanding;
                          return (
                            <>
                              <div className="text-sm font-semibold text-gray-900">
                                {formatCurrency(showPrincipal)}
                              </div>
                              {showInterest > 0 && (
                                <div className="text-xs text-orange-600 mt-0.5">
                                  +{formatCurrency(showInterest)} interest
                                </div>
                              )}
                            </>
                          );
                        })()}
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${l.status === "active" ? "bg-blue-100 text-blue-800" : l.status === "settled" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}
                        >
                          {l.status}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Properties */}
            {properties.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Properties ({properties.length})
                </h3>
                <div className="space-y-3">
                  {properties.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => navigate(`/properties/${p.id}`)}
                      className="w-full flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 transition-colors text-left"
                    >
                      <div>
                        <span className="text-sm font-medium text-gray-900">
                          {p.title}
                        </span>
                        <span
                          className={`inline-block ml-2 px-2 py-0.5 text-xs rounded-full ${p.role === "seller" ? "bg-orange-100 text-orange-800" : "bg-blue-100 text-blue-800"}`}
                        >
                          {p.role}
                        </span>
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${p.status === "active" ? "bg-blue-100 text-blue-800" : p.status === "settled" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}
                      >
                        {p.status}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Partnerships */}
            {partnerships.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Partnerships ({partnerships.length})
                </h3>
                <div className="space-y-3">
                  {partnerships.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => navigate(`/partnerships/${p.id}`)}
                      className="w-full flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 transition-colors text-left"
                    >
                      <div>
                        <span className="text-sm font-medium text-gray-900">
                          {p.title}
                        </span>
                        {p.share_percentage && (
                          <span className="text-xs text-gray-500 ml-2">
                            ({p.share_percentage}%)
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${p.status === "active" ? "bg-blue-100 text-blue-800" : p.status === "settled" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}
                      >
                        {p.status}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Beesi */}
            {beesis.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Beesi ({beesis.length})
                </h3>
                <div className="space-y-3">
                  {beesis.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => navigate(`/beesi/${b.id}`)}
                      className="w-full flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 transition-colors text-left"
                    >
                      <span className="text-sm font-medium text-gray-900">
                        {b.title}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${b.status === "active" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-600"}`}
                      >
                        {b.status}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {paymentBehavior && paymentBehavior.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Payment Behavior
                </h3>
                {paymentBehavior.map((row) => (
                  <div key={row.contact_id} className="space-y-3">
                    <div className="flex items-center justify-between mb-3">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${
                          row.score_color === "green"
                            ? "bg-green-100 text-green-700"
                            : row.score_color === "red"
                              ? "bg-red-100 text-red-700"
                              : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {row.score}
                      </span>
                      <span className="text-sm text-gray-500">
                        Avg repayment rate:{" "}
                        <strong className="text-gray-900">
                          {row.avg_payment_rate_pct}%
                        </strong>
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-gray-500 text-xs mb-1">
                          Active Loans
                        </p>
                        <p className="font-semibold text-gray-900">
                          {row.active_loans}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-gray-500 text-xs mb-1">
                          Total Principal
                        </p>
                        <p className="font-semibold text-gray-900">
                          {formatCurrency(row.total_principal)}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-gray-500 text-xs mb-1">
                          Total Payments Made
                        </p>
                        <p className="font-semibold text-gray-900">
                          {row.total_payments_made}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-gray-500 text-xs mb-1">
                          Last Payment
                        </p>
                        <p className="font-semibold text-gray-900">
                          {row.last_payment_date
                            ? formatDate(row.last_payment_date)
                            : "Never"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
