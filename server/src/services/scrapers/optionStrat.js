import { withBrowser } from "./browser.js";

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/[^0-9.+-]/g, "");
  return normalized ? Number(normalized) : null;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractPercent(text, patterns) {
  const normalized = normalizeText(text);
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const value = parseNumber(match[1]);
    if (value !== null && !Number.isNaN(value)) return value;
  }
  return null;
}

function extractInteger(text, patterns) {
  const normalized = normalizeText(text);
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const value = parseNumber(match[1]);
    if (value !== null && !Number.isNaN(value)) return Math.round(value);
  }
  return null;
}

function firstValue(values) {
  for (const value of values) {
    if (value !== null && value !== undefined && !Number.isNaN(value)) return value;
  }
  return null;
}

function collectPercentFromItems(items, patterns) {
  for (const item of items) {
    const text = [item.text, item.title, item.aria].filter(Boolean).join(" ");
    const value = extractPercent(text, patterns);
    if (value !== null) return value;
  }
  return null;
}

function collectIntegerFromItems(items, patterns) {
  for (const item of items) {
    const text = [item.text, item.title, item.aria].filter(Boolean).join(" ");
    const value = extractInteger(text, patterns);
    if (value !== null) return value;
  }
  return null;
}

export async function scrapeOptionStrat(url, settings) {
  if (!url) {
    return {
      ok: false,
      requiresManualInput: false,
      message: "OptionStrat URL is missing.",
      metrics: { current_pl_pct: null, hwm_pct: null, current_dte: null }
    };
  }

  return withBrowser(async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: settings.manual_scrape_timeout_ms });
    await page.waitForLoadState("networkidle", { timeout: settings.manual_scrape_timeout_ms }).catch(() => {});
    await page.waitForFunction(
      () => {
        const text = document.body?.innerText || "";
        return !/loading\.{0,3}/i.test(text) && text.length > 200;
      },
      { timeout: settings.manual_scrape_timeout_ms }
    ).catch(() => {});
    await page.waitForSelector(
      'span[class*="StrategyStatsPanel_value"], div[class*="Alert_alert"], span.green, span.red',
      { timeout: settings.manual_scrape_timeout_ms }
    ).catch(() => {});
    await page.waitForTimeout(2500);

    const snapshot = await page.evaluate(() => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const toItem = (node) => ({
        text: normalize(node.textContent || ""),
        title: normalize(node.getAttribute("title") || ""),
        aria: normalize(node.getAttribute("aria-label") || ""),
        className: typeof node.className === "string" ? node.className : ""
      });
      const pick = (selector) => Array.from(document.querySelectorAll(selector)).map(toItem).filter((item) => item.text || item.title || item.aria);

      return {
        title: normalize(document.title || ""),
        bodyText: normalize(document.body?.innerText || ""),
        headers: pick('span[class*="StrategyStatsPanel_header"]'),
        values: pick('span[class*="StrategyStatsPanel_value"]'),
        alerts: pick('div[class*="Alert_alert"]'),
        colorSpans: pick('span.green, span.red, .green, .red'),
        interesting: pick('main span, main div, main h1, main h2, main h3, [class*="StrategyStatsPanel"]')
          .filter((item) => /gain|loss|p\/l|return since|expiration|expirations|dte|max|highest|profit/i.test(item.text))
          .slice(0, 250)
      };
    });

    const combinedText = [
      snapshot.title,
      snapshot.bodyText,
      ...snapshot.headers.map((item) => item.text),
      ...snapshot.values.map((item) => item.text),
      ...snapshot.alerts.map((item) => item.text),
      ...snapshot.interesting.map((item) => item.text)
    ].join("\n");

    const currentPl = firstValue([
      collectPercentFromItems(snapshot.alerts, [
        /([+-]?\d+(?:\.\d+)?)%\s*return\s*since/i,
        /([+-]?\d+(?:\.\d+)?)%\s*since/i,
        /\(([+-]?\d+(?:\.\d+)?)%\)/i
      ]),
      collectPercentFromItems(snapshot.values, [
        /\(([+-]?\d+(?:\.\d+)?)%\)/i,
        /([+-]?\d+(?:\.\d+)?)%/i
      ]),
      collectPercentFromItems(snapshot.colorSpans, [
        /\(([+-]?\d+(?:\.\d+)?)%\)/i,
        /([+-]?\d+(?:\.\d+)?)%\s*return\s*since/i,
        /^([+-]?\d+(?:\.\d+)?)%$/i,
        /([+-]?\d+(?:\.\d+)?)%/i
      ]),
      extractPercent(combinedText, [
        /Unrealized\s*Gain[^\n]*?\(([+-]?\d+(?:\.\d+)?)%\)/i,
        /Unrealized\s*Gain[^\n]*?([+-]?\d+(?:\.\d+)?)%/i,
        /([+-]?\d+(?:\.\d+)?)%\s*return\s*since/i,
        /([+-]?\d+(?:\.\d+)?)%\s*since\s+[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}/i
      ])
    ]);

    const highestPnlYet = firstValue([
      collectPercentFromItems(snapshot.interesting, [
        /Highest\s*P\/?L\s*Yet[^\d+-]*([+-]?\d+(?:\.\d+)?)%/i,
        /Max\s*Profit[^\d+-]*([+-]?\d+(?:\.\d+)?)%/i,
        /Max\s*P\/?L[^\d+-]*([+-]?\d+(?:\.\d+)?)%/i,
        /\bHWM\b[^\d+-]*([+-]?\d+(?:\.\d+)?)%/i
      ]),
      extractPercent(combinedText, [
        /Highest\s*P\/?L\s*Yet[^\d+-]*([+-]?\d+(?:\.\d+)?)%/i,
        /Max\s*Profit[^\d+-]*([+-]?\d+(?:\.\d+)?)%/i,
        /Max\s*P\/?L[^\d+-]*([+-]?\d+(?:\.\d+)?)%/i
      ])
    ]);

    const currentDte = firstValue([
      collectIntegerFromItems(snapshot.interesting, [
        /Expirations?\s*:?\s*(\d+)d\b/i,
        /\b(\d+)\s*DTE\b/i,
        /\bDTE[^0-9]*(\d+)\b/i,
        /Days\s+to\s+Exp(?:iry|iration)?[^0-9]*(\d+)/i
      ]),
      extractInteger(combinedText, [
        /Expirations?\s*:?\s*(\d+)d\b/i,
        /\b(\d+)\s*DTE\b/i,
        /\bDTE[^0-9]*(\d+)\b/i,
        /Days\s+to\s+Exp(?:iry|iration)?[^0-9]*(\d+)/i
      ])
    ]);

    const finalHwm = firstValue([highestPnlYet, currentPl]);
    const hasCurrentPl = currentPl !== null;
    const hasAnyMetrics = currentPl !== null || finalHwm !== null || currentDte !== null;

    return {
      ok: hasCurrentPl,
      requiresManualInput: false,
      message: hasCurrentPl
        ? "OptionStrat metrics scraped successfully."
        : hasAnyMetrics
          ? "OptionStrat was only partially readable. Current P/L could not be confirmed from the page yet."
          : "OptionStrat scrape could not find trade metrics. The saved trade page is still rendering like a loading shell.",
      metrics: {
        current_pl_pct: currentPl,
        hwm_pct: finalHwm,
        current_dte: currentDte
      }
    };
  }).catch((error) => ({
    ok: false,
    requiresManualInput: false,
    message: `OptionStrat scrape failed: ${error.message}`,
    metrics: { current_pl_pct: null, hwm_pct: null, current_dte: null }
  }));
}
