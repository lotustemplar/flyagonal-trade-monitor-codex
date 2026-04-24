import { scrapeForexFactoryWindow } from "./scrapers/forexFactory.js";

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isWithinWindow(targetIso, startIso, windowDays) {
  return targetIso >= startIso && targetIso <= addDays(startIso, windowDays - 1);
}

function windowDay(targetIso, startIso) {
  const start = new Date(`${startIso}T12:00:00Z`);
  const target = new Date(`${targetIso}T12:00:00Z`);
  return Math.round((target.getTime() - start.getTime()) / 86400000) + 1;
}

export function evaluateCalendarGate(events, settings, _vix, currentIso) {
  const cpiDate = settings.cpi_blackout_dates.find((date) => isWithinWindow(date, currentIso, 8));
  if (cpiDate) {
    const cpiEvent = {
      iso_date: cpiDate,
      date: cpiDate,
      time: "08:30",
      currency: "USD",
      impact: "High Impact Expected",
      event_name: "CPI Release (Blackout)",
      window_day: windowDay(cpiDate, currentIso)
    };
    const mergedEvents = [cpiEvent, ...events.filter((event) => event.iso_date !== cpiDate || !/cpi/i.test(event.event_name || ""))];
    const message = `BLOCKED - CPI blackout date ${cpiDate} falls inside the 8-day trade window. Skip the trade.`;
    return {
      status: "BLOCKED",
      badge: "🚫 BLOCKED",
      primary_rule: "CPI-BLACKOUT",
      primary_message: message,
      triggered_rules: [{ rule: "CPI-BLACKOUT", severity: "BLOCKED", message }],
      events: mergedEvents
    };
  }

  return {
    status: "CLEAR",
    badge: "✅ CLEAR TO TRADE",
    primary_rule: "CLEAR",
    primary_message: "No CPI blackout dates detected in the current 8-day trade window.",
    triggered_rules: [],
    events
  };
}

export async function refreshCalendarGate(settings, vix, currentIso) {
  const events = await scrapeForexFactoryWindow(settings, currentIso);
  return evaluateCalendarGate(events, settings, vix, currentIso);
}
