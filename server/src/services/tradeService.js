import { calculateTradeDayNumber, todayIso } from "../lib/dateUtils.js";
import { readData, writeData } from "../lib/storage.js";
import { validateEntry } from "./entryValidator.js";
import { getDailyVerdict } from "../engines/dailyVerdict.js";
import { scrapeOptionStrat } from "./scrapers/optionStrat.js";
import { sendTestAlert, sendTradeClosedAlert, sendTradeOpenedAlert, sendVerdictAlert } from "./telegram.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freshManualInputs() {
  return {
    vix_current: null,
    vix_yesterday: null,
    vix_3days_ago: null,
    spx_consecutive_days: 0
  };
}

function isoAtNoon(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`);
}

function addDays(isoDate, days) {
  const date = isoAtNoon(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(startIso, endIso) {
  return Math.round((isoAtNoon(endIso).getTime() - isoAtNoon(startIso).getTime()) / 86400000);
}

function asNumber(value) {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

function normalizePercentValue(value) {
  const numeric = asNumber(value);
  return numeric === null || Number.isNaN(numeric) ? null : numeric;
}

function normalizeTargetPercent(value) {
  const numeric = normalizePercentValue(value);
  if (numeric === null) return null;
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

function coalesceMetric(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "" && !Number.isNaN(value)) return value;
  }
  return null;
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

function deriveFrontMonthDte(trade) {
  const legs = Array.isArray(trade?.legs) ? trade.legs : [];
  const dtes = legs
    .map((leg) => (leg?.dte === "" || leg?.dte === null || leg?.dte === undefined ? null : Number(leg.dte)))
    .filter((value) => Number.isFinite(value) && value > 0);
  return dtes.length ? Math.min(...dtes) : null;
}

function deriveExpirationDate(trade) {
  if (trade?.expiration_date) return trade.expiration_date;
  if (!trade?.entry_date) return null;
  const openingDte = deriveFrontMonthDte(trade);
  if (!openingDte) return null;
  return addDays(trade.entry_date, openingDte);
}

function deriveCurrentDte(trade, settings, asOfIso = todayIso(settings.timezone)) {
  const expirationDate = deriveExpirationDate(trade);
  if (!expirationDate) return null;
  return Math.max(daysBetween(asOfIso, expirationDate), 0);
}

function alertCodeForVerdict(verdict) {
  switch (verdict.rule) {
    case "PT-HIT":
      return "pt_hit";
    case "CHECKPOINT-4DTE":
    case "CAUTION-4DTE":
      return "checkpoint";
    case "RECOVERY-4DTE":
      return "recovery_watch";
    case "BAIL-2DTE":
      return "bail";
    case "APPROACHING-PT":
      return "approaching_pt";
    case "PASS-4DTE":
      return "pass_4dte";
    case "PASS-2DTE":
      return "pass_2dte";
    case "DAY2-VIX-WARN":
      return "early_vix_warning";
    case "STALE-PEAK":
      return "stale_peak_warning";
    case "WED-CAUTION":
      return "wed_caution";
    case "EXPIRED":
      return "expired";
    default:
      return null;
  }
}

function buildThresholdAlerts(previousHwm, currentHwm, settings) {
  const alerts = [];
  if (previousHwm < settings.milestone_on_track_pct && currentHwm >= settings.milestone_on_track_pct) {
    alerts.push({
      code: "hit_15",
      verdict: {
        verdict: "CROSSED 15%",
        rule: "HIT-15",
        severity: "GREEN",
        reason: `Crossed ${settings.milestone_on_track_pct.toFixed(0)}% highest P/L yet - on track.`
      }
    });
  }
  if (previousHwm < settings.milestone_survivor_pct && currentHwm >= settings.milestone_survivor_pct) {
    alerts.push({
      code: "hit_19",
      verdict: {
        verdict: "CROSSED 19%",
        rule: "HIT-19",
        severity: "GREEN",
        reason: `Crossed ${settings.milestone_survivor_pct.toFixed(0)}% highest P/L yet - historical win path confirmed.`
      }
    });
  }
  return alerts;
}

function buildUpdatedLastMetrics(previousMetrics, currentPl, currentDte, hwmPct, trendLast24h, vixChangeFromEntry) {
  return {
    current_pl_pct: currentPl ?? previousMetrics?.current_pl_pct ?? null,
    hwm_pct: hwmPct ?? previousMetrics?.hwm_pct ?? 0,
    current_dte: currentDte ?? previousMetrics?.current_dte ?? null,
    trade_value_trend_last_24h: trendLast24h ?? previousMetrics?.trade_value_trend_last_24h ?? null,
    vix_change_from_entry: vixChangeFromEntry ?? previousMetrics?.vix_change_from_entry ?? null
  };
}

function deriveTrendLast24h(verdicts, currentPl, timestampIso, settings) {
  if (currentPl === null || currentPl === undefined || !Array.isArray(verdicts) || !verdicts.length) return null;
  const currentTime = new Date(timestampIso).getTime();
  const recent = [...verdicts]
    .reverse()
    .find((item) => item?.timestamp && currentTime - new Date(item.timestamp).getTime() <= settings.recovery_trend_window_hours * 3600000);
  if (!recent || recent.current_pl_pct === null || recent.current_pl_pct === undefined) return null;
  const delta = currentPl - Number(recent.current_pl_pct);
  if (delta > settings.trend_change_buffer_pct) return "rising";
  if (delta < -settings.trend_change_buffer_pct) return "declining";
  return "flat";
}

async function persistTradeEvaluation(data, slot, metrics, sourceMessage, sourceLabel = "optionstrat-poll") {
  const trade = data.trades[slot];
  const currentPl = normalizePercentValue(metrics.current_pl_pct);
  const currentDte = coalesceMetric(metrics.current_dte, deriveCurrentDte(trade, data.settings));
  const previousHighest = Number(trade.hwm_pct || 0);
  const scrapedHighest = normalizePercentValue(metrics.hwm_pct);
  const highestPnlYet = Math.max(previousHighest, scrapedHighest ?? currentPl ?? 0);
  const timestamp = new Date().toISOString();
  const dayNumber = calculateTradeDayNumber(trade.entry_date, todayIso(data.settings.timezone));
  const isNewPeak = highestPnlYet > previousHighest;
  const peakDayNumber = isNewPeak ? dayNumber : trade.peak_day_number ?? null;
  const peakTimestamp = isNewPeak ? timestamp : trade.peak_timestamp ?? null;
  const trendLast24h = deriveTrendLast24h(trade.verdicts, currentPl, timestamp, data.settings);
  const vixCurrent = asNumber(trade.manual_inputs?.vix_current);
  const vixChangeFromEntry = vixCurrent !== null && trade.vix_at_entry !== null && trade.vix_at_entry !== undefined
    ? vixCurrent - Number(trade.vix_at_entry)
    : null;

  const verdict = getDailyVerdict(
    {
      current_pl_pct: currentPl,
      hwm_pct: highestPnlYet,
      current_dte: currentDte,
      profit_target_pct: trade.profit_target_pct,
      vix_at_entry: trade.vix_at_entry,
      trade_day_number: dayNumber,
      vix_change_from_entry: vixChangeFromEntry,
      trade_value_trend_last_24h: trendLast24h,
      peak_day_number: peakDayNumber,
      entry_day: trade.label,
      vix_zone_label: trade.vix_zone_label
    },
    data.settings
  );

  const historyItem = {
    timestamp,
    day_number: dayNumber,
    hwm_pct: highestPnlYet,
    current_pl_pct: Number(currentPl),
    dte: currentDte,
    trend_last_24h: trendLast24h,
    vix_change_from_entry: vixChangeFromEntry,
    verdict: verdict.verdict,
    rule: verdict.rule,
    reason: verdict.reason
  };

  const alertsSent = new Set(Array.isArray(trade.alerts_sent) ? trade.alerts_sent : []);
  const alertsToSend = [];
  for (const item of buildThresholdAlerts(previousHighest, highestPnlYet, data.settings)) {
    if (!alertsSent.has(item.code)) alertsToSend.push(item);
  }
  const verdictAlertCode = alertCodeForVerdict(verdict);
  if (verdictAlertCode && !alertsSent.has(verdictAlertCode)) {
    alertsToSend.push({ code: verdictAlertCode, verdict });
  }

  const lastHistory = Array.isArray(trade.verdicts) && trade.verdicts.length ? trade.verdicts[trade.verdicts.length - 1] : null;
  const shouldAppendHistory =
    !lastHistory ||
    lastHistory.current_pl_pct !== historyItem.current_pl_pct ||
    lastHistory.hwm_pct !== historyItem.hwm_pct ||
    lastHistory.dte !== historyItem.dte ||
    lastHistory.rule !== historyItem.rule ||
    lastHistory.trend_last_24h !== historyItem.trend_last_24h;

  data.trades[slot] = {
    ...trade,
    day_number: dayNumber,
    hwm_pct: highestPnlYet,
    hwm_source: highestPnlYet > previousHighest ? sourceLabel : trade.hwm_source,
    peak_day_number: peakDayNumber,
    peak_timestamp: peakTimestamp,
    last_check: timestamp,
    last_metrics: buildUpdatedLastMetrics(trade.last_metrics, currentPl, currentDte, highestPnlYet, trendLast24h, vixChangeFromEntry),
    last_scrape_message: sourceMessage || null,
    verdicts: shouldAppendHistory ? [...trade.verdicts, historyItem] : trade.verdicts,
    alerts_sent: Array.from(new Set([...alertsSent, ...alertsToSend.map((item) => item.code)]))
  };

  await writeData(data);
  for (const alert of alertsToSend) {
    try {
      await sendVerdictAlert(decorateTrade(data.trades[slot], data.settings), alert.verdict, data.settings);
    } catch (error) {
      console.error("Telegram alert failed:", error);
    }
  }

  return { ok: true, trade: decorateTrade(data.trades[slot], data.settings), verdict };
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
  const derivedTrade = { entry_date: entryDate, expiration_date: payload.expiration_date || null, legs: payload.legs || [] };
  const expirationDate = payload.expiration_date || deriveExpirationDate(derivedTrade);

  data.trades[slot] = {
    ...current,
    slot,
    label: current.label,
    status: "OPEN",
    id: generateTradeId(current.label, entryDate),
    entry_date: entryDate,
    expiration_date: expirationDate,
    day_number: calculateTradeDayNumber(entryDate, todayIso(data.settings.timezone)),
    optionstrat_url: payload.optionstrat_url || null,
    legs: payload.legs || [],
    sl_ratio: validation.sl_ratio,
    vix_ratio: validation.vix_ratio,
    net_premium: validation.net_premium,
    premium_per_contract: validation.premium_per_contract,
    vix_at_entry: Number(payload.vix),
    vix9d_at_entry: Number(payload.vix9d),
    profit_target_pct: validation.profit_target_pct,
    allocation_pct: validation.allocation_pct,
    contracts: validation.contracts,
    portfolio_value: payload.portfolio_value === "" || payload.portfolio_value === undefined ? null : Number(payload.portfolio_value),
    vix_zone_label: validation.vix_zone_label,
    hwm_pct: 0,
    hwm_source: "entry",
    peak_day_number: null,
    peak_timestamp: null,
    entry_validation_status: validation.status,
    entry_validation_messages: validation.messages,
    last_check: null,
    last_metrics: null,
    last_scrape_message: null,
    alerts_sent: [],
    manual_inputs: { ...freshManualInputs(), ...(payload.manual_inputs || {}) },
    verdicts: []
  };

  await writeData(data);
  const savedTrade = decorateTrade(data.trades[slot], data.settings);
  try {
    await sendTradeOpenedAlert(savedTrade, data.settings);
  } catch (error) {
    console.error("Telegram trade-open alert failed:", error);
  }
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
  await writeData(data);
  const closedTrade = decorateTrade(data.trades[slot], data.settings);
  try {
    await sendTradeClosedAlert(closedTrade, data.settings);
  } catch (error) {
    console.error("Telegram trade-close alert failed:", error);
  }
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
  data.trades[slot].manual_inputs = mergedManual;
  if (activeOptionStratUrl && activeOptionStratUrl !== trade.optionstrat_url) {
    data.trades[slot].optionstrat_url = activeOptionStratUrl;
  }

  const currentPl = normalizePercentValue(scraped.metrics?.current_pl_pct);
  if (currentPl === null) {
    const partialDte = coalesceMetric(scraped.metrics?.current_dte, deriveCurrentDte(data.trades[slot], data.settings));
    data.trades[slot].last_check = new Date().toISOString();
    data.trades[slot].last_scrape_message = scraped.message;
    data.trades[slot].last_metrics = buildUpdatedLastMetrics(
      trade.last_metrics,
      null,
      partialDte,
      Number(trade.hwm_pct || 0),
      trade.last_metrics?.trade_value_trend_last_24h ?? null,
      trade.last_metrics?.vix_change_from_entry ?? null
    );
    await writeData(data);
    return {
      ok: false,
      requiresManualInput: false,
      message: scraped.message,
      scrape: scraped,
      trade: decorateTrade(data.trades[slot], data.settings)
    };
  }

  const result = await persistTradeEvaluation(
    data,
    slot,
    {
      current_pl_pct: currentPl,
      hwm_pct: scraped.metrics?.hwm_pct,
      current_dte: scraped.metrics?.current_dte,
      source: "optionstrat-poll"
    },
    scraped.message,
    "optionstrat-poll"
  );

  return { ...result, scrape: scraped };
}

export async function updateTradeFromApi(payload) {
  const data = await readData();
  const slot = getSlotById(data.trades, payload.trade_id);
  const trade = data.trades[slot];
  const nextProfitTarget = normalizeTargetPercent(payload.profit_target_pct) ?? trade.profit_target_pct;

  data.trades[slot] = {
    ...trade,
    status: trade.status === "EMPTY" ? "OPEN" : trade.status,
    entry_date: payload.entry_date || trade.entry_date,
    expiration_date: payload.expiration_date || trade.expiration_date || deriveExpirationDate(trade),
    net_premium: payload.net_debit === undefined ? trade.net_premium : Number(payload.net_debit),
    premium_per_contract: payload.net_debit === undefined ? trade.premium_per_contract : Number(payload.net_debit),
    profit_target_pct: nextProfitTarget,
    contracts: payload.contracts === undefined ? trade.contracts : Number(payload.contracts)
  };

  const result = await persistTradeEvaluation(
    data,
    slot,
    {
      current_pl_pct: payload.current_pnl_pct,
      hwm_pct: payload.high_water_mark,
      current_dte: payload.dte,
      source: "api-update"
    },
    "External trade update received.",
    "api-update"
  );

  return {
    status: "ok",
    trade_id: result.trade.id,
    high_water_mark: result.trade.hwm_pct,
    trade_status: result.trade.status === "OPEN" ? "active" : String(result.trade.status || "unknown").toLowerCase(),
    dte: result.trade.last_metrics?.current_dte ?? deriveCurrentDte(result.trade, data.settings)
  };
}

export async function runScheduledChecks() {
  const dashboard = await getDashboardData();
  const openTrades = Object.values(dashboard.trades).filter((trade) => trade.status === "OPEN");
  const results = [];
  for (const trade of openTrades) {
    results.push(await checkTrade(trade.id, trade.manual_inputs));
  }
  return results;
}

export async function pollOpenTradesForHwm() {
  return runScheduledChecks();
}

export async function triggerTelegramTest() {
  const data = await readData();
  return sendTestAlert(data.settings);
}
