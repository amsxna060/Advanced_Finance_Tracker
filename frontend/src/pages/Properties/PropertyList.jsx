import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { PageHero, HeroStat, PageBody, Button } from "../../components/ui";

function PropertyList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    search: "",
    status: "",
    property_type: "",
  });

  const { data: properties = [], isLoading } = useQuery({
    queryKey: ["properties", filters],
    queryFn: async () => {
      const params = {};
      if (filters.search) params.search = filters.search;
      if (filters.status) params.status = filters.status;
      if (filters.property_type) params.property_type = filters.property_type;
      params.limit = 500;
      const response = await api.get("/api/properties", { params });
      return response.data;
    },
  });

  const handleFilterChange = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const clearFilters = () => {
    setFilters({ search: "", status: "", property_type: "" });
  };

  const stats = useMemo(() => {
    const count = properties.length;
    const totalInvested = properties.reduce((s, p) => s + parseFloat(p.advance_paid || 0), 0);
    const totalRevenue = properties.reduce((s, p) => s + parseFloat(p.total_buyer_value || 0), 0);
    const netProfit = properties.reduce((s, p) => s + parseFloat(p.net_profit || 0), 0);
    return { count, totalInvested, totalRevenue, netProfit };
  }, [properties]);

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title="Properties"
        subtitle="Investment property portfolio"
        backTo="/dashboard"
        actions={
          <Button variant="white" icon={Plus} onClick={() => navigate("/properties/new")}>
            New Property Deal
          </Button>
        }
      >
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <HeroStat label="Total Properties" value={stats.count} accent="indigo" />
          <HeroStat label="Total Invested" value={formatCurrency(stats.totalInvested)} accent="violet" />
          <HeroStat label="Total Revenue" value={formatCurrency(stats.totalRevenue)} accent="emerald" />
          <HeroStat label="Net Profit" value={formatCurrency(stats.netProfit)} accent={stats.netProfit >= 0 ? "teal" : "rose"} />
        </div>
      </PageHero>
      <PageBody>
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-4 sm:p-5 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input type="text" value={filters.search} onChange={(e) => handleFilterChange("search", e.target.value)}
              placeholder="Search title or location..."
              className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all" />
            <select value={filters.status} onChange={(e) => handleFilterChange("status", e.target.value)}
              className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all">
              <option value="">All Status</option>
              <option value="negotiating">Negotiating</option>
              <option value="advance_given">Advance Given</option>
              <option value="buyer_found">Buyer Found</option>
              <option value="registry_done">Registry Done</option>
              <option value="settled">Settled</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select value={filters.property_type} onChange={(e) => handleFilterChange("property_type", e.target.value)}
              className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all">
              <option value="">All Types</option>
              <option value="plot">Plot</option>
              <option value="site">Site</option>
              <option value="flat">Flat</option>
              <option value="commercial">Commercial</option>
              <option value="agricultural">Agricultural</option>
            </select>
            <button onClick={clearFilters}
              className="px-3.5 py-2.5 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 text-sm font-medium transition-colors">
              Clear Filters
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-200 border-t-indigo-600" />
          </div>
        ) : properties.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-16 text-center">
            <div className="text-4xl mb-3">🏠</div>
            <p className="text-slate-400 text-sm">No property deals found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {properties.map((property) => (
              <div key={property.id} onClick={() => navigate(`/properties/${property.id}`)}
                className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 sm:p-6 hover:border-slate-300 hover:shadow-md transition-all cursor-pointer group">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">{property.title}</h2>
                    <p className="text-sm text-slate-500 mt-0.5">{property.location || "No location provided"}</p>
                  </div>
                  <span className="px-3 py-1 text-xs rounded-full bg-indigo-50 text-indigo-700 font-medium capitalize whitespace-nowrap">
                    {property.status.replaceAll("_", " ")}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-5 text-sm">
                  <div>
                    <div className="text-xs font-medium text-slate-400">Deal Type</div>
                    <div className="font-medium text-slate-900 capitalize mt-0.5">{property.deal_type.replaceAll("_", " ")}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-400">Type</div>
                    <div className="font-medium text-slate-900 capitalize mt-0.5">{property.property_type || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-400">Area</div>
                    <div className="font-medium text-slate-900 mt-0.5">{property.total_area_sqft || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-400">Expected Registry</div>
                    <div className="font-medium text-slate-900 mt-0.5">{formatDate(property.expected_registry_date)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-400">Advance Paid</div>
                    <div className="font-medium text-slate-900 mt-0.5">{formatCurrency(property.advance_paid)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-400">Net Profit</div>
                    <div className="font-semibold text-emerald-700 mt-0.5">{formatCurrency(property.net_profit)}</div>
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

export default PropertyList;
