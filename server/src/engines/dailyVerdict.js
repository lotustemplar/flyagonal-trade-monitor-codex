const DEFAULT_VERDICT = {
  verdict: "KEEP TRADE OPEN",
  severity: "GREEN",
  reason: "Trade is healthy.",
  rule: "HOLD"
};

function num(value) {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

function normalizeTargetPct(value) {
  const numeric = num(value);
  if (numeric === null) return null;
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

export function getDailyVerdict(trade, settings) {
  const currentPl = num(trade.current_pl_pct);
  const highestPnlYet = Math.max(0, num(trade.hwm_pct) ?? 0);
  const currentDte = num(trade.current_dte);
  const profitTargetPct = normalizeTargetPct(trade.profit_target_pct) ?? settings.default_profit_target_pct;
  const approachingThreshold = profitTargetPct * settings.approaching_profit_target_fraction;
  const entryVix = num(trade.vix_at_entry);
  const isCautionZone = entryVix !== null && entryVix >= settings.vix_optimal_high && entryVix < settings.vix_caution_high;
  const currentDay = num(trade.trade_day_number) ?? 0;
  const vixChangeFromEntry = num(trade.vix_change_from_entry);
  const trendLast24h = trade.trade_value_trend_last_24h || null;
  const peakDayNumber = num(trade.peak_day_number);
  const entryDay = String(trade.entry_day || "");

  if (currentPl !== null && currentPl >= profitTargetPct) {
    return {
      verdict: "CLOSE ALL",
      severity: "GREEN",
      reason: `PT HIT - CLOSE NOW. Current P/L is ${currentPl.toFixed(1)}%, which meets or exceeds the ${profitTargetPct.toFixed(1)}% profit target. Close all contracts immediately.`,
      rule: "PT-HIT"
    };
  }

  if (currentDte !== null && currentDte <= 0) {
    return {
      verdict: "CLOSE ALL",
      severity: "RED",
      reason: "Trade reached expiration while still open. This should not happen with the checkpoint system. Treat it as a full loss and close any residual exposure immediately.",
      rule: "EXPIRED"
    };
  }

  if (currentDte === settings.checkpoint_scaleout_dte && highestPnlYet < settings.checkpoint_hwm_pct) {
    if (trendLast24h === "rising") {
      return {
        verdict: "KEEP TRADE OPEN - RECOVERY WATCH",
        severity: "AMBER",
        reason: `4 DTE - Highest P/L yet is still below ${settings.checkpoint_hwm_pct.toFixed(1)}% (current HWM: ${highestPnlYet.toFixed(1)}%), but the trade is rising over the last ${settings.recovery_trend_window_hours}h. Hold for now and bail at ${settings.bail_dte} DTE if HWM is still below ${settings.bail_hwm_pct.toFixed(1)}%.`,
        rule: "RECOVERY-4DTE"
      };
    }

    return {
      verdict: "SCALE OUT 50%",
      severity: "AMBER",
      reason: `4 DTE CHECKPOINT - Highest P/L yet never hit ${settings.checkpoint_hwm_pct.toFixed(1)}% (current HWM: ${highestPnlYet.toFixed(1)}%) and the trade is still ${trendLast24h === "declining" ? "declining" : "not showing a recovery bounce"}. Scale out half at market open.`,
      rule: "CHECKPOINT-4DTE"
    };
  }

  if (
    isCautionZone &&
    currentDte === settings.checkpoint_scaleout_dte &&
    highestPnlYet >= settings.checkpoint_hwm_pct &&
    currentPl !== null &&
    currentPl < settings.caution_zone_pullback_pl_pct
  ) {
    return {
      verdict: "SCALE OUT 50%",
      severity: "AMBER",
      reason: `CAUTION ZONE OVERRIDE - Entry VIX was between ${settings.vix_optimal_high} and ${settings.vix_caution_high}, HWM cleared ${settings.checkpoint_hwm_pct.toFixed(1)}%, but current P/L has faded to ${currentPl.toFixed(1)}% at 4 DTE. Scale out half and tighten management.`,
      rule: "CAUTION-4DTE"
    };
  }

  if (currentDte !== null && currentDte <= settings.bail_dte && highestPnlYet < settings.bail_hwm_pct) {
    return {
      verdict: "CLOSE ALL",
      severity: "RED",
      reason: `2 DTE BAIL - Highest P/L yet never hit ${settings.bail_hwm_pct.toFixed(1)}% (current HWM: ${highestPnlYet.toFixed(1)}%). Close everything at market open.`,
      rule: "BAIL-2DTE"
    };
  }

  if (
    vixChangeFromEntry !== null &&
    vixChangeFromEntry < -settings.day2_vix_warning_drop_points &&
    currentDay <= 2 &&
    highestPnlYet < settings.day2_vix_warning_hwm_pct
  ) {
    return {
      verdict: "KEEP TRADE OPEN - EARLY WARNING",
      severity: "AMBER",
      reason: `VIX dropped ${Math.abs(vixChangeFromEntry).toFixed(2)} points from entry within the first ${currentDay || 2} days and highest P/L yet is still below ${settings.day2_vix_warning_hwm_pct.toFixed(1)}%. Elevated risk - monitor closely.`,
      rule: "DAY2-VIX-WARN"
    };
  }

  if (
    highestPnlYet >= settings.stale_peak_hwm_min &&
    currentPl !== null &&
    currentPl < highestPnlYet * settings.stale_peak_drawdown_fraction &&
    peakDayNumber !== null &&
    currentDay - peakDayNumber >= settings.stale_peak_days
  ) {
    return {
      verdict: "KEEP TRADE OPEN - STALE PEAK WARNING",
      severity: "AMBER",
      reason: `Trade peaked at ${highestPnlYet.toFixed(1)}% but has given back more than ${((1 - settings.stale_peak_drawdown_fraction) * 100).toFixed(0)}% for ${currentDay - peakDayNumber} days. Watch closely for loser behavior.`,
      rule: "STALE-PEAK"
    };
  }

  if (currentPl !== null && currentPl >= approachingThreshold) {
    return {
      verdict: "KEEP TRADE OPEN - APPROACHING PT",
      severity: "AMBER",
      reason: `Approaching profit target - current P/L is ${currentPl.toFixed(1)}%, which is at least ${(settings.approaching_profit_target_fraction * 100).toFixed(0)}% of the ${profitTargetPct.toFixed(1)}% target. Watch closely and prepare to close.`,
      rule: "APPROACHING-PT"
    };
  }

  if (currentDte === settings.checkpoint_scaleout_dte && highestPnlYet >= settings.checkpoint_hwm_pct) {
    return {
      verdict: "KEEP TRADE OPEN",
      severity: "GREEN",
      reason: `4 DTE - Highest P/L yet crossed ${settings.checkpoint_hwm_pct.toFixed(1)}% (current HWM: ${highestPnlYet.toFixed(1)}%). Trade is on track.`,
      rule: "PASS-4DTE"
    };
  }

  if (currentDte !== null && currentDte <= settings.bail_dte && highestPnlYet >= settings.bail_hwm_pct) {
    return {
      verdict: "KEEP TRADE OPEN",
      severity: "GREEN",
      reason: `2 DTE - Highest P/L yet crossed ${settings.bail_hwm_pct.toFixed(1)}% (current HWM: ${highestPnlYet.toFixed(1)}%). Historical win path remains intact.`,
      rule: "PASS-2DTE"
    };
  }

  if (entryDay === "Wednesday" && isCautionZone) {
    return {
      verdict: "KEEP TRADE OPEN - WEDNESDAY CAUTION",
      severity: "AMBER",
      reason: "Wednesday entry in the Caution zone is the highest loss-rate combination. Manage more tightly than usual.",
      rule: "WED-CAUTION"
    };
  }

  return {
    ...DEFAULT_VERDICT,
    reason: `Trade is active. Highest P/L yet: ${highestPnlYet.toFixed(1)}% | Current P/L: ${currentPl?.toFixed(1) ?? "n/a"}% | DTE: ${currentDte ?? "n/a"} | Profit target: ${profitTargetPct.toFixed(1)}%.`
  };
}
