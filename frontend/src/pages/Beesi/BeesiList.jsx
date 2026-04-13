import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { PageHero, HeroStat, PageBody, Button } from "../../components/ui";

export default function BeesiList() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("");

  const { data: beesis = [], isLoading } = useQuery({
    queryKey: ["beesis", statusFilter],
    queryFn: async () => {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      params.limit = 500;
      const res = await api.get("/api/beesi", { params });
      return res.data;
    },
  });

  function scoreBadge(b) {
    const summary = b.summary || {};
    const pl = Number(summary.profit_loss || 0);
    if (!summary.has_withdrawn) return null;
    return pl >= 0 ? (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
        +{formatCurrency(pl)} profit
      </span>
    ) : (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800">
        {formatCurrency(pl)} loss
      </span>
    );
  }

  const totalInvested = beesis.reduce(
    (s, b) => s + Number(b.summary?.total_invested || 0),
    0,
  );
  const totalWithdrawn = beesis.reduce(
    (s, b) => s + Number(b.summary?.total_withdrawn || 0),
    0,
  );
  const activeCount = beesis.filter((b) => b.status === "active").length;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title="Beesi / BC Funds"
        subtitle="Track chit funds, rotating savings pools, and monthly installments"
        backTo="/dashboard"
        actions={
          <Button
            variant="white"
            size="lg"
            onClick={() => navigate("/beesi/new")}
          >
            + New Beesi
          </Button>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <HeroStat label="Total Beesi" value={beesis.length} accent="indigo" />
          <HeroStat label="Active" value={activeCount} accent="emerald" />
          <HeroStat
            label="Total Invested"
            value={formatCurrency(totalInvested)}
            accent="violet"
          />
          <HeroStat
            label="Total Withdrawn"
            value={formatCurrency(totalWithdrawn)}
            accent="amber"
          />
        </div>
      </PageHero>
      <PageBody>
        {/* Filter */}
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-4 mb-5 flex gap-3 items-center">
          <label className="text-xs font-medium text-slate-500">Status:</label>
          {["", "active", "completed", "cancelled"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                statusFilter === s
                  ? "bg-gradient-to-r from-indigo-500 to-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-500/20"
                  : "bg-white text-slate-600 border-slate-200 hover:border-indigo-400"
              }`}
            >
              {s === "" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-slate-500">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600 mb-3"></div>
            <div>Loading…</div>
          </div>
        ) : beesis.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200/60 shadow-sm">
            <div className="text-4xl mb-3">💰</div>
            <p className="text-slate-400 text-sm">
              No Beesi funds found. Add your first one!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {beesis.map((b) => {
              const summary = b.summary || {};
              const paidPct =
                b.tenure_months > 0
                  ? Math.round((summary.months_paid / b.tenure_months) * 100)
                  : 0;
              return (
                <div
                  key={b.id}
                  onClick={() => navigate(`/beesi/${b.id}`)}
                  className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 hover:border-slate-300 hover:shadow-md transition-all cursor-pointer group"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                        {b.title}
                      </h2>
                      <p className="text-sm text-slate-500">
                        Started {formatDate(b.start_date)}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        b.status === "active"
                          ? "bg-emerald-100 text-emerald-700"
                          : b.status === "completed"
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {b.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm mb-3">
                    <div>
                      <div className="text-slate-500">Pot Size</div>
                      <div className="font-semibold">
                        {formatCurrency(b.pot_size)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Base EMI</div>
                      <div className="font-semibold">
                        {formatCurrency(b.base_installment)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Members</div>
                      <div className="font-semibold">{b.member_count}</div>
                    </div>
                  </div>

                  <div className="text-sm text-slate-600 mb-2">
                    Month {summary.months_paid || 0} of {b.tenure_months} paid
                    <div className="w-full bg-slate-100 rounded-full h-1.5 mt-1">
                      <div
                        className="bg-purple-500 h-1.5 rounded-full"
                        style={{ width: `${paidPct}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">
                      Invested:{" "}
                      <span className="font-medium text-slate-800">
                        {formatCurrency(summary.total_invested)}
                      </span>
                    </span>
                    {scoreBadge(b)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageBody>
    </div>
  );
}
