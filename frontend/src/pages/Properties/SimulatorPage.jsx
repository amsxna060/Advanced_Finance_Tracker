/**
 * SimulatorPage — Route-based full-page wrapper for DealSimulator.
 * Fetches property data and renders the simulator as a proper page.
 */
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import DealSimulator from "../../components/DealSimulator";

export default function SimulatorPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["property", id],
    queryFn: async () => (await api.get(`/api/properties/${id}`)).data,
    retry: 2,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-12 h-12 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !data?.property) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-500 mb-4">Property deal not found.</p>
          <button
            onClick={() => navigate("/properties")}
            className="text-indigo-600 hover:underline text-sm"
          >
            ← Back to Properties
          </button>
        </div>
      </div>
    );
  }

  return (
    <DealSimulator
      property={data.property}
      onClose={() => navigate(`/properties/${id}`)}
    />
  );
}
