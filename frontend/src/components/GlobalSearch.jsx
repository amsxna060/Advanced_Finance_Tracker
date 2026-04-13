import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function GlobalSearch() {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchType, setSearchType] = useState("all");
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState({
    contacts: [],
    loans: [],
    properties: [],
    partnerships: [],
    expenses: [],
  });
  const navigate = useNavigate();

  const handleSearch = async (term) => {
    if (!term || term.length < 2) {
      setResults({
        contacts: [],
        loans: [],
        properties: [],
        partnerships: [],
        expenses: [],
      });
      return;
    }

    // Simulate search - in real implementation, this would call backend APIs
    // For now, just show the search interface
    setIsOpen(true);
  };

  const handleResultClick = (type, id) => {
    setIsOpen(false);
    setSearchTerm("");

    const routes = {
      contact: `/contacts/${id}`,
      loan: `/loans/${id}`,
      property: `/properties/${id}`,
      partnership: `/partnerships/${id}`,
      expense: "/expenses",
    };

    navigate(routes[type] || "/");
  };

  return (
    <div className="relative w-full max-w-2xl">
      <div className="flex gap-2">
        <select
          value={searchType}
          onChange={(e) => setSearchType(e.target.value)}
          className="px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
        >
          <option value="all">All</option>
          <option value="contacts">Contacts</option>
          <option value="loans">Loans</option>
          <option value="properties">Properties</option>
          <option value="partnerships">Partnerships</option>
          <option value="expenses">Expenses</option>
        </select>

        <div className="relative flex-1">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              handleSearch(e.target.value);
            }}
            onFocus={() => searchTerm.length >= 2 && setIsOpen(true)}
            placeholder="Search across all modules..."
            className="w-full px-3.5 py-2.5 pl-10 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
          />
          <svg
            className="absolute left-3 top-2.5 h-5 w-5 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      </div>

      {/* Search Results Dropdown */}
      {isOpen && searchTerm.length >= 2 && (
        <div className="absolute z-50 w-full mt-2 bg-white rounded-xl border border-slate-200 shadow-lg max-h-96 overflow-y-auto">
          <div className="p-4">
            <div className="text-sm text-slate-500 mb-2">
              Advanced search functionality coming soon! This will allow you to:
            </div>
            <ul className="text-sm text-slate-600 space-y-1 ml-4 list-disc">
              <li>
                Search across all contacts, loans, properties, and partnerships
              </li>
              <li>Filter by date ranges and amounts</li>
              <li>Use advanced operators (AND, OR, NOT)</li>
              <li>Save frequently used searches</li>
              <li>Export filtered results</li>
            </ul>
            <div className="mt-3 text-xs text-slate-400">
              For now, use the filter options on each module page.
            </div>
          </div>

          <button
            onClick={() => setIsOpen(false)}
            className="w-full px-3.5 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors border-t"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
