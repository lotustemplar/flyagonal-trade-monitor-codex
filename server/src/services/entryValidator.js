function asNumber(value) {
  return value === null || value === undefined || value === "" ? 0 : Number(value);
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
  const hasInput = payload.vix !== "" || payload.vix9d !== "" || legs.some((leg) => leg.premium !== "" || leg.dte !== "" || leg.strike !== "");

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
      messages: []
    };
  }

  const vix = asNumber(payload.vix);
  const vix9d = asNumber(payload.vix9d);

  const shortValue = legs.filter((leg) => String(leg.direction).toUpperCase() === "STO").reduce((sum, leg) => sum + asNumber(leg.qty) * asNumber(leg.premium), 0);
  const longValue = legs.filter((leg) => String(leg.direction).toUpperCase() === "BTO").reduce((sum, leg) => sum + asNumber(leg.qty) * asNumber(leg.premium), 0);
  const totalValue = shortValue + longValue;
  const totalContracts = legs.reduce((sum, leg) => sum + asNumber(leg.qty), 0);
  const netPremium = shortValue - longValue;
  const premiumPerContract = totalContracts > 0 ? Math.abs(netPremium) / totalContracts : 0;
  const slRatio = longValue > 0 ? shortValue / longValue : 0;
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

  if (vix < settings.vix_block_low || vix > settings.vix_block_high) {
    elevate("BLOCKED", `BLOCKED — VIX ${vix.toFixed(1)} is outside the safe entry zone (${settings.vix_block_low}–${settings.vix_block_high}). Do not open a trade today.`, "R1");
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
    const lowerWidth = shortCall.strike - longCallLower.strike;
    const upperWidth = longCallUpper.strike - shortCall.strike;
    if (lowerWidth !== 30 || upperWidth !== 30) {
      elevate("CAUTION", `CAUTION — Call butterfly wings should be 30 points wide. Current wings are -${lowerWidth} / +${upperWidth}.`, "CALL-BFLY-WIDTH");
    }
  }

  if (slRatio < settings.sl_ratio_floor) {
    elevate("BLOCKED", `BLOCKED — Ratio ${slRatio.toFixed(3)} is dangerously low. Adjust strikes to improve ratio above 0.70 before entering.`, "SL-FLOOR");
  } else if (slRatio < settings.sl_ratio_low_caution) {
    elevate("CAUTION", `WARNING — Ratio ${slRatio.toFixed(3)} indicates heavy short exposure. Maximum 50% position size.`, "SL-50");
  } else if (slRatio < settings.sl_ratio_preferred) {
    elevate("CAUTION", `CAUTION — Ratio ${slRatio.toFixed(3)} is on the low end. Enter at 75% size and monitor closely.`, "SL-75");
  } else if (slRatio >= settings.sl_ratio_well_hedged) {
    elevate("APPROVED", "Well-hedged structure. Full size entry approved.", "SL-GREEN");
  } else {
    elevate("APPROVED", "Normal structure. Full size entry approved.", "SL-NORMAL");
  }

  if (premiumPerContract < settings.premium_per_contract_floor) {
    elevate("BLOCKED", `BLOCKED — Premium per contract is $${premiumPerContract.toFixed(2)}. This is below the absolute minimum seen in winning trades. Do not enter.`, "PREMIUM-BLOCK");
  } else if (premiumPerContract < settings.premium_per_contract_min) {
    elevate("CAUTION", `WARNING — Premium per contract is $${premiumPerContract.toFixed(2)}, below the $${settings.premium_per_contract_min} minimum threshold.`, "PREMIUM-LOW");
  }

  if (vix9d - vix > settings.vix9d_above_gap) {
    elevate("CAUTION", `CAUTION — VIX9D (${vix9d.toFixed(1)}) significantly exceeds VIX (${vix.toFixed(1)}). Short-term IV expectations are elevated.`, "VIX9D-HIGH");
  }

  if (vix - vix9d > settings.vix9d_below_gap) {
    elevate("CAUTION", `CAUTION — VIX9D (${vix9d.toFixed(1)}) is well below VIX (${vix.toFixed(1)}). Short-term IV contraction may accelerate long-put decay.`, "VIX9D-LOW");
  }

  return {
    status,
    short_value: shortValue,
    long_value: longValue,
    total_value: totalValue,
    net_premium: netPremium,
    premium_per_contract: premiumPerContract,
    total_contracts: totalContracts,
    sl_ratio: slRatio,
    messages
  };
}
