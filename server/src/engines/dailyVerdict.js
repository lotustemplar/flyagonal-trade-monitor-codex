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
  const hwm = Math.max(0, num(trade.hwm_pct) ?? 0);
  const currentDte = num(trade.current_dte);
  const dayNumber = num(trade.trade_day_number) ?? 0;
  const vixCurrent = num(trade.vix_current);
  const vixYesterday = num(trade.vix_yesterday);
  const vix3DaysAgo = num(trade.vix_3days_ago);
  const spxTrendDays = num(trade.spx_consecutive_days) ?? 0;
  const macroRiskWithin2Days = Boolean(trade.macro_risk_within_2_days);

  if (dayNumber === 1 && hwm <= settings.zero_profit_day_one_hwm) {
    return {
      verdict: "CLOSE 50%",
      severity: "RED",
      reason: "DAY 1 ALERT — Trade has made 0% profit since entry. Reduce to 50% size immediately. If still 0% by end of Day 2, close all remaining.",
      rule: "E1"
    };
  }

  if (dayNumber === 2 && hwm <= settings.zero_profit_day_two_hwm) {
    return {
      verdict: "CLOSE ALL",
      severity: "RED",
      reason: "CLOSE TRADE IMMEDIATELY — Structure has never generated any profit in 2 days. Rule E1 confirmed. Exit at market open.",
      rule: "E1-confirmed"
    };
  }

  if (dayNumber >= settings.binary_separator_day && hwm < settings.hwm_threshold_pct) {
    return {
      verdict: "CLOSE ALL",
      severity: "RED",
      reason: `CLOSE TRADE IMMEDIATELY — Day ${dayNumber} and trade has never crossed ${settings.hwm_threshold_pct}% HWM (current HWM: ${hwm.toFixed(1)}%). Exit at tomorrow's open.`,
      rule: "E2"
    };
  }

  if (hwm >= settings.hwm_threshold_pct && currentPl !== null && currentPl <= settings.reversal_close_pl_pct) {
    return {
      verdict: "CLOSE ALL",
      severity: "RED",
      reason: `CLOSE TRADE IMMEDIATELY — Trade reached ${hwm.toFixed(1)}% HWM but has given back all profit to ${currentPl.toFixed(1)}%. Exit now.`,
      rule: "E3"
    };
  }

  if (vixYesterday && vixCurrent && hwm < settings.hwm_threshold_pct) {
    const vixDrop = ((vixYesterday - vixCurrent) / vixYesterday) * 100;
    if (vixDrop >= settings.vix_collapse_pct) {
      return {
        verdict: "CLOSE ALL",
        severity: "RED",
        reason: `CLOSE TRADE — VIX collapsed ${vixDrop.toFixed(1)}% today (${vixYesterday} → ${vixCurrent}) while trade has never crossed ${settings.hwm_threshold_pct}% HWM. Exit at today's close.`,
        rule: "E4"
      };
    }
  }

  if (Math.abs(spxTrendDays) >= settings.spx_trend_close_days && hwm < settings.hwm_threshold_pct) {
    const direction = spxTrendDays > 0 ? "UP" : "DOWN";
    return {
      verdict: "CLOSE ALL",
      severity: "RED",
      reason: `CLOSE TRADE — SPX has trended ${direction} for ${Math.abs(spxTrendDays)} consecutive days while trade has never crossed ${settings.hwm_threshold_pct}% HWM. Exit today.`,
      rule: "E5"
    };
  }

  if (vixCurrent && vixYesterday && vix3DaysAgo && hwm < settings.hwm_threshold_pct) {
    if (vixCurrent < vixYesterday && vixYesterday < vix3DaysAgo) {
      return {
        verdict: "CLOSE ALL",
        severity: "RED",
        reason: `CLOSE TRADE — VIX has declined 3 consecutive days (${vix3DaysAgo} → ${vixYesterday} → ${vixCurrent}) while trade has never crossed ${settings.hwm_threshold_pct}% HWM. Exit by Day 5 at the latest.`,
        rule: "V2"
      };
    }
  }

  if (currentDte !== null && currentDte <= settings.close_winner_dte && hwm >= settings.hwm_threshold_pct) {
    return {
      verdict: "CLOSE ALL",
      severity: "GREEN",
      reason: `CLOSE TRADE — PROFIT TARGET PROTOCOL. DTE is ${currentDte} and HWM reached ${hwm.toFixed(1)}%. Current P/L: ${currentPl?.toFixed(1) ?? "n/a"}%. Lock in the win.`,
      rule: "S4-2DTE"
    };
  }

  if (currentDte !== null && currentDte <= settings.last_day_dte && currentPl !== null && currentPl < settings.last_day_min_profit_pct) {
    return {
      verdict: "CLOSE ALL",
      severity: "AMBER",
      reason: `CLOSE TRADE — ${settings.last_day_dte} DTE remaining with only ${currentPl.toFixed(1)}% current profit. Exit now.`,
      rule: "D7-B"
    };
  }

  if (macroRiskWithin2Days && currentPl !== null && currentPl > 0) {
    return {
      verdict: `SCALE OUT ${settings.s4_scale_out_pct}%`,
      severity: "AMBER",
      reason: `SCALE OUT — FOMC or NFP risk is inside the next 2 days while the trade is profitable (${currentPl.toFixed(1)}%). Reduce exposure by ${settings.s4_scale_out_pct}% before the event window.`,
      rule: "S4"
    };
  }

  if (hwm >= settings.profit_target_pct && currentPl !== null && currentPl >= settings.s2_pullback_low && currentPl <= settings.s2_pullback_high) {
    return {
      verdict: "SCALE OUT 50%",
      severity: "AMBER",
      reason: `SCALE OUT — Trade reached ${hwm.toFixed(1)}% HWM but has pulled back to ${currentPl.toFixed(1)}%. Close 50% now to lock in the win.`,
      rule: "S2"
    };
  }

  if (currentDte !== null && currentDte <= settings.scale_out_1_dte && hwm >= settings.scale_out_1_hwm_min && currentPl !== null && currentPl >= settings.scale_out_1_current_pl_min) {
    return {
      verdict: "SCALE OUT 30%",
      severity: "AMBER",
      reason: `SCALE OUT — At ${currentDte} DTE with HWM ${hwm.toFixed(1)}% and current P/L ${currentPl.toFixed(1)}%. Close 30% to bank partial profit.`,
      rule: "S1"
    };
  }

  if (dayNumber === settings.day3_warning_day && hwm < settings.hwm_threshold_pct) {
    return {
      verdict: "KEEP OPEN — DAY 3 WARNING",
      severity: "AMBER",
      reason: `WATCH CLOSELY — Day ${dayNumber} and trade has not yet crossed ${settings.hwm_threshold_pct}% HWM (current HWM: ${hwm.toFixed(1)}%). Tomorrow is the hard evaluation line.`,
      rule: "D2-A-warning"
    };
  }

  return {
    ...DEFAULT_VERDICT,
    reason: `Trade is healthy. HWM: ${hwm.toFixed(1)}% | Current P/L: ${currentPl?.toFixed(1) ?? "n/a"}% | DTE: ${currentDte ?? "n/a"} | Day ${dayNumber} of trade. ${hwm >= settings.hwm_threshold_pct ? "Binary separator crossed — trade confirmed as survivor." : "HWM has not reached the binary threshold yet — continue monitoring daily."} Next check: tomorrow.`
  };
}
