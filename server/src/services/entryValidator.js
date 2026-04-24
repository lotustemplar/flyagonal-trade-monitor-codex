function asNumber(value) {
  return value === null || value === undefined || value === "" ? 0 : Number(value);
}

function absPremium(leg) {
  return Math.abs(asNumber(leg.premium));
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isWithinWindow(targetIso, startIso, windowDays) {
  return targetIso >= startIso && targetIso <= addDays(startIso, windowDays - 1);
}

function getVixZone(vix, settings) {
  if (vix < settings.vix_low_cutoff) {
    return {
      label: "LOW",
      allocation_pct: settings.low_vix_allocation_pct,
      profit_target_pct: settings.low_vix_profit_target_pct,
      note: "Low VIX — reduced size, lower PT"
    };
  }
  if (vix < settings.vix_optimal_high) {
    return {
      label: "OPTIMAL",
      allocation_pct: settings.default_allocation_pct,
      profit_target_pct: settings.default_profit_target_pct,
      note: "Optimal zone — full size"
    };
  }
  if (vix < settings.vix_caution_high) {
    return {
      label: "CAUTION",
      allocation_pct: settings.default_allocation_pct,
      profit_target_pct: settings.default_profit_target_pct,
      note: "Caution zone — tighter exit management"
    };
  }
  return {
    label: "STRONG",
    allocation_pct: settings.default_allocation_pct,
    profit_target_pct: settings.default_profit_target_pct,
    note: "Strong VIX — fastest winners expected"
  };
}

function applyPortfolioCap(allocationPct, portfolioValue, settings) {
  if (!portfolioValue || portfolioValue <= 0) return allocationPct;
  if (portfolioValue > settings.portfolio_high_threshold) {
    return Math.min(allocationPct, settings.portfolio_high_cap_pct);
  }
  if (portfolioValue >= settings.portfolio_mid_threshold) {
    return Math.min(allocationPct, settings.portfolio_mid_cap_pct);
  }
  return allocationPct;
}

export function validateEntry(payload, settings) {
  const legs = Array.isArray(payload.legs) ? payload.legs : [];
  const normalizedLegs = legs.map((leg) => ({
    ...leg,
    strike: leg.strike === "" || leg.strike === null || leg.strike === undefined ? "" : Number(leg.strike),
    dte: leg.dte === "" || leg.dte === null || leg.dte === undefined ? "" : Number(leg.dte)
  }));
  const shortCall = normalizedLegs.find((leg) => String(leg.role || "").toLowerCase() === "short_call");
  const longCallLower = normalizedLegs.find((leg) => String(leg.role || "").toLowerCase() === "long_call_lower");
  const longCallUpper = normalizedLegs.find((leg) => String(leg.role || "").toLowerCase() === "long_call_upper");
  const shortPut = normalizedLegs.find((leg) => String(leg.role || "").toLowerCase() === "short_put_calendar");
  const longPut = normalizedLegs.find((leg) => String(leg.role || "").toLowerCase() === "long_put_calendar");
  const hasInput =
    payload.vix !== "" ||
    payload.vix9d !== "" ||
    payload.spx_price !== "" ||
    legs.some((leg) => leg.premium !== "" || leg.dte !== "" || leg.strike !== "");

  if (!hasInput) {
    return {
      status: "APPROVED",
      short_value: 0,
      long_value: 0,
      total_value: 0,
      net_premium: 0,
      premium_per_contract: 0,
      total_contracts: 0,
      sl_ratio: 0,
      vix_ratio: 0,
      vix_zone_label: null,
      allocation_pct: null,
      profit_target_pct: null,
      contracts: null,
      messages: []
    };
  }

  const vix = asNumber(payload.vix);
  const vix9d = asNumber(payload.vix9d);
  const spxPrice = asNumber(payload.spx_price);
  const portfolioValue = asNumber(payload.portfolio_value);
  const shortLegs = legs.filter((leg) => String(leg.direction).toUpperCase() === "STO");
  const longLegs = legs.filter((leg) => String(leg.direction).toUpperCase() === "BTO");
  const shortValue = shortLegs.reduce((sum, leg) => sum + asNumber(leg.qty) * absPremium(leg), 0);
  const longValue = longLegs.reduce((sum, leg) => sum + asNumber(leg.qty) * absPremium(leg), 0);
  const totalValue = shortValue + longValue;
  const totalContracts = legs.reduce((sum, leg) => sum + asNumber(leg.qty), 0);
  const netDebit = longValue - shortValue;
  const packageCount = Math.max(
    1,
    ...legs
      .filter((leg) => String(leg.role || "").toLowerCase() === "short_put_calendar")
      .map((leg) => asNumber(leg.qty))
  );
  const premiumPerContract = packageCount > 0 ? Math.abs(netDebit) / packageCount : Math.abs(netDebit);
  const hasCompleteStructure = shortValue > 0 && longValue > 0;
  const slRatio = hasCompleteStructure ? shortValue / longValue : 0;
  const vixRatio = vix > 0 ? vix9d / vix : 0;
  const vixZone = getVixZone(vix, settings);
  const allocationPct = applyPortfolioCap(vixZone.allocation_pct, portfolioValue, settings);
  const marginPerLot = spxPrice > 0 ? spxPrice * settings.margin_per_lot_factor * 100 : 0;
  const allocatedCapital = portfolioValue > 0 ? portfolioValue * allocationPct : 0;
  const contracts = marginPerLot > 0 ? Math.floor(allocatedCapital / marginPerLot) : null;
  const entryDate = payload.entry_date || null;
  const messages = [];
  let status = "APPROVED";

  const elevate = (nextStatus, message, rule) => {
    messages.push({ rule, message, severity: nextStatus });
    if (nextStatus === "BLOCKED") {
      status = "BLOCKED";
      return;
    }
    if (status !== "BLOCKED" && nextStatus === "CAUTION") {
      status = "CAUTION";
    }
  };

  if (!settings.entry_days.includes(payload.trade_day)) {
    elevate("BLOCKED", `SKIP TRADE — Entry day must be Wednesday or Thursday. Current selection: ${payload.trade_day || "unset"}.`, "ENTRY-DAY");
  }

  if (vix <= 0 || vix9d <= 0) {
    elevate("CAUTION", "CAUTION — Enter both VIX and VIX9D to compute the VIX ratio filter.", "VIX-RATIO-PENDING");
  } else if (vixRatio < settings.vix_ratio_min || vixRatio > settings.vix_ratio_max) {
    elevate(
      "BLOCKED",
      `SKIP TRADE — VIX9D/VIX ratio is ${vixRatio.toFixed(3)}. Required range is ${settings.vix_ratio_min.toFixed(2)} to ${settings.vix_ratio_max.toFixed(2)}.`,
      "VIX-RATIO"
    );
  }

  if (entryDate && settings.cpi_blackout_dates.some((cpiDate) => isWithinWindow(cpiDate, entryDate, 8))) {
    const cpiDate = settings.cpi_blackout_dates.find((date) => isWithinWindow(date, entryDate, 8));
    elevate("BLOCKED", `SKIP TRADE — CPI blackout date ${cpiDate} falls inside the 8-day trade window.`, "CPI-BLACKOUT");
  }

  if (premiumPerContract < settings.min_net_debit_per_lot) {
    elevate(
      "BLOCKED",
      `SKIP TRADE — Net debit per lot is $${premiumPerContract.toFixed(2)}. Minimum required is $${settings.min_net_debit_per_lot.toFixed(2)}.`,
      "NET-DEBIT"
    );
  }

  if (shortPut && longPut && shortPut.strike !== "" && longPut.strike !== "" && shortPut.strike !== longPut.strike) {
    elevate("CAUTION", `CAUTION — Put calendar strikes should match. Short put is ${shortPut.strike}, long put is ${longPut.strike}.`, "PUT-CALENDAR-STRIKE");
  }

  if (shortPut && shortPut.dte !== "" && shortPut.dte !== 8) {
    elevate("CAUTION", `CAUTION — Short put calendar leg should be 8 DTE. Current value is ${shortPut.dte}.`, "PUT-CALENDAR-DTE");
  }

  if (longPut && longPut.dte !== "" && longPut.dte !== 12) {
    elevate("CAUTION", `CAUTION — Long put calendar leg should be 12 DTE. Current value is ${longPut.dte}.`, "PUT-CALENDAR-DTE");
  }

  if (shortCall && longCallLower && longCallUpper && shortCall.strike !== "" && longCallLower.strike !== "" && longCallUpper.strike !== "") {
    const lowerWidth = Math.abs(shortCall.strike - longCallLower.strike);
    const upperWidth = Math.abs(longCallUpper.strike - shortCall.strike);
    if (lowerWidth !== 30 || upperWidth !== 30) {
      elevate("CAUTION", `CAUTION — Call butterfly wings should be 30 points wide. Current wings are -${lowerWidth} / +${upperWidth}.`, "CALL-BFLY-WIDTH");
    }
  }

  if (!hasCompleteStructure) {
    elevate("CAUTION", "CAUTION — S/L ratio is waiting on complete premium inputs for both the short and long sides.", "SL-PENDING");
  } else if (slRatio < settings.sl_ratio_floor) {
    elevate("BLOCKED", `BLOCKED — S/L ratio ${slRatio.toFixed(3)} is dangerously low. Adjust strikes to improve ratio above 0.70 before entering.`, "SL-FLOOR");
  } else if (slRatio < settings.sl_ratio_low_caution) {
    elevate("CAUTION", `WARNING — S/L ratio ${slRatio.toFixed(3)} indicates heavy short exposure. Maximum 50% position size.`, "SL-50");
  } else if (slRatio < settings.sl_ratio_preferred) {
    elevate("CAUTION", `CAUTION — S/L ratio ${slRatio.toFixed(3)} is on the low end. Enter at 75% size and monitor closely.`, "SL-75");
  } else if (slRatio >= settings.sl_ratio_well_hedged) {
    elevate("APPROVED", "Well-hedged structure. Full size entry approved.", "SL-GREEN");
  } else {
    elevate("APPROVED", "Normal structure. Full size entry approved.", "SL-NORMAL");
  }

  if (vix > 0) {
    elevate("APPROVED", `${vixZone.note} Suggested allocation: ${(allocationPct * 100).toFixed(1)}% of portfolio. Profit target: ${vixZone.profit_target_pct.toFixed(0)}%.`, "VIX-ZONE");
  }

  return {
    status,
    short_value: shortValue,
    long_value: longValue,
    total_value: totalValue,
    net_premium: netDebit,
    premium_per_contract: premiumPerContract,
    total_contracts: totalContracts,
    sl_ratio: slRatio,
    vix_ratio: vixRatio,
    vix_zone_label: vixZone.label,
    allocation_pct: allocationPct,
    profit_target_pct: vixZone.profit_target_pct,
    margin_per_lot: marginPerLot,
    contracts,
    messages
  };
}
