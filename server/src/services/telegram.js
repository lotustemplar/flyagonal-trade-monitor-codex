function getTelegramConfig(settings) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = settings.telegram_chat_id || process.env.TELEGRAM_CHAT_ID;
  return { enabled: Boolean(settings.telegram_alerts_enabled && token && chatId), token, chatId };
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function postTelegramMessage(message, settings) {
  const config = getTelegramConfig(settings);
  if (!config.enabled) {
    return { ok: false, skipped: true, reason: "Telegram alerts are disabled or incomplete." };
  }

  const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.chatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram send failed: ${response.status} ${body}`);
  }

  return { ok: true };
}

export function shouldAlertForVerdict(verdict) {
  return Boolean(verdict) && verdict.rule !== "HOLD";
}

export function buildVerdictAlertKey(verdict, trade) {
  return `${trade.id}:${trade.day_number}:${verdict.rule}:${verdict.verdict}`;
}

export async function sendTradeOpenedAlert(trade, settings) {
  const message = [
    "🟦 <b>Flyagonal Trade Opened</b>",
    `<b>${escapeHtml(trade.label)} slot:</b> ${escapeHtml(trade.id)}`,
    `<b>Entry date:</b> ${escapeHtml(trade.entry_date)}`,
    `<b>S/L ratio:</b> ${Number(trade.sl_ratio || 0).toFixed(3)}`,
    `<b>Net premium:</b> $${Number(trade.net_premium || 0).toFixed(2)}`,
    `<b>Next move:</b> Paste/save the OptionStrat link, then run the first temperature check.`
  ].join("\n");

  return postTelegramMessage(message, settings);
}

export async function sendVerdictAlert(trade, verdict, settings) {
  const metrics = trade.last_metrics || {};
  const message = [
    "🟨 <b>Flyagonal Checkpoint</b>",
    `<b>${escapeHtml(trade.label)}:</b> ${escapeHtml(trade.id)}`,
    `<b>Verdict:</b> ${escapeHtml(verdict.verdict)}`,
    `<b>Rule:</b> ${escapeHtml(verdict.rule)}`,
    `<b>Day:</b> ${trade.day_number}`,
    `<b>HWM:</b> ${Number(trade.hwm_pct || 0).toFixed(1)}%`,
    `<b>P/L:</b> ${Number(metrics.current_pl_pct || 0).toFixed(1)}%`,
    `<b>DTE:</b> ${metrics.current_dte ?? "n/a"}`,
    "",
    escapeHtml(verdict.reason)
  ].join("\n");

  return postTelegramMessage(message, settings);
}

export async function sendTradeClosedAlert(trade, settings) {
  const message = [
    "🟥 <b>Flyagonal Trade Closed</b>",
    `<b>${escapeHtml(trade.label)} slot:</b> ${escapeHtml(trade.id)}`,
    `<b>Status:</b> CLOSED`,
    `<b>Next move:</b> Review the verdict history, then prepare the next qualified setup.`
  ].join("\n");
  return postTelegramMessage(message, settings);
}

export async function sendTestAlert(settings) {
  return postTelegramMessage(["✅ <b>Flyagonal Telegram Test</b>", "Alerts are connected.", "You will receive milestone and checkpoint notifications from the monitor."].join("\n"), settings);
}
