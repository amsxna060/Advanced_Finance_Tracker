import React, { forwardRef } from "react";
import { cn } from "../lib/utils";
import { ChevronLeft, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

/* ═══════════════════════════════════════════════════════════════════════
   DESIGN SYSTEM — Shared modern components used across all pages.
   Theme: Slate/indigo palette, rounded-2xl cards, smooth transitions.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── PAGE SHELL ─────────────────────────────────────────────────────── */
export function PageContainer({ children, className }) {
  return (
    <div className={cn("min-h-screen bg-slate-50", className)}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {children}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, backTo, children }) {
  const navigate = useNavigate();
  return (
    <div className="mb-6 sm:mb-8">
      {backTo && (
        <button
          onClick={() => navigate(backTo)}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 transition-colors mb-3"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
        </div>
        {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
      </div>
    </div>
  );
}

/* ── CARDS ───────────────────────────────────────────────────────────── */
export function Card({ children, className, onClick, hover = false }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-white rounded-2xl border border-slate-200/60 shadow-sm",
        hover && "hover:shadow-md hover:border-slate-300/60 transition-all cursor-pointer",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }) {
  return <div className={cn("px-5 py-4 border-b border-slate-100", className)}>{children}</div>;
}

export function CardBody({ children, className }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

/* ── STAT CARD ──────────────────────────────────────────────────────── */
export function StatCard({ label, value, sub, accent = "indigo", icon: Icon, className }) {
  const accents = {
    emerald: "border-l-emerald-500 bg-emerald-50/30",
    rose: "border-l-rose-500 bg-rose-50/30",
    violet: "border-l-violet-500 bg-violet-50/30",
    amber: "border-l-amber-500 bg-amber-50/30",
    sky: "border-l-sky-500 bg-sky-50/30",
    indigo: "border-l-indigo-500 bg-indigo-50/30",
    teal: "border-l-teal-500 bg-teal-50/30",
    slate: "border-l-slate-400 bg-slate-50/30",
  };
  return (
    <div className={cn("rounded-2xl border border-slate-200/60 shadow-sm border-l-4 px-5 py-4", accents[accent], className)}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
        {Icon && <Icon className="w-4 h-4 text-slate-300" />}
      </div>
      <p className="text-xl sm:text-2xl font-extrabold text-slate-800 mt-1 tracking-tight">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ── PAGE HERO (Dashboard-style dark gradient header) ────────────────── */
export function PageHero({ title, subtitle, backTo, actions, compact = false, children }) {
  const navigate = useNavigate();
  return (
    <div className={cn(
      "relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-800 px-4 sm:px-6 lg:px-8",
      compact ? "pt-5 pb-8" : "pt-5 sm:pt-6 pb-10 sm:pb-12",
    )}>
      <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-16 w-80 h-80 rounded-full bg-violet-600/10 blur-3xl" />
      <div className="relative max-w-7xl mx-auto">
        {backTo && (
          <button onClick={() => navigate(backTo)} className="inline-flex items-center gap-1 text-sm text-indigo-300/60 hover:text-indigo-200 transition-colors mb-2">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{title}</h1>
            {subtitle && <p className="text-indigo-300/70 text-sm mt-1">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── HERO STAT (glass card for inside PageHero) ──────────────────────── */
export function HeroStat({ label, value, sub, accent }) {
  const borders = {
    emerald: "border-l-2 border-l-emerald-400",
    rose: "border-l-2 border-l-rose-400",
    indigo: "border-l-2 border-l-indigo-400",
    amber: "border-l-2 border-l-amber-400",
    violet: "border-l-2 border-l-violet-400",
    teal: "border-l-2 border-l-teal-400",
    sky: "border-l-2 border-l-sky-400",
  };
  return (
    <div className={cn("bg-white/[0.07] backdrop-blur-xl border border-white/[0.12] rounded-2xl px-5 py-4", accent && borders[accent])}>
      <p className="text-indigo-300/80 text-[11px] font-semibold uppercase tracking-widest">{label}</p>
      <p className="text-white text-xl font-extrabold mt-1 tracking-tight">{value}</p>
      {sub && <p className="text-indigo-300/60 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

/* ── PAGE BODY (content area below PageHero) ─────────────────────────── */
export function PageBody({ children, className }) {
  return (
    <div className={cn("max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-5 pb-16 relative z-10", className)}>
      {children}
    </div>
  );
}

/* ── BUTTONS ─────────────────────────────────────────────────────────── */
const buttonVariants = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-500/20 active:scale-[0.98]",
  white: "bg-white text-slate-800 hover:bg-slate-50 shadow-sm active:scale-[0.98]",
  secondary: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 shadow-sm active:scale-[0.98]",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-800",
  "ghost-light": "text-indigo-200/80 hover:bg-white/10 hover:text-white",
  danger: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm shadow-rose-500/20 active:scale-[0.98]",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-500/20 active:scale-[0.98]",
};

const buttonSizes = {
  xs: "px-2.5 py-1 text-xs gap-1",
  sm: "px-3 py-1.5 text-sm gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
  lg: "px-5 py-2.5 text-base gap-2",
};

export function Button({ variant = "primary", size = "md", className, children, icon: Icon, ...props }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center font-medium rounded-xl transition-all duration-150",
        buttonVariants[variant],
        buttonSizes[size],
        props.disabled && "opacity-50 cursor-not-allowed pointer-events-none",
        className,
      )}
      {...props}
    >
      {Icon && <Icon className={cn(size === "xs" || size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4")} />}
      {children}
    </button>
  );
}

/* ── FORM ELEMENTS ───────────────────────────────────────────────────── */
export const Input = forwardRef(({ label, error, className, labelClassName, ...props }, ref) => (
  <div className="space-y-1.5">
    {label && <label className={labelClassName || "block text-sm font-medium text-slate-700"}>{label}</label>}
    <input
      ref={ref}
      className={cn(
        "w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm text-slate-800 placeholder:text-slate-400",
        "focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all",
        error ? "border-rose-300 focus:ring-rose-500/40 focus:border-rose-400" : "border-slate-200",
        className,
      )}
      {...props}
    />
    {error && <p className="text-xs text-rose-500">{error}</p>}
  </div>
));
Input.displayName = "Input";

export const Select = forwardRef(({ label, error, className, children, labelClassName, ...props }, ref) => (
  <div className="space-y-1.5">
    {label && <label className={labelClassName || "block text-sm font-medium text-slate-700"}>{label}</label>}
    <select
      ref={ref}
      className={cn(
        "w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm text-slate-800",
        "focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all",
        error ? "border-rose-300" : "border-slate-200",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    {error && <p className="text-xs text-rose-500">{error}</p>}
  </div>
));
Select.displayName = "Select";

export const Textarea = forwardRef(({ label, error, className, labelClassName, ...props }, ref) => (
  <div className="space-y-1.5">
    {label && <label className={labelClassName || "block text-sm font-medium text-slate-700"}>{label}</label>}
    <textarea
      ref={ref}
      className={cn(
        "w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm text-slate-800 placeholder:text-slate-400",
        "focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all resize-none",
        error ? "border-rose-300" : "border-slate-200",
        className,
      )}
      {...props}
    />
    {error && <p className="text-xs text-rose-500">{error}</p>}
  </div>
));
Textarea.displayName = "Textarea";

/* ── BADGE ───────────────────────────────────────────────────────────── */
const badgeVariants = {
  default: "bg-slate-100 text-slate-600",
  primary: "bg-indigo-50 text-indigo-700",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-rose-50 text-rose-700",
  info: "bg-sky-50 text-sky-700",
  purple: "bg-violet-50 text-violet-700",
};

export function Badge({ variant = "default", children, className, dot = false }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold", badgeVariants[variant], className)}>
      {dot && <span className={cn("w-1.5 h-1.5 rounded-full", variant === "success" ? "bg-emerald-500" : variant === "danger" ? "bg-rose-500" : variant === "warning" ? "bg-amber-500" : "bg-slate-400")} />}
      {children}
    </span>
  );
}

/* ── STATUS BADGE (loan, obligation, etc.) ───────────────────────────── */
const STATUS_MAP = {
  active: { variant: "success", label: "Active" },
  closed: { variant: "default", label: "Closed" },
  defaulted: { variant: "danger", label: "Defaulted" },
  on_hold: { variant: "warning", label: "On Hold" },
  pending: { variant: "warning", label: "Pending" },
  partial: { variant: "info", label: "Partial" },
  settled: { variant: "success", label: "Settled" },
  cancelled: { variant: "default", label: "Cancelled" },
  completed: { variant: "success", label: "Completed" },
  ongoing: { variant: "primary", label: "Ongoing" },
  sold: { variant: "info", label: "Sold" },
};

export function StatusBadge({ status, className }) {
  const m = STATUS_MAP[status] || { variant: "default", label: status };
  return <Badge variant={m.variant} dot className={className}>{m.label}</Badge>;
}

/* ── MODAL ───────────────────────────────────────────────────────────── */
export function Modal({ open, onClose, title, children, size = "md", className }) {
  if (!open) return null;
  const sizes = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl", full: "max-w-6xl" };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={cn("relative bg-white rounded-2xl shadow-2xl w-full animate-slideDown overflow-hidden", sizes[size], className)}>
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h3 className="text-lg font-bold text-slate-800">{title}</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="px-6 py-5 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/* ── TABS ─────────────────────────────────────────────────────────────── */
export function Tabs({ tabs, active, onChange, className }) {
  return (
    <div className={cn("flex gap-1 p-1 bg-slate-100 rounded-xl w-fit", className)}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150",
            active === t.key
              ? "bg-white text-slate-800 shadow-sm"
              : "text-slate-500 hover:text-slate-700",
          )}
        >
          {t.label}
          {t.count != null && (
            <span className={cn("ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold", active === t.key ? "bg-indigo-50 text-indigo-600" : "bg-slate-200 text-slate-500")}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ── EMPTY STATE ─────────────────────────────────────────────────────── */
export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      {Icon && (
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <Icon className="w-8 h-8 text-slate-300" />
        </div>
      )}
      <h3 className="text-base font-semibold text-slate-700 mb-1">{title}</h3>
      {description && <p className="text-sm text-slate-400 text-center max-w-sm mb-4">{description}</p>}
      {action}
    </div>
  );
}

/* ── TABLE ───────────────────────────────────────────────────────────── */
export function Table({ children, className }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200/60 bg-white shadow-sm">
      <table className={cn("min-w-full divide-y divide-slate-100", className)}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }) {
  return (
    <th className={cn("px-5 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-50/60", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className }) {
  return (
    <td className={cn("px-5 py-3.5 text-sm text-slate-700", className)}>{children}</td>
  );
}

/* ── SEARCH INPUT ───────────────────────────────────────────────────── */
export function SearchInput({ value, onChange, placeholder = "Search...", className }) {
  return (
    <div className={cn("relative", className)}>
      <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
      />
    </div>
  );
}

/* ── INFO ROW (for detail pages) ─────────────────────────────────────── */
export function InfoRow({ label, value, className }) {
  return (
    <div className={cn("flex justify-between items-center py-2.5 border-b border-slate-50 last:border-0", className)}>
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-800 text-right">{value ?? "-"}</span>
    </div>
  );
}

/* ── SECTION HEADER ──────────────────────────────────────────────────── */
export function SectionHeader({ title, count, children, className }) {
  return (
    <div className={cn("flex items-center justify-between mb-4 mt-8", className)}>
      <div className="flex items-center gap-2.5">
        <span className="w-1.5 h-5 rounded-full bg-indigo-500" />
        <h2 className="text-base font-bold text-slate-700">{title}</h2>
        {count != null && (
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

/* ── LOADING SKELETON ────────────────────────────────────────────────── */
export function PageSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50 animate-pulse">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="h-8 w-48 bg-slate-200 rounded-lg mb-2" />
        <div className="h-4 w-64 bg-slate-100 rounded mb-8" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-2xl border border-slate-200/60" />)}
        </div>
        <div className="h-64 bg-white rounded-2xl border border-slate-200/60" />
      </div>
    </div>
  );
}

/* ── GREYED-OUT WRAPPER (for deprecated features) ────────────────────── */
export function GreyedOut({ label = "Under Review", children }) {
  return (
    <div className="relative">
      <div className="opacity-40 pointer-events-none select-none blur-[0.5px]">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-slate-800/80 backdrop-blur-sm text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg">
          {label}
        </div>
      </div>
    </div>
  );
}
