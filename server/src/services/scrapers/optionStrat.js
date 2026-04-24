import { withBrowser } from "./browser.js";

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/[^0-9.+-]/g, "");
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

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
    await page.waitForTimeout(2500);

    const snapshot = await page.evaluate(() => {
      const bodyText = document.body?.innerText || "";
      const interesting = Array.from(document.querySelectorAll("main, section, article, div, span, h1, h2, h3"))
        .map((node) => (node.textContent || "").trim())
        .filter((value) => /since|expiration|expirations|profit|loss|p\/l|max|highest|return|gain|\bd\b/i.test(value))
        .slice(0, 250)
        .join("\n");
      const ariaLabels = Array.from(document.querySelectorAll("[aria-label], [title]"))
        .map((node) => node.getAttribute("aria-label") || node.getAttribute("title") || "")
        .filter(Boolean)
        .join("\n");
      const scriptText = Array.from(document.querySelectorAll("script"))
        .map((node) => node.textContent || "")
        .filter((value) => /since|expiration|profit|loss|p\/l|max|highest/i.test(value))
        .slice(0, 40)
        .join("\n");
      return `${bodyText}\n${interesting}\n${ariaLabels}\n${scriptText}`;
    });

    const text = normalizeText(snapshot);

    const currentPl = extractPercent(text, [
      /([+-]?\d+(?:\.\d+)?)%\s+since\b/i,
      /Current\s*P\/?L[^\d+-]*([+-]?\d+(?:\.\d+)?)%/i,
      /\bP\/?L\b[^\d+-]*([+-]?\d+(?:\.\d+)?)%/i,
      /Profit\/?Loss[^\d+-]*([+-]?\d+(?:\.\d+)?)%/i,
      /Today[^\d+-]*([+-]?\d+(?:\.\d+)?)%/i
    ]);

    const highestPnlYet = extractPercent(text, [
      /Highest\s*P\/?L\s*Yet[^\d+-]*([+-]?\d+(?:\.\d+)?)%/i,
      /Max\s*Profit[^\d+-]*([+-]?\d+(?:\.\d+)?)%/i,
      /Max\s*P\/?L[^\d+-]*([+-]?\d+(?:\.\d+)?)%/i,
      /\bHWM\b[^\d+-]*([+-]?\d+(?:\.\d+)?)%/i
    ]);

    const currentDte = extractInteger(text, [
      /Expirations?[^\d]*(\d+)d\b/i,
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
          ? "OptionStrat was only partially readable. Current P/L could not be confirmed from the page yet."
          : "OptionStrat scrape could not find trade metrics. The page appears to be rendering as a loading shell instead of exposing the live strategy values.",
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
