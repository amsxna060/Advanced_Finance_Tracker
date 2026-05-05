/**
 * DealSimulator — full-page sandbox. Uses app-standard PageHero + PageBody.
 * Never mutates property_deals or property_transactions.
 */
import { useState, useMemo, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import api from "../lib/api";
import { formatCurrency } from "../lib/utils";
import { PageHero, PageBody, HeroStat } from "./ui";

const BASELINE_PCT = 18;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function monthsBetween(a, b) {
  if (!a || !b) return null;
  return Math.max(1, Math.round((new Date(b) - new Date(a)) / (30.44 * 86400000)));
}
function fmtMonths(m) {
  if (!m || m <= 0) return "—";
  if (m < 12) return `${m} month${m !== 1 ? "s" : ""}`;
  const y = Math.floor(m / 12), mo = m % 12;
  return mo === 0 ? `${y} yr${y !== 1 ? "s" : ""}` : `${y}yr ${mo}mo`;
}

// ── Financial engine ───────────────────────────────────────────────────────────
function compute({ totalInvest, area, px, months, pah, regPx, appPct, profitTargetPct, myFrac, myInvested, extraBrok }) {
  const m = Math.max(months, 1);
  const regTotal = pah ? regPx * area : 0;
  const cost = totalInvest + regTotal + extraBrok;
  const exitPx = pah ? px * Math.pow(1 + appPct / 100, m / 12) : px;
  const proceeds = exitPx * area;
  const profit = proceeds - cost;
  const absRoi = cost > 0 ? (profit / cost) * 100 : 0;
  const annRoi = (absRoi / m) * 12;
  const myCapital = myFrac < 1 ? cost * myFrac : (myInvested > 0 ? myInvested : cost);
  const myProfit = profit * myFrac;
  const myAnn = myCapital > 0 ? (myProfit / myCapital / m) * 12 * 100 : annRoi;
  let bePx = null;
  if (profitTargetPct != null && area > 0 && cost > 0) {
    const needed = cost * (1 + (profitTargetPct * m) / 12 / 100);
    bePx = pah ? needed / area / Math.pow(1 + appPct / 100, m / 12) : needed / area;
  }
  return { cost, proceeds, profit, absRoi, annRoi, exitPx, bePx, regTotal, myCapital, myProfit, myAnn };
}

function verdict({ annRoi, profit, months, pah, appPct }) {
  if (pah) {
    if (appPct >= 12 && months >= 18)
      return { v: "REGISTRY", color: "emerald", icon: "🏠", reason: `${appPct}% p.a. appreciation over ${fmtMonths(months)} offsets registry cost. Annualized ROI: ${annRoi.toFixed(1)}%.` };
    if (appPct < 8)
      return { v: "HOLD", color: "amber", icon: "⏳", reason: `${appPct}% appreciation is modest. Registry may not beat lending at ${BASELINE_PCT}% within this window.` };
    return { v: "REGISTRY", color: "emerald", icon: "🏠", reason: `${appPct}% p.a. over ${fmtMonths(months)} supports long-term ownership. Annualized ROI: ${annRoi.toFixed(1)}%.` };
  }
  if (profit <= 0) return { v: "HOLD", color: "rose", icon: "⚠️", reason: "Selling now locks in a loss. Hold for a better buyer or price recovery." };
  if (annRoi >= BASELINE_PCT + 5) return { v: "SELL", color: "emerald", icon: "✅", reason: `${annRoi.toFixed(1)}% annualized ROI beats the ${BASELINE_PCT}% baseline by ${(annRoi - BASELINE_PCT).toFixed(1)}pp. Good time to close.` };
  if (annRoi < BASELINE_PCT && months > 12) return { v: "SELL", color: "amber", icon: "⚠️", reason: `Capital tied up ${fmtMonths(months)} at ${annRoi.toFixed(1)}% — below ${BASELINE_PCT}% lending baseline. Consider closing and redeploying.` };
  if (annRoi >= BASELINE_PCT) return { v: "SELL", color: "emerald", icon: "✅", reason: `${annRoi.toFixed(1)}% meets the ${BASELINE_PCT}% baseline. Proceed to close.` };
  return { v: "HOLD", color: "amber", icon: "⏳", reason: "ROI below baseline but window is short. Monitor a few more months before discounting." };
}

// ── Primitives ─────────────────────────────────────────────────────────────────
function Card({ title, children, className = "" }) {
  return (
    <div className={`bg-white border border-slate-200/60 rounded-2xl overflow-hidden shadow-sm ${className}`}>
      {title && (
        <div className="px-5 py-3.5 border-b border-slate-100">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</h2>
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

const A = {
  emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
  rose:    "bg-rose-50 border-rose-200 text-rose-700",
  amber:   "bg-amber-50 border-amber-200 text-amber-700",
  violet:  "bg-violet-50 border-violet-200 text-violet-700",
  indigo:  "bg-indigo-50 border-indigo-200 text-indigo-700",
  cyan:    "bg-sky-50 border-sky-200 text-sky-700",
  slate:   "bg-slate-50 border-slate-200 text-slate-700",
  sky:     "bg-sky-50 border-sky-200 text-sky-700",
};

function Metric({ label, value, sub, accent = "slate", className = "" }) {
  const [bg, border, text] = (A[accent] || A.slate).split(" ");
  return (
    <div className={`rounded-xl border p-4 ${bg} ${border} ${className}`}>
      <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 mb-1">{label}</p>
      <p className={`text-base font-bold tabular-nums ${text}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{sub}</p>}
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, fmt, onChange, disabled }) {
  const pct = clamp(((value - min) / (max - min)) * 100, 0, 100);
  return (
    <div className={disabled ? "opacity-40 pointer-events-none select-none" : ""}>
      <div className="flex justify-between items-center mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</span>
        <span className="text-sm font-bold text-slate-800 tabular-nums">{fmt ? fmt(value) : value}</span>
      </div>
      <div className="relative h-5 flex items-center">
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-indigo-500 transition-all duration-150" style={{ width: `${pct}%` }} />
        </div>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="relative w-full h-1.5 appearance-none bg-transparent cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600
            [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md
            [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-indigo-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white"
        />
      </div>
      <div className="flex justify-between text-[9px] text-slate-400 mt-1 select-none">
        <span>{fmt ? fmt(min) : min}</span><span>{fmt ? fmt(max) : max}</span>
      </div>
    </div>
  );
}

function Toggle({ label, description, checked, onChange }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <button role="switch" aria-checked={checked} type="button"
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 w-9 h-5 rounded-full transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1 ${checked ? "bg-indigo-500" : "bg-slate-200"}`}>
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
      </button>
      <div>
        <p className="text-xs font-semibold text-slate-800 group-hover:text-slate-900">{label}</p>
        {description && <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{description}</p>}
      </div>
    </label>
  );
}

const AI_THEME = {
  emerald: { wrap: "bg-emerald-50 border-emerald-200", text: "text-emerald-800", badge: "bg-emerald-100 text-emerald-700 border-emerald-300" },
  amber:   { wrap: "bg-amber-50 border-amber-200",   text: "text-amber-900",   badge: "bg-amber-100 text-amber-700 border-amber-300"   },
  rose:    { wrap: "bg-rose-50 border-rose-200",     text: "text-rose-800",    badge: "bg-rose-100 text-rose-700 border-rose-300"     },
  sky:     { wrap: "bg-sky-50 border-sky-200",       text: "text-sky-800",     badge: "bg-sky-100 text-sky-700 border-sky-300"       },
};

// ── Main ───────────────────────────────────────────────────────────────────────
export default function DealSimulator({ property, onClose }) {
  const pid = property.id;

  // Seed from live snapshot
  const area      = parseFloat(property.total_area_sqft    || 0);
  const seller    = parseFloat(property.total_seller_value  || 0);
  const broker    = parseFloat(property.broker_commission   || 0);
  const other     = parseFloat(property.other_expenses      || 0);
  const advance   = parseFloat(property.advance_paid        || 0);
  const totalInv  = seller + broker + other;
  const beBASE    = area > 0 ? totalInv / area : 0;
  const sellerPx  = parseFloat(property.seller_rate_per_sqft || 0);
  const myShare   = parseFloat(property.my_share_percentage  || 0);
  const myInv     = parseFloat(property.my_investment        || 0);
  const myFrac    = myShare > 0 ? myShare / 100 : 1;

  const natMonths  = monthsBetween(property.negotiating_date, property.expected_registry_date);
  const maxFlip    = natMonths ? Math.min(natMonths + 3, 36) : 24;
  const defFlip    = natMonths ?? 6;
  const pRef       = beBASE > 0 ? beBASE : (sellerPx > 0 ? sellerPx : 500);
  const pMin       = Math.max(100, Math.floor(pRef * 0.7));
  const pMax       = Math.ceil(pRef * 3);
  const pStep      = Math.max(1, Math.floor((pMax - pMin) / 300));
  const defPx      = Math.ceil(pRef * 1.15);

  // State
  const [flipM,      setFlipM]      = useState(defFlip);
  const [pahM,       setPahM]       = useState(24);
  const [px,         setPx]         = useState(defPx);
  const [pxTxt,      setPxTxt]      = useState(String(defPx));
  const [profTgt,    setProfTgt]    = useState(15);
  const [pah,        setPah]        = useState(false);
  const [regPx,      setRegPx]      = useState(70);
  const [appPct,     setAppPct]     = useState(12);
  const [extraBrok,  setExtraBrok]  = useState(0);
  const [brokTxt,    setBrokTxt]    = useState("0");
  const [lendRate,   setLendRate]   = useState(18);
  const [simName,    setSimName]    = useState("");
  const [loadedId,   setLoadedId]   = useState(null);
  const [aiData,     setAiData]     = useState(null);

  const months = pah ? pahM : flipM;

  function onPxSlider(v)  { setPx(v); setPxTxt(String(v)); }
  function onPxText(raw)  { setPxTxt(raw); const n = parseFloat(raw); if (!isNaN(n) && n > 0) setPx(Math.round(n)); }
  function commitPx()     { if (isNaN(parseFloat(pxTxt)) || parseFloat(pxTxt) <= 0) setPxTxt(String(px)); }
  function onBrokText(raw){ setBrokTxt(raw); const n = parseFloat(raw); setExtraBrok(!isNaN(n) && n >= 0 ? n : 0); }

  const m = useMemo(() => compute({
    totalInvest: totalInv, area, px, months, pah, regPx, appPct,
    profitTargetPct: profTgt, myFrac, myInvested: myInv, extraBrok,
  }), [totalInv, area, px, months, pah, regPx, appPct, profTgt, myFrac, myInv, extraBrok]);

  const qv = useMemo(() => verdict({ annRoi: m.annRoi, profit: m.profit, months, pah, appPct }),
    [m.annRoi, m.profit, months, pah, appPct]);

  // AI mutation
  const aiMut = useMutation({
    mutationFn: async () => (await api.post(`/api/properties/${pid}/simulations/ai-insight`, {
      holding_months: months,
      target_price_per_sqft: px,
      purchase_and_hold: pah,
      annual_appreciation_pct: appPct,
      brokerage_amount: extraBrok,
      absolute_profit: m.profit,
      absolute_roi_pct: m.absRoi,
      annualized_roi_pct: m.annRoi,
      breakeven_price_per_sqft: m.bePx ?? 0,
      my_capital: m.myCapital,
      my_profit: m.myProfit,
      my_ann_roi_pct: m.myAnn,
      effective_invest: m.cost,
      lending_rate_pct: lendRate,
    })).data,
    onSuccess: d => setAiData(d),
    onError: err => setAiData({ verdict: "ERROR", reasoning: err?.response?.data?.detail || "AI service unavailable." }),
  });

  // Saved simulations
  const { data: saved = [], refetch } = useQuery({
    queryKey: ["simulations", pid],
    queryFn: async () => (await api.get(`/api/properties/${pid}/simulations`)).data,
  });

  const saveMut = useMutation({
    mutationFn: async () => (await api.post(`/api/properties/${pid}/simulations`, {
      name: simName.trim() || `Scenario — ${new Date().toLocaleDateString("en-IN")}`,
      payload: {
        holding_months: months, target_price_per_sqft: px,
        target_annual_profit_pct: profTgt, purchase_and_hold: pah,
        registry_cost_per_sqft: regPx, annual_appreciation_pct: appPct,
        absolute_profit: m.profit, absolute_roi_pct: m.absRoi,
        annualized_roi_pct: m.annRoi, breakeven_price_per_sqft: m.bePx,
        ai_verdict: (aiData ?? qv).verdict,
        ai_reasoning: (aiData ?? qv).reason ?? (aiData ?? qv).reasoning,
      },
    })).data,
    onSuccess: () => { refetch(); setSimName(""); },
    onError: e => alert(e?.response?.data?.detail || "Failed to save"),
  });

  const delMut = useMutation({
    mutationFn: id => api.delete(`/api/properties/${pid}/simulations/${id}`),
    onSuccess: () => refetch(),
  });

  const loadSim = useCallback((sim) => {
    const p = sim.payload;
    if (p.purchase_and_hold) { setPah(true); setPahM(p.holding_months ?? 24); }
    else { setPah(false); setFlipM(p.holding_months ?? defFlip); }
    const p2 = p.target_price_per_sqft ?? defPx;
    setPx(p2); setPxTxt(String(p2));
    setProfTgt(p.target_annual_profit_pct ?? 15);
    setRegPx(p.registry_cost_per_sqft ?? 70);
    setAppPct(p.annual_appreciation_pct ?? 12);
    setLoadedId(sim.id); setAiData(null);
  }, [defFlip, defPx]);

  // Derived
  const hasData       = totalInv > 0 && area > 0;
  const profAcc       = m.profit > 0 ? "emerald" : m.profit < 0 ? "rose" : "slate";
  const roiAcc        = m.annRoi >= BASELINE_PCT ? "emerald" : m.annRoi >= 8 ? "amber" : "rose";
  const lendReturn    = m.myCapital * (lendRate / 100) * (months / 12);
  const baseReturn    = m.myCapital * (BASELINE_PCT / 100) * (months / 12);
  const plotLow       = m.myCapital * 0.25 * (5 / 12);
  const plotHigh      = m.myCapital * 0.40 * (5 / 12);
  const worstPx       = sellerPx > 0 ? sellerPx : null;
  const worstProfit   = worstPx ? (worstPx * area - m.cost) * myFrac : null;
  const downsidePx    = px * 0.9;
  const downsideProfit= (downsidePx * area - m.cost) * myFrac;

  const displayAI     = aiData ?? qv;
  const aiColor       = aiData ? (aiData.verdict === "SELL" ? "emerald" : aiData.verdict === "REGISTRY" ? "sky" : "amber") : qv.color;
  const at            = AI_THEME[aiColor] || AI_THEME.amber;
  const displayVerdict  = displayAI.verdict;
  const displayReason   = displayAI.reasoning ?? displayAI.reason ?? "";
  const displayIcon     = aiData ? (displayVerdict === "SELL" ? "✅" : displayVerdict === "REGISTRY" ? "🏠" : "⏳") : qv.icon;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title="Deal Simulator"
        subtitle={`${property.title} · Sandbox · No live data modified`}
        backTo="/properties"
        actions={
          <button onClick={onClose}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition border border-white/10">
            ← Back to Deal
          </button>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <HeroStat label="Total Area" value={area > 0 ? `${Number(area).toLocaleString("en-IN")} sqft` : "—"} />
          <HeroStat label="All-in Investment" value={totalInv > 0 ? formatCurrency(totalInv) : "—"} sub="seller + broker + misc" accent="indigo" />
          <HeroStat label="Break-even Rate" value={beBASE > 0 ? `₹${Math.round(beBASE).toLocaleString("en-IN")}/sqft` : "—"} accent="amber" />
          {myShare > 0
            ? <HeroStat label={`My Share (${myShare}%)`} value={formatCurrency(myInv || 0)} sub="capital deployed" accent="violet" />
            : <HeroStat label="Advance Paid" value={advance > 0 ? formatCurrency(advance) : "—"} />}
        </div>
      </PageHero>

      <PageBody>
        <div className="pt-4 pb-20 grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* ── LEFT COLUMN ──────────────────────────────────────────────────── */}
          <div className="space-y-5">

            {/* Scenario Controls */}
            <Card title="Scenario Controls">
              <div className="space-y-6">
                {/* Holding period */}
                {!pah ? (
                  <div>
                    <Slider label="Flip Holding Period" value={flipM} min={1} max={maxFlip} step={1}
                      fmt={fmtMonths} onChange={setFlipM} />
                    {natMonths ? (
                      <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] text-slate-600">
                        <span>Natural window: <strong className="text-slate-800">{fmtMonths(natMonths)}</strong></span>
                        {flipM > natMonths && <span className="ml-auto text-amber-600 font-medium">+{flipM - natMonths}mo over window</span>}
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[10px] text-slate-400">Add negotiation &amp; registry dates to see the natural deal window.</p>
                    )}
                  </div>
                ) : (
                  <div>
                    <Slider label="Post-Purchase Holding" value={pahM} min={1} max={120} step={1}
                      fmt={fmtMonths} onChange={setPahM} />
                    <p className="mt-1.5 text-[10px] text-slate-500">
                      Capital blocked for <strong className="text-slate-700">{fmtMonths(pahM)}</strong> after acquisition. Up to 10 years supported.
                    </p>
                  </div>
                )}

                {/* Target sale price */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Target Sale Price</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-400">₹</span>
                      <input type="number" value={pxTxt} min={1}
                        onChange={e => onPxText(e.target.value)} onBlur={commitPx}
                        className="w-24 border border-slate-200 rounded-lg px-2 py-1 text-sm font-bold text-slate-800 bg-white text-right focus:outline-none focus:ring-2 focus:ring-indigo-400 tabular-nums" />
                      <span className="text-xs text-slate-400">/sqft</span>
                    </div>
                  </div>
                  <div className="relative h-5 flex items-center">
                    <div className="absolute inset-x-0 h-1.5 rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-indigo-500 transition-all duration-150"
                        style={{ width: `${clamp(((px - pMin) / (pMax - pMin)) * 100, 0, 100)}%` }} />
                    </div>
                    <input type="range" min={pMin} max={pMax} step={pStep} value={clamp(px, pMin, pMax)}
                      onChange={e => onPxSlider(Number(e.target.value))}
                      className="relative w-full h-1.5 appearance-none bg-transparent cursor-pointer
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600
                        [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md
                        [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
                        [&::-moz-range-thumb]:bg-indigo-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white" />
                  </div>
                  <div className="flex justify-between text-[9px] text-slate-400 mt-1 select-none">
                    <span>₹{pMin.toLocaleString("en-IN")}</span><span>₹{pMax.toLocaleString("en-IN")}</span>
                  </div>
                  {beBASE > 0 && (
                    <p className={`mt-1.5 text-[10px] font-medium ${px > beBASE ? "text-emerald-600" : "text-rose-600"}`}>
                      {px > beBASE
                        ? `↑ ₹${Math.round(px - beBASE).toLocaleString("en-IN")}/sqft above break-even`
                        : `↓ ₹${Math.round(beBASE - px).toLocaleString("en-IN")}/sqft below break-even`}
                    </p>
                  )}
                </div>

                {/* Target profit % */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Target Annual Profit %</span>
                    <div className="flex items-center gap-1">
                      <input type="number" value={profTgt ?? ""} min={0} max={500} step={0.5}
                        onChange={e => setProfTgt(e.target.value === "" ? null : parseFloat(e.target.value))}
                        className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm font-bold text-slate-800 bg-white text-right focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        placeholder="15" />
                      <span className="text-xs text-slate-400">% p.a.</span>
                    </div>
                  </div>
                  {m.bePx != null && (
                    <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-sky-500 mb-1">Required Price for {profTgt}% Target</p>
                      <p className="text-xl font-bold text-sky-800 tabular-nums">₹{Math.ceil(m.bePx).toLocaleString("en-IN")}/sqft</p>
                      <p className="text-[10px] text-sky-600 mt-1">
                        {m.bePx <= px ? "✅ Your target price exceeds this — goal is achievable." : `Need ₹${Math.ceil(m.bePx - px).toLocaleString("en-IN")}/sqft more to hit target.`}
                      </p>
                    </div>
                  )}
                </div>

                {/* Extra Brokerage */}
                <div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Extra Brokerage / Fees</p>
                      <p className="text-[9px] text-slate-400 mt-0.5">Optional — buyer agent, stamp duty, misc.</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-400">₹</span>
                      <input type="number" value={brokTxt} min={0} step={1000}
                        onChange={e => onBrokText(e.target.value)}
                        className="w-28 border border-slate-200 rounded-lg px-2 py-1 text-sm font-bold text-slate-800 bg-white text-right focus:outline-none focus:ring-2 focus:ring-indigo-400 tabular-nums"
                        placeholder="0" />
                    </div>
                  </div>
                  {extraBrok > 0 && (
                    <p className="text-[10px] text-amber-600 font-medium mt-1.5">↑ Adds {formatCurrency(extraBrok)} to effective investment</p>
                  )}
                </div>
              </div>
            </Card>

            {/* Ownership Mode */}
            <Card title="Ownership Mode">
              <div className="space-y-4">
                <Toggle
                  label="Purchase & Hold"
                  description="Simulate buying outright (pay registry) and holding for long-term appreciation."
                  checked={pah} onChange={setPah}
                />
                {pah && (
                  <div className="space-y-5 pt-4 border-t border-slate-100">
                    <Slider label="Registry Cost" value={regPx} min={20} max={300} step={5}
                      fmt={v => `₹${v}/sqft`} onChange={setRegPx} />
                    {area > 0 && (
                      <div className="flex justify-between items-center px-3 py-2 bg-violet-50 border border-violet-200 rounded-xl text-xs -mt-2">
                        <span className="text-violet-700">Total registry outlay</span>
                        <span className="font-bold text-violet-800">{formatCurrency(regPx * area)}</span>
                      </div>
                    )}
                    <Slider label="Annual Appreciation" value={appPct} min={0} max={50} step={0.5}
                      fmt={v => `${v}% p.a.`} onChange={setAppPct} />
                    {m.exitPx !== px && (
                      <div className="px-3 py-2.5 bg-indigo-50 border border-indigo-200 rounded-xl text-[10px] text-indigo-700">
                        At {appPct}% p.a., ₹{Number(px).toLocaleString("en-IN")}/sqft grows to{" "}
                        <strong>₹{Math.round(m.exitPx).toLocaleString("en-IN")}/sqft</strong> after {fmtMonths(pahM)}.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>

            {/* Save / Load */}
            <Card title="Save / Load Scenarios">
              <div className="flex gap-2 mb-4">
                <input type="text" value={simName} onChange={e => setSimName(e.target.value)}
                  placeholder="e.g. Best Case — 8 Months"
                  className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder-slate-300" />
                <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
                  className="px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-xl hover:bg-indigo-700 transition disabled:opacity-50 shrink-0">
                  {saveMut.isPending ? "Saving…" : "Save"}
                </button>
              </div>
              {saved.length === 0 ? (
                <p className="text-[10px] text-slate-400 italic text-center py-4">No saved scenarios yet.</p>
              ) : (
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                  {saved.map(sim => (
                    <div key={sim.id}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs cursor-pointer transition ${
                        loadedId === sim.id ? "bg-indigo-50 border-indigo-300" : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                      }`}>
                      <button className="flex-1 text-left" onClick={() => loadSim(sim)}>
                        <p className="font-semibold text-slate-800">{sim.name}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                          {sim.payload.ai_verdict && (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                              sim.payload.ai_verdict === "SELL" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                              sim.payload.ai_verdict === "REGISTRY" ? "bg-sky-50 text-sky-700 border-sky-200" :
                              "bg-amber-50 text-amber-700 border-amber-200"
                            }`}>{sim.payload.ai_verdict}</span>
                          )}
                          <span>
                            {sim.payload.annualized_roi_pct != null && `${sim.payload.annualized_roi_pct.toFixed(1)}% · `}
                            {fmtMonths(sim.payload.holding_months)} · {sim.payload.purchase_and_hold ? "P&H" : "Flip"}
                          </span>
                        </p>
                      </button>
                      <button onClick={() => { if (window.confirm(`Delete "${sim.name}"?`)) delMut.mutate(sim.id); }}
                        className="text-slate-300 hover:text-rose-500 transition text-base leading-none shrink-0">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* ── RIGHT COLUMN ─────────────────────────────────────────────────── */}
          <div className="space-y-5">

            {/* Calculated Results */}
            <Card title="Calculated Results">
              {!hasData ? (
                <div className="text-center py-12 text-slate-400 text-xs">
                  Add total area and investment details to unlock metrics.
                </div>
              ) : (
                <div className="space-y-5">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Deal-level Returns</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Metric label="Absolute Profit" value={formatCurrency(m.profit)}
                        sub={`${m.absRoi.toFixed(1)}% absolute ROI`} accent={profAcc} />
                      <Metric label="Annualized ROI" value={`${m.annRoi.toFixed(1)}%`}
                        sub={`over ${fmtMonths(months)}`} accent={roiAcc} />
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <Metric label="Net Sale Proceeds" value={formatCurrency(m.proceeds)}
                        sub={pah ? `₹${Math.round(m.exitPx).toLocaleString("en-IN")}/sqft (appreciated)` : `₹${Number(px).toLocaleString("en-IN")}/sqft`}
                        accent="cyan" />
                      <Metric label="All-in Cost" value={formatCurrency(m.cost)}
                        sub={pah && m.regTotal > 0 ? `incl. ${formatCurrency(m.regTotal)} registry` : extraBrok > 0 ? `incl. ${formatCurrency(extraBrok)} brokerage` : "purchase + expenses"} />
                    </div>
                  </div>

                  {/* Baseline bar */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">vs {BASELINE_PCT}% Lending Baseline</p>
                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden mb-2">
                      <div className={`h-full rounded-full transition-all duration-500 ${m.annRoi >= BASELINE_PCT ? "bg-emerald-500" : "bg-amber-400"}`}
                        style={{ width: `${clamp((m.annRoi / (BASELINE_PCT * 2)) * 100, 0, 100)}%` }} />
                    </div>
                    <div className="flex justify-between text-[9px]">
                      <span className={`font-semibold ${m.annRoi >= BASELINE_PCT ? "text-emerald-700" : "text-amber-700"}`}>
                        This deal: {m.annRoi.toFixed(1)}%
                      </span>
                      <span className="text-slate-400">Lending baseline: {BASELINE_PCT}%</span>
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {/* My Investment View — always shown when hasData */}
            {hasData && (
              <Card title={myShare > 0 ? `My Stakes — ${myShare}% Partner` : "My Investment View"}>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Metric label="My Capital Deployed" value={formatCurrency(m.myCapital)}
                      sub={`locked ${fmtMonths(months)}`} accent="violet" />
                    <Metric label="My Projected Return" value={formatCurrency(m.myProfit)}
                      sub={`${m.myAnn.toFixed(1)}% annualized`}
                      accent={m.myProfit >= 0 ? "emerald" : "rose"} />
                  </div>

                  {/* Opportunity cost table */}
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Capital Opportunity Cost</p>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {[
                        { label: "My capital committed",
                          val: formatCurrency(m.myCapital), cls: "text-slate-700 font-medium" },
                        { label: `Lending at ${BASELINE_PCT}% for ${fmtMonths(months)}`,
                          val: `+${formatCurrency(baseReturn)}`, cls: "text-slate-500" },
                        { label: "This deal returns me",
                          val: formatCurrency(m.myProfit),
                          cls: m.myProfit >= baseReturn ? "text-emerald-700 font-bold" : "text-amber-700 font-bold" },
                      ].map((row, i) => (
                        <div key={i} className="px-4 py-2.5 flex justify-between text-xs">
                          <span className="text-slate-500">{row.label}</span>
                          <span className={row.cls}>{row.val}</span>
                        </div>
                      ))}
                      <div className="px-4 py-2.5 flex justify-between text-xs bg-slate-50/50">
                        <span className="text-slate-500 font-medium">vs 18% baseline</span>
                        <span className={`font-bold ${m.myProfit >= baseReturn ? "text-emerald-700" : "text-amber-700"}`}>
                          {m.myProfit >= baseReturn
                            ? `+${formatCurrency(m.myProfit - baseReturn)} better`
                            : `${formatCurrency(baseReturn - m.myProfit)} below`}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Downside scenarios */}
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Downside Scenarios</p>
                    <div className="space-y-2">
                      {/* Break-even */}
                      <div className="flex justify-between items-center px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs">
                        <div>
                          <p className="font-semibold text-amber-800">Break-even Sale</p>
                          <p className="text-[10px] text-amber-600">₹{Math.round(beBASE).toLocaleString("en-IN")}/sqft — capital returned, zero profit</p>
                        </div>
                        <span className="font-bold text-amber-700">₹0</span>
                      </div>
                      {/* 10% below target */}
                      <div className={`flex justify-between items-center px-4 py-3 rounded-xl text-xs border ${
                        downsideProfit >= 0 ? "bg-slate-50 border-slate-200" : "bg-rose-50 border-rose-200"
                      }`}>
                        <div>
                          <p className={`font-semibold ${downsideProfit >= 0 ? "text-slate-700" : "text-rose-800"}`}>
                            10% Below Target (₹{Math.round(downsidePx).toLocaleString("en-IN")}/sqft)
                          </p>
                          <p className="text-[10px] text-slate-500">Negotiation discount / buyer pressure</p>
                        </div>
                        <span className={`font-bold ${downsideProfit >= 0 ? "text-slate-700" : "text-rose-700"}`}>
                          {downsideProfit >= 0 ? "+" : ""}{formatCurrency(downsideProfit)}
                        </span>
                      </div>
                      {/* Seller rate exit */}
                      {worstPx && (
                        <div className={`flex justify-between items-center px-4 py-3 rounded-xl text-xs border ${
                          worstProfit >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"
                        }`}>
                          <div>
                            <p className={`font-semibold ${worstProfit >= 0 ? "text-emerald-800" : "text-rose-800"}`}>
                              Sell at Entry Price (₹{worstPx.toLocaleString("en-IN")}/sqft)
                            </p>
                            <p className="text-[10px] text-slate-500">Worst case — exit at what you paid the seller</p>
                          </div>
                          <span className={`font-bold ${worstProfit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {worstProfit >= 0 ? "+" : ""}{formatCurrency(worstProfit ?? 0)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* P&H additional commitment */}
                  {pah && m.regTotal > 0 && (
                    <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-violet-500 mb-3">Purchase & Hold — Additional Commitment</p>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-violet-700">Registry cost (₹{regPx}/sqft × {area.toLocaleString("en-IN")} sqft)</span>
                          <span className="font-bold text-violet-800">{formatCurrency(m.regTotal)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-violet-700">My share of registry ({myShare > 0 ? `${myShare}%` : "100%"})</span>
                          <span className="font-bold text-violet-800">{formatCurrency(m.regTotal * myFrac)}</span>
                        </div>
                        <div className="flex justify-between pt-2 mt-1 border-t border-violet-200">
                          <span className="font-semibold text-violet-800">Total capital blocked</span>
                          <span className="font-bold text-violet-900">{formatCurrency(m.myCapital)}</span>
                        </div>
                        <div className="flex justify-between text-violet-600">
                          <span>For a period of</span>
                          <span className="font-semibold">{fmtMonths(months)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Alternative Use of Capital — shown for both flip and P&H */}
            {hasData && m.myCapital > 0 && (
              <Card title="Alternative Use of Capital">
                <div className="space-y-5">
                  <Slider label="Lending Rate" value={lendRate} min={12} max={36} step={0.5}
                    fmt={v => `${v}% p.a.`} onChange={setLendRate} />

                  {/* Option A: Lend */}
                  <div className="bg-sky-50 border border-sky-200 rounded-xl p-4">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-sky-500 mb-3">Option A — Lend This Capital Out</p>
                    <div className="flex justify-between items-start text-xs mb-3">
                      <div>
                        <p className="font-semibold text-sky-800">
                          Lend {m.myCapital >= 1e5 ? `₹${(m.myCapital / 1e5).toFixed(1)}L` : formatCurrency(m.myCapital)} at {lendRate}% p.a.
                        </p>
                        <p className="text-[10px] text-sky-600 mt-0.5">for {fmtMonths(months)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-sky-700 text-base">{formatCurrency(lendReturn)}</p>
                        <p className="text-[10px] text-sky-500">interest income</p>
                      </div>
                    </div>
                    <div className="pt-2.5 border-t border-sky-200 flex justify-between text-[10px]">
                      <span className="text-sky-600 font-medium">vs this deal</span>
                      <span className={`font-bold ${m.myProfit >= lendReturn ? "text-emerald-700" : "text-rose-600"}`}>
                        {m.myProfit >= lendReturn
                          ? `Deal better by +${formatCurrency(m.myProfit - lendReturn)}`
                          : `Lending better by +${formatCurrency(lendReturn - m.myProfit)}`}
                      </span>
                    </div>
                  </div>

                  {/* Option B: Plot flip */}
                  <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-violet-500 mb-1">Option B — Flip Another Plot</p>
                    <p className="text-[10px] text-violet-600 mb-3">Deploy in a 4–5 month plot deal at 25–40% p.a. — typical market range</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white/70 border border-violet-200 rounded-lg px-3 py-2.5">
                        <p className="text-[10px] text-violet-500 font-medium">Conservative (25%)</p>
                        <p className="font-bold text-violet-800 text-sm tabular-nums">{formatCurrency(plotLow)}</p>
                        <p className="text-[9px] text-violet-500 mt-0.5">in 5 months</p>
                      </div>
                      <div className="bg-white/70 border border-violet-200 rounded-lg px-3 py-2.5">
                        <p className="text-[10px] text-violet-500 font-medium">Optimistic (40%)</p>
                        <p className="font-bold text-violet-800 text-sm tabular-nums">{formatCurrency(plotHigh)}</p>
                        <p className="text-[9px] text-violet-500 mt-0.5">in 5 months</p>
                      </div>
                    </div>
                    <p className="text-[9px] text-violet-400 mt-2.5">Illustrative — based on typical plot flip ROI in this market.</p>
                  </div>
                </div>
              </Card>
            )}

            {/* AI Insight */}
            <div className={`border rounded-2xl p-5 shadow-sm ${at.wrap}`}>
              <div className="flex items-center justify-between mb-4 gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{displayIcon}</span>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                      {aiData ? "Gemini AI Analysis" : "Quick Verdict"}
                    </p>
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide border ${at.badge}`}>
                      {displayVerdict}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => { setAiData(null); aiMut.mutate(); }}
                  disabled={aiMut.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-bold rounded-xl transition shrink-0">
                  {aiMut.isPending
                    ? <><span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin inline-block" /> Analysing…</>
                    : <>✨ Ask AI</>}
                </button>
              </div>

              {aiMut.isPending ? (
                <div className="space-y-2.5">
                  <div className="h-3 bg-black/10 rounded animate-pulse w-full" />
                  <div className="h-3 bg-black/10 rounded animate-pulse w-4/5" />
                  <div className="h-3 bg-black/10 rounded animate-pulse w-3/5" />
                </div>
              ) : (
                <p className={`text-xs leading-relaxed ${at.text}`}>{displayReason}</p>
              )}

              <div className="mt-4 pt-3 border-t border-black/5 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[9px] text-slate-400 mb-0.5">Holding</p>
                  <p className="text-xs font-bold text-slate-700">{fmtMonths(months)}</p>
                </div>
                <div>
                  <p className="text-[9px] text-slate-400 mb-0.5">Ann. ROI</p>
                  <p className={`text-xs font-bold ${at.text}`}>{m.annRoi.toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-[9px] text-slate-400 mb-0.5">Baseline</p>
                  <p className="text-xs font-bold text-slate-500">{BASELINE_PCT}%</p>
                </div>
              </div>

              {!aiData && !aiMut.isPending && (
                <p className="mt-3 text-[9px] text-slate-400 text-center leading-relaxed">
                  "Ask AI" sends all deal data to Gemini with your capital constraints and lending business context for a personalised analysis.
                </p>
              )}
            </div>

            {/* Scenarios comparison */}
            {saved.length > 1 && (
              <Card title="Scenarios Comparison">
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="border-b border-slate-200">
                        {["Name", "Mode", "Hold", "Ann. ROI", "Verdict"].map((h, i) => (
                          <th key={h} className={`py-2 text-slate-400 font-semibold ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {saved.map(sim => (
                        <tr key={sim.id}
                          className={`cursor-pointer transition hover:bg-slate-50 ${loadedId === sim.id ? "bg-indigo-50/50" : ""}`}
                          onClick={() => loadSim(sim)}>
                          <td className="py-2 font-medium text-slate-700 max-w-[100px] truncate">{sim.name}</td>
                          <td className="text-right py-2 text-slate-500">{sim.payload.purchase_and_hold ? "P&H" : "Flip"}</td>
                          <td className="text-right py-2 text-slate-500">{fmtMonths(sim.payload.holding_months)}</td>
                          <td className="text-right py-2 font-semibold text-slate-700">
                            {sim.payload.annualized_roi_pct != null ? `${sim.payload.annualized_roi_pct.toFixed(1)}%` : "—"}
                          </td>
                          <td className="text-right py-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                              sim.payload.ai_verdict === "SELL"     ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                              sim.payload.ai_verdict === "REGISTRY" ? "bg-sky-50 text-sky-700 border-sky-200" :
                                                                      "bg-amber-50 text-amber-700 border-amber-200"
                            }`}>{sim.payload.ai_verdict || "—"}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

          </div>
        </div>
      </PageBody>
    </div>
  );
}
