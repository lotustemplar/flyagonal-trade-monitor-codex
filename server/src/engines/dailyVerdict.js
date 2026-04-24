const DEFAULT_VERDICT = {
  verdict: "KEEP TRADE OPEN",
  severity: "GREEN",
  reason: "Trade is healthy.",
  rule: "HOLD"
};

function num(value) {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

export function getDailyVerdict(trade, settings) {
  const currentPl = num(trade.current_pl_pct);
  const highestPnlYet = Math.max(0, num(trade.hwm_pct) ?? 0);
  const currentDte = num(trade.current_dte);
  const profitTargetPct = num(trade.profit_target_pct) ?? settings.default_profit_target_pct;
  const approachingThreshold = profitTargetPct * settings.approaching_profit_target_fraction;
  const entryVix = num(trade.vix_at_entry);
  const isCautionZone = entryVix !== null && entryVix >= settings.vix_optimal_high && entryVix < settings.vix_caution_high;

  if (currentPl !== null && currentPl >= profitTargetPct) {
    return {
      verdict: "CLOSE ALL",
      severity: "GREEN",
      reason: `PT HIT — CLOSE NOW. Current P/L is ${currentPl.toFixed(1)}%, which meets or exceeds the ${profitTargetPct.toFixed(1)}% profit target. Close all contracts immediately.`,
      rule: "PT-HIT"
    };
  }

  if (currentDte === settings.checkpoint_scaleout_dte && highestPnlYet < settings.checkpoint_hwm_pct) {
    return {
      verdict: "SCALE OUT 50%",
      severity: "AMBER",
      reason: `4 DTE CHECKPOINT — Highest P/L yet never hit ${settings.checkpoint_hwm_pct.toFixed(1)}% (current HWM: ${highestPnlYet.toFixed(1)}%). Scale out half at market open.`,
      rule: "CHECKPOINT-4DTE"
    };
  }

  if (currentDte !== null && currentDte <= settings.bail_dte && highestPnlYet < settings.bail_hwm_pct) {
    return {
      verdict: "CLOSE ALL",
      severity: "RED",
      reason: `2 DTE BAIL — Highest P/L yet never hit ${settings.bail_hwm_pct.toFixed(1)}% (current HWM: ${highestPnlYet.toFixed(1)}%). Close everything at market open.`,
      rule: "BAIL-2DTE"
    };
  }

  if (isCautionZone && currentDte === settings.checkpoint_scaleout_dte && highestPnlYet >= settings.checkpoint_hwm_pct && currentPl !== null && currentPl < settings.caution_zone_pullback_pl_pct) {
    return {
      verdict: "SCALE OUT 50%",
      severity: "AMBER",
      reason: `CAUTION ZONE OVERRIDE — Entry VIX was in the 16-18 zone, HWM did hit ${settings.checkpoint_hwm_pct.toFixed(1)}%, but current P/L has faded to ${currentPl.toFixed(1)}% at 4 DTE. Scale out half and tighten management.`,
      rule: "CAUTION-4DTE"
    };
  }

  if (currentPl !== null && currentPl >= approachingThreshold) {
    return {
      verdict: "KEEP TRADE OPEN — APPROACHING PT",
      severity: "AMBER",
      reason: `Approaching profit target — current P/L is ${currentPl.toFixed(1)}%, which is at least 85% of the ${profitTargetPct.toFixed(1)}% target. Watch closely and prepare to close.`,
      rule: "APPROACHING-PT"
    };
  }

  if (currentDte === settings.checkpoint_scaleout_dte && highestPnlYet >= settings.checkpoint_hwm_pct) {
    return {
      verdict: "KEEP TRADE OPEN",
      severity: "GREEN",
      reason: `4 DTE — Highest P/L yet crossed ${settings.checkpoint_hwm_pct.toFixed(1)}% (current HWM: ${highestPnlYet.toFixed(1)}%). Trade is still on track.`,
      rule: "PASS-4DTE"
    };
  }

  if (currentDte !== null && currentDte <= settings.bail_dte && highestPnlYet >= settings.bail_hwm_pct) {
    return {
      verdict: "KEEP TRADE OPEN",
      severity: "GREEN",
      reason: `2 DTE — Highest P/L yet crossed ${settings.bail_hwm_pct.toFixed(1)}% (current HWM: ${highestPnlYet.toFixed(1)}%). Historical win path still intact.`,
      rule: "PASS-2DTE"
    };
  }

  return {
    ...DEFAULT_VERDICT,
    reason: `Trade is active. Highest P/L yet: ${highestPnlYet.toFixed(1)}% | Current P/L: ${currentPl?.toFixed(1) ?? "n/a"}% | DTE: ${currentDte ?? "n/a"} | Profit target: ${profitTargetPct.toFixed(1)}%.`
  };
}
