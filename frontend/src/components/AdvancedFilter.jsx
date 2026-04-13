import { useState } from "react";

export default function AdvancedFilter({
  filters,
  onFilterChange,
  onReset,
  onSave,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [savedFilters, setSavedFilters] = useState([]);
  const [filterName, setFilterName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const handleSaveFilter = () => {
    if (!filterName.trim()) return;

    const newFilter = {
      name: filterName,
      filters: { ...filters },
      timestamp: new Date().toISOString(),
    };

    const updated = [...savedFilters, newFilter];
    setSavedFilters(updated);
    localStorage.setItem("savedFilters", JSON.stringify(updated));

    setFilterName("");
    setShowSaveDialog(false);

    if (onSave) onSave(newFilter);
  };

  const handleLoadFilter = (filter) => {
    if (onFilterChange) {
      Object.keys(filter.filters).forEach((key) => {
        onFilterChange(key, filter.filters[key]);
      });
    }
  };

  const handleDeleteSavedFilter = (index) => {
    const updated = savedFilters.filter((_, i) => i !== index);
    setSavedFilters(updated);
    localStorage.setItem("savedFilters", JSON.stringify(updated));
  };

  return (
    <div className="bg-white rounded-2xl shadow p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">Filters</h3>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-sm text-indigo-600 hover:text-indigo-800"
          >
            {isExpanded ? "▼ Collapse" : "▶ Expand"}
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowSaveDialog(true)}
            className="px-3 py-1 text-sm text-indigo-600 border border-indigo-600 rounded-xl hover:bg-indigo-50 transition-colors"
          >
            Save Filter
          </button>
          <button
            onClick={onReset}
            className="px-3 py-1 text-sm text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
          >
            Reset All
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="space-y-4">
          {/* Dynamic filter inputs based on props */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.keys(filters).map((key) => (
              <div key={key}>
                <label className="block text-sm font-medium text-slate-700 mb-1 capitalize">
                  {key.replace(/_/g, " ")}
                </label>
                {typeof filters[key] === "boolean" ? (
                  <select
                    value={filters[key] ? "true" : "false"}
                    onChange={(e) =>
                      onFilterChange(key, e.target.value === "true")
                    }
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  >
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                ) : key.includes("date") ? (
                  <input
                    type="date"
                    value={filters[key] || ""}
                    onChange={(e) => onFilterChange(key, e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  />
                ) : key.includes("amount") ||
                  key.includes("min") ||
                  key.includes("max") ? (
                  <input
                    type="number"
                    value={filters[key] || ""}
                    onChange={(e) => onFilterChange(key, e.target.value)}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  />
                ) : (
                  <input
                    type="text"
                    value={filters[key] || ""}
                    onChange={(e) => onFilterChange(key, e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Saved Filters */}
          {savedFilters.length > 0 && (
            <div className="mt-6 pt-6 border-t">
              <h4 className="text-sm font-semibold mb-3">Saved Filters</h4>
              <div className="flex flex-wrap gap-2">
                {savedFilters.map((filter, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-3 py-1 bg-indigo-50 border border-indigo-200 rounded-full"
                  >
                    <button
                      onClick={() => handleLoadFilter(filter)}
                      className="text-sm text-indigo-700 hover:text-indigo-900"
                    >
                      {filter.name}
                    </button>
                    <button
                      onClick={() => handleDeleteSavedFilter(index)}
                      className="text-rose-500 hover:text-rose-700"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Save Filter Dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Save Current Filter</h3>
            <input
              type="text"
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              placeholder="Enter filter name..."
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowSaveDialog(false);
                  setFilterName("");
                }}
                className="px-3.5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveFilter}
                disabled={!filterName.trim()}
                className="px-3.5 py-2.5 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl hover:from-indigo-600 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
