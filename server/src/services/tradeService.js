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

function coalesceMetric(primary, fallback) {
  return primary === null || primary === undefined || primary === "" ? fallback : primary;
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
  if (validation.status === "BLOCKED") throw new Error("Trade is blocked by the entry validator and cannot be saved.");

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
  const current_pl_pct = coalesceMetric(manualOnlyInputs.current_pl_pct, scraped.metrics?.current_pl_pct);
  const providedHwm = coalesceMetric(manualOnlyInputs.hwm_pct, scraped.metrics?.hwm_pct);
  const current_dte = coalesceMetric(manualOnlyInputs.current_dte, scraped.metrics?.current_dte);
  const hwm_pct = Math.max(trade.hwm_pct || 0, Number(coalesceMetric(providedHwm, current_pl_pct ?? 0)));

  if (current_pl_pct === null || current_pl_pct === undefined || current_dte === null || current_dte === undefined) {
    return { ok: false, requiresManualInput: true, message: scraped.message, scrape: scraped };
  }

  const payload = {
    current_pl_pct: Number(current_pl_pct),
    hwm_pct,
    current_dte: Number(current_dte),
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
    hwm_pct,
    current_pl_pct: Number(current_pl_pct),
    dte: Number(current_dte),
    verdict: verdict.verdict,
    rule: verdict.rule,
    reason: verdict.reason
  };

  data.trades[slot] = {
    ...trade,
    day_number: payload.trade_day_number,
    optionstrat_url: activeOptionStratUrl,
    hwm_pct,
    last_check: timestamp,
    last_metrics: { current_pl_pct: Number(current_pl_pct), hwm_pct, current_dte: Number(current_dte) },
    manual_inputs: mergedManual,
    verdicts: [...trade.verdicts, historyItem]
  };

  const alertKey = buildVerdictAlertKey(verdict, data.trades[slot]);
  if (shouldAlertForVerdict(verdict) && trade.last_alert_key !== alertKey) {
    data.trades[slot].last_alert_key = alertKey;
  }

  await writeData(data);
  if (shouldAlertForVerdict(verdict) && trade.last_alert_key !== alertKey) {
    try { await sendVerdictAlert(decorateTrade(data.trades[slot], data.settings), verdict, data.settings); } catch (error) { console.error("Telegram verdict alert failed:", error); }
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

export async function triggerTelegramTest() {
  const data = await readData();
  return sendTestAlert(data.settings);
}
