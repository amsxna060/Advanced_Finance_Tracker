import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { PageHero, HeroStat, PageBody, Button } from "../../components/ui";

const STATUS_COLORS = {
  active: "bg-indigo-50 text-indigo-700",
  settled: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-rose-50 text-rose-700",
};

export default function PartnershipList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ search: "", status: "" });

  const { data: partnerships = [], isLoading } = useQuery({
    queryKey: ["partnerships", filters],
    queryFn: async () => {
      const params = {};
      if (filters.search) params.search = filters.search;
      if (filters.status) params.status = filters.status;
      params.limit = 100;
      const res = await api.get("/api/partnerships", { params });
      return res.data;
    },
  });

  const totalCount = partnerships.length;
  const activeCount = partnerships.filter((p) => p.status === "active").length;
  const totalInvested = partnerships.reduce((s, p) => s + parseFloat(p.our_investment || 0), 0);
  const totalReceivedAll = partnerships.reduce((s, p) => s + parseFloat(p.total_received || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title="Partnerships"
        subtitle="Business partnership investments"
        backTo="/dashboard"
        actions={<Button variant="white" onClick={() => navigate("/partnerships/new")}>+ New Partnership</Button>}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <HeroStat label="Total" value={totalCount} accent="indigo" />
          <HeroStat label="Active" value={activeCount} accent="emerald" />
          <HeroStat label="Total Invested" value={formatCurrency(totalInvested)} accent="violet" />
          <HeroStat label="Total Received" value={formatCurrency(totalReceivedAll)} accent="teal" />
        </div>
      </PageHero>

      <PageBody>
        {/* Filters */}
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-4 mb-5 flex flex-wrap gap-3">
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
            placeholder="Search partnerships..."
            className="flex-1 min-w-[200px] px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
          />
          <select
            value={filters.status}
            onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
            className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="settled">Settled</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {(filters.search || filters.status) && (
            <button
              onClick={() => setFilters({ search: "", status: "" })}
              className="px-3.5 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm hover:bg-slate-200 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-2 border-indigo-200 border-t-indigo-600"></div>
          </div>
        ) : partnerships.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-12 text-center">
            <p className="text-slate-400 text-sm mb-3">🤝 No partnerships found.</p>
            <button
              onClick={() => navigate("/partnerships/new")}
              className="text-indigo-600 hover:underline text-sm"
            >
              Create your first partnership →
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {partnerships.map((p) => (
              <div
                key={p.id}
                onClick={() => navigate(`/partnerships/${p.id}`)}
                className="group bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 hover:border-slate-300 hover:shadow-md cursor-pointer transition-all"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">{p.title}</h2>
                    {p.linked_property_deal_id && (
                      <p className="text-xs text-indigo-600 mt-0.5">🏘 Linked to property deal</p>
                    )}
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 text-xs rounded-full font-medium ${STATUS_COLORS[p.status] || "bg-slate-100 text-slate-700"}`}>
                    {p.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <div className="text-xs font-medium text-slate-400">Total Advance</div>
                    <div className="font-medium text-slate-900">{formatCurrency(p.our_investment || 0)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-400">Total Received</div>
                    <div className={`font-medium ${parseFloat(p.total_received) > 0 ? "text-emerald-700" : "text-slate-400"}`}>
                      {formatCurrency(p.total_received || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-400">Partners</div>
                    <div className="font-medium text-slate-900">—</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-400">Created</div>
                    <div className="font-medium text-slate-500 text-xs">{formatDate(p.created_at)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageBody>
    </div>
  );
}
