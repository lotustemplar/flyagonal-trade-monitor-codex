import { withBrowser } from "./browser.js";

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/[^0-9.-]/g, "");
  return normalized ? Number(normalized) : null;
}

function extractPercent(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = parseNumber(match[1]);
      if (value !== null && !Number.isNaN(value)) return value;
    }
  }
  return null;
}

function extractInteger(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = parseNumber(match[1]);
      if (value !== null && !Number.isNaN(value)) return Math.round(value);
    }
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
    await page.waitForTimeout(1800);

    const text = await page.evaluate(() => {
      const bodyText = document.body?.innerText || "";
      const interesting = Array.from(document.querySelectorAll("main, section, article, div, span"))
        .map((node) => (node.textContent || "").trim())
        .filter((value) => /p\/l|profit|dte|max|highest|return|gain|loss/i.test(value))
        .slice(0, 120)
        .join("\n");
      return `${bodyText}\n${interesting}`;
    });

    const currentPl = extractPercent(text, [
      /Current\s*P\/L[^-\d]*(-?\d+(?:\.\d+)?)%/i,
      /\bP\/L\b[^-\d]*(-?\d+(?:\.\d+)?)%/i,
      /Profit\/Loss[^-\d]*(-?\d+(?:\.\d+)?)%/i,
      /Today[^-\d]*(-?\d+(?:\.\d+)?)%/i
    ]);

    const highestPnlYet = extractPercent(text, [
      /Highest\s*P\/L\s*Yet[^-\d]*(\d+(?:\.\d+)?)%/i,
      /Max\s*Profit[^-\d]*(\d+(?:\.\d+)?)%/i,
      /Max\s*P\/L[^-\d]*(\d+(?:\.\d+)?)%/i,
      /\bHWM\b[^-\d]*(\d+(?:\.\d+)?)%/i
    ]);

    const currentDte = extractInteger(text, [
      /\b(\d+)\s*DTE\b/i,
      /\bDTE[^0-9]*(\d+)\b/i,
      /Days\s+to\s+Exp(?:iry|iration)?[^0-9]*(\d+)/i
    ]);

    const hasCurrentPl = currentPl !== null;
    const hasAnyMetrics = currentPl !== null || highestPnlYet !== null || currentDte !== null;

    return {
      ok: hasCurrentPl,
      requiresManualInput: false,
      message: hasCurrentPl
        ? "OptionStrat metrics scraped successfully."
        : hasAnyMetrics
          ? "OptionStrat was only partially readable. Current P/L could not be confirmed from the page."
          : "OptionStrat scrape could not find trade metrics. Open the saved trade page and confirm the link still exposes live values.",
      metrics: {
        current_pl_pct: currentPl,
        hwm_pct: highestPnlYet,
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
