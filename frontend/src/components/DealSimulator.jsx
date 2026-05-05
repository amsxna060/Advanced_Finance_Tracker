/**
 * DealSimulator — Sandboxed "What-if" playground for a PropertyDeal.
 *
 * SAFETY GUARANTEE: This component never calls any API that mutates the core
 * property_deals or property_transactions tables. All calculations are local
 * React state. The only writes that reach the backend are to the dedicated
 * property_simulations table (POST/DELETE /api/properties/:id/simulations).
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { formatCurrency } from "../lib/utils";

// ── Constants ────────────────────────────────────────────────────────────────
const OPPORTUNITY_COST_BASELINE_PCT = 15; // % annualized baseline return to beat

// ── Helper: clamp ─────────────────────────────────────────────────────────────
const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

// ── Core financial calculations ───────────────────────────────────────────────
function computeMetrics({
  totalInvestment,     // total capital deployed (seller cost + any extras)
  totalArea,           // sqft
  targetPricePerSqft,
  holdingMonths,
  purchaseAndHold,
  registryCostPerSqft,
  annualAppreciationPct,
  targetAnnualProfitPct,
}) {
  const m = Math.max(holdingMonths, 1);

  // Effective investment in purchase-and-hold mode includes registry
  const registryTotal = purchaseAndHold ? registryCostPerSqft * totalArea : 0;
  const effectiveInvestment = totalInvestment + registryTotal;

  // In P&H mode, appreciate the base price per sqft over the holding period
  const appreciatedPricePerSqft = purchaseAndHold
    ? targetPricePerSqft * Math.pow(1 + annualAppreciationPct / 100, m / 12)
    : targetPricePerSqft;

  const netSaleProceeds = appreciatedPricePerSqft * totalArea;
  const absoluteProfit = netSaleProceeds - effectiveInvestment;
  const absoluteRoiPct =
    effectiveInvestment > 0 ? (absoluteProfit / effectiveInvestment) * 100 : 0;
  const annualizedRoiPct = (absoluteRoiPct / m) * 12;

  // Reverse-calc: given a desired annualized ROI, what price/sqft do we need?
  let breakevenPricePerSqft = null;
  if (targetAnnualProfitPct != null && totalArea > 0 && effectiveInvestment > 0) {
    // annualizedRoi = (absoluteRoi / m) * 12  →  absoluteRoi = targetAnnual * m / 12
    const neededAbsoluteRoi = (targetAnnualProfitPct * m) / 12;
    // absoluteRoi% = profit / investment * 100
    const neededProfit = (neededAbsoluteRoi / 100) * effectiveInvestment;
    const neededNetProceeds = effectiveInvestment + neededProfit;
    breakevenPricePerSqft =
      purchaseAndHold
        ? neededNetProceeds / totalArea / Math.pow(1 + annualAppreciationPct / 100, m / 12)
        : neededNetProceeds / totalArea;
  }

  return {
    effectiveInvestment,
    netSaleProceeds,
    absoluteProfit,
    absoluteRoiPct,
    annualizedRoiPct,
    appreciatedPricePerSqft,
    breakevenPricePerSqft,
    registryTotal,
  };
}

// ── AI Suggestion engine (pure logic, no external API) ────────────────────────
function generateAiSuggestion({
  annualizedRoiPct,
  absoluteRoiPct,
  holdingMonths,
  purchaseAndHold,
  registryCostPerSqft,
  annualAppreciationPct,
  absoluteProfit,
}) {
  const opportunityGap = annualizedRoiPct - OPPORTUNITY_COST_BASELINE_PCT;
  const capitalStuck = holdingMonths > 12;

  if (purchaseAndHold) {
    // Registry mode analysis
    const breakEvenMonthsForRegistry =
      annualAppreciationPct > 0
        ? ((registryCostPerSqft / /* avg price proxy */ 1000) * 100) /
          (annualAppreciationPct / 12)
        : null;

    if (annualAppreciationPct >= 12 && holdingMonths >= 18) {
      return {
        verdict: "REGISTRY",
        color: "emerald",
        icon: "📜",
        reasoning: `At ${annualAppreciationPct}% annual appreciation over ${holdingMonths} months, the registry cost is recouped through capital gains. Long-term hold strategy is sound. Annualized ROI: ${annualizedRoiPct.toFixed(1)}%.`,
      };
    }
    if (annualAppreciationPct < 8) {
      return {
        verdict: "HOLD",
        color: "amber",
        icon: "⏳",
        reasoning: `Appreciation at ${annualAppreciationPct}% is modest. Registry may not pay off within this holding window. Consider whether renting-out income could supplement the return before committing to registry.`,
      };
    }
    return {
      verdict: "REGISTRY",
      color: "emerald",
      icon: "📜",
      reasoning: `Appreciation of ${annualAppreciationPct}% p.a. over ${holdingMonths} months supports a long-term ownership play. Registry unlocks full resale value. Projected annualized ROI: ${annualizedRoiPct.toFixed(1)}%.`,
    };
  }

  // Flip/middleman mode
  if (absoluteProfit <= 0) {
    return {
      verdict: "HOLD",
      color: "rose",
      icon: "🚫",
      reasoning: `At ₹${Number(Math.round(absoluteProfit)).toLocaleString("en-IN")} absolute profit, selling now means a loss. Hold and wait for better market conditions or a higher buyer rate.`,
    };
  }

  if (annualizedRoiPct >= OPPORTUNITY_COST_BASELINE_PCT + 5) {
    return {
      verdict: "SELL",
      color: "emerald",
      icon: "✅",
      reasoning: `Annualized ROI of ${annualizedRoiPct.toFixed(1)}% comfortably beats the ${OPPORTUNITY_COST_BASELINE_PCT}% business baseline. This is an attractive deal — closing now frees capital for the next opportunity.`,
    };
  }

  if (opportunityGap < 0 && capitalStuck) {
    return {
      verdict: "SELL",
      color: "amber",
      icon: "⚠️",
      reasoning: `Capital stuck for ${holdingMonths} months with ${annualizedRoiPct.toFixed(1)}% annualized ROI vs. ${OPPORTUNITY_COST_BASELINE_PCT}% baseline. Opportunity cost is mounting. Consider accepting a slightly lower buyer rate to close the deal and redeploy capital.`,
    };
  }

  if (opportunityGap >= 0 && annualizedRoiPct >= 12) {
    return {
      verdict: "SELL",
      color: "emerald",
      icon: "✅",
      reasoning: `${annualizedRoiPct.toFixed(1)}% annualized ROI meets the baseline. Absolute profit of ${formatCurrency(absoluteProfit)} is solid for ${holdingMonths} months. A good time to sell and close.`,
    };
  }

  return {
    verdict: "HOLD",
    color: "amber",
    icon: "⏳",
    reasoning: `Annualized ROI of ${annualizedRoiPct.toFixed(1)}% is below the ${OPPORTUNITY_COST_BASELINE_PCT}% baseline but holding period is short (${holdingMonths} months). The market may deliver a better price. Monitor for ${Math.max(3, 9 - holdingMonths)} more months.`,
  };
}

// ── Slider component ──────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step = 1, unit = "", onChange, format }) {
  const display = format ? format(value) : `${Number(value).toLocaleString("en-IN")}${unit}`;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-widest text-amber-700">
          {label}
        </label>
        <span className="text-sm font-bold text-amber-900 tabular-nums">{display}</span>
      </div>
      <div className="relative h-5 flex items-center">
        <div className="absolute left-0 right-0 h-1.5 rounded-full bg-amber-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600"
            style={{ width: `${clamp(pct, 0, 100)}%` }}
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative w-full h-1.5 appearance-none bg-transparent cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4
            [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-amber-600
            [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-white
            [&::-webkit-slider-thumb]:shadow-md
            [&::-moz-range-thumb]:w-4
            [&::-moz-range-thumb]:h-4
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-amber-600
            [&::-moz-range-thumb]:border-2
            [&::-moz-range-thumb]:border-white"
        />
      </div>
      <div className="flex justify-between text-[9px] text-amber-400 mt-0.5 select-none">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

// ── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({ label, checked, onChange, description }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <div
        className={`relative mt-0.5 w-9 h-5 rounded-full transition-colors shrink-0 ${
          checked ? "bg-amber-500" : "bg-slate-200"
        }`}
        onClick={() => onChange(!checked)}
      >
        <div
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </div>
      <div>
        <p className="text-xs font-semibold text-amber-900">{label}</p>
        {description && <p className="text-[10px] text-amber-700/70">{description}</p>}
      </div>
    </label>
  );
}

// ── Metric card (amber theme) ─────────────────────────────────────────────────
function SimMetric({ label, value, sub, accent = "amber" }) {
  const styles = {
    amber:   { bg: "bg-amber-50 border-amber-200",   text: "text-amber-800"   },
    emerald: { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-800" },
    rose:    { bg: "bg-rose-50 border-rose-200",     text: "text-rose-800"    },
    sky:     { bg: "bg-sky-50 border-sky-200",       text: "text-sky-800"     },
    slate:   { bg: "bg-slate-50 border-slate-200",   text: "text-slate-700"   },
  };
  const s = styles[accent] || styles.amber;
  return (
    <div className={`rounded-xl border p-3 ${s.bg}`}>
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">{label}</p>
      <p className={`text-base font-bold tabular-nums ${s.text}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Main DealSimulator component ──────────────────────────────────────────────
export default function DealSimulator({ property, onClose }) {
  const propertyId = property.id;
  const queryClient = useQueryClient();

  // ── Seed from live property data (clone, never mutate) ──
  const totalArea        = parseFloat(property.total_area_sqft || 0);
  const advancePaid      = parseFloat(property.advance_paid || 0);
  const brokerComm       = parseFloat(property.broker_commission || 0);
  const otherExp         = parseFloat(property.other_expenses || 0);
  const totalSeller      = parseFloat(property.total_seller_value || 0);
  const totalInvestment  = totalSeller + brokerComm + otherExp;
  const breakevenBase    = totalArea > 0 ? totalInvestment / totalArea : 0;
  const sellerRate       = parseFloat(property.seller_rate_per_sqft || 0);

  // ── Simulator state ──────────────────────────────────────
  const [holdingMonths, setHoldingMonths]             = useState(6);
  const [targetPricePerSqft, setTargetPricePerSqft]   = useState(
    Math.ceil(breakevenBase * 1.15) || (sellerRate > 0 ? Math.ceil(sellerRate * 1.2) : 500)
  );
  const [targetAnnualProfitPct, setTargetAnnualProfitPct] = useState(15);
  const [purchaseAndHold, setPurchaseAndHold]         = useState(false);
  const [registryCostPerSqft, setRegistryCostPerSqft] = useState(70);
  const [annualAppreciationPct, setAnnualAppreciationPct] = useState(12);
  const [scenarioName, setScenarioName]               = useState("");
  const [loadedSim, setLoadedSim]                     = useState(null);

  // Compute slider bounds based on property data
  const priceMin  = Math.max(100, Math.floor(breakevenBase * 0.7));
  const priceMax  = Math.ceil(breakevenBase * 3) || 5000;
  const priceStep = Math.max(1, Math.floor((priceMax - priceMin) / 200));

  // ── Derived calculations (memoized) ──────────────────────
  const metrics = useMemo(
    () =>
      computeMetrics({
        totalInvestment,
        totalArea,
        targetPricePerSqft,
        holdingMonths,
        purchaseAndHold,
        registryCostPerSqft,
        annualAppreciationPct,
        targetAnnualProfitPct,
      }),
    [
      totalInvestment, totalArea, targetPricePerSqft, holdingMonths,
      purchaseAndHold, registryCostPerSqft, annualAppreciationPct, targetAnnualProfitPct,
    ]
  );

  const aiSuggestion = useMemo(
    () =>
      generateAiSuggestion({
        annualizedRoiPct: metrics.annualizedRoiPct,
        absoluteRoiPct: metrics.absoluteRoiPct,
        holdingMonths,
        purchaseAndHold,
        registryCostPerSqft,
        annualAppreciationPct,
        absoluteProfit: metrics.absoluteProfit,
      }),
    [metrics, holdingMonths, purchaseAndHold, registryCostPerSqft, annualAppreciationPct]
  );

  // ── Saved simulations ─────────────────────────────────────
  const { data: savedSims = [], refetch: refetchSims } = useQuery({
    queryKey: ["simulations", propertyId],
    queryFn: async () => (await api.get(`/api/properties/${propertyId}/simulations`)).data,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        holding_months: holdingMonths,
        target_price_per_sqft: targetPricePerSqft,
        target_annual_profit_pct: targetAnnualProfitPct,
        purchase_and_hold: purchaseAndHold,
        registry_cost_per_sqft: registryCostPerSqft,
        annual_appreciation_pct: annualAppreciationPct,
        absolute_profit: metrics.absoluteProfit,
        absolute_roi_pct: metrics.absoluteRoiPct,
        annualized_roi_pct: metrics.annualizedRoiPct,
        breakeven_price_per_sqft: metrics.breakevenPricePerSqft,
        ai_verdict: aiSuggestion.verdict,
        ai_reasoning: aiSuggestion.reasoning,
      };
      return (
        await api.post(`/api/properties/${propertyId}/simulations`, {
          name: scenarioName.trim() || `Scenario ${new Date().toLocaleDateString("en-IN")}`,
          payload,
        })
      ).data;
    },
    onSuccess: () => {
      refetchSims();
      setScenarioName("");
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to save simulation"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (simId) =>
      api.delete(`/api/properties/${propertyId}/simulations/${simId}`),
    onSuccess: () => refetchSims(),
  });

  const loadSimulation = useCallback((sim) => {
    const p = sim.payload;
    setHoldingMonths(p.holding_months ?? 6);
    setTargetPricePerSqft(p.target_price_per_sqft ?? targetPricePerSqft);
    setTargetAnnualProfitPct(p.target_annual_profit_pct ?? 15);
    setPurchaseAndHold(p.purchase_and_hold ?? false);
    setRegistryCostPerSqft(p.registry_cost_per_sqft ?? 70);
    setAnnualAppreciationPct(p.annual_appreciation_pct ?? 12);
    setLoadedSim(sim);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Profit/loss colouring ─────────────────────────────────
  const profitAccent =
    metrics.absoluteProfit > 0
      ? "emerald"
      : metrics.absoluteProfit < 0
      ? "rose"
      : "slate";

  const roiAccent =
    metrics.annualizedRoiPct >= OPPORTUNITY_COST_BASELINE_PCT
      ? "emerald"
      : metrics.annualizedRoiPct >= 8
      ? "amber"
      : "rose";

  const verdictColors = {
    emerald: { bg: "bg-emerald-50 border-emerald-300", text: "text-emerald-800", badge: "bg-emerald-100 text-emerald-800" },
    amber:   { bg: "bg-amber-50 border-amber-300",   text: "text-amber-900",   badge: "bg-amber-100 text-amber-800"   },
    rose:    { bg: "bg-rose-50 border-rose-300",     text: "text-rose-800",    badge: "bg-rose-100 text-rose-800"     },
  };
  const vc = verdictColors[aiSuggestion.color] || verdictColors.amber;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-amber-900/20 backdrop-blur-sm p-4">
      <div className="max-w-4xl mx-auto min-h-screen pb-12">

        {/* ── Sandbox Banner ── */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-amber-600 text-white px-5 py-3 rounded-b-2xl shadow-lg mb-6">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🧪</span>
            <div>
              <p className="text-sm font-bold tracking-wide">SANDBOX MODE — Deal Simulator</p>
              <p className="text-[10px] text-amber-200">No live data is being changed. All calculations are hypothetical.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white text-sm font-bold transition shrink-0"
          >
            ✕
          </button>
        </div>

        {/* ── Live property snapshot ── */}
        <div className="bg-white border border-amber-200 rounded-2xl p-4 mb-5 shadow-sm">
          <p className="text-[9px] font-bold uppercase tracking-widest text-amber-600 mb-2">
            Seeded from live property data (read-only)
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SimMetric
              label="Total Area"
              value={totalArea > 0 ? `${Number(totalArea).toLocaleString("en-IN")} sqft` : "—"}
              accent="slate"
            />
            <SimMetric
              label="Total Investment"
              value={formatCurrency(totalInvestment)}
              sub="seller + broker + expenses"
              accent="slate"
            />
            <SimMetric
              label="Break-even Rate"
              value={breakevenBase > 0 ? `₹${Math.round(breakevenBase).toLocaleString("en-IN")}/sqft` : "—"}
              accent="slate"
            />
            <SimMetric
              label="Advance Paid"
              value={formatCurrency(advancePaid)}
              accent="slate"
            />
          </div>
        </div>

        {/* ── Main two-column layout ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* ── LEFT: Controls ── */}
          <div className="space-y-5">

            {/* Sliders */}
            <div className="bg-white border border-amber-200 rounded-2xl p-5 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-4">
                📊 Simulation Controls
              </h3>
              <div className="space-y-5">
                <Slider
                  label="Holding Period"
                  value={holdingMonths}
                  min={1}
                  max={36}
                  step={1}
                  unit=" mo"
                  onChange={setHoldingMonths}
                />
                <Slider
                  label="Target Sale Price"
                  value={targetPricePerSqft}
                  min={priceMin}
                  max={priceMax}
                  step={priceStep}
                  onChange={setTargetPricePerSqft}
                  format={(v) => `₹${Number(v).toLocaleString("en-IN")}/sqft`}
                />

                {/* Break-even reverse calc */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-amber-700 mb-1.5">
                    Target Annual Profit %
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={targetAnnualProfitPct ?? ""}
                      min={0}
                      max={200}
                      step={0.5}
                      onChange={(e) =>
                        setTargetAnnualProfitPct(
                          e.target.value === "" ? null : parseFloat(e.target.value)
                        )
                      }
                      className="w-24 border border-amber-200 rounded-lg px-3 py-1.5 text-sm font-semibold text-amber-900 bg-amber-50 focus:outline-none focus:ring-1 focus:ring-amber-400"
                      placeholder="15"
                    />
                    <span className="text-xs text-amber-700">% per year</span>
                    {metrics.breakevenPricePerSqft != null && (
                      <div className="ml-auto text-right">
                        <p className="text-[9px] text-slate-400 uppercase tracking-wide">Break-even Price</p>
                        <p className="text-sm font-bold text-sky-700 tabular-nums">
                          ₹{Math.ceil(metrics.breakevenPricePerSqft).toLocaleString("en-IN")}/sqft
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Purchase & Hold toggle */}
            <div className="bg-white border border-amber-200 rounded-2xl p-5 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-4">
                🏠 Ownership Mode
              </h3>
              <Toggle
                label="Purchase & Hold"
                description="Simulate buying the property outright instead of flipping it."
                checked={purchaseAndHold}
                onChange={setPurchaseAndHold}
              />

              {purchaseAndHold && (
                <div className="mt-4 space-y-4 pl-1 border-l-2 border-amber-300">
                  <div className="pl-3">
                    <Slider
                      label="Registry Cost"
                      value={registryCostPerSqft}
                      min={20}
                      max={200}
                      step={5}
                      onChange={setRegistryCostPerSqft}
                      format={(v) => `₹${v}/sqft`}
                    />
                    <p className="text-[10px] text-amber-600 mt-1">
                      Total registry cost:{" "}
                      <strong>
                        ₹{Math.round(registryCostPerSqft * totalArea).toLocaleString("en-IN")}
                      </strong>
                    </p>
                  </div>
                  <div className="pl-3">
                    <Slider
                      label="Annual Appreciation"
                      value={annualAppreciationPct}
                      min={0}
                      max={50}
                      step={0.5}
                      onChange={setAnnualAppreciationPct}
                      format={(v) => `${v}% p.a.`}
                    />
                  </div>
                  {purchaseAndHold && metrics.appreciatedPricePerSqft !== targetPricePerSqft && (
                    <div className="pl-3 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Projected value after {holdingMonths} months:{" "}
                      <strong>
                        ₹{Math.round(metrics.appreciatedPricePerSqft).toLocaleString("en-IN")}/sqft
                      </strong>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Save / Load scenarios */}
            <div className="bg-white border border-amber-200 rounded-2xl p-5 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-4">
                💾 Save / Load Scenarios
              </h3>

              {/* Save */}
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                  placeholder="Scenario name (e.g. Best Case – 8 Months)"
                  className="flex-1 border border-amber-200 rounded-xl px-3 py-2 text-xs bg-amber-50 focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder-amber-300"
                />
                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="px-4 py-2 bg-amber-600 text-white text-xs font-semibold rounded-xl hover:bg-amber-700 transition disabled:opacity-50 shrink-0"
                >
                  {saveMutation.isPending ? "Saving…" : "Save"}
                </button>
              </div>

              {/* Saved list */}
              {savedSims.length === 0 ? (
                <p className="text-[10px] text-slate-400 italic text-center py-2">
                  No saved scenarios yet.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {savedSims.map((sim) => (
                    <div
                      key={sim.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs cursor-pointer transition ${
                        loadedSim?.id === sim.id
                          ? "bg-amber-100 border-amber-400"
                          : "bg-slate-50 border-slate-200 hover:bg-amber-50 hover:border-amber-200"
                      }`}
                    >
                      <button
                        className="flex-1 text-left"
                        onClick={() => loadSimulation(sim)}
                      >
                        <p className="font-semibold text-slate-700">{sim.name}</p>
                        <p className="text-[10px] text-slate-400">
                          {sim.payload.ai_verdict && (
                            <span
                              className={`mr-1.5 px-1.5 py-0.5 rounded font-bold text-[9px] uppercase ${
                                sim.payload.ai_verdict === "SELL"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : sim.payload.ai_verdict === "REGISTRY"
                                  ? "bg-sky-100 text-sky-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {sim.payload.ai_verdict}
                            </span>
                          )}
                          {sim.payload.annualized_roi_pct != null &&
                            `${sim.payload.annualized_roi_pct.toFixed(1)}% ann. ROI · `}
                          {sim.payload.holding_months}mo
                        </p>
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete "${sim.name}"?`))
                            deleteMutation.mutate(sim.id);
                        }}
                        className="text-rose-400 hover:text-rose-600 text-base leading-none shrink-0 ml-1"
                        title="Delete"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT: Results ── */}
          <div className="space-y-5">

            {/* Key metrics */}
            <div className="bg-white border border-amber-200 rounded-2xl p-5 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-4">
                📈 Calculated Results
              </h3>

              {totalInvestment === 0 || totalArea === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  <p>Add total area and investment details to this property to unlock simulation metrics.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <SimMetric
                      label="Absolute Profit"
                      value={formatCurrency(metrics.absoluteProfit)}
                      sub={`${metrics.absoluteRoiPct.toFixed(1)}% absolute ROI`}
                      accent={profitAccent}
                    />
                    <SimMetric
                      label="Annualized ROI"
                      value={`${metrics.annualizedRoiPct.toFixed(1)}%`}
                      sub={`over ${holdingMonths} months`}
                      accent={roiAccent}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <SimMetric
                      label="Net Sale Proceeds"
                      value={formatCurrency(metrics.netSaleProceeds)}
                      sub={
                        purchaseAndHold
                          ? `₹${Math.round(metrics.appreciatedPricePerSqft).toLocaleString("en-IN")}/sqft appreciated`
                          : `₹${Number(targetPricePerSqft).toLocaleString("en-IN")}/sqft`
                      }
                      accent="sky"
                    />
                    <SimMetric
                      label="Effective Investment"
                      value={formatCurrency(metrics.effectiveInvestment)}
                      sub={
                        purchaseAndHold && metrics.registryTotal > 0
                          ? `incl. ₹${Math.round(metrics.registryTotal).toLocaleString("en-IN")} registry`
                          : "all-in cost"
                      }
                      accent="slate"
                    />
                  </div>

                  {/* Baseline comparison bar */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                      vs {OPPORTUNITY_COST_BASELINE_PCT}% Baseline Business Return
                    </p>
                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden mb-1.5">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          metrics.annualizedRoiPct >= OPPORTUNITY_COST_BASELINE_PCT
                            ? "bg-emerald-500"
                            : "bg-amber-400"
                        }`}
                        style={{
                          width: `${clamp(
                            (metrics.annualizedRoiPct / (OPPORTUNITY_COST_BASELINE_PCT * 2)) * 100,
                            0,
                            100
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[9px]">
                      <span
                        className={
                          metrics.annualizedRoiPct >= OPPORTUNITY_COST_BASELINE_PCT
                            ? "text-emerald-700 font-semibold"
                            : "text-amber-700 font-semibold"
                        }
                      >
                        Your deal: {metrics.annualizedRoiPct.toFixed(1)}%
                      </span>
                      <span className="text-slate-400">
                        Baseline: {OPPORTUNITY_COST_BASELINE_PCT}%
                      </span>
                    </div>
                  </div>

                  {/* Break-even reverse calc result */}
                  {metrics.breakevenPricePerSqft != null && (
                    <div className="bg-sky-50 border border-sky-200 rounded-xl p-3">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-sky-500 mb-1">
                        Break-even Price for {targetAnnualProfitPct}% Annual Target
                      </p>
                      <p className="text-xl font-bold text-sky-800 tabular-nums">
                        ₹{Math.ceil(metrics.breakevenPricePerSqft).toLocaleString("en-IN")}/sqft
                      </p>
                      <p className="text-[10px] text-sky-600 mt-0.5">
                        {metrics.breakevenPricePerSqft <= targetPricePerSqft
                          ? "✅ Your target price exceeds this — you'll hit the goal."
                          : `⚠️ You need ₹${Math.ceil(
                              metrics.breakevenPricePerSqft - targetPricePerSqft
                            ).toLocaleString("en-IN")}/sqft more to hit the goal.`}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* AI Suggestion */}
            <div className={`border rounded-2xl p-5 shadow-sm ${vc.bg}`}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">{aiSuggestion.icon}</span>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    AI Insight Engine
                  </p>
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${vc.badge}`}
                  >
                    {aiSuggestion.verdict}
                  </span>
                </div>
              </div>
              <p className={`text-xs leading-relaxed ${vc.text}`}>{aiSuggestion.reasoning}</p>

              {/* Parameter breakdown */}
              <div className="mt-3 pt-3 border-t border-black/5 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[9px] text-slate-400">Holding</p>
                  <p className="text-xs font-bold text-slate-700">{holdingMonths} mo</p>
                </div>
                <div>
                  <p className="text-[9px] text-slate-400">Ann. ROI</p>
                  <p className={`text-xs font-bold ${vc.text}`}>
                    {metrics.annualizedRoiPct.toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p className="text-[9px] text-slate-400">Baseline</p>
                  <p className="text-xs font-bold text-slate-500">{OPPORTUNITY_COST_BASELINE_PCT}%</p>
                </div>
              </div>
            </div>

            {/* Scenario comparison table */}
            {savedSims.length > 0 && (
              <div className="bg-white border border-amber-200 rounded-2xl p-5 shadow-sm">
                <h3 className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-3">
                  📋 Saved Scenarios Comparison
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-1.5 text-slate-400 font-semibold">Name</th>
                        <th className="text-right py-1.5 text-slate-400 font-semibold">Months</th>
                        <th className="text-right py-1.5 text-slate-400 font-semibold">Ann. ROI</th>
                        <th className="text-right py-1.5 text-slate-400 font-semibold">Verdict</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {savedSims.map((sim) => (
                        <tr key={sim.id} className="hover:bg-amber-50 transition cursor-pointer" onClick={() => loadSimulation(sim)}>
                          <td className="py-1.5 font-medium text-slate-700 max-w-[120px] truncate">
                            {sim.name}
                          </td>
                          <td className="text-right py-1.5 text-slate-500">{sim.payload.holding_months}mo</td>
                          <td className="text-right py-1.5 font-semibold text-slate-700">
                            {sim.payload.annualized_roi_pct != null
                              ? `${sim.payload.annualized_roi_pct.toFixed(1)}%`
                              : "—"}
                          </td>
                          <td className="text-right py-1.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                sim.payload.ai_verdict === "SELL"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : sim.payload.ai_verdict === "REGISTRY"
                                  ? "bg-sky-100 text-sky-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {sim.payload.ai_verdict || "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
