import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../lib/api";

const LINKED_CONFIGS = {
  loan: {
    endpoint: "/api/loans",
    label: (r) =>
      `#${r.id} — ${r.contact?.name || "?"} — ₹${Number(r.principal_amount || 0).toLocaleString("en-IN")} (${r.loan_direction}, ${r.status})`,
    search: (r, q) => {
      const hay = `${r.id} ${r.contact?.name || ""} ${r.principal_amount || ""} ${r.status || ""} ${r.loan_direction || ""}`.toLowerCase();
      return hay.includes(q);
    },
  },
  property: {
    endpoint: "/api/properties",
    label: (r) =>
      `#${r.id} — ${r.title || r.location || "?"} (${r.status})`,
    search: (r, q) => {
      const hay = `${r.id} ${r.title || ""} ${r.location || ""} ${r.status || ""}`.toLowerCase();
      return hay.includes(q);
    },
  },
  partnership: {
    endpoint: "/api/partnerships",
    label: (r) => `#${r.id} — ${r.title || "?"} (${r.status})`,
    search: (r, q) => {
      const hay = `${r.id} ${r.title || ""} ${r.status || ""}`.toLowerCase();
      return hay.includes(q);
    },
  },
  beesi: {
    endpoint: "/api/beesi",
    label: (r) =>
      `#${r.id} — ${r.title || "?"} — ₹${Number(r.base_installment || 0).toLocaleString("en-IN")}/mo (${r.status})`,
    search: (r, q) => {
      const hay = `${r.id} ${r.title || ""} ${r.status || ""}`.toLowerCase();
      return hay.includes(q);
    },
  },
  expense: {
    endpoint: "/api/expenses",
    label: (r) =>
      `#${r.id} — ${r.category || "General"} — ₹${Number(r.amount || 0).toLocaleString("en-IN")}`,
    search: (r, q) => {
      const hay = `${r.id} ${r.category || ""} ${r.amount || ""} ${r.description || ""}`.toLowerCase();
      return hay.includes(q);
    },
  },
  obligation: {
    endpoint: "/api/obligations",
    label: (r) => {
      const ob = r.obligation || r;
      return `#${ob.id} — ${r.contact?.name || "?"} — ₹${Number(ob.amount || 0).toLocaleString("en-IN")} (${ob.status})`;
    },
    search: (r, q) => {
      const ob = r.obligation || r;
      const hay = `${ob.id} ${r.contact?.name || ""} ${ob.reason || ""} ${ob.amount || ""}`.toLowerCase();
      return hay.includes(q);
    },
    getId: (r) => (r.obligation || r).id,
  },
};

/**
 * Searchable dropdown for selecting a linked record (loan, property, partnership, etc).
 * @param {string} linkedType - "loan" | "property" | "partnership" | "beesi" | "expense" | "obligation"
 * @param {string} value - current linked_id value (as string)
 * @param {function} onChange - called with the selected id (as string)
 * @param {string} className - optional tailwind classes
 */
export default function LinkedRecordSelect({
  linkedType,
  value,
  onChange,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  const config = LINKED_CONFIGS[linkedType];

  const { data: records = [] } = useQuery({
    queryKey: ["linked-records", linkedType],
    queryFn: async () => {
      if (!config) return [];
      const res = await api.get(config.endpoint);
      return res.data;
    },
    enabled: !!config,
    staleTime: 30_000,
  });

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!config) return null;

  const getId = config.getId || ((r) => r.id);
  const q = search.toLowerCase();
  const filtered = q
    ? records.filter((r) => config.search(r, q))
    : records;

  // Find currently selected record
  const selected = value
    ? records.find((r) => String(getId(r)) === String(value))
    : null;

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className="w-full px-3 py-1.5 border border-gray-300 rounded bg-white cursor-pointer text-sm min-h-[34px] flex items-center"
      >
        {selected ? (
          <span className="truncate text-gray-800">
            {config.label(selected)}
          </span>
        ) : (
          <span className="text-gray-400">Search {linkedType}…</span>
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-hidden">
          <div className="p-2 border-b">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${linkedType}…`}
              className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
            />
          </div>
          <div className="overflow-y-auto max-h-48">
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setSearch("");
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-red-50"
              >
                ✕ Clear selection
              </button>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-sm text-gray-400 text-center">
                No records found
              </div>
            ) : (
              filtered.slice(0, 50).map((r) => {
                const rid = String(getId(r));
                return (
                  <button
                    type="button"
                    key={rid}
                    onClick={() => {
                      onChange(rid);
                      setSearch("");
                      setOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${
                      String(value) === rid
                        ? "bg-blue-50 text-blue-700 font-medium"
                        : "text-gray-700"
                    }`}
                  >
                    {config.label(r)}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
