import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, Search, User, Building } from "lucide-react";
import api from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";

export default function ContactList() {
  const [search, setSearch] = useState("");
  const [contactType, setContactType] = useState("");
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const {
    data: allContacts = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => {
      const response = await api.get("/api/contacts?limit=500");
      return response.data;
    },
  });

  const contacts = useMemo(() => {
    let result = allContacts;
    if (contactType) result = result.filter((c) => c.contact_type === contactType);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.phone?.toLowerCase().includes(q) ||
          c.city?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [allContacts, search, contactType]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
            <button onClick={logout} className="px-4 py-2 text-sm text-red-600">
              Logout
            </button>
          </div>
        </header>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-600">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
            <p className="text-sm text-gray-600">Manage all your contacts</p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/dashboard")}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Dashboard
            </button>
            <button onClick={logout} className="px-4 py-2 text-sm text-red-600">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search by name, phone, city..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <select
              value={contactType}
              onChange={(e) => setContactType(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Types</option>
              <option value="individual">Individual</option>
              <option value="institution">Institution</option>
            </select>

            {user?.role === "admin" && (
              <button
                onClick={() => navigate("/contacts/new")}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                <Plus className="w-5 h-5" />
                Add Contact
              </button>
            )}
          </div>
        </div>

        {/* Results count */}
        <div className="mb-4">
          <p className="text-sm text-gray-600">
            {contacts.length} contact(s) found{(search || contactType) && allContacts.length !== contacts.length ? ` of ${allContacts.length}` : ""}
          </p>
        </div>

        {/* Contact List */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md mb-4">
            Failed to load contacts. Please try again.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {contacts.map((contact) => (
            <div
              key={contact.id}
              onClick={() => navigate(`/contacts/${contact.id}`)}
              className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {contact.contact_type === "institution" ? (
                    <Building className="w-10 h-10 text-gray-400" />
                  ) : (
                    <User className="w-10 h-10 text-gray-400" />
                  )}
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {contact.name}
                    </h3>
                    <p className="text-sm text-gray-500 capitalize">
                      {contact.relationship_type}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-1">
                {contact.phone && (
                  <p className="text-sm text-gray-600">📞 {contact.phone}</p>
                )}
                {contact.city && (
                  <p className="text-sm text-gray-600">📍 {contact.city}</p>
                )}
                {contact.is_handshake && (
                  <span className="inline-block px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">
                    Handshake Deal
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {contacts.length === 0 && !error && (
          <div className="text-center py-12">
            <User className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {search || contactType ? "No contacts match your search" : "No contacts found"}
            </h3>
            <p className="text-gray-600 mb-4">
              {search || contactType ? "Try a different search or filter" : "Get started by adding your first contact"}
            </p>
            {user?.role === "admin" && (
              <button
                onClick={() => navigate("/contacts/new")}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                <Plus className="w-5 h-5" />
                Add Contact
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
