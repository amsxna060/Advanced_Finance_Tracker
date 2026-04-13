import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { Phone, MapPin, Edit, User, Building, Trash2 } from "lucide-react";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";
import {
  PageHero,
  HeroStat,
  PageBody,
  Card,
  CardBody,
  Button,
  Badge,
  StatusBadge,
  StatCard,
  SectionHeader,
  InfoRow,
  PageSkeleton,
} from "../../components/ui";

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: contactData, isLoading, isError } = useQuery({
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
      const res = await api.get("/api/dashboard/payment-behavior", { params: { contact_id: id } });
      return res.data;
    },
  });

  const { data: obligationsData } = useQuery({
    queryKey: ["contact-obligations", id],
    queryFn: async () => {
      const res = await api.get("/api/obligations", { params: { contact_id: id, limit: 50 } });
      return res.data;
    },
  });

  const deleteContactMutation = useMutation({
    mutationFn: async () => { await api.delete(`/api/contacts/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      navigate("/contacts");
    },
    onError: (err) => { alert(err?.response?.data?.detail || "Failed to delete contact"); },
  });

  const handleDelete = () => {
    if (window.confirm("Delete this contact? This cannot be undone.")) {
      deleteContactMutation.mutate();
    }
  };

  if (isLoading) return <PageSkeleton />;

  const contact = contactData?.contact;
  const summary = contactData?.summary;
  const loans = contactData?.loans || [];
  const properties = contactData?.properties || [];
  const partnerships = contactData?.partnerships || [];
  const beesis = contactData?.beesis || [];
  const obligations = obligationsData || [];

  if (isError || !contact) {
    return (
      <div className="min-h-screen bg-slate-50">
        <PageHero title={isError ? "Failed to load contact" : "Contact not found"} backTo="/contacts" compact />
        <PageBody>
          <div className="flex flex-col items-center justify-center py-24">
            <h2 className="text-xl font-bold text-slate-800 mb-2">
              {isError ? "Failed to load contact" : "Contact not found"}
            </h2>
            <Button variant="ghost" onClick={() => navigate("/contacts")}>← Back to contacts</Button>
          </div>
        </PageBody>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title={contact.name}
        subtitle={`${contact.relationship_type} · ${contact.contact_type}`}
        backTo="/contacts"
        actions={
          user?.role === "admin" && (
            <>
              <Button variant="white" icon={Edit} onClick={() => navigate(`/contacts/${id}/edit`)}>Edit</Button>
              <Button variant="white" icon={Trash2} onClick={handleDelete} disabled={deleteContactMutation.isPending}>
                Delete
              </Button>
            </>
          )
        }
      >
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <HeroStat label="Total Given Out" value={formatCurrency(summary?.total_lent || 0)} accent="emerald" />
          <HeroStat label="Outstanding" value={formatCurrency(summary?.total_outstanding || 0)} accent="rose" />
          <HeroStat label="Interest Accrued" value={formatCurrency(summary?.total_interest_due || 0)} accent="amber" />
          <HeroStat label="Active Loans" value={summary?.active_loans_count || 0} accent="indigo" />
        </div>
      </PageHero>

      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Contact Info Card */}
        <div className="lg:col-span-1">
          <Card>
            <CardBody>
              <div className="flex items-center gap-4 mb-5">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
                  contact.contact_type === "institution"
                    ? "bg-gradient-to-br from-amber-500 to-orange-600"
                    : "bg-gradient-to-br from-indigo-500 to-violet-600"
                }`}>
                  {contact.contact_type === "institution" ? (
                    <Building className="w-7 h-7 text-white" />
                  ) : (
                    <User className="w-7 h-7 text-white" />
                  )}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">{contact.name}</h2>
                  <p className="text-sm text-slate-400 capitalize">{contact.contact_type}</p>
                </div>
              </div>

              <div className="space-y-4">
                {contact.phone && (
                  <div className="flex items-center gap-3">
                    <Phone className="w-4 h-4 text-slate-400" />
                    <div>
                      <p className="text-xs text-slate-400">Phone</p>
                      <p className="text-sm font-medium text-slate-700">{contact.phone}</p>
                    </div>
                  </div>
                )}
                {contact.alternate_phone && (
                  <div className="flex items-center gap-3">
                    <Phone className="w-4 h-4 text-slate-400" />
                    <div>
                      <p className="text-xs text-slate-400">Alternate</p>
                      <p className="text-sm font-medium text-slate-700">{contact.alternate_phone}</p>
                    </div>
                  </div>
                )}
                {contact.address && (
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-slate-400 mt-0.5" />
                    <div>
                      <p className="text-xs text-slate-400">Address</p>
                      <p className="text-sm font-medium text-slate-700">{contact.address}</p>
                      {contact.city && <p className="text-xs text-slate-400">{contact.city}</p>}
                    </div>
                  </div>
                )}
                {contact.is_handshake && (
                  <div className="pt-3 border-t border-slate-100">
                    <Badge variant="warning">🤝 Handshake Deal</Badge>
                  </div>
                )}
                {contact.notes && (
                  <div className="pt-3 border-t border-slate-100">
                    <p className="text-xs text-slate-400 mb-1">Notes</p>
                    <p className="text-sm text-slate-600">{contact.notes}</p>
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Summary & Activity */}
        <div className="lg:col-span-2 space-y-6">
          {/* Financial Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Total Lent" value={formatCurrency(summary?.total_lent || 0)} accent="emerald" />
            <StatCard label="Total Borrowed" value={formatCurrency(summary?.total_borrowed || 0)} accent="rose" />
            <StatCard label="Principal Outstanding" value={formatCurrency(summary?.principal_outstanding || 0)} accent="teal" />
            <StatCard label="Interest Accrued" value={formatCurrency(summary?.total_interest_due || 0)} accent="amber" />
            <StatCard label="Total Outstanding" value={formatCurrency(summary?.total_outstanding || 0)} accent="rose" sub="Principal + Interest" />
            <StatCard label="Active Loans" value={summary?.active_loans_count || 0} accent="indigo" />
            <StatCard label="Collateral Value" value={formatCurrency(summary?.total_collateral_value || 0)} accent="violet" className="col-span-2 sm:col-span-1" />
          </div>

          {/* Quick Actions */}
          <Card>
            <CardBody className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => navigate(`/contacts/${id}/edit`)}>✏️ Edit Contact</Button>
              <Button variant="success" size="sm" onClick={() => navigate("/loans/new", { state: { contactId: contact.id } })}>Create Loan</Button>
              <Button variant="secondary" size="sm" onClick={() => navigate(`/loans?contact_id=${contact.id}`)}>View All Loans</Button>
            </CardBody>
          </Card>

          {/* Loans */}
          {loans.length > 0 && (
            <>
              <SectionHeader title="Loans" count={loans.length} />
              <Card>
                <CardBody className="space-y-2 !py-3">
                  {loans.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => navigate(`/loans/${l.id}`)}
                      className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={l.loan_direction === "given" ? "success" : "danger"}>
                          {l.loan_direction === "given" ? "Given" : "Taken"}
                        </Badge>
                        <span className="text-sm font-medium text-slate-700 capitalize">{l.loan_type?.replace("_", " ")}</span>
                        {l.interest_rate ? <span className="text-xs text-slate-400">@ {l.interest_rate}%</span> : null}
                      </div>
                      <div className="text-right">
                        {(() => {
                          const capGrown = l.capitalization_enabled && l.current_principal != null && l.current_principal > l.principal_amount;
                          const showPrincipal = capGrown ? l.principal_amount : (l.current_principal ?? l.principal_amount);
                          const showInterest = capGrown ? (l.total_outstanding != null ? l.total_outstanding - l.principal_amount : null) : l.interest_outstanding;
                          return (
                            <>
                              <div className="text-sm font-bold text-slate-800">{formatCurrency(showPrincipal)}</div>
                              {showInterest > 0 && <div className="text-xs text-amber-600">+{formatCurrency(showInterest)} int</div>}
                            </>
                          );
                        })()}
                        <StatusBadge status={l.status} className="mt-0.5" />
                      </div>
                    </button>
                  ))}
                </CardBody>
              </Card>
            </>
          )}

          {/* Properties */}
          {properties.length > 0 && (
            <>
              <SectionHeader title="Properties" count={properties.length} />
              <Card>
                <CardBody className="space-y-2 !py-3">
                  {properties.map((p) => (
                    <button key={p.id} onClick={() => navigate(`/properties/${p.id}`)} className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-700">{p.title}</span>
                        <Badge variant={p.role === "seller" ? "warning" : "info"}>{p.role}</Badge>
                      </div>
                      <StatusBadge status={p.status} />
                    </button>
                  ))}
                </CardBody>
              </Card>
            </>
          )}

          {/* Partnerships */}
          {partnerships.length > 0 && (
            <>
              <SectionHeader title="Partnerships" count={partnerships.length} />
              <Card>
                <CardBody className="space-y-2 !py-3">
                  {partnerships.map((p) => (
                    <button key={p.id} onClick={() => navigate(`/partnerships/${p.id}`)} className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-700">{p.title}</span>
                        {p.share_percentage && <span className="text-xs text-slate-400">({p.share_percentage}%)</span>}
                      </div>
                      <StatusBadge status={p.status} />
                    </button>
                  ))}
                </CardBody>
              </Card>
            </>
          )}

          {/* Beesi */}
          {beesis.length > 0 && (
            <>
              <SectionHeader title="Beesi" count={beesis.length} />
              <Card>
                <CardBody className="space-y-2 !py-3">
                  {beesis.map((b) => (
                    <button key={b.id} onClick={() => navigate(`/beesi/${b.id}`)} className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors text-left">
                      <span className="text-sm font-medium text-slate-700">{b.title}</span>
                      <StatusBadge status={b.status} />
                    </button>
                  ))}
                </CardBody>
              </Card>
            </>
          )}

          {/* Obligations */}
          {obligations.length > 0 && (
            <>
              <SectionHeader title="Money Flow" count={obligations.length}>
                <button onClick={() => navigate("/obligations")} className="text-xs text-indigo-600 hover:underline">View all →</button>
              </SectionHeader>
              <Card>
                <CardBody className="space-y-2 !py-3">
                  {obligations.map((item) => {
                    const ob = item.obligation || item;
                    const remaining = Number(ob.amount) - Number(ob.amount_settled || 0);
                    const isReceivable = ob.obligation_type === "receivable";
                    return (
                      <div key={ob.id} className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 ${isReceivable ? "border-emerald-100 bg-emerald-50/40" : "border-rose-100 bg-rose-50/40"}`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={isReceivable ? "success" : "danger"}>{isReceivable ? "To Receive" : "To Pay"}</Badge>
                            <StatusBadge status={ob.status} />
                          </div>
                          {ob.reason && <p className="text-sm text-slate-600 mt-1 truncate">{ob.reason}</p>}
                          {ob.due_date && <p className="text-xs text-slate-400 mt-0.5">Due: {formatDate(ob.due_date)}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-bold text-slate-800">{formatCurrency(ob.amount)}</div>
                          {ob.status !== "settled" && remaining > 0 && <div className="text-xs text-amber-600">{formatCurrency(remaining)} pending</div>}
                        </div>
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            </>
          )}

          {/* Payment Behavior */}
          {paymentBehavior && paymentBehavior.length > 0 && (
            <>
              <SectionHeader title="Payment Behavior" />
              <Card>
                <CardBody>
                  {paymentBehavior.map((row) => (
                    <div key={row.contact_id} className="space-y-3">
                      <div className="flex items-center justify-between mb-3">
                        <Badge variant={row.score_color === "green" ? "success" : row.score_color === "red" ? "danger" : "warning"}>
                          {row.score}
                        </Badge>
                        <span className="text-sm text-slate-500">
                          Avg repayment rate: <strong className="text-slate-800">{row.avg_payment_rate_pct}%</strong>
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-50 rounded-xl p-3">
                          <p className="text-xs text-slate-400 mb-0.5">Active Loans</p>
                          <p className="font-bold text-slate-800">{row.active_loans}</p>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-3">
                          <p className="text-xs text-slate-400 mb-0.5">Total Principal</p>
                          <p className="font-bold text-slate-800">{formatCurrency(row.total_principal)}</p>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-3">
                          <p className="text-xs text-slate-400 mb-0.5">Total Payments</p>
                          <p className="font-bold text-slate-800">{row.total_payments_made}</p>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-3">
                          <p className="text-xs text-slate-400 mb-0.5">Last Payment</p>
                          <p className="font-bold text-slate-800">{row.last_payment_date ? formatDate(row.last_payment_date) : "Never"}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardBody>
              </Card>
            </>
          )}
        </div>
      </div>
      </PageBody>
    </div>
  );
}
