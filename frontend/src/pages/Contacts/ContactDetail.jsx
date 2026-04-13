import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import {
  Phone,
  MapPin,
  Edit,
  User,
  Building,
  Trash2,
  ArrowUpRight,
  ArrowDownLeft,
  Wallet,
  TrendingUp,
  Shield,
  FileText,
  Handshake,
  ChevronRight,
  PlusCircle,
  ExternalLink,
} from "lucide-react";
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
  SectionHeader,
  PageSkeleton,
} from "../../components/ui";

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

  const { data: obligationsData } = useQuery({
    queryKey: ["contact-obligations", id],
    queryFn: async () => {
      const res = await api.get("/api/obligations", {
        params: { contact_id: id, limit: 50 },
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
        <PageHero
          title={isError ? "Failed to load contact" : "Contact not found"}
          backTo="/contacts"
          compact
        />
        <PageBody>
          <div className="flex flex-col items-center justify-center py-24">
            <h2 className="text-xl font-bold text-slate-800 mb-2">
              {isError ? "Failed to load contact" : "Contact not found"}
            </h2>
            <Button variant="ghost" onClick={() => navigate("/contacts")}>
              ← Back to contacts
            </Button>
          </div>
        </PageBody>
      </div>
    );
  }

  /* helper: net position */
  const netPosition =
    (summary?.total_lent || 0) - (summary?.total_borrowed || 0);
  const collateralCoverage =
    summary?.principal_outstanding > 0
      ? (
          ((summary?.total_collateral_value || 0) /
            summary.principal_outstanding) *
          100
        ).toFixed(0)
      : null;

  /* grouped counts for sections */
  const givenLoans = loans.filter((l) => l.loan_direction === "given");
  const takenLoans = loans.filter((l) => l.loan_direction === "taken");

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ─── HERO ─── */}
      <PageHero
        title={contact.name}
        subtitle={`${contact.relationship_type} · ${contact.contact_type}`}
        backTo="/contacts"
        actions={
          user?.role === "admin" && (
            <>
              <Button
                variant="white"
                icon={Edit}
                onClick={() => navigate(`/contacts/${id}/edit`)}
              >
                Edit
              </Button>
              <Button
                variant="white"
                icon={Trash2}
                onClick={handleDelete}
                disabled={deleteContactMutation.isPending}
              >
                Delete
              </Button>
            </>
          )
        }
      >
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <HeroStat
            label="Total Given Out"
            value={formatCurrency(summary?.total_lent || 0)}
            accent="emerald"
          />
          <HeroStat
            label="Outstanding"
            value={formatCurrency(summary?.total_outstanding || 0)}
            accent="rose"
          />
          <HeroStat
            label="Interest Accrued"
            value={formatCurrency(summary?.total_interest_due || 0)}
            accent="amber"
          />
          <HeroStat
            label="Active Loans"
            value={summary?.active_loans_count || 0}
            accent="indigo"
          />
        </div>
      </PageHero>

      <PageBody>
        {/* ─── TOP ROW: Contact card + Financial snapshot ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* ── Contact Info Card ── */}
          <div className="lg:col-span-4">
            <Card className="h-full">
              <CardBody>
                <div className="flex items-center gap-4 mb-5">
                  <div
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${
                      contact.contact_type === "institution"
                        ? "bg-gradient-to-br from-amber-500 to-orange-600"
                        : "bg-gradient-to-br from-indigo-500 to-violet-600"
                    }`}
                  >
                    {contact.contact_type === "institution" ? (
                      <Building className="w-7 h-7 text-white" />
                    ) : (
                      <User className="w-7 h-7 text-white" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-slate-800 truncate">
                      {contact.name}
                    </h2>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs font-medium bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full capitalize">
                        {contact.relationship_type}
                      </span>
                      <span className="text-xs font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full capitalize">
                        {contact.contact_type}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {contact.phone && (
                    <div className="flex items-center gap-3 py-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                        <Phone className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                          Phone
                        </p>
                        <p className="text-sm font-semibold text-slate-700">
                          {contact.phone}
                        </p>
                      </div>
                    </div>
                  )}
                  {contact.alternate_phone && (
                    <div className="flex items-center gap-3 py-3">
                      <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center shrink-0">
                        <Phone className="w-4 h-4 text-sky-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                          Alternate
                        </p>
                        <p className="text-sm font-semibold text-slate-700">
                          {contact.alternate_phone}
                        </p>
                      </div>
                    </div>
                  )}
                  {(contact.address || contact.city) && (
                    <div className="flex items-start gap-3 py-3">
                      <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0 mt-0.5">
                        <MapPin className="w-4 h-4 text-violet-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                          Address
                        </p>
                        <p className="text-sm font-semibold text-slate-700">
                          {contact.address || contact.city}
                        </p>
                        {contact.address && contact.city && (
                          <p className="text-xs text-slate-400">
                            {contact.city}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {contact.is_handshake && (
                    <div className="flex items-center gap-3 py-3">
                      <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                        <Handshake className="w-4 h-4 text-amber-600" />
                      </div>
                      <div>
                        <span className="text-sm font-semibold text-amber-700">
                          Handshake Deal
                        </span>
                        <p className="text-[10px] text-slate-400">
                          Trust-based arrangement
                        </p>
                      </div>
                    </div>
                  )}
                  {contact.notes && (
                    <div className="flex items-start gap-3 py-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                        <FileText className="w-4 h-4 text-slate-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                          Notes
                        </p>
                        <p className="text-sm text-slate-600 whitespace-pre-line">
                          {contact.notes}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Quick Actions */}
                <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-slate-100">
                  <button
                    onClick={() => navigate(`/contacts/${id}/edit`)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Edit className="w-3 h-3" /> Edit
                  </button>
                  <button
                    onClick={() =>
                      navigate("/loans/new", {
                        state: { contactId: contact.id },
                      })
                    }
                    className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <PlusCircle className="w-3 h-3" /> New Loan
                  </button>
                  <button
                    onClick={() => navigate(`/loans?contact_id=${contact.id}`)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" /> All Loans
                  </button>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* ── Financial Snapshot ── */}
          <div className="lg:col-span-8 space-y-4">
            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <MiniStat
                icon={ArrowUpRight}
                iconBg="bg-emerald-50"
                iconColor="text-emerald-600"
                label="Total Lent"
                value={formatCurrency(summary?.total_lent || 0)}
              />
              <MiniStat
                icon={ArrowDownLeft}
                iconBg="bg-rose-50"
                iconColor="text-rose-600"
                label="Total Borrowed"
                value={formatCurrency(summary?.total_borrowed || 0)}
              />
              <MiniStat
                icon={Wallet}
                iconBg={netPosition >= 0 ? "bg-emerald-50" : "bg-rose-50"}
                iconColor={
                  netPosition >= 0 ? "text-emerald-600" : "text-rose-600"
                }
                label="Net Position"
                value={formatCurrency(Math.abs(netPosition))}
                sub={netPosition >= 0 ? "You owe less" : "You owe more"}
              />
              <MiniStat
                icon={TrendingUp}
                iconBg="bg-amber-50"
                iconColor="text-amber-600"
                label="Interest Accrued"
                value={formatCurrency(summary?.total_interest_due || 0)}
              />
              <MiniStat
                icon={Shield}
                iconBg="bg-violet-50"
                iconColor="text-violet-600"
                label="Collateral"
                value={formatCurrency(summary?.total_collateral_value || 0)}
                sub={
                  collateralCoverage
                    ? `${collateralCoverage}% coverage`
                    : undefined
                }
              />
              <MiniStat
                icon={FileText}
                iconBg="bg-indigo-50"
                iconColor="text-indigo-600"
                label="Total Loans"
                value={summary?.total_loans_count || 0}
                sub={`${summary?.active_loans_count || 0} active`}
              />
            </div>

            {/* Outstanding Breakdown Bar */}
            {(summary?.principal_outstanding > 0 ||
              summary?.total_interest_due > 0) && (
              <Card className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                    Outstanding Breakdown
                  </h4>
                  <span className="text-sm font-bold text-slate-800">
                    {formatCurrency(summary?.total_outstanding || 0)}
                  </span>
                </div>
                <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
                  {summary?.principal_outstanding > 0 && (
                    <div
                      className="bg-indigo-500 transition-all"
                      style={{
                        width: `${(summary.principal_outstanding / summary.total_outstanding) * 100}%`,
                      }}
                    />
                  )}
                  {summary?.total_interest_due > 0 && (
                    <div
                      className="bg-amber-400 transition-all"
                      style={{
                        width: `${(summary.total_interest_due / summary.total_outstanding) * 100}%`,
                      }}
                    />
                  )}
                </div>
                <div className="flex justify-between mt-2 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                    <span className="text-slate-500">Principal</span>
                    <span className="font-bold text-slate-700">
                      {formatCurrency(summary?.principal_outstanding || 0)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span className="text-slate-500">Interest</span>
                    <span className="font-bold text-slate-700">
                      {formatCurrency(summary?.total_interest_due || 0)}
                    </span>
                  </span>
                </div>
              </Card>
            )}

            {/* Payment Behavior (inline) */}
            {paymentBehavior && paymentBehavior.length > 0 && (
              <Card className="p-4">
                {paymentBehavior.map((row) => (
                  <div key={row.contact_id}>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                        Payment Behavior
                      </h4>
                      <Badge
                        variant={
                          row.score_color === "green"
                            ? "success"
                            : row.score_color === "red"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {row.score}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      <div className="bg-slate-50 rounded-xl p-2.5 text-center">
                        <p className="text-[10px] text-slate-400 mb-0.5">
                          Repayment Rate
                        </p>
                        <p className="font-bold text-slate-800 text-sm">
                          {row.avg_payment_rate_pct}%
                        </p>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-2.5 text-center">
                        <p className="text-[10px] text-slate-400 mb-0.5">
                          Active Loans
                        </p>
                        <p className="font-bold text-slate-800 text-sm">
                          {row.active_loans}
                        </p>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-2.5 text-center">
                        <p className="text-[10px] text-slate-400 mb-0.5">
                          Total Payments
                        </p>
                        <p className="font-bold text-slate-800 text-sm">
                          {row.total_payments_made}
                        </p>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-2.5 text-center">
                        <p className="text-[10px] text-slate-400 mb-0.5">
                          Last Payment
                        </p>
                        <p className="font-bold text-slate-800 text-sm">
                          {row.last_payment_date
                            ? formatDate(row.last_payment_date)
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </div>
        </div>

        {/* ─── LOANS ─── */}
        {loans.length > 0 && (
          <div className="mt-8">
            <SectionHeader title="Loans" count={loans.length} />

            {/* Given Loans */}
            {givenLoans.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest mb-2 ml-1">
                  Given ({givenLoans.length})
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {givenLoans.map((l) => (
                    <LoanRow key={l.id} loan={l} navigate={navigate} />
                  ))}
                </div>
              </div>
            )}

            {/* Taken Loans */}
            {takenLoans.length > 0 && (
              <div>
                <p className="text-xs font-bold text-rose-500 uppercase tracking-widest mb-2 ml-1">
                  Taken ({takenLoans.length})
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {takenLoans.map((l) => (
                    <LoanRow key={l.id} loan={l} navigate={navigate} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── BOTTOM SECTIONS: Properties / Partnerships / Beesi / Obligations ─── */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Properties */}
          {properties.length > 0 && (
            <div>
              <SectionHeader title="Properties" count={properties.length} />
              <Card>
                <CardBody className="space-y-1 !py-3">
                  {properties.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => navigate(`/properties/${p.id}`)}
                      className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors text-left group"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-600 transition-colors">
                          {p.title}
                        </span>
                        <Badge
                          variant={p.role === "seller" ? "warning" : "info"}
                        >
                          {p.role}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={p.status} />
                        <ChevronRight className="w-4 h-4 text-slate-300" />
                      </div>
                    </button>
                  ))}
                </CardBody>
              </Card>
            </div>
          )}

          {/* Partnerships */}
          {partnerships.length > 0 && (
            <div>
              <SectionHeader title="Partnerships" count={partnerships.length} />
              <Card>
                <CardBody className="space-y-1 !py-3">
                  {partnerships.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => navigate(`/partnerships/${p.id}`)}
                      className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors text-left group"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-600 transition-colors">
                          {p.title}
                        </span>
                        {p.share_percentage && (
                          <span className="text-xs font-semibold bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">
                            {p.share_percentage}%
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={p.status} />
                        <ChevronRight className="w-4 h-4 text-slate-300" />
                      </div>
                    </button>
                  ))}
                </CardBody>
              </Card>
            </div>
          )}

          {/* Beesi */}
          {beesis.length > 0 && (
            <div>
              <SectionHeader title="Beesi" count={beesis.length} />
              <Card>
                <CardBody className="space-y-1 !py-3">
                  {beesis.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => navigate(`/beesi/${b.id}`)}
                      className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors text-left group"
                    >
                      <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-600 transition-colors">
                        {b.title}
                      </span>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={b.status} />
                        <ChevronRight className="w-4 h-4 text-slate-300" />
                      </div>
                    </button>
                  ))}
                </CardBody>
              </Card>
            </div>
          )}

          {/* Obligations */}
          {obligations.length > 0 && (
            <div>
              <SectionHeader title="Money Flow" count={obligations.length}>
                <button
                  onClick={() => navigate("/obligations")}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  View all →
                </button>
              </SectionHeader>
              <Card>
                <CardBody className="space-y-2 !py-3">
                  {obligations.map((item) => {
                    const ob = item.obligation || item;
                    const remaining =
                      Number(ob.amount) - Number(ob.amount_settled || 0);
                    const isReceivable = ob.obligation_type === "receivable";
                    return (
                      <div
                        key={ob.id}
                        className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 ${
                          isReceivable
                            ? "border-emerald-200 bg-emerald-50/50"
                            : "border-rose-200 bg-rose-50/50"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge
                              variant={isReceivable ? "success" : "danger"}
                            >
                              {isReceivable ? "To Receive" : "To Pay"}
                            </Badge>
                            <StatusBadge status={ob.status} />
                          </div>
                          {ob.reason && (
                            <p className="text-sm text-slate-600 mt-1 truncate">
                              {ob.reason}
                            </p>
                          )}
                          {ob.due_date && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              Due: {formatDate(ob.due_date)}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-bold text-slate-800">
                            {formatCurrency(ob.amount)}
                          </div>
                          {ob.status !== "settled" && remaining > 0 && (
                            <div className="text-xs text-amber-600">
                              {formatCurrency(remaining)} pending
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            </div>
          )}
        </div>
      </PageBody>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────── */

function MiniStat({ icon: Icon, iconBg, iconColor, label, value, sub }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-4 flex items-center gap-3">
      <div
        className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}
      >
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
          {label}
        </p>
        <p className="text-base font-extrabold text-slate-800 truncate">
          {value}
        </p>
        {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

function LoanRow({ loan: l, navigate }) {
  const isGiven = l.loan_direction === "given";
  const capGrown =
    l.capitalization_enabled &&
    l.current_principal != null &&
    l.current_principal > l.principal_amount;
  const showPrincipal = capGrown
    ? l.principal_amount
    : (l.current_principal ?? l.principal_amount);
  const showInterest = capGrown
    ? l.total_outstanding != null
      ? l.total_outstanding - l.principal_amount
      : null
    : l.interest_outstanding;

  return (
    <button
      onClick={() => navigate(`/loans/${l.id}`)}
      className="w-full bg-white rounded-xl border border-slate-200/60 shadow-sm hover:shadow-md hover:border-slate-300/60 transition-all p-4 text-left group"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              isGiven
                ? "bg-emerald-100 text-emerald-700"
                : "bg-rose-100 text-rose-700"
            }`}
          >
            {isGiven ? "Given" : "Taken"}
          </span>
          <span className="text-sm font-semibold text-slate-700 capitalize group-hover:text-indigo-600 transition-colors">
            {l.loan_type?.replace("_", " ")}
          </span>
          {l.interest_rate ? (
            <span className="text-xs font-medium text-slate-400">
              @ {l.interest_rate}%
            </span>
          ) : null}
        </div>
        <StatusBadge status={l.status} />
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-lg font-extrabold text-slate-800">
            {formatCurrency(showPrincipal)}
          </p>
          {showInterest > 0 && (
            <p className="text-xs font-semibold text-amber-600 mt-0.5">
              +{formatCurrency(showInterest)} interest
            </p>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-400 transition-colors" />
      </div>
    </button>
  );
}
