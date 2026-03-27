import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatDate } from "../../lib/utils";

const INITIAL = {
  title: "",
  description: "",
  pot_size: "",
  member_count: "",
  tenure_months: "",
  base_installment: "",
  start_date: "",
  status: "active",
  notes: "",
};

export default function BeesiForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const qc = useQueryClient();
  const [form, setForm] = useState(INITIAL);
  const [error, setError] = useState("");

  useQuery({
    queryKey: ["beesi", id],
    enabled: isEdit,
    queryFn: async () => {
      const res = await api.get(`/api/beesi/${id}`);
      const d = res.data;
      setForm({
        title: d.title || "",
        description: d.description || "",
        pot_size: d.pot_size || "",
        member_count: d.member_count || "",
        tenure_months: d.tenure_months || "",
        base_installment: d.base_installment || "",
        start_date: d.start_date || "",
        status: d.status || "active",
        notes: d.notes || "",
      });
      return d;
    },
  });

  const mutation = useMutation({
    mutationFn: async (data) => {
      if (isEdit) {
        return api.put(`/api/beesi/${id}`, data);
      }
      return api.post("/api/beesi", data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["beesis"] });
      navigate("/beesi");
    },
    onError: (err) => {
      setError(err.response?.data?.detail || "Failed to save Beesi");
    },
  });

  const handleChange = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    mutation.mutate({
      ...form,
      pot_size: Number(form.pot_size),
      member_count: Number(form.member_count),
      tenure_months: Number(form.tenure_months),
      base_installment: Number(form.base_installment),
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto">
        <button onClick={() => navigate("/beesi")} className="text-gray-500 hover:text-gray-900 text-sm mb-4">← Back to Beesi List</button>
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">{isEdit ? "Edit Beesi" : "New Beesi"}</h1>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
              <input name="title" value={form.title} onChange={handleChange} required
                placeholder="e.g. Ramesh BC 2024"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pot Size (₹) *</label>
                <input name="pot_size" type="number" value={form.pot_size} onChange={handleChange} required min="1"
                  placeholder="200000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Base Installment (₹/month) *</label>
                <input name="base_installment" type="number" value={form.base_installment} onChange={handleChange} required min="1"
                  placeholder="10000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Total Members *</label>
                <input name="member_count" type="number" value={form.member_count} onChange={handleChange} required min="2"
                  placeholder="20"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tenure (months) *</label>
                <input name="tenure_months" type="number" value={form.tenure_months} onChange={handleChange} required min="1"
                  placeholder="20"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
                <input name="start_date" type="date" value={form.start_date} onChange={handleChange} required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select name="status" value={form.status} onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea name="description" value={form.description} onChange={handleChange} rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea name="notes" value={form.notes} onChange={handleChange} rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={mutation.isPending}
                className="flex-1 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium disabled:opacity-50"
              >
                {mutation.isPending ? "Saving…" : isEdit ? "Save Changes" : "Create Beesi"}
              </button>
              <button type="button" onClick={() => navigate("/beesi")}
                className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
