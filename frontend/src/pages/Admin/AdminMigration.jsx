import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import api from "../../lib/api";

export default function AdminMigration() {
  const [result, setResult] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteLegacyMutation = useMutation({
    mutationFn: () => api.delete("/admin/delete-legacy"),
    onSuccess: (res) => {
      setResult(res.data);
      setConfirmDelete(false);
      alert("Legacy data deleted successfully!");
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to delete legacy data"),
  });

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Data Migration Admin</h1>
        <p className="text-sm text-slate-500 mb-6">
          One-time cleanup tool. After verifying that all production data has been migrated correctly,
          use this to permanently delete old test/legacy data.
        </p>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-2">Delete Legacy Data</h2>
          <p className="text-sm text-slate-600 mb-4">
            This will permanently delete all properties, partnerships, transactions, and members 
            that were marked as <span className="font-mono bg-slate-100 px-1 rounded">is_legacy=true</span>.
            Contacts will be soft-deleted (hidden but not removed).
          </p>

          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
            <p className="text-sm text-red-700 font-medium">
              ⚠️ This action is irreversible. Make sure you have verified all migrated data before proceeding.
            </p>
          </div>

          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="px-5 py-2.5 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 shadow-sm"
            >
              Delete All Legacy Data
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => deleteLegacyMutation.mutate()}
                disabled={deleteLegacyMutation.isPending}
                className="px-5 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 shadow-sm disabled:opacity-50"
              >
                {deleteLegacyMutation.isPending ? "Deleting..." : "Yes, permanently delete"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200"
              >
                Cancel
              </button>
            </div>
          )}

          {result && (
            <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
              <p className="text-sm font-semibold text-emerald-800 mb-2">Cleanup complete:</p>
              <ul className="text-sm text-emerald-700 space-y-1">
                {Object.entries(result.counts || {}).map(([table, count]) => (
                  <li key={table}>
                    <span className="font-mono">{table}</span>: {count} rows deleted
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
