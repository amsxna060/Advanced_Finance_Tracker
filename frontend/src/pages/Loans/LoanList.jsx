import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, FileText } from "lucide-react";
import api from "../../lib/api";
import { formatCurrency, formatDate, getLoanStatusColor } from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";
import {
  PageHero, HeroStat, PageBody, Card, CardBody, Button, Badge, StatusBadge,
  SearchInput, Select, Tabs, EmptyState, Table, Th, Td, PageSkeleton,
} from "../../components/ui";

function LoanList() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [tab, setTab] = useState("active");
  const [filters, setFilters] = useState({ direction: "", type: "", contact_id: "", search: "" });

  const { data: contactsData } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => { const r = await api.get("/api/contacts", { params: { limit: 500 } }); return r.data; },
  });

  const { data: loansData, isLoading } = useQuery({
    queryKey: ["loans", filters],
    queryFn: async () => {
      const params = { limit: 500 };
      if (filters.direction) params.direction = filters.direction;
      if (filters.type) params.loan_type = filters.type;
      if (filters.contact_id) params.contact_id = filters.contact_id;
      const r = await api.get("/api/loans", { params });
      return r.data;
    },
  });

  const handleFilterChange = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const handleClearFilters = () => setFilters({ direction: "", type: "", contact_id: "", search: "" });

  const ACTIVE_STATUSES = ["active", "on_hold", "defaulted"];

  const filteredLoans = (loansData || []).filter((loan) => {
    const isArchived = !ACTIVE_STATUSES.includes(loan.status);
    if (tab === "active" && isArchived) return false;
    if (tab === "archived" && !isArchived) return false;
    if (filters.search) {
      const s = filters.search.toLowerCase();
      const matches =
        (loan.contact?.name || "").toLowerCase().includes(s) ||
        (loan.notes || "").toLowerCase().includes(s) ||
        (loan.institution_name || "").toLowerCase().includes(s) ||
        (loan.loan_type || "").toLowerCase().includes(s) ||
        String(loan.id).includes(s) ||
        String(loan.principal_amount || "").includes(s);
      if (!matches) return false;
    }
    return true;
  });

  const activeCount = (loansData || []).filter((l) => ACTIVE_STATUSES.includes(l.status)).length;
  const archivedCount = (loansData || []).filter((l) => !ACTIVE_STATUSES.includes(l.status)).length;

  if (isLoading) return <PageSkeleton />;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero title="Loans" subtitle="Manage all lending activities" actions={<Button variant="white" icon={Plus} onClick={() => navigate("/loans/new")}>New Loan</Button>}>
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-3 gap-3">
          <HeroStat label="Active Loans" value={activeCount} accent="emerald" />
          <HeroStat label="Archived" value={archivedCount} accent="slate" />
          <HeroStat label="Total Loans" value={(loansData || []).length} accent="indigo" />
        </div>
      </PageHero>

      <PageBody>
        {/* Tabs */}
        <Tabs
          tabs={[
            { key: "active", label: "Active", count: activeCount },
            { key: "archived", label: "Archived", count: archivedCount },
          ]}
          active={tab}
          onChange={setTab}
          className="mb-5"
        />

        {/* Filters */}
        <Card className="p-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <SearchInput value={filters.search} onChange={(v) => handleFilterChange("search", v)} placeholder="Contact or notes..." />
            <Select value={filters.direction} onChange={(e) => handleFilterChange("direction", e.target.value)}>
              <option value="">All Directions</option>
              <option value="given">Given (Lent Out)</option>
              <option value="taken">Taken (Borrowed)</option>
            </Select>
            <Select value={filters.type} onChange={(e) => handleFilterChange("type", e.target.value)}>
              <option value="">All Types</option>
              <option value="interest_only">Interest Only</option>
              <option value="emi">EMI</option>
              <option value="short_term">Short Term</option>
            </Select>
            <Select value={filters.contact_id} onChange={(e) => handleFilterChange("contact_id", e.target.value)}>
              <option value="">All Contacts</option>
              {contactsData?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="mt-3 flex justify-between items-center">
            <button onClick={handleClearFilters} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Clear Filters</button>
            <span className="text-xs text-slate-400">{filteredLoans.length} loan(s)</span>
          </div>
        </Card>

        {/* Table */}
        {filteredLoans.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={tab === "archived" ? "No archived loans" : "No active loans found"}
            action={tab === "active" && <Button icon={Plus} onClick={() => navigate("/loans/new")}>Create Loan</Button>}
          />
        ) : (
          <>
            {tab === "archived" && (
              <div className="text-sm text-slate-400 mb-3 flex items-center gap-1.5">🗄️ Showing closed / settled loans</div>
            )}
            <Table>
              <thead>
                <tr>
                  <Th>Contact</Th>
                  <Th>Direction</Th>
                  <Th>Type</Th>
                  <Th>Principal</Th>
                  <Th>Rate</Th>
                  <Th>Start</Th>
                  {tab === "archived" && <Th>Closed</Th>}
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredLoans.map((loan) => (
                  <tr key={loan.id} className="hover:bg-slate-50/60 cursor-pointer transition-colors" onClick={() => navigate(`/loans/${loan.id}`)}>
                    <Td>
                      <div className="text-sm font-semibold text-slate-800">{loan.contact?.name || "Unknown"}</div>
                      {loan.contact?.phone && <div className="text-xs text-slate-400">{loan.contact.phone}</div>}
                    </Td>
                    <Td>
                      <Badge variant={loan.loan_direction === "given" ? "success" : "danger"}>
                        {loan.loan_direction === "given" ? "↑ Given" : "↓ Taken"}
                      </Badge>
                    </Td>
                    <Td className="capitalize">{loan.loan_type === "interest_only" ? "Interest Only" : loan.loan_type === "emi" ? "EMI" : "Short Term"}</Td>
                    <Td className="font-semibold">{formatCurrency(loan.principal_amount)}</Td>
                    <Td>
                      {loan.loan_type === "short_term"
                        ? loan.post_due_interest_rate ? `${parseFloat(loan.post_due_interest_rate).toFixed(2)}%` : "—"
                        : loan.interest_rate ? `${parseFloat(loan.interest_rate).toFixed(2)}%` : "—"}
                    </Td>
                    <Td>{formatDate(loan.disbursed_date)}</Td>
                    {tab === "archived" && <Td>{loan.actual_end_date ? formatDate(loan.actual_end_date) : "—"}</Td>}
                    <Td><StatusBadge status={loan.status} /></Td>
                    <Td>
                      <button onClick={(e) => { e.stopPropagation(); navigate(`/loans/${loan.id}`); }} className="text-indigo-600 hover:text-indigo-800 text-xs font-medium">
                        View →
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </PageBody>
    </div>
  );
}

export default LoanList;
