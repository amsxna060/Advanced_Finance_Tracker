/**
 * DealSimulator — Sandboxed "What-if" playground for a PropertyDeal.
 * Renders as a full page (not a modal). Route: /properties/:id/simulator
 *
 * SAFETY GUARANTEE: never mutates property_deals or property_transactions.
 * The only backend writes are to the isolated property_simulations table.
 */

import { useState, useMemo, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import api from "../lib/api";
import { formatCurrency } from "../lib/utils";

// ── Constants ──────────────────────────────────────────────────────────────────────────────
const OPPORTUNITY_BASELINE_PCT = 18;

// ── Helpers ──────────────────────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function monthsBetween(d1Str, d2Str) {
  if (!d1Str || !d2Str) return null;
  const ms = new Date(d2Str) - new Date(d1Str);
  return Math.max(1, Math.round(ms / (30.44 * 24 * 3600 * 1000)));
}

function formatMonths(m) {
  if (!m || m <= 0) return "—";
  if (m < 12) return `${m} month${m !== 1 ? "s" : ""}`;
  const y = Math.floor(m / 12), mo = m % 12;
  return mo === 0 ? `${y} yr${y !== 1 ? "s" : ""}` : `${y}yr ${mo}mo`;
}

// ── Core financial engine ──────────────────────────────────────────────────────────────────────────────
function computeMetrics({
  totalInvestment,
  totalArea,
  targetPricePerSqft,
  activeHoldingMonths,
  purchaseAndHold,
  registryCostPerSqft,
  annualAppreciationPct,
  targetAnnualProfitPct,
  myShareFrac,
  myInvested,
  extraBrokerage = 0,
}) {
  const m = Math.max(activeHoldingMonths, 1);

  const registryTotal   = purchaseAndHold ? registryCostPerSqft * totalArea : 0;
  const effectiveInvest = totalInvestment + registryTotal + extraBrokerage;

  const appreciatedPx = purchaseAndHold
    ? targetPricePerSqft * Math.pow(1 + annualAppreciationPct / 100, m / 12)
    : targetPricePerSqft;

  const netProceeds = appreciatedPx * totalArea;
  const absProfit   = netProceeds - effectiveInvest;
  const absRoiPct   = effectiveInvest > 0 ? (absProfit / effectiveInvest) * 100 : 0;
  const annRoiPct   = (absRoiPct / m) * 12;

  const myCapital =
    myShareFrac < 1
      ? effectiveInvest * myShareFrac
      : myInvested > 0
      ? myInvested
      : effectiveInvest;
  const myProfit    = absProfit * myShareFrac;
  const myAnnRoiPct = myCapital > 0 ? (myProfit / myCapital / m) * 12 * 100 : annRoiPct;

  let breakevenPx = null;
  if (targetAnnualProfitPct != null && totalArea > 0 && effectiveInvest > 0) {
    const neededAbsRoi   = (targetAnnualProfitPct * m) / 12;
    const neededProfit   = (neededAbsRoi / 100) * effectiveInvest;
    const neededProceeds = effectiveInvest + neededProfit;
    breakevenPx = purchaseAndHold
      ? neededProceeds / totalArea / Math.pow(1 + annualAppreciationPct / 100, m / 12)
      : neededProceeds / totalArea;
  }

  return {
    effectiveInvest, netProceeds, absProfit, absRoiPct, annRoiPct,
    appreciatedPx, breakevenPx, registryTotal, myCapital, myProfit, myAnnRoiPct,
  };
}

// ── Quick JS AI verdict (shown before Gemini API call) ────────────────────────────────────────────────────────────────
function quickVerdict({ annRoiPct, absProfit, holdingMonths, purchaseAndHold, annualAppreciationPct }) {
  if (purchaseAndHold) {
    if (annualAppreciationPct >= 12 && holdingMonths >= 18)
      return { verdict: "REGISTRY", color: "emerald", icon: "������",
        reason: `${annualAppreciationPct}% p.a. appreciation over ${formatMonths(holdingMonths)} comfortably offsets registry cost. Annualized ROI: ${annRoiPct.toFixed(1)}%.` };
    if (annualAppreciationPct < 8)
      return { verdict: "HOLD", color: "amber", icon: "⏳",
        reason: `${annualAppreciationPct}% appreciation is modest. Registry investment may not beat lending at ${OPPORTUNITY_BASELINE_PCT}% within this window.` };
    return { verdict: "REGISTRY", color: "emerald", icon: "������",
      reason: `${annualAppreciationPct}% p.a. over ${formatMonths(holdingMonths)} supports long-term ownership. Annualized ROI: ${annRoiPct.toFixed(1)}%.` };
  }
  if (absProfit <= 0)
    return { verdict: "HOLD", color: "rose", icon: "������",
      reason: "Selling now locks in a loss. Hold for a better buyer or improved market conditions." };
  if (annRoiPct >= OPPORTUNITY_BASELINE_PCT + 5)
    return { verdict: "SELL", color: "emerald", icon: "✅",
      reason: `${annRoiPct.toFixed(1)}% annualized ROI beats the ${OPPORTUNITY_BASELINE_PCT}% baseline by ${(annRoiPct - OPPORTUNITY_BASELINE_PCT).toFixed(1)}pp. Good time to close.` };
  if (annRoiPct < OPPORTUNITY_BASELINE_PCT && holdingMonths > 12)
    return { verdict: "SELL", color: "amber", icon: "⚠️",
      reason: `Capital tied up for ${formatMonths(holdingMonths)} at only ${annRoiPct.toFixed(1)}% — below ${OPPORTUNITY_BASELINE_PCT}% lending baseline. Consider closing and redeploying.` };
  if (annRoiPct >= OPPORTUNITY_BASELINE_PCT)
    return { verdict: "SELL", color: "emerald", icon: "✅",
      reason: `${annRoiPct.toFixed(1)}% annualized ROI meets the ${OPPORTUNITY_BASELINE_PCT}% baseline. Proceed to close.` };
  return { verdict: "HOLD", color: "amber", icon: "⏳",
    reason: "ROI is below baseline but holding window is short. Monitor a few more months before discounting." };
}

// ── Shared UI primitives ──────────────────────────────────────────────────────────────────────────────
function SimSection({ title, icon, children, className = "" }) {
  return (
    <div className={`bg-white border border-slate-200/60 rounded-2xl overflow-hidden shadow-sm ${className}`}>
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
        {icon && <span className="text-sm">{icon}</span>}
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

const METRIC_ACCENT = {
  cyan:    "bg-sky-50 border-sky-200 text-sky-700",
  amber:   "bg-amber-50 border-amber-200 text-amber-700",
  emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
  rose:    "bg-rose-50 border-rose-200 text-rose-700",
  violet:  "bg-violet-50 border-violet-200 text-violet-700",
  indigo:  "bg-indigo-50 border-indigo-200 text-indigo-700",
  slate:   "bg-slate-50 border-slate-200 text-slate-700",
};

function SimMetric({ label, value, sub, accent = "slate", className = "" }) {
  const cls = METRIC_ACCENT[accent] || METRIC_ACCENT.slate;
  const [bg, border, text] = cls.split(" ");
  return (
    <div className={`rounded-xl border p-3.5 ${bg} ${border} ${className}`}>
      <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 mb-1">{label}</p>
      <p className={`text-base font-bold tabular-nums ${text}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function RangeSlider({ label, value, min, max, step = 1, format: fmt, onChange, disabled }) {
  const pct = clamp(((value - min) / (max - min)) * 100, 0, 100);
  return (
    <div className={disabled ? "opacity-40 pointer-events-none select-none" : ""}>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</span>
        <span className="text-sm font-bold text-slate-800 tabular-nums">{fmt ? fmt(value) : value}</span>
      </div>
      <div className="relative h-5 flex items-center">
        <div className="absolute left-0 right-0 h-1.5 rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-indigo-500 transition-all duration-150" style={{ width: `${pct}%` }} />
        </div>
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="relative w-full h-1.5 appearance-none bg-transparent cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600
            [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md
            [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-indigo-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white"
        />
      </div>
      <div className="flex justify-between text-[9px] text-slate-400 mt-0.5 select-none">
        <span>{fmt ? fmt(min) : min}</span>
        <span>{fmt ? fmt(max) : max}</span>
      </div>
    </div>
  );
}

function Toggle({ label, description, checked, onChange }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <button
        role="switch" aria-checked={checked} type="button"
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? "bg-indigo-500" : "bg-slate-200"}`}
      >
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
      </button>
      <div>
        <p className="text-xs font-semibold text-slate-800">{label}</p>
        {description && <p className="text-[10px] text-slate-500 mt-0.5">{description}</p>}
      </div>
    </label>
  );
}

// ── Main component ────────────────────────────────────────────────────────────────────────────────────
export default function DealSimulator({ property, onClose }) {
  const propertyId = property.id;

  // ── Seed from live property snapshot (read-only clone) ─────────────────────────────────
  const totalArea   = parseFloat(property.total_area_sqft   || 0);
  const totalSeller = parseFloat(property.total_seller_value || 0);
  const brokerComm  = parseFloat(property.broker_commission  || 0);
  const otherExp    = parseFloat(property.other_expenses     || 0);
  const advancePaid = parseFloat(property.advance_paid       || 0);
  const totalInvest = totalSeller + brokerComm + otherExp;
  const breakevenBase = totalArea > 0 ? totalInvest / totalArea : 0;
  const sellerRate  = parseFloat(property.seller_rate_per_sqft || 0);

  const myShare    = parseFloat(property.my_share_percentage || 0);
  const myInvested = parseFloat(property.my_investment || 0);
  const myShareFrac = myShare > 0 ? myShare / 100 : 1;

  // ── Date-constrained flip holding window ───────────────────────────────────────────
  const naturalFlipMonths = monthsBetween(property.negotiating_date, property.expected_registry_date);
  const maxFlipMonths     = naturalFlipMonths ? Math.min(naturalFlipMonths + 3, 36) : 24;
  const defaultFlip       = naturalFlipMonths ?? 6;

  // ── Price slider bounds ─────────────────────────────────────────────────────────────────────────────────
  const priceRef  = breakevenBase > 0 ? breakevenBase : (sellerRate > 0 ? sellerRate : 500);
  const priceMin  = Math.max(100, Math.floor(priceRef * 0.7));
  const priceMax  = Math.ceil(priceRef * 3);
  const priceStep = Math.max(1, Math.floor((priceMax - priceMin) / 300));
  const defaultPx = Math.ceil(priceRef * 1.15);

  // ── State ────────────────────────────────────────────────────────────────────────────────────────
  const [flipMonths,         setFlipMonths]         = useState(defaultFlip);
  const [postPurchaseMonths, setPostPurchaseMonths] = useState(24);
  const [targetPx,           setTargetPx]           = useState(defaultPx);
  const [pxText,             setPxText]             = useState(String(defaultPx));
  const [targetAnnualPct,    setTargetAnnualPct]    = useState(15);
  const [purchaseAndHold,    setPurchaseAndHold]    = useState(false);
  const [registryCostPx,     setRegistryCostPx]     = useState(70);
  const [appreciationPct,    setAppreciationPct]    = useState(12);
  const [extraBrokerage,     setExtraBrokerage]     = useState(0);
  const [extraBrokerageText, setExtraBrokerageText] = useState("0");
  const [lendingRatePct,     setLendingRatePct]     = useState(18);
  const [scenarioName,       setScenarioName]       = useState("");
  const [loadedSimId,        setLoadedSimId]        = useState(null);
  const [aiData,             setAiData]             = useState(null);

  const activeMonths = purchaseAndHold ? postPurchaseMonths : flipMonths;

  // ── Price input sync ────────────────────────────────────────────────────────────────────────────────────
  function handlePriceSlider(v) { setTargetPx(v); setPxText(String(v)); }
  function handlePriceText(raw) {
    setPxText(raw);
    const n = parseFloat(raw);
    if (!isNaN(n) && n > 0) setTargetPx(Math.round(n));
  }
  function commitPriceText() { if (isNaN(parseFloat(pxText)) || parseFloat(pxText) <= 0) setPxText(String(targetPx)); }

  function handleBrokerageText(raw) {
    setExtraBrokerageText(raw);
    const n = parseFloat(raw);
    setExtraBrokerage(!isNaN(n) && n >= 0 ? n : 0);
  }

  // ── Metrics ────────────────────────────────────────────────────────────────────────────────────────
  const m = useMemo(
    () => computeMetrics({
      totalInvestment: totalInvest, totalArea, targetPricePerSqft: targetPx,
      activeHoldingMonths: activeMonths, purchaseAndHold,
      registryCostPerSqft: registryCostPx, annualAppreciationPct: appreciationPct,
      targetAnnualProfitPct: targetAnnualPct, myShareFrac, myInvested,
      extraBrokerage,
    }),
    [totalInvest, totalArea, targetPx, activeMonths, purchaseAndHold,
     registryCostPx, appreciationPct, targetAnnualPct, myShareFrac, myInvested, extraBrokerage]
  );

  const qv = useMemo(
    () => quickVerdict({ annRoiPct: m.annRoiPct, absProfit: m.absProfit,
      holdingMonths: activeMonths, purchaseAndHold, annualAppreciationPct: appreciationPct }),
    [m, activeMonths, purchaseAndHold, appreciationPct]
  );

  // ── Gemini AI mutation ─────────────────────────────────────────────────────────────────────────────────
  const aiMut = useMutation({
    mutationFn: async () => (await api.post(
      `/api/properties/${propertyId}/simulations/ai-insight`,
      {
        holding_months: activeMonths,
        target_price_per_sqft: targetPx,
        purchase_and_hold: purchaseAndHold,
        annual_appreciation_pct: appreciationPct,
        brokerage_amount: extraBrokerage,
        absolute_profit: m.absProfit,
        absolute_roi_pct: m.absRoiPct,
        annualized_roi_pct: m.annRoiPct,
        breakeven_price_per_sqft: m.breakevenPx ?? 0,
        my_capital: m.myCapital,
        my_profit: m.myProfit,
        my_ann_roi_pct: m.myAnnRoiPct,
        effective_invest: m.effectiveInvest,
        lending_rate_pct: lendingRatePct,
      }
    )).data,
    onSuccess: data => setAiData(data),
    onError: err => setAiData({
      verdict: "ERROR",
      reasoning: err?.response?.data?.detail || "AI service is unavailable. Check GEMINI_API_KEY.",
    }),
  });

  // ── Saved simulations ───────────────────────────────────────────────────────────────────────────────
  const { data: savedSims = [], refetch } = useQuery({
    queryKey: ["simulations", propertyId],
    queryFn: async () => (await api.get(`/api/properties/${propertyId}/simulations`)).data,
  });

  const saveMut = useMutation({
    mutationFn: async () => (await api.post(`/api/properties/${propertyId}/simulations`, {
      name: scenarioName.trim() || `Scenario — ${new Date().toLocaleDateString("en-IN")}`,
      payload: {
        holding_months: activeMonths,
        target_price_per_sqft: targetPx,
        target_annual_profit_pct: targetAnnualPct,
        purchase_and_hold: purchaseAndHold,
        registry_cost_per_sqft: registryCostPx,
        annual_appreciation_pct: appreciationPct,
        absolute_profit: m.absProfit,
        absolute_roi_pct: m.absRoiPct,
        annualized_roi_pct: m.annRoiPct,
        breakeven_price_per_sqft: m.breakevenPx,
        ai_verdict: (aiData ?? qv).verdict,
        ai_reasoning: (aiData ?? qv).reason ?? (aiData ?? qv).reasoning,
      },
    })).data,
    onSuccess: () => { refetch(); setScenarioName(""); },
    onError: err => alert(err?.response?.data?.detail || "Failed to save"),
  });

  const delMut = useMutation({
    mutationFn: simId => api.delete(`/api/properties/${propertyId}/simulations/${simId}`),
    onSuccess: () => refetch(),
  });

  const loadSim = useCallback((sim) => {
    const p = sim.payload;
    if (p.purchase_and_hold) { setPurchaseAndHold(true); setPostPurchaseMonths(p.holding_months ?? 24); }
    else { setPurchaseAndHold(false); setFlipMonths(p.holding_months ?? defaultFlip); }
    const px = p.target_price_per_sqft ?? defaultPx;
    setTargetPx(px); setPxText(String(px));
    setTargetAnnualPct(p.target_annual_profit_pct ?? 15);
    setRegistryCostPx(p.registry_cost_per_sqft ?? 70);
    setAppreciationPct(p.annual_appreciation_pct ?? 12);
    setLoadedSimId(sim.id);
    setAiData(null);
  }, [defaultFlip, defaultPx]);

  // ── Derived helpers ─────────────────────────────────────────────────────────────────────────────────
  const profitAcc = m.absProfit > 0 ? "emerald" : m.absProfit < 0 ? "rose" : "slate";
  const roiAcc    = m.annRoiPct >= OPPORTUNITY_BASELINE_PCT ? "emerald" : m.annRoiPct >= 8 ? "amber" : "rose";
  const hasData   = totalInvest > 0 && totalArea > 0;

  const lendingReturn  = m.myCapital * (lendingRatePct / 100) * (activeMonths / 12);
  const baselineReturn = m.myCapital * (OPPORTUNITY_BASELINE_PCT / 100) * (activeMonths / 12);

  const worstCasePx = sellerRate > 0 ? sellerRate : null;
  const worstCaseProfit = worstCasePx ? worstCasePx * totalArea - m.effectiveInvest : null;
  const worstCaseMyProfit = worstCaseProfit != null ? worstCaseProfit * myShareFrac : null;

  const plotFlipLow  = m.myCapital * 0.25 * (5 / 12);
  const plotFlipHigh = m.myCapital * 0.40 * (5 / 12);

  const AI_THEME = {
    emerald: { wrap: "bg-emerald-50 border-emerald-200", text: "text-emerald-800", badge: "bg-emerald-100 text-emerald-700 border-emerald-300" },
    amber:   { wrap: "bg-amber-50 border-amber-200",   text: "text-amber-900",   badge: "bg-amber-100 text-amber-700 border-amber-300"   },
    rose:    { wrap: "bg-rose-50 border-rose-200",     text: "text-rose-800",    badge: "bg-rose-100 text-rose-700 border-rose-300"     },
    sky:     { wrap: "bg-sky-50 border-sky-200",       text: "text-sky-800",     badge: "bg-sky-100 text-sky-700 border-sky-300"       },
  };

  const displayAI      = aiData ?? qv;
  const displayColor   = aiData ? (aiData.verdict === "SELL" ? "emerald" : aiData.verdict === "REGISTRY" ? "sky" : "amber") : qv.color;
  const at             = AI_THEME[displayColor] || AI_THEME.amber;
  const displayVerdict   = displayAI.verdict;
  const displayReasoning = displayAI.reasoning ?? displayAI.reason ?? "";
  const displayIcon      = aiData ? (displayVerdict === "SELL" ? "✅" : displayVerdict === "REGISTRY" ? "������" : "⏳") : qv.icon;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Sticky header ────────────────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur-sm border-b border-white/5 shadow-xl">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-base shrink-0">������</div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-bold text-white">Deal Simulator</p>
                <span className="text-[10px] bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">Sandbox</span>
              </div>
              <p className="text-[10px] text-slate-400 truncate">{property.title} · Read-only snapshot · No live data modified</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white text-xs font-medium transition shrink-0"
          >
            ← Back to Deal
          </button>
        </div>
      </div>

      {/* ── Page content ───────────────────────────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-4 py-6 pb-20 space-y-5">

        {/* Live snapshot */}
        <div className="bg-white border border-slate-200/60 rounded-2xl p-4 shadow-sm">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-3">Live Property Snapshot — Seeded (read-only)</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SimMetric label="Total Area" value={totalArea > 0 ? `${Number(totalArea).toLocaleString("en-IN")} sqft` : "—"} />
            <SimMetric label="All-in Investment" value={formatCurrency(totalInvest)} sub="seller + broker + misc" />
            <SimMetric label="Break-even Rate" value={breakevenBase > 0 ? `₹${Math.round(breakevenBase).toLocaleString("en-IN")}/sqft` : "—"} accent="amber" />
            {myShare > 0
              ? <SimMetric label={`My Share (${myShare}%)`} value={formatCurrency(myInvested)} sub="capital deployed" accent="indigo" />
              : <SimMetric label="Advance Paid" value={formatCurrency(advancePaid)} />}
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* ═══ LEFT: Controls ══════════════════════════════════════════════════════ */}
          <div className="space-y-5">

            <SimSection title="Scenario Controls" icon="������">
              <div className="space-y-5">

                {/* Holding period */}
                {!purchaseAndHold ? (
                  <div>
                    <RangeSlider
                      label="Flip Holding Period"
                      value={flipMonths} min={1} max={maxFlipMonths} step={1}
                      format={formatMonths} onChange={setFlipMonths}
                    />
                    {naturalFlipMonths ? (
                      <div className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] text-slate-600">
                        <span className="text-slate-400">������</span>
                        <span>Natural window: <strong className="text-slate-800">{formatMonths(naturalFlipMonths)}</strong></span>
                        {flipMonths > naturalFlipMonths && (
                          <span className="ml-auto text-amber-600 font-medium">+{flipMonths - naturalFlipMonths}mo over window</span>
                        )}
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[10px] text-slate-400">Add negotiation & registry dates to see the natural deal window.</p>
                    )}
                  </div>
                ) : (
                  <div>
                    <RangeSlider
                      label="Post-Purchase Holding"
                      value={postPurchaseMonths} min={1} max={120} step={1}
                      format={formatMonths} onChange={setPostPurchaseMonths}
                    />
                    <p className="mt-1.5 text-[10px] text-slate-500">
                      Capital blocked for <strong className="text-slate-700">{formatMonths(postPurchaseMonths)}</strong> after acquisition. Up to 10 years supported.
                    </p>
                  </div>
                )}

                {/* Target sale price */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Target Sale Price</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-400 font-medium">₹</span>
                      <input
                        type="number" value={pxText} min={1}
                        onChange={e => handlePriceText(e.target.value)} onBlur={commitPriceText}
                        className="w-24 border border-slate-200 rounded-lg px-2 py-0.5 text-sm font-bold text-slate-800 bg-white text-right focus:outline-none focus:ring-2 focus:ring-indigo-400 tabular-nums"
                      />
                      <span className="text-xs text-slate-400">/sqft</span>
                    </div>
                  </div>
                  <div className="relative h-5 flex items-center">
                    <div className="absolute left-0 right-0 h-1.5 rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-indigo-500 transition-all duration-150"
                        style={{ width: `${clamp(((targetPx - priceMin) / (priceMax - priceMin)) * 100, 0, 100)}%` }} />
                    </div>
                    <input type="range" min={priceMin} max={priceMax} step={priceStep}
                      value={clamp(targetPx, priceMin, priceMax)}
                      onChange={e => handlePriceSlider(Number(e.target.value))}
                      className="relative w-full h-1.5 appearance-none bg-transparent cursor-pointer
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600
                        [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md
                        [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
                        [&::-moz-range-thumb]:bg-indigo-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white"
                    />
                  </div>
                  <div className="flex justify-between text-[9px] text-slate-400 mt-0.5 select-none">
                    <span>₹{priceMin.toLocaleString("en-IN")}</span>
                    <span>₹{priceMax.toLocaleString("en-IN")}</span>
                  </div>
                  {breakevenBase > 0 && (
                    <p className={`mt-1.5 text-[10px] font-medium ${targetPx > breakevenBase ? "text-emerald-600" : "text-rose-600"}`}>
                      {targetPx > breakevenBase
                        ? `↑ ₹${Math.round(targetPx - breakevenBase).toLocaleString("en-IN")}/sqft above break-even`
                        : `↓ ₹${Math.round(breakevenBase - targetPx).toLocaleString("en-IN")}/sqft below break-even`}
                    </p>
                  )}
                </div>

                {/* Target annual profit % */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Target Annual Profit %</span>
                    <div className="flex items-center gap-1">
                      <input type="number" value={targetAnnualPct ?? ""} min={0} max={500} step={0.5}
                        onChange={e => setTargetAnnualPct(e.target.value === "" ? null : parseFloat(e.target.value))}
                        className="w-16 border border-slate-200 rounded-lg px-2 py-0.5 text-sm font-bold text-slate-800 bg-white text-right focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        placeholder="15" />
                      <span className="text-xs text-slate-400">% p.a.</span>
                    </div>
                  </div>
                  {m.breakevenPx != null && (
                    <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-sky-500 mb-0.5">Required Price for {targetAnnualPct}% Target</p>
                      <p className="text-lg font-bold text-sky-800 tabular-nums">₹{Math.ceil(m.breakevenPx).toLocaleString("en-IN")}/sqft</p>
                      <p className="text-[10px] text-sky-600 mt-0.5">
                        {m.breakevenPx <= targetPx
                          ? "✅ Your target price exceeds this — goal is achievable."
                          : `Need ₹${Math.ceil(m.breakevenPx - targetPx).toLocaleString("en-IN")}/sqft more.`}
                      </p>
                    </div>
                  )}
                </div>

                {/* Extra Brokerage */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Extra Brokerage / Fees</p>
                      <p className="text-[9px] text-slate-400">Optional — buyer agent, stamp duty, etc.</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-400 font-medium">₹</span>
                      <input
                        type="number" value={extraBrokerageText} min={0} step={1000}
                        onChange={e => handleBrokerageText(e.target.value)}
                        className="w-28 border border-slate-200 rounded-lg px-2 py-0.5 text-sm font-bold text-slate-800 bg-white text-right focus:outline-none focus:ring-2 focus:ring-indigo-400 tabular-nums"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  {extraBrokerage > 0 && (
                    <p className="text-[10px] text-amber-600 font-medium">↑ Adds {formatCurrency(extraBrokerage)} to effective investment</p>
                  )}
                </div>
              </div>
            </SimSection>

            {/* Purchase & Hold Mode */}
            <SimSection title="Ownership Mode" icon="������">
              <div className="space-y-4">
                <Toggle
                  label="Purchase & Hold"
                  description="Simulate buying outright (pay registry) and holding for long-term appreciation."
                  checked={purchaseAndHold}
                  onChange={setPurchaseAndHold}
                />
                {purchaseAndHold && (
                  <div className="space-y-4 mt-2 pt-4 border-t border-slate-100">
                    <RangeSlider
                      label="Registry Cost" value={registryCostPx}
                      min={20} max={300} step={5} format={v => `₹${v}/sqft`}
                      onChange={setRegistryCostPx}
                    />
                    {totalArea > 0 && (
                      <p className="text-[10px] text-slate-500 -mt-2">
                        Total registry outlay: <strong className="text-slate-700">{formatCurrency(registryCostPx * totalArea)}</strong>
                      </p>
                    )}
                    <RangeSlider
                      label="Annual Appreciation" value={appreciationPct}
                      min={0} max={50} step={0.5} format={v => `${v}% p.a.`}
                      onChange={setAppreciationPct}
                    />
                    {m.appreciatedPx !== targetPx && (
                      <div className="px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-xl text-[10px] text-indigo-700">
                        At {appreciationPct}% p.a., ₹{Number(targetPx).toLocaleString("en-IN")}/sqft grows to{" "}
                        <strong>₹{Math.round(m.appreciatedPx).toLocaleString("en-IN")}/sqft</strong>{" "}
                        after {formatMonths(postPurchaseMonths)}.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </SimSection>

            {/* Save / Load */}
            <SimSection title="Save / Load Scenarios" icon="������">
              <div className="flex gap-2 mb-4">
                <input type="text" value={scenarioName} onChange={e => setScenarioName(e.target.value)}
                  placeholder="e.g. Best Case — 8 Months"
                  className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder-slate-300"
                />
                <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
                  className="px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-xl hover:bg-indigo-700 transition disabled:opacity-50 shrink-0">
                  {saveMut.isPending ? "Saving…" : "Save"}
                </button>
              </div>
              {savedSims.length === 0 ? (
                <p className="text-[10px] text-slate-400 italic text-center py-3">No saved scenarios yet.</p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                  {savedSims.map(sim => (
                    <div key={sim.id}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs cursor-pointer transition ${
                        loadedSimId === sim.id ? "bg-indigo-50 border-indigo-300" : "bg-slate-50 border-slate-200 hover:bg-indigo-50/50 hover:border-indigo-200"
                      }`}>
                      <button className="flex-1 text-left" onClick={() => loadSim(sim)}>
                        <p className="font-semibold text-slate-800">{sim.name}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1 flex-wrap">
                          {sim.payload.ai_verdict && (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                              sim.payload.ai_verdict === "SELL" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                              sim.payload.ai_verdict === "REGISTRY" ? "bg-sky-50 text-sky-700 border-sky-200" :
                              "bg-amber-50 text-amber-700 border-amber-200"
                            }`}>{sim.payload.ai_verdict}</span>
                          )}
                          <span>
                            {sim.payload.annualized_roi_pct != null && `${sim.payload.annualized_roi_pct.toFixed(1)}% · `}
                            {formatMonths(sim.payload.holding_months)} · {sim.payload.purchase_and_hold ? "P&H" : "Flip"}
                          </span>
                        </p>
                      </button>
                      <button onClick={() => { if (window.confirm(`Delete "${sim.name}"?`)) delMut.mutate(sim.id); }}
                        className="text-slate-300 hover:text-rose-500 transition text-base leading-none shrink-0">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </SimSection>
          </div>

          {/* ═══ RIGHT: Results ══════════════════════════════════════════════════════ */}
          <div className="space-y-5">

            <SimSection title="Calculated Results" icon="������">
              {!hasData ? (
                <div className="text-center py-10 text-slate-400 text-xs">
                  Add total area and investment details to unlock simulation metrics.
                </div>
              ) : (
                <div className="space-y-5">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Deal-level Returns</p>
                    <div className="grid grid-cols-2 gap-3">
                      <SimMetric label="Absolute Profit" value={formatCurrency(m.absProfit)}
                        sub={`${m.absRoiPct.toFixed(1)}% absolute ROI`} accent={profitAcc} />
                      <SimMetric label="Annualized ROI" value={`${m.annRoiPct.toFixed(1)}%`}
                        sub={`over ${formatMonths(activeMonths)}`} accent={roiAcc} />
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <SimMetric label="Net Sale Proceeds" value={formatCurrency(m.netProceeds)}
                        sub={purchaseAndHold
                          ? `₹${Math.round(m.appreciatedPx).toLocaleString("en-IN")}/sqft (appreciated)`
                          : `₹${Number(targetPx).toLocaleString("en-IN")}/sqft`}
                        accent="cyan" />
                      <SimMetric label="All-in Cost" value={formatCurrency(m.effectiveInvest)}
                        sub={purchaseAndHold && m.registryTotal > 0
                          ? `incl. ${formatCurrency(m.registryTotal)} registry`
                          : extraBrokerage > 0 ? `incl. ${formatCurrency(extraBrokerage)} brokerage` : "purchase + expenses"} />
                    </div>
                  </div>

                  {/* Baseline comparison bar */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">vs {OPPORTUNITY_BASELINE_PCT}% Lending Baseline</p>
                    <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden mb-2">
                      <div className={`h-full rounded-full transition-all duration-500 ${m.annRoiPct >= OPPORTUNITY_BASELINE_PCT ? "bg-emerald-500" : "bg-amber-400"}`}
                        style={{ width: `${clamp((m.annRoiPct / (OPPORTUNITY_BASELINE_PCT * 2)) * 100, 0, 100)}%` }} />
                    </div>
                    <div className="flex justify-between text-[9px]">
                      <span className={`font-semibold ${m.annRoiPct >= OPPORTUNITY_BASELINE_PCT ? "text-emerald-700" : "text-amber-700"}`}>
                        This deal: {m.annRoiPct.toFixed(1)}%
                      </span>
                      <span className="text-slate-400">Lending baseline: {OPPORTUNITY_BASELINE_PCT}%</span>
                    </div>
                  </div>
                </div>
              )}
            </SimSection>

            {/* My View */}
            {hasData && (myShare > 0 || myInvested > 0) && (
              <SimSection title={`My View${myShare > 0 ? ` — ${myShare}% stake` : ""}`} icon="������">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <SimMetric label="My Capital Deployed"
                      value={formatCurrency(m.myCapital)}
                      sub={`locked ${formatMonths(activeMonths)}`} accent="violet" />
                    <SimMetric label="My Projected Return"
                      value={formatCurrency(m.myProfit)}
                      sub={`${m.myAnnRoiPct.toFixed(1)}% annualized`}
                      accent={m.myProfit >= 0 ? "emerald" : "rose"} />
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl divide-y divide-slate-200">
                    <div className="px-4 py-2.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Capital Opportunity Cost</p>
                    </div>
                    {[
                      { label: "My capital committed", val: formatCurrency(m.myCapital), cls: "text-slate-700" },
                      { label: `Lending at ${OPPORTUNITY_BASELINE_PCT}% for ${formatMonths(activeMonths)}`, val: `+${formatCurrency(baselineReturn)}`, cls: "text-slate-500" },
                      { label: "This deal returns me", val: formatCurrency(m.myProfit), cls: m.myProfit >= baselineReturn ? "text-emerald-700 font-bold" : "text-amber-700 font-bold" },
                    ].map((row, i) => (
                      <div key={i} className="px-4 py-2 flex justify-between text-xs">
                        <span className="text-slate-500">{row.label}</span>
                        <span className={row.cls}>{row.val}</span>
                      </div>
                    ))}
                    <div className="px-4 py-2.5 flex justify-between text-xs">
                      <span className="text-slate-500">vs baseline</span>
                      <span className={`font-bold ${m.myProfit >= baselineReturn ? "text-emerald-700" : "text-amber-700"}`}>
                        {m.myProfit >= baselineReturn
                          ? `+${formatCurrency(m.myProfit - baselineReturn)} better`
                          : `${formatCurrency(baselineReturn - m.myProfit)} below`}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Scenario Analysis</p>
                    <div className="flex justify-between items-center px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs">
                      <div>
                        <p className="font-semibold text-amber-800">Break-even Sale</p>
                        <p className="text-[10px] text-amber-600">₹{Math.round(breakevenBase).toLocaleString("en-IN")}/sqft — capital back, no profit</p>
                      </div>
                      <span className="font-bold text-amber-700">₹0 return</span>
                    </div>
                    {worstCasePx && (
                      <div className={`flex justify-between items-center px-3 py-2.5 rounded-xl text-xs border ${
                        worstCaseMyProfit >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"
                      }`}>
                        <div>
                          <p className={`font-semibold ${worstCaseMyProfit >= 0 ? "text-emerald-800" : "text-rose-800"}`}>At Seller Rate (₹{worstCasePx.toLocaleString("en-IN")}/sqft)</p>
                          <p className={`text-[10px] ${worstCaseMyProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>Current market entry price as exit</p>
                        </div>
                        <span className={`font-bold ${worstCaseMyProfit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          {worstCaseMyProfit >= 0 ? "+" : ""}{formatCurrency(worstCaseMyProfit ?? 0)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </SimSection>
            )}

            {/* Alternative Use of Capital */}
            {hasData && purchaseAndHold && m.myCapital > 0 && (
              <SimSection title="Alternative Use of Capital" icon="������">
                <div className="space-y-4">
                  <div>
                    <RangeSlider
                      label="Lending Rate"
                      value={lendingRatePct} min={12} max={36} step={0.5}
                      format={v => `${v}% p.a.`}
                      onChange={setLendingRatePct}
                    />
                    <div className="mt-2 bg-sky-50 border border-sky-200 rounded-xl px-4 py-2.5">
                      <div className="flex justify-between items-center text-xs">
                        <div>
                          <p className="font-semibold text-sky-800">
                            Lend {m.myCapital >= 1e5 ? `₹${(m.myCapital / 1e5).toFixed(1)}L` : formatCurrency(m.myCapital)} at {lendingRatePct}% p.a.
                          </p>
                          <p className="text-[10px] text-sky-600">for {formatMonths(activeMonths)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-sky-700">{formatCurrency(lendingReturn)}</p>
                          <p className="text-[10px] text-sky-500">interest income</p>
                        </div>
                      </div>
                      <div className="mt-2 pt-2 border-t border-sky-200">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-sky-600">vs this P&H deal</span>
                          <span className={`font-bold ${m.myProfit >= lendingReturn ? "text-emerald-700" : "text-rose-600"}`}>
                            {m.myProfit >= lendingReturn
                              ? `Deal better by +${formatCurrency(m.myProfit - lendingReturn)}`
                              : `Lending better by +${formatCurrency(lendingReturn - m.myProfit)}`}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-violet-500 mb-2">Plot Flip Alternative (Reference)</p>
                    <p className="text-[10px] text-violet-700 mb-2">Deploy in a 4–5 month plot flip at 25–40% p.a. ROI</p>
                    <div className="flex justify-between text-xs">
                      <div>
                        <p className="text-[10px] text-violet-600">Conservative (25% p.a.)</p>
                        <p className="font-bold text-violet-800">{formatCurrency(plotFlipLow)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-violet-600">Optimistic (40% p.a.)</p>
                        <p className="font-bold text-violet-800">{formatCurrency(plotFlipHigh)}</p>
                      </div>
                    </div>
                    <p className="text-[9px] text-violet-500 mt-2">Illustrative only — based on typical deal returns.</p>
                  </div>
                </div>
              </SimSection>
            )}

            {/* AI Insight Card */}
            <div className={`border rounded-2xl p-5 shadow-sm ${at.wrap}`}>
              <div className="flex items-center justify-between mb-3 gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{displayIcon}</span>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                      {aiData ? "Gemini AI Insight" : "Quick Verdict"}
                    </p>
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide border ${at.badge}`}>
                      {displayVerdict}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => aiMut.mutate()}
                  disabled={aiMut.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-bold rounded-xl transition shrink-0"
                >
                  {aiMut.isPending ? (
                    <><span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin inline-block" /> Thinking…</>
                  ) : <>✨ Ask AI</>}
                </button>
              </div>

              {aiMut.isPending ? (
                <div className="space-y-2">
                  <div className="h-3 bg-black/10 rounded animate-pulse w-full" />
                  <div className="h-3 bg-black/10 rounded animate-pulse w-4/5" />
                  <div className="h-3 bg-black/10 rounded animate-pulse w-3/5" />
                </div>
              ) : (
                <p className={`text-xs leading-relaxed ${at.text}`}>{displayReasoning}</p>
              )}

              <div className="mt-3 pt-3 border-t border-black/5 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[9px] text-slate-400">Holding</p>
                  <p className="text-xs font-bold text-slate-700">{formatMonths(activeMonths)}</p>
                </div>
                <div>
                  <p className="text-[9px] text-slate-400">Ann. ROI</p>
                  <p className={`text-xs font-bold ${at.text}`}>{m.annRoiPct.toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-[9px] text-slate-400">Baseline</p>
                  <p className="text-xs font-bold text-slate-500">{OPPORTUNITY_BASELINE_PCT}%</p>
                </div>
              </div>

              {!aiData && (
                <p className="mt-2 text-[9px] text-slate-400 text-center">Click "✨ Ask AI" for a Gemini-powered deep analysis.</p>
              )}
            </div>

            {/* Scenarios comparison table */}
            {savedSims.length > 1 && (
              <SimSection title="Scenarios Comparison" icon="������">
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-1.5 text-slate-400 font-semibold">Name</th>
                        <th className="text-right py-1.5 text-slate-400 font-semibold">Mode</th>
                        <th className="text-right py-1.5 text-slate-400 font-semibold">Hold</th>
                        <th className="text-right py-1.5 text-slate-400 font-semibold">Ann. ROI</th>
                        <th className="text-right py-1.5 text-slate-400 font-semibold">Verdict</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {savedSims.map(sim => (
                        <tr key={sim.id}
                          className={`cursor-pointer transition hover:bg-slate-50 ${loadedSimId === sim.id ? "bg-indigo-50/50" : ""}`}
                          onClick={() => loadSim(sim)}>
                          <td className="py-2 font-medium text-slate-700 max-w-[100px] truncate">{sim.name}</td>
                          <td className="text-right py-2 text-slate-500">{sim.payload.purchase_and_hold ? "P&H" : "Flip"}</td>
                          <td className="text-right py-2 text-slate-500">{formatMonths(sim.payload.holding_months)}</td>
                          <td className="text-right py-2 font-semibold text-slate-700">
                            {sim.payload.annualized_roi_pct != null ? `${sim.payload.annualized_roi_pct.toFixed(1)}%` : "—"}
                          </td>
                          <td className="text-right py-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                              sim.payload.ai_verdict === "SELL"     ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                              sim.payload.ai_verdict === "REGISTRY" ? "bg-sky-50 text-sky-700 border-sky-200" :
                                                                      "bg-amber-50 text-amber-700 border-amber-200"
                            }`}>
                              {sim.payload.ai_verdict || "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SimSection>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}