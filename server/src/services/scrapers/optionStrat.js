import { withBrowser } from "./browser.js";

function extractPercent(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function extractInteger(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

export async function scrapeOptionStrat(url, settings) {
  if (!url) {
    return { ok: false, requiresManualInput: true, message: "OptionStrat URL is missing.", metrics: { current_pl_pct: null, hwm_pct: null, current_dte: null } };
  }

  return withBrowser(async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: settings.manual_scrape_timeout_ms });
    await page.waitForLoadState("networkidle", { timeout: settings.manual_scrape_timeout_ms }).catch(() => {});
    await page.waitForTimeout(1500);

    const text = await page.evaluate(() => document.body?.innerText || "");
    const currentPl = extractPercent(text, [/P\/L[^-\d]*(-?\d+(?:\.\d+)?)%/i, /Profit\/Loss[^-\d]*(-?\d+(?:\.\d+)?)%/i, /Current[^-\d]*(-?\d+(?:\.\d+)?)%/i]);
    const maxOrHwm = extractPercent(text, [/HWM[^-\d]*(\d+(?:\.\d+)?)%/i, /Max Profit[^-\d]*(\d+(?:\.\d+)?)%/i, /Max P\/L[^-\d]*(\d+(?:\.\d+)?)%/i]);
    const currentDte = extractInteger(text, [/\b(\d+)\s*DTE\b/i, /\bDTE[^0-9]*(\d+)\b/i, /\bDays to Exp(?:iry|iration)?[^0-9]*(\d+)\b/i]);
    const hasEnough = currentPl !== null && currentDte !== null;

    return {
      ok: hasEnough,
      requiresManualInput: !hasEnough,
      message: hasEnough ? "OptionStrat metrics scraped successfully." : "OptionStrat scrape incomplete. Manual P/L, HWM, and DTE inputs are required.",
      metrics: { current_pl_pct: currentPl, hwm_pct: maxOrHwm, current_dte: currentDte }
    };
  }).catch((error) => ({ ok: false, requiresManualInput: true, message: `OptionStrat scrape failed: ${error.message}`, metrics: { current_pl_pct: null, hwm_pct: null, current_dte: null } }));
}
