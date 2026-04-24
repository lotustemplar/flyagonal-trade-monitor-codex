import { calculateTradeDayNumber, todayIso } from "../lib/dateUtils.js";
import { readData, writeData } from "../lib/storage.js";
import { validateEntry } from "./entryValidator.js";
import { getDailyVerdict } from "../engines/dailyVerdict.js";
import { scrapeOptionStrat } from "./scrapers/optionStrat.js";
import { buildVerdictAlertKey, sendTestAlert, sendTradeClosedAlert, sendTradeOpenedAlert, sendVerdictAlert, shouldAlertForVerdict } from "./telegram.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freshManualInputs() {
  return {
    current_pl_pct: null,
    hwm_pct: null,
    current_dte: null,
    vix_current: null,
    vix_yesterday: null,
    vix_3days_ago: null,
    spx_consecutive_days: 0,
    macro_risk_within_2_days: false
  };
}

function slotFromTradeDay(tradeDay) {
  const normalized = String(tradeDay || "").toLowerCase();
  if (normalized.startsWith("wed")) return "wednesday";
  if (normalized.startsWith("thu")) return "thursday";
  throw new Error("Trade day must be Wednesday or Thursday.");
}

function getSlotById(trades, id) {
  const entry = Object.values(trades).find((trade) => trade.id === id);
  if (!entry) throw new Error(`Trade ${id} was not found.`);
  return entry.slot;
}

function decorateTrade(trade, settings) {
  const dayNumber = trade.entry_date ? calculateTradeDayNumber(trade.entry_date, todayIso(settings.timezone)) : 0;
  return { ...clone(trade), day_number: dayNumber };
}

function generateTradeId(tradeDay, entryDate) {
  return `${tradeDay.slice(0, 3).toUpperCase()}-${entryDate}`;
}

function coalesceMetric(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function deriveFrontMonthDte(trade) {
  const legs = Array.isArray(trade?.legs) ? trade.legs : [];
  const dtes = legs
    .map((leg) => (leg?.dte === "" || leg?.dte === null || leg?.dte === undefined ? null : Number(leg.dte)))
    .filter((value) => Number.isFinite(value) && value > 0);
  return dtes.length ? Math.min(...dtes) : null;
}

function deriveCurrentDte(trade, settings) {
  const openingDte = deriveFrontMonthDte(trade);
  if (!openingDte || !trade?.entry_date) return null;
  const dayNumber = calculateTradeDayNumber(trade.entry_date, todayIso(settings.timezone));
  return Math.max(openingDte - Math.max(dayNumber - 1, 0), 0);
}

export async function getDashboardData() {
  const data = await readData();
  return {
    settings: data.settings,
    trades: {
      wednesday: decorateTrade(data.trades.wednesday, data.settings),
      thursday: decorateTrade(data.trades.thursday, data.settings)
    }
  };
}

export async function getSettings() {
  const data = await readData();
  return data.settings;
}

export async function updateSettings(nextSettings) {
  const data = await readData();
  data.settings = { ...data.settings, ...nextSettings };
  await writeData(data);
  return data.settings;
}

export async function runEntryValidation(payload) {
  const data = await readData();
  return validateEntry(payload, data.settings);
}

export async function saveTrade(payload) {
  const data = await readData();
  const validation = validateEntry(payload, data.settings);
  const slot = slotFromTradeDay(payload.trade_day);
  const current = data.trades[slot];
  if (current.status === "OPEN") throw new Error(`${current.label} slot already has an open trade.`);

  const entryDate = payload.entry_date || todayIso(data.settings.timezone);
  data.trades[slot] = {
    ...current,
    slot,
    label: current.label,
    status: "OPEN",
    id: generateTradeId(current.label, entryDate),
    entry_date: entryDate,
    day_number: calculateTradeDayNumber(entryDate, todayIso(data.settings.timezone)),
    optionstrat_url: payload.optionstrat_url || null,
    legs: payload.legs || [],
    sl_ratio: validation.sl_ratio,
    net_premium: validation.net_premium,
    premium_per_contract: validation.premium_per_contract,
    vix_at_entry: Number(payload.vix),
    vix9d_at_entry: Number(payload.vix9d),
    hwm_pct: 0,
    hwm_source: "entry",
    entry_validation_status: validation.status,
    entry_validation_messages: validation.messages,
    last_check: null,
    last_metrics: null,
    manual_inputs: { ...freshManualInputs(), ...(payload.manual_inputs || {}) },
    verdicts: []
  };

  await writeData(data);
  const savedTrade = decorateTrade(data.trades[slot], data.settings);
  try { await sendTradeOpenedAlert(savedTrade, data.settings); } catch (error) { console.error("Telegram trade-open alert failed:", error); }
  return savedTrade;
}

export async function updateTrade(id, updates) {
  const data = await readData();
  const slot = getSlotById(data.trades, id);
  const trade = data.trades[slot];
  data.trades[slot] = {
    ...trade,
    ...Object.fromEntries(Object.entries(updates).filter(([key]) => key !== "manual_inputs")),
    manual_inputs: { ...trade.manual_inputs, ...(updates.manual_inputs || {}) }
  };
  await writeData(data);
  return decorateTrade(data.trades[slot], data.settings);
}

export async function closeTrade(id) {
  const data = await readData();
  const slot = getSlotById(data.trades, id);
  data.trades[slot].status = "CLOSED";
  data.trades[slot].closed_at = new Date().toISOString();
  data.trades[slot].last_alert_key = `CLOSED:${id}`;
  await writeData(data);
  const closedTrade = decorateTrade(data.trades[slot], data.settings);
  try { await sendTradeClosedAlert(closedTrade, data.settings); } catch (error) { console.error("Telegram trade-close alert failed:", error); }
  return closedTrade;
}

export async function checkTrade(id, manualInputs = {}) {
  const data = await readData();
  const slot = getSlotById(data.trades, id);
  const trade = data.trades[slot];
  const { optionstrat_url: optionstratUrlOverride, ...manualOnlyInputs } = manualInputs || {};
  if (trade.status !== "OPEN") throw new Error("Only open trades can be checked.");

  const activeOptionStratUrl = optionstratUrlOverride || trade.optionstrat_url;
  const scraped = await scrapeOptionStrat(activeOptionStratUrl, data.settings);
  const mergedManual = { ...trade.manual_inputs, ...manualOnlyInputs };
  const derivedDte = deriveCurrentDte(trade, data.settings);
  const currentPl = coalesceMetric(scraped.metrics?.current_pl_pct);
  const currentDte = coalesceMetric(scraped.metrics?.current_dte, derivedDte);
  const highestPnlYet = Math.max(trade.hwm_pct || 0, Number(coalesceMetric(scraped.metrics?.hwm_pct, currentPl ?? 0)));
  const previousHighest = Number(trade.hwm_pct || 0);
  const highestImproved = highestPnlYet > previousHighest;

  if (activeOptionStratUrl && activeOptionStratUrl !== trade.optionstrat_url) {
    data.trades[slot].optionstrat_url = activeOptionStratUrl;
  }
  data.trades[slot].manual_inputs = mergedManual;

  if (currentPl === null || currentPl === undefined) {
    await writeData(data);
    return { ok: false, requiresManualInput: false, message: scraped.message, scrape: scraped, trade: decorateTrade(data.trades[slot], data.settings) };
  }

  const payload = {
    current_pl_pct: Number(currentPl),
    hwm_pct: highestPnlYet,
    current_dte: currentDte === null || currentDte === undefined ? null : Number(currentDte),
    trade_day_number: calculateTradeDayNumber(trade.entry_date, todayIso(data.settings.timezone)),
    vix_current: mergedManual.vix_current,
    vix_yesterday: mergedManual.vix_yesterday,
    vix_3days_ago: mergedManual.vix_3days_ago,
    spx_consecutive_days: mergedManual.spx_consecutive_days,
    macro_risk_within_2_days: mergedManual.macro_risk_within_2_days
  };

  const verdict = getDailyVerdict(payload, data.settings);
  const timestamp = new Date().toISOString();
  const historyItem = {
    timestamp,
    day_number: payload.trade_day_number,
    hwm_pct: highestPnlYet,
    current_pl_pct: Number(currentPl),
    dte: payload.current_dte,
    verdict: verdict.verdict,
    rule: verdict.rule,
    reason: verdict.reason
  };

  data.trades[slot] = {
    ...trade,
    ...data.trades[slot],
    day_number: payload.trade_day_number,
    optionstrat_url: activeOptionStratUrl,
    hwm_pct: highestPnlYet,
    hwm_source: highestImproved ? "optionstrat-poll" : trade.hwm_source,
    last_check: timestamp,
    last_metrics: { current_pl_pct: Number(currentPl), hwm_pct: highestPnlYet, current_dte: payload.current_dte },
    manual_inputs: mergedManual,
    verdicts: [...trade.verdicts, historyItem]
  };

  const alertKey = buildVerdictAlertKey(verdict, data.trades[slot]);
  if (shouldAlertForVerdict(verdict) && trade.last_alert_key !== alertKey) {
    data.trades[slot].last_alert_key = alertKey;
  }
  if (highestImproved && verdict.rule === "HOLD") {
    data.trades[slot].last_alert_key = `${trade.id}:HWM:${highestPnlYet.toFixed(1)}`;
  }

  await writeData(data);
  if (shouldAlertForVerdict(verdict) && trade.last_alert_key !== alertKey) {
    try { await sendVerdictAlert(decorateTrade(data.trades[slot], data.settings), verdict, data.settings); } catch (error) { console.error("Telegram verdict alert failed:", error); }
  }
  if (highestImproved && verdict.rule === "HOLD") {
    try {
      await sendVerdictAlert(decorateTrade(data.trades[slot], data.settings), {
        verdict: "NEW HIGHEST PNL YET",
        rule: "HWM",
        reason: `New highest P/L reached: ${highestPnlYet.toFixed(1)}%. This is the number to compare against the Day 4 / 20% binary separator.`
      }, data.settings);
    } catch (error) { console.error("Telegram HWM alert failed:", error); }
  }

  return { ok: true, scrape: scraped, trade: decorateTrade(data.trades[slot], data.settings), verdict };
}

export async function runScheduledChecks() {
  const dashboard = await getDashboardData();
  const openTrades = Object.values(dashboard.trades).filter((trade) => trade.status === "OPEN");
  const results = [];
  for (const trade of openTrades) results.push(await checkTrade(trade.id, trade.manual_inputs));
  return results;
}

export async function pollOpenTradesForHwm() {
  return runScheduledChecks();
}

export async function triggerTelegramTest() {
  const data = await readData();
  return sendTestAlert(data.settings);
}
