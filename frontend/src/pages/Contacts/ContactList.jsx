import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, User, Building } from "lucide-react";
import api from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import {
  PageHero,
  HeroStat,
  PageBody,
  Card,
  Button,
  Badge,
  SearchInput,
  EmptyState,
  PageSkeleton,
  Select,
} from "../../components/ui";

export default function ContactList() {
  const [search, setSearch] = useState("");
  const [contactType, setContactType] = useState("");
  const navigate = useNavigate();
  const { user } = useAuth();

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
    if (contactType)
      result = result.filter((c) => c.contact_type === contactType);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.phone?.toLowerCase().includes(q) ||
          c.city?.toLowerCase().includes(q),
      );
    }
    return result;
  }, [allContacts, search, contactType]);

  const individualCount = useMemo(
    () => allContacts.filter((c) => c.contact_type === "individual").length,
    [allContacts],
  );
  const institutionCount = useMemo(
    () => allContacts.filter((c) => c.contact_type === "institution").length,
    [allContacts],
  );
  const handshakeCount = useMemo(
    () => allContacts.filter((c) => c.is_handshake).length,
    [allContacts],
  );

  if (isLoading) return <PageSkeleton />;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title="Contacts"
        subtitle={`${allContacts.length} total contacts in your network`}
        actions={
          user?.role === "admin" && (
            <Button
              variant="white"
              icon={Plus}
              onClick={() => navigate("/contacts/new")}
            >
              Add Contact
            </Button>
          )
        }
      >
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <HeroStat
            label="Total Contacts"
            value={allContacts.length}
            accent="indigo"
          />
          <HeroStat
            label="Individuals"
            value={individualCount}
            accent="emerald"
          />
          <HeroStat
            label="Institutions"
            value={institutionCount}
            accent="violet"
          />
          <HeroStat
            label="Handshake Deals"
            value={handshakeCount}
            accent="amber"
          />
        </div>
      </PageHero>

      <PageBody>
        {/* Filters */}
        <Card className="p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search by name, phone, city..."
              className="flex-1"
            />
            <Select
              value={contactType}
              onChange={(e) => setContactType(e.target.value)}
              className="sm:w-48"
            >
              <option value="">All Types</option>
              <option value="individual">Individual</option>
              <option value="institution">Institution</option>
            </Select>
          </div>
        </Card>

        {/* Results count */}
        {(search || contactType) && contacts.length !== allContacts.length && (
          <p className="text-sm text-slate-500 mb-4">
            {contacts.length} result(s) found
          </p>
        )}

        {error && (
          <Card className="p-4 mb-4 border-rose-200 bg-rose-50">
            <p className="text-sm text-rose-700">
              Failed to load contacts. Please try again.
            </p>
          </Card>
        )}

        {/* Contact Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {contacts.map((contact) => (
            <Card
              key={contact.id}
              hover
              onClick={() => navigate(`/contacts/${contact.id}`)}
              className="p-5 group"
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    contact.contact_type === "institution"
                      ? "bg-gradient-to-br from-amber-500 to-orange-600"
                      : "bg-gradient-to-br from-indigo-500 to-violet-600"
                  }`}
                >
                  {contact.contact_type === "institution" ? (
                    <Building className="w-5 h-5 text-white" />
                  ) : (
                    <User className="w-5 h-5 text-white" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-slate-800 truncate group-hover:text-indigo-600 transition-colors">
                    {contact.name}
                  </h3>
                  <p className="text-xs text-slate-400 capitalize">
                    {contact.relationship_type}
                  </p>
                </div>
              </div>

              <div className="mt-3 space-y-1">
                {contact.phone && (
                  <p className="text-sm text-slate-500">📞 {contact.phone}</p>
                )}
                {contact.city && (
                  <p className="text-sm text-slate-500">📍 {contact.city}</p>
                )}
              </div>

              {contact.is_handshake && (
                <Badge variant="warning" className="mt-3">
                  🤝 Handshake
                </Badge>
              )}
            </Card>
          ))}
        </div>

        {contacts.length === 0 && !error && (
          <EmptyState
            icon={User}
            title={
              search || contactType ? "No contacts match" : "No contacts yet"
            }
            description={
              search || contactType
                ? "Try a different search or filter"
                : "Get started by adding your first contact"
            }
            action={
              user?.role === "admin" && (
                <Button icon={Plus} onClick={() => navigate("/contacts/new")}>
                  Add Contact
                </Button>
              )
            }
          />
        )}
      </PageBody>
    </div>
  );
}
