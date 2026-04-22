import { scrapeForexFactoryWindow } from "./scrapers/forexFactory.js";
import { isHolidayBlockedDay } from "../lib/dateUtils.js";

const FOMC_PATTERN = /fomc|fed rate|federal reserve|interest rate decision|fomc meeting minutes/i;
const NFP_PATTERN = /non-farm payrolls|\bnfp\b/i;
const CPI_PATTERN = /\bcpi\b|consumer price index|core cpi/i;
const PCE_PATTERN = /\bpce\b|personal consumption|core pce/i;
const HOLIDAY_PATTERN = /bank holiday|market holiday|early close/i;

export function evaluateCalendarGate(events, settings, vix, currentIso) {
  const todayEvents = events.filter((event) => event.window_day === 1);
  const triggered = [];

  if (typeof vix === "number" && (vix < settings.vix_block_low || vix > settings.vix_block_high)) {
    const message = `BLOCKED — VIX ${vix.toFixed(1)} is outside the safe entry zone (${settings.vix_block_low}–${settings.vix_block_high}). Do not open a trade today.`;
    triggered.push({ rule: "R1", severity: "BLOCKED", message });
    return { status: "BLOCKED", badge: "🚫 BLOCKED", primary_rule: "R1", primary_message: message, triggered_rules: triggered, events };
  }

  const fomcEvent = events.find((event) => FOMC_PATTERN.test(event.event_name));
  if (fomcEvent) {
    const message = `BLOCKED — FOMC event detected: '${fomcEvent.event_name}' on ${fomcEvent.iso_date}. Do not enter within 7 days of an FOMC decision.`;
    triggered.push({ rule: "R2", severity: "BLOCKED", message });
    return { status: "BLOCKED", badge: "🚫 BLOCKED", primary_rule: "R2", primary_message: message, triggered_rules: triggered, events };
  }

  const holidayEvent = events.find((event) => HOLIDAY_PATTERN.test(event.event_name));
  if (isHolidayBlockedDay(currentIso) || holidayEvent) {
    const blockedDate = holidayEvent?.iso_date || currentIso;
    const message = `BLOCKED — Today is a holiday-adjacent session (${blockedDate}). Entries on half-days or holiday eves are prohibited. Resume trading on the next normal session.`;
    triggered.push({ rule: "R3", severity: "BLOCKED", message });
    return { status: "BLOCKED", badge: "🚫 BLOCKED", primary_rule: "R3", primary_message: message, triggered_rules: triggered, events };
  }

  const sameDayNfp = todayEvents.find((event) => NFP_PATTERN.test(event.event_name));
  if (sameDayNfp) triggered.push({ rule: "R4", severity: "CAUTION", message: "CAUTION — NFP release today. If entering, reduce position size to 50% of normal." });

  const nfpOrCpi = events.find((event) => NFP_PATTERN.test(event.event_name) || CPI_PATTERN.test(event.event_name));
  if (nfpOrCpi) triggered.push({ rule: "R5", severity: "CAUTION", message: `CAUTION — ${nfpOrCpi.event_name} detected on ${nfpOrCpi.iso_date} (Day ${nfpOrCpi.window_day} of trade window). Enter at 50% position size.` });

  const pceEvent = events.find((event) => PCE_PATTERN.test(event.event_name));
  if (pceEvent) triggered.push({ rule: "R6", severity: "CAUTION", message: `CAUTION — PCE release on ${pceEvent.iso_date} (Day ${pceEvent.window_day} of trade window). Enter at 70% position size.` });

  if (typeof vix === "number" && vix >= settings.vix_elevated_low && vix <= settings.vix_optimal_high) {
    triggered.push({ rule: "R7", severity: "CAUTION", message: `CAUTION — VIX at ${vix.toFixed(1)} is elevated. Enter at 75% position size. Tighter management required.` });
  }

  if (triggered.length > 0) {
    return { status: "CAUTION", badge: "⚠️ CAUTION", primary_rule: triggered[0].rule, primary_message: triggered[0].message, triggered_rules: triggered, events };
  }

  return { status: "CLEAR", badge: "✅ CLEAR TO TRADE", primary_rule: "CLEAR", primary_message: "No blocking macro events or elevated entry warnings detected in the current 8-day window.", triggered_rules: [], events };
}

export async function refreshCalendarGate(settings, vix, currentIso) {
  const events = await scrapeForexFactoryWindow(settings);
  return evaluateCalendarGate(events, settings, vix, currentIso);
}
